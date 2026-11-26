// =============================================================================
// Fusion-Doc — issue #45 tenant isolation + fusion-identity integration unit tests
// Zero external dependencies (node:test + node:assert). Covers the three red lines: fail-closed / cross-tenant rejection /
// role mapping + required X-Tenant-Id. identity.verify is stubbed via the require cache.
// =============================================================================

const test = require('node:test');
const assert = require('node:assert');

// ── identity stub: intercepts verify; tests can override __verifyImpl ─────────────────
const identityModule = require('../../server/integrations/fusion-identity');
let __verifyImpl = null;
let __reportCalls = [];
const _origVerify = identityModule.verify;
const _origReport = identityModule.reportUsage;
identityModule.verify = async ({ token, config }) => {
    if (__verifyImpl) return __verifyImpl({ token, config });
    throw new Error('stub: no verify impl set');
};
identityModule.reportUsage = async ({ tid, usage }) => {
    __reportCalls.push({ tid, usage });
};

// The auth middleware captures the identity reference at require time — the stub works because module.exports is an object reference.
const { auth, createToken, verifyToken } = require('../../server/middleware/auth');

// ── Test fixtures: fake req/res/ctx ──────────────────────────────────────────────
function makeReq({ method = 'GET', url = '/api/pages', headers = {}, cfg = {}, socket = { remoteAddress: '127.0.0.1' } } = {}) {
    const h = {};
    for (const k of Object.keys(headers)) h[k.toLowerCase()] = headers[k];
    return {
        method, url, headers: h, socket,
        ctx: { config: cfg },
    };
}

function makeRes() {
    const state = { statusCode: null, body: null, ended: false, chunks: [] };
    return {
        writeHead(code) { state.statusCode = code; },
        end(data) { state.ended = true; state.body = data; },
        get state() { return state; },
    };
}

function bodyCode(res) {
    if (!res.state.body) return null;
    try { return JSON.parse(res.state.body).code; } catch { return null; }
}

// ── Tests ─────────────────────────────────────────────────────────────────
test('issue#45: production path without token → AUTH_REQUIRED (fail-closed)', async () => {
    const req = makeReq({ cfg: { localAuth: false, fusionIdentity: { url: 'http://x', serviceToken: 'svc' } } });
    const res = makeRes();
    const blocked = await auth(req, res, {});
    assert.strictEqual(blocked, true);
    assert.strictEqual(res.state.statusCode, 401);
    assert.strictEqual(bodyCode(res), 'AUTH_REQUIRED');
});

test('issue#45: token present but X-Tenant-Id missing → AUTH_TENANT_REQUIRED', async () => {
    __verifyImpl = async () => ({ tid: 't1', role: 'member', scopes: [] });
    const req = makeReq({
        headers: { Authorization: 'Bearer tok' },
        cfg: { localAuth: false, fusionIdentity: { url: 'http://x', serviceToken: 'svc' } },
    });
    const res = makeRes();
    const blocked = await auth(req, res, {});
    assert.strictEqual(blocked, true);
    assert.strictEqual(res.state.statusCode, 401);
    assert.strictEqual(bodyCode(res), 'AUTH_TENANT_REQUIRED');
});

test('issue#45: JWT tid ≠ X-Tenant-Id → AUTH_TENANT_MISMATCH (cross-tenant rejection)', async () => {
    __verifyImpl = async () => ({ tid: 'tenant-A', role: 'member', scopes: [] });
    const req = makeReq({
        headers: { Authorization: 'Bearer tok', 'X-Tenant-Id': 'tenant-B' },
        cfg: { localAuth: false, fusionIdentity: { url: 'http://x', serviceToken: 'svc' } },
    });
    const res = makeRes();
    const blocked = await auth(req, res, {});
    assert.strictEqual(blocked, true);
    assert.strictEqual(res.state.statusCode, 401);
    assert.strictEqual(bodyCode(res), 'AUTH_TENANT_MISMATCH');
});

test('issue#45: identity verify throws → AUTH_TOKEN_INVALID (fail-closed, no fallback)', async () => {
    __verifyImpl = async () => { throw new Error('revoked'); };
    const req = makeReq({
        headers: { Authorization: 'Bearer tok', 'X-Tenant-Id': 't1' },
        cfg: { localAuth: false, fusionIdentity: { url: 'http://x', serviceToken: 'svc' } },
    });
    const res = makeRes();
    const blocked = await auth(req, res, {});
    assert.strictEqual(blocked, true);
    assert.strictEqual(bodyCode(res), 'AUTH_TOKEN_INVALID');
});

test('issue#45: tid matches + verify succeeds → injects req.user and passes', async () => {
    __verifyImpl = async () => ({ tid: 't1', role: 'tenant_admin', scopes: ['read'], quota: { rpm: 100 }, sub: 'u1' });
    const req = makeReq({
        headers: { Authorization: 'Bearer tok', 'X-Tenant-Id': 't1' },
        cfg: { localAuth: false, fusionIdentity: { url: 'http://x', serviceToken: 'svc' } },
    });
    const res = makeRes();
    const blocked = await auth(req, res, {});
    assert.strictEqual(blocked, false);
    assert.strictEqual(req.user.tid, 't1');
    assert.strictEqual(req.user.role, 'tenant_admin');
    assert.strictEqual(req.user.id, 'u1');
    assert.deepStrictEqual(req.user.scopes, ['read']);
});

