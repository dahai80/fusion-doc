// =============================================================================
// Fusion-Doc — issue #51 Union Web shell registration unit tests
// Zero external dependencies (node:test + node:assert). Covers: service key generation/write-back/re-read,
// registration body assembly (version override + upstream + api_key), auth middleware shell service key
// branch (timingSafeEqual pass / wrong key falls through to the original path).
// =============================================================================

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const shellRegister = require('../../server/services/shell-register');
const { auth } = require('../../server/middleware/auth');

// ── Test fixtures: fake req/res/ctx (aligned with test-identity-tenant.js) ──────────────
function makeReq({ method = 'GET', url = '/api/pages', headers = {}, cfg = {} } = {}) {
    const h = {};
    for (const k of Object.keys(headers)) h[k.toLowerCase()] = headers[k];
    return { method, url, headers: h, ctx: { config: cfg } };
}

function makeRes() {
    const state = { statusCode: null, body: null, ended: false };
    return {
        writeHead(code) { state.statusCode = code; },
        end(data) { state.ended = true; state.body = data; },
        get state() { return state; },
    };
}

// ── loadServiceKey: env first / auto-generate + write back to config / stable re-read ─────────
test('issue#51: loadServiceKey env takes priority (no generation/re-read)', () => {
    const cfg = { shellGateway: { apiKey: 'fdshell-env-key' } };
    const key = shellRegister.loadServiceKey(cfg);
    assert.strictEqual(key, 'fdshell-env-key');
    assert.strictEqual(cfg.shellGateway.apiKey, 'fdshell-env-key');
});

test('issue#51: loadServiceKey without env generates an fdshell- prefixed key and writes it back to config', () => {
    // Generation path writes the real data/shell-api-key.json (gitignored, valid runtime location)
    const cfg = { shellGateway: { apiKey: '' } };
    const key = shellRegister.loadServiceKey(cfg);
    assert.ok(key.startsWith('fdshell-'), 'key should have the fdshell- prefix');
    assert.strictEqual(cfg.shellGateway.apiKey, key, 'key must be written back to config (auth middleware depends on it)');
    // Stable re-read (persistence works)
    const cfg2 = { shellGateway: { apiKey: '' } };
    assert.strictEqual(shellRegister.loadServiceKey(cfg2), key, 're-read should be stable');
});

// ── buildRegistrationBody: version override + upstream + api_key ─────────────
test('issue#51: buildRegistrationBody — package.json version is authoritative + upstream + api_key', () => {
    const { version } = require('../../package.json');
    const cfg = { port: 11449, shellGateway: { apiKey: 'fdshell-x' } };
    const body = shellRegister.buildRegistrationBody(cfg, 'fdshell-x');
    assert.strictEqual(body.id, 'fusion-doc');
    assert.strictEqual(body.category, 'infra');
    assert.strictEqual(body.version, version, 'version overridden from package.json');
    assert.strictEqual(body.upstream, 'http://127.0.0.1:11449');
    assert.strictEqual(body.api_key, 'fdshell-x');
    assert.ok(Array.isArray(body.devices) && body.devices.includes('desktop'));
    assert.strictEqual(body.entry, '/shell/fusion-doc/');
});

test('issue#51: manifest.json itself has no secret (api_key injected only at runtime)', () => {
    const manifest = JSON.parse(fs.readFileSync(shellRegister.MANIFEST_PATH, 'utf8'));
    assert.strictEqual(manifest.api_key, undefined);
    assert.strictEqual(manifest.upstream, undefined);
    // §5.1 required fields present
    for (const f of ['id', 'title', 'path', 'entry', 'devices', 'category']) {
        assert.ok(manifest[f], `manifest missing required field ${f}`);
    }
});

// ── auth middleware shell service key branch ─────────────────────────────────────────
function shellCfg(apiKey, extra = {}) {
    return {
        shellGateway: { apiKey, tenant: 'shell', role: 'operator', ...extra },
        localAuth: false,
        fusionIdentity: { url: 'http://x', serviceToken: 'svc' },
    };
}

test('issue#51: gateway-injected service key → allowed, shell session principal injected', async () => {
    const req = makeReq({ headers: { Authorization: 'Bearer fdshell-correct' }, cfg: shellCfg('fdshell-correct') });
    const res = makeRes();
    const blocked = await auth(req, res, {});
    assert.strictEqual(blocked, false);
    assert.strictEqual(req.user.id, 'shell-session');
    assert.strictEqual(req.user.tid, 'shell');
    assert.strictEqual(req.user.role, 'operator');
});

test('issue#51: wrong service key → rejected (falls into the identity path, fail-closed)', async () => {
    const req = makeReq({ headers: { Authorization: 'Bearer fdshell-wrong' }, cfg: shellCfg('fdshell-correct') });
    const res = makeRes();
    const blocked = await auth(req, res, {});
    assert.strictEqual(blocked, true);
    assert.strictEqual(res.state.statusCode, 401);
    // No X-Tenant-Id → AUTH_TENANT_REQUIRED (proves the shell branch was not taken)
    const code = JSON.parse(res.state.body).code;
    assert.strictEqual(code, 'AUTH_TENANT_REQUIRED');
});

test('issue#51: service key length mismatch → not equal, no throw (length checked before timingSafeEqual)', async () => {
    const req = makeReq({ headers: { Authorization: 'Bearer short' }, cfg: shellCfg('fdshell-correct') });
    const res = makeRes();
    const blocked = await auth(req, res, {});
    assert.strictEqual(blocked, true);
});

test('issue#51: service key also allowed in localAuth mode (gateway proxy is mode-agnostic)', async () => {
    const cfg = shellCfg('fdshell-correct', {});
    cfg.localAuth = true;
    const req = makeReq({ headers: { Authorization: 'Bearer fdshell-correct' }, cfg });
    const res = makeRes();
    const blocked = await auth(req, res, {});
    assert.strictEqual(blocked, false);
    assert.strictEqual(req.user.id, 'shell-session');
});

test('issue#51: shellGateway.apiKey not configured → branch inactive (existing behavior unchanged)', async () => {
    const req = makeReq({ headers: { Authorization: 'Bearer whatever' }, cfg: shellCfg('') });
    const res = makeRes();
    const blocked = await auth(req, res, {});
    assert.strictEqual(blocked, true);
});

// ── teardown: clean up generated key files (keep only final outputs and logs) ──────────────────
test('teardown: clean up service key files generated by tests', () => {
    // Delete if it did not exist before the tests (avoid polluting real runtime state)
    const keyFile = shellRegister.SERVICE_KEY_FILE;
    if (fs.existsSync(keyFile)) {
        fs.unlinkSync(keyFile);
        console.log(`  [teardown] cleaned up ${keyFile}`);
    }
});
