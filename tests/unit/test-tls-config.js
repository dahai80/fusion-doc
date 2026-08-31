// =============================================================================
// 内置 TLS 修复: 行为测试 — config.tls 配置降级 + 半配置可见失败
// 三态: 两路径空 → HTTP; 两路径同设 → HTTPS; 仅设其一 → 启动 fail visibly (不静默降级)
// =============================================================================
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// config.js 读 env 时缓存, 每用例前清 require 缓存 + 还原 env
function loadConfig() {
    delete require.cache[require.resolve('../../server/config')];
    return require('../../server/config');
}

test('TLS: 两路径均空 → redirectHttp 默认开, 不启 HTTPS', () => {
    delete process.env.FUSION_DOC_TLS_CERT;
    delete process.env.FUSION_DOC_TLS_KEY;
    delete process.env.FUSION_DOC_TLS_CA;
    delete process.env.FUSION_DOC_TLS_REDIRECT;
    const cfg = loadConfig();
    assert.equal(cfg.tls.certPath, '', 'certPath 空默认');
    assert.equal(cfg.tls.keyPath, '', 'keyPath 空默认');
    assert.equal(cfg.tls.caPath, '', 'caPath 空默认');
    assert.equal(cfg.tls.redirectHttp, true, 'redirectHttp 默认 true');
});

test('TLS: 两路径同设 → 读 env, redirectHttp=0 可关', () => {
    process.env.FUSION_DOC_TLS_CERT = '/tmp/cert.pem';
    process.env.FUSION_DOC_TLS_KEY = '/tmp/key.pem';
    process.env.FUSION_DOC_TLS_CA = '/tmp/ca.pem';
    process.env.FUSION_DOC_TLS_REDIRECT = '0';
    try {
        const cfg = loadConfig();
        assert.equal(cfg.tls.certPath, '/tmp/cert.pem');
        assert.equal(cfg.tls.keyPath, '/tmp/key.pem');
        assert.equal(cfg.tls.caPath, '/tmp/ca.pem');
        assert.equal(cfg.tls.redirectHttp, false, '显式 0 关闭跳转');
    } finally {
        delete process.env.FUSION_DOC_TLS_CERT;
        delete process.env.FUSION_DOC_TLS_KEY;
        delete process.env.FUSION_DOC_TLS_CA;
        delete process.env.FUSION_DOC_TLS_REDIRECT;
    }
});

// app.js 首次 require 时缓存 config (含当时 env)。后续测试改 env 再 require app 拿到的是旧 config。
// 故每测须先清 app + config 缓存, 确保以本测设置的 env 重新求值 config。
function loadAppFresh() {
    delete require.cache[require.resolve('../../server/config')];
    delete require.cache[require.resolve('../../server/app')];
    return require('../../server/app');
}

test('TLS 半配置: 仅 cert 有, key 缺 — _buildTlsOptions 须 fail visibly', async (t) => {
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
        assert.throws(() => app._buildTlsOptions(), /process\.exit/, '半配置须 fail visibly (process.exit)');
        assert.equal(exitCalled, true, 'process.exit 已触发');
    } finally {
        process.exit = origExit;
    }
});

test('TLS 全配置且文件可读 → _buildTlsOptions 返回 opts 并标记 _tlsEnabled', async (t) => {
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
    assert.equal(app._tlsEnabled, true, '_tlsEnabled 已置位');
    assert.ok(opts, 'opts 非空');
    assert.equal(opts.minVersion, 'TLSv1.2', '强制最低 TLSv1.2');
    assert.equal(opts.honorCipherOrder, true, '服务端主导 cipher 顺序');
    assert.equal(opts.cert.toString(), 'FAKECERT');
    assert.equal(opts.key.toString(), 'FAKEKEY');
});

test('TLS 全配置但文件不存在 → fail visibly', () => {
    process.env.FUSION_DOC_TLS_CERT = '/tmp/nonexistent-cert-' + process.pid + '.pem';
    process.env.FUSION_DOC_TLS_KEY = '/tmp/nonexistent-key-' + process.pid + '.pem';
    try {
        const FusionDocApp = loadAppFresh();
        const app = new FusionDocApp();
        const origExit = process.exit;
        process.exit = (code) => { throw new Error(`process.exit(${code})`); };
        try {
            assert.throws(() => app._buildTlsOptions(), /process\.exit/, '文件缺失须 fail visibly');
        } finally {
            process.exit = origExit;
        }
    } finally {
        delete process.env.FUSION_DOC_TLS_CERT;
        delete process.env.FUSION_DOC_TLS_KEY;
    }
});