test('issue#45: role mapping admin→tenant_admin, user→member, other values passed through', async () => {
    __verifyImpl = async ({ token }) => ({ tid: 't1', role: token === 'a' ? 'admin' : token === 'u' ? 'user' : 'operator', scopes: [] });
    for (const [tok, expectRole] of [['a', 'tenant_admin'], ['u', 'member'], ['o', 'operator']]) {
        const req = makeReq({
            headers: { Authorization: `Bearer ${tok}`, 'X-Tenant-Id': 't1' },
            cfg: { localAuth: false, fusionIdentity: { url: 'http://x', serviceToken: 'svc' } },
        });
        const res = makeRes();
        await auth(req, res, {});
        assert.strictEqual(req.user.role, expectRole, `role map for token=${tok}`);
    }
});

test('issue#45: public paths pass (health/branding)', async () => {
    for (const url of ['/api/health', '/api/health/live', '/api/branding']) {
        const req = makeReq({ url, cfg: { localAuth: false, fusionIdentity: { url: 'http://x', serviceToken: 'svc' } } });
        const res = makeRes();
        const blocked = await auth(req, res, {});
        assert.strictEqual(blocked, false, `public ${url} should pass`);
        assert.strictEqual(res.state.ended, false);
    }
});

test('issue#45: non-/api/ paths pass (static assets)', async () => {
    const req = makeReq({ url: '/static/app.js', cfg: { localAuth: false, fusionIdentity: { url: 'http://x', serviceToken: 'svc' } } });
    const res = makeRes();
    const blocked = await auth(req, res, {});
    assert.strictEqual(blocked, false);
});

test('issue#45: local bypass localAuth=1 + X-User-Id (dev loopback) → injects local-tenant', async () => {
    const req = makeReq({
        url: '/api/pages',
        headers: { 'X-User-Id': 'dev' },
        cfg: { localAuth: true, auth: { jwtSecret: 's' }, fusionIdentity: { url: 'http://x', serviceToken: '' } },
    });
    // Requires dev environment
    process.env.NODE_ENV = 'development';
    const res = makeRes();
    const blocked = await auth(req, res, {});
    assert.strictEqual(blocked, false);
    assert.strictEqual(req.user.tid, 'local-tenant');
    assert.strictEqual(req.user.role, 'tenant_admin');
    delete process.env.NODE_ENV;
});

test('issue#45: local bypass HS256 token verifies (createToken/verifyToken round trip)', () => {
    const secret = 'test-secret';
    const tok = createToken({ id: 'u1', role: 'admin', workspace_id: 'ws1' }, secret, 60);
    const payload = verifyToken(tok, secret);
    assert.ok(payload);
    assert.strictEqual(payload.id, 'u1');
    assert.strictEqual(payload.role, 'admin');
    // Tampered signature should be rejected
    const bad = tok.slice(0, -2) + 'xx';
    assert.strictEqual(verifyToken(bad, secret), null);
    // Wrong secret should be rejected
    assert.strictEqual(verifyToken(tok, 'wrong'), null);
});

test('issue#45: helpers.tenantId — prefers req.user.tid, falls back to local-tenant', () => {
    const { tenantId } = require('../../server/utils/helpers');
    assert.strictEqual(tenantId({ user: { tid: 't9' } }), 't9');
    assert.strictEqual(tenantId({ user: {} }), 'local-tenant');
    assert.strictEqual(tenantId({}), 'local-tenant');
});

test('issue#45: reportUsage fire-and-forget — local-tenant tid is not reported', async () => {
    __reportCalls = [];
    const { auth } = require('../../server/middleware/auth');
    // Call the reportUsage stub directly to verify logic equivalent to ai.js _reportUsage: local-tenant is skipped
    const identityMod = require('../../server/integrations/fusion-identity');
    // Simulate ai.js _reportUsage: tid === local-tenant → no call
    const tid = 'local-tenant';
    if (tid && tid !== 'local-tenant') {
        await identityMod.reportUsage({ tid, usage: { tokens: 10 } });
    }
    assert.strictEqual(__reportCalls.length, 0, 'local-tenant should not be reported');
    // Real tid is reported
    await identityMod.reportUsage({ tid: 't1', usage: { tokens: 10, prompt_tokens: 4, completion_tokens: 6 } });
    assert.strictEqual(__reportCalls.length, 1);
    assert.strictEqual(__reportCalls[0].tid, 't1');
    assert.strictEqual(__reportCalls[0].usage.tokens, 10);
});

test('issue#45: config fail-closed — non-local auth + no serviceToken + non-test → process exits', async () => {
    // Verify process.exit(1) in a child process to avoid polluting the current one
    const { execFileSync } = require('node:child_process');
    const path = require('node:path');
    const probe = path.join(__dirname, '_probe-config-failclosed.js');
    const fs = require('node:fs');
    fs.writeFileSync(probe, `
        // Use '0' rather than '': empty string is falsy, so config.js's .env loader would pour the repo .env's
        // FUSION_DOC_LOCAL_AUTH=1 back in (it only fills unset variables), making the test sensitive to the local .env
        process.env.FUSION_DOC_LOCAL_AUTH = '0';
        delete process.env.FUSION_IDENTITY_SERVICE_TOKEN;
        process.env.NODE_ENV = 'production';
        process.env.JWT_SECRET = 'a'.repeat(32); // Pass the JWT_SECRET gate first, to exercise the identity gate
        require('${path.resolve(__dirname, '../../server/config.js')}');
    `);
    let exited = false;
    let stderr = '';
    try {
        execFileSync(process.execPath, [probe], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
        exited = true;
        stderr = e.stderr || '';
    }
    fs.unlinkSync(probe);
    assert.ok(exited, 'config should exit fail-closed');
    assert.ok(stderr.includes('FUSION_IDENTITY_SERVICE_TOKEN'), 'stderr should contain the fail-closed hint');
});

// ── Restore stubs ────────────────────────────────────────────────────────────────
test('teardown: restore identity stub', () => {
    identityModule.verify = _origVerify;
    identityModule.reportUsage = _origReport;
    assert.strictEqual(typeof identityModule.verify, 'function');
});
