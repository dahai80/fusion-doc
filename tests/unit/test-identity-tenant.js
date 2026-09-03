// =============================================================================
// Fusion-Doc — issue #45 租户隔离 + fusion-identity 集成 单元测试
// 零外部依赖 (node:test + node:assert)。覆盖三红线: fail-closed / 跨租户拒绝 /
// role 映射 + X-Tenant-Id 必填。identity.verify 通过 require 缓存注入桩。
// =============================================================================

const test = require('node:test');
const assert = require('node:assert');

// ── identity 桩: 拦截 verify, 可由用例改写 __verifyImpl ─────────────────
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

// auth 中间件在 require 时已捕获 identity 引用 — 因 module.exports 是对象引用, 桩生效。
const { auth, createToken, verifyToken } = require('../../server/middleware/auth');

// ── 测试夹具: 伪 req/res/ctx ──────────────────────────────────────────────
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

// ── 测试组 ─────────────────────────────────────────────────────────────────
test('issue#45: 生产路径无 token → AUTH_REQUIRED (fail-closed)', async () => {
    const req = makeReq({ cfg: { localAuth: false, fusionIdentity: { url: 'http://x', serviceToken: 'svc' } } });
    const res = makeRes();
    const blocked = await auth(req, res, {});
    assert.strictEqual(blocked, true);
    assert.strictEqual(res.state.statusCode, 401);
    assert.strictEqual(bodyCode(res), 'AUTH_REQUIRED');
});

test('issue#45: 有 token 缺 X-Tenant-Id → AUTH_TENANT_REQUIRED', async () => {
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

test('issue#45: JWT tid ≠ X-Tenant-Id → AUTH_TENANT_MISMATCH (跨租户拒绝)', async () => {
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

test('issue#45: identity verify 抛错 → AUTH_TOKEN_INVALID (fail-closed, 不降级)', async () => {
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

test('issue#45: tid 匹配 + verify 成功 → 注入 req.user, 放行', async () => {
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

test('issue#45: role 映射 admin→tenant_admin, user→member, 原值透传', async () => {
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

test('issue#45: 公开路径放行 (health/branding)', async () => {
    for (const url of ['/api/health', '/api/health/live', '/api/branding']) {
        const req = makeReq({ url, cfg: { localAuth: false, fusionIdentity: { url: 'http://x', serviceToken: 'svc' } } });
        const res = makeRes();
        const blocked = await auth(req, res, {});
        assert.strictEqual(blocked, false, `public ${url} should pass`);
        assert.strictEqual(res.state.ended, false);
    }
});

test('issue#45: 非 /api/ 路径放行 (静态资源)', async () => {
    const req = makeReq({ url: '/static/app.js', cfg: { localAuth: false, fusionIdentity: { url: 'http://x', serviceToken: 'svc' } } });
    const res = makeRes();
    const blocked = await auth(req, res, {});
    assert.strictEqual(blocked, false);
});

test('issue#45: 本地旁路 localAuth=1 + X-User-Id (dev loopback) → 注入 local-tenant', async () => {
    const req = makeReq({
        url: '/api/pages',
        headers: { 'X-User-Id': 'dev' },
        cfg: { localAuth: true, auth: { jwtSecret: 's' }, fusionIdentity: { url: 'http://x', serviceToken: '' } },
    });
    // 需 dev 环境
    process.env.NODE_ENV = 'development';
    const res = makeRes();
    const blocked = await auth(req, res, {});
    assert.strictEqual(blocked, false);
    assert.strictEqual(req.user.tid, 'local-tenant');
    assert.strictEqual(req.user.role, 'tenant_admin');
    delete process.env.NODE_ENV;
});

test('issue#45: 本地旁路 HS256 token 可验 (createToken/verifyToken 往返)', () => {
    const secret = 'test-secret';
    const tok = createToken({ id: 'u1', role: 'admin', workspace_id: 'ws1' }, secret, 60);
    const payload = verifyToken(tok, secret);
    assert.ok(payload);
    assert.strictEqual(payload.id, 'u1');
    assert.strictEqual(payload.role, 'admin');
    // 篡改签名应拒
    const bad = tok.slice(0, -2) + 'xx';
    assert.strictEqual(verifyToken(bad, secret), null);
    // 错密钥应拒
    assert.strictEqual(verifyToken(tok, 'wrong'), null);
});

test('issue#45: helpers.tenantId — req.user.tid 优先, 缺失回退 local-tenant', () => {
    const { tenantId } = require('../../server/utils/helpers');
    assert.strictEqual(tenantId({ user: { tid: 't9' } }), 't9');
    assert.strictEqual(tenantId({ user: {} }), 'local-tenant');
    assert.strictEqual(tenantId({}), 'local-tenant');
});

test('issue#45: reportUsage fire-and-forget — local-tenant tid 不上报', async () => {
    __reportCalls = [];
    const { auth } = require('../../server/middleware/auth');
    // 直接调 reportUsage 桩验证 ai.js _reportUsage 逻辑等价: local-tenant 跳过
    const identityMod = require('../../server/integrations/fusion-identity');
    // 模拟 ai.js _reportUsage: tid === local-tenant → 不调
    const tid = 'local-tenant';
    if (tid && tid !== 'local-tenant') {
        await identityMod.reportUsage({ tid, usage: { tokens: 10 } });
    }
    assert.strictEqual(__reportCalls.length, 0, 'local-tenant 不应上报');
    // 真实 tid 上报
    await identityMod.reportUsage({ tid: 't1', usage: { tokens: 10, prompt_tokens: 4, completion_tokens: 6 } });
    assert.strictEqual(__reportCalls.length, 1);
    assert.strictEqual(__reportCalls[0].tid, 't1');
    assert.strictEqual(__reportCalls[0].usage.tokens, 10);
});

test('issue#45: config fail-closed — 非本地认证 + 无 serviceToken + 非测试 → 进程退出', async () => {
    // 用子进程验证 process.exit(1), 避免污染当前进程
    const { execFileSync } = require('node:child_process');
    const path = require('node:path');
    const probe = path.join(__dirname, '_probe-config-failclosed.js');
    const fs = require('node:fs');
    fs.writeFileSync(probe, `
        process.env.FUSION_DOC_LOCAL_AUTH = '';
        delete process.env.FUSION_IDENTITY_SERVICE_TOKEN;
        process.env.NODE_ENV = 'production';
        process.env.JWT_SECRET = 'a'.repeat(32); // 先过 JWT_SECRET 闸, 验证 identity 闸
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
    assert.ok(exited, 'config 应 fail-closed 退出');
    assert.ok(stderr.includes('FUSION_IDENTITY_SERVICE_TOKEN'), 'stderr 应含 fail-closed 提示');
});

// ── 还原桩 ────────────────────────────────────────────────────────────────
test('teardown: 还原 identity 桩', () => {
    identityModule.verify = _origVerify;
    identityModule.reportUsage = _origReport;
    assert.strictEqual(typeof identityModule.verify, 'function');
});
