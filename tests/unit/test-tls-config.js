// =============================================================================
// Built-in TLS fix: behavior tests — config.tls fallback + visible failure on half configuration
// Three states: both paths empty → HTTP; both set → HTTPS; only one set → startup fails visibly (no silent fallback)
// =============================================================================
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// config.js caches env on load; clear the require cache + restore env before each case
function loadConfig() {
    delete require.cache[require.resolve('../../server/config')];
    return require('../../server/config');
}

test('TLS: both paths empty → redirectHttp on by default, HTTPS not started', () => {
    delete process.env.FUSION_DOC_TLS_CERT;
    delete process.env.FUSION_DOC_TLS_KEY;
    delete process.env.FUSION_DOC_TLS_CA;
    delete process.env.FUSION_DOC_TLS_REDIRECT;
    const cfg = loadConfig();
    assert.equal(cfg.tls.certPath, '', 'certPath defaults to empty');
    assert.equal(cfg.tls.keyPath, '', 'keyPath defaults to empty');
    assert.equal(cfg.tls.caPath, '', 'caPath defaults to empty');
    assert.equal(cfg.tls.redirectHttp, true, 'redirectHttp defaults to true');
});

test('TLS: both paths set → read from env, redirectHttp=0 disables it', () => {
    process.env.FUSION_DOC_TLS_CERT = '/tmp/cert.pem';
    process.env.FUSION_DOC_TLS_KEY = '/tmp/key.pem';
    process.env.FUSION_DOC_TLS_CA = '/tmp/ca.pem';
    process.env.FUSION_DOC_TLS_REDIRECT = '0';
    try {
        const cfg = loadConfig();
        assert.equal(cfg.tls.certPath, '/tmp/cert.pem');
        assert.equal(cfg.tls.keyPath, '/tmp/key.pem');
        assert.equal(cfg.tls.caPath, '/tmp/ca.pem');
        assert.equal(cfg.tls.redirectHttp, false, 'explicit 0 disables redirect');
    } finally {
        delete process.env.FUSION_DOC_TLS_CERT;
        delete process.env.FUSION_DOC_TLS_KEY;
        delete process.env.FUSION_DOC_TLS_CA;
        delete process.env.FUSION_DOC_TLS_REDIRECT;
    }
});

// app.js caches config (including env at that time) on first require; later tests that change env and re-require app get the stale config.
// So each test clears the app + config cache to re-evaluate config with that test's env.
function loadAppFresh() {
    delete require.cache[require.resolve('../../server/config')];
    delete require.cache[require.resolve('../../server/app')];
    return require('../../server/app');
}

test('TLS half configuration: cert only, key missing — _buildTlsOptions must fail visibly', async (t) => {
    const certFile = path.join(require('os').tmpdir(), `tls-test-cert-${process.pid}.pem`);
    fs.writeFileSync(certFile, 'FAKECERT');
    process.env.FUSION_DOC_TLS_CERT = certFile;
    delete process.env.FUSION_DOC_TLS_KEY;
    t.after(() => {
        try { fs.unlinkSync(certFile); } catch (_) { /* noop */ }
        delete process.env.FUSION_DOC_TLS_CERT;
    });

    const FusionDocApp = loadAppFresh();
    const app = new FusionDocApp();
    const origExit = process.exit;
    let exitCalled = false;
    process.exit = (code) => { exitCalled = true; throw new Error(`process.exit(${code})`); };
    try {
        assert.throws(() => app._buildTlsOptions(), /process\.exit/, 'half configuration must fail visibly (process.exit)');
        assert.equal(exitCalled, true, 'process.exit was called');
    } finally {
        process.exit = origExit;
    }
});

test('TLS fully configured with readable files → _buildTlsOptions returns opts and sets _tlsEnabled', async (t) => {
    const tmp = require('os').tmpdir();
    const certFile = path.join(tmp, `tls-test-cert-${process.pid}.pem`);
    const keyFile = path.join(tmp, `tls-test-key-${process.pid}.pem`);
    fs.writeFileSync(certFile, 'FAKECERT');
    fs.writeFileSync(keyFile, 'FAKEKEY');
    process.env.FUSION_DOC_TLS_CERT = certFile;
    process.env.FUSION_DOC_TLS_KEY = keyFile;
    delete process.env.FUSION_DOC_TLS_CA;
    t.after(() => {
        try { fs.unlinkSync(certFile); } catch (_) { /* noop */ }
        try { fs.unlinkSync(keyFile); } catch (_) { /* noop */ }
        delete process.env.FUSION_DOC_TLS_CERT;
        delete process.env.FUSION_DOC_TLS_KEY;
    });

    const FusionDocApp = loadAppFresh();
    const app = new FusionDocApp();
    const opts = app._buildTlsOptions();
    assert.equal(app._tlsEnabled, true, '_tlsEnabled is set');
    assert.ok(opts, 'opts is non-empty');
    assert.equal(opts.minVersion, 'TLSv1.2', 'enforces minimum TLSv1.2');
    assert.equal(opts.honorCipherOrder, true, 'server-preferred cipher order');
    assert.equal(opts.cert.toString(), 'FAKECERT');
    assert.equal(opts.key.toString(), 'FAKEKEY');
});

test('TLS fully configured but files missing → fail visibly', () => {
    process.env.FUSION_DOC_TLS_CERT = '/tmp/nonexistent-cert-' + process.pid + '.pem';
    process.env.FUSION_DOC_TLS_KEY = '/tmp/nonexistent-key-' + process.pid + '.pem';
    try {
        const FusionDocApp = loadAppFresh();
        const app = new FusionDocApp();
        const origExit = process.exit;
        process.exit = (code) => { throw new Error(`process.exit(${code})`); };
        try {
            assert.throws(() => app._buildTlsOptions(), /process\.exit/, 'missing files must fail visibly');
        } finally {
            process.exit = origExit;
        }
    } finally {
        delete process.env.FUSION_DOC_TLS_CERT;
        delete process.env.FUSION_DOC_TLS_KEY;
    }
});
