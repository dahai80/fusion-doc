// =============================================================================
// Fusion-Doc — issue #51 Union Web shell 注册 单元测试
// 零外部依赖 (node:test + node:assert)。覆盖: 服务凭证生成/回写/复读,
// 注册体组装 (version 覆写 + upstream + api_key), auth 中件 shell 服务凭证
// 分支 (timingSafeEqual 放行 / 错凭证走原路径)。
// =============================================================================

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const shellRegister = require('../../server/services/shell-register');
const { auth } = require('../../server/middleware/auth');

// ── 测试夹具: 伪 req/res/ctx (对齐 test-identity-tenant.js) ──────────────
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

// ── loadServiceKey: env 优先 / 自动生成 + 回写 config / 复读稳定 ─────────
test('issue#51: loadServiceKey env 优先 (不触发生成/复读)', () => {
    const cfg = { shellGateway: { apiKey: 'fdshell-env-key' } };
    const key = shellRegister.loadServiceKey(cfg);
    assert.strictEqual(key, 'fdshell-env-key');
    assert.strictEqual(cfg.shellGateway.apiKey, 'fdshell-env-key');
});

test('issue#51: loadServiceKey 缺 env 时生成 fdshell- 前缀凭证并回写 config', () => {
    // 生成路径写真实 data/shell-api-key.json (gitignored, 运行时合法位置)
    const cfg = { shellGateway: { apiKey: '' } };
    const key = shellRegister.loadServiceKey(cfg);
    assert.ok(key.startsWith('fdshell-'), '凭证应带 fdshell- 前缀');
    assert.strictEqual(cfg.shellGateway.apiKey, key, '凭证须回写 config (auth 中件依赖)');
    // 复读稳定 (持久化生效)
    const cfg2 = { shellGateway: { apiKey: '' } };
    assert.strictEqual(shellRegister.loadServiceKey(cfg2), key, '复读应稳定');
});

// ── buildRegistrationBody: version 覆写 + upstream + api_key ─────────────
test('issue#51: buildRegistrationBody — package.json version 权威 + upstream + api_key', () => {
    const { version } = require('../../package.json');
    const cfg = { port: 11449, shellGateway: { apiKey: 'fdshell-x' } };
    const body = shellRegister.buildRegistrationBody(cfg, 'fdshell-x');
    assert.strictEqual(body.id, 'fusion-doc');
    assert.strictEqual(body.category, 'infra');
    assert.strictEqual(body.version, version, 'version 由 package.json 覆写');
    assert.strictEqual(body.upstream, 'http://127.0.0.1:11449');
    assert.strictEqual(body.api_key, 'fdshell-x');
    assert.ok(Array.isArray(body.devices) && body.devices.includes('desktop'));
    assert.strictEqual(body.entry, '/shell/fusion-doc/');
});

test('issue#51: manifest.json 本体不含密钥 (api_key 仅运行时注入)', () => {
    const manifest = JSON.parse(fs.readFileSync(shellRegister.MANIFEST_PATH, 'utf8'));
    assert.strictEqual(manifest.api_key, undefined);
    assert.strictEqual(manifest.upstream, undefined);
    // §5.1 必填字段齐备
    for (const f of ['id', 'title', 'path', 'entry', 'devices', 'category']) {
        assert.ok(manifest[f], `manifest 缺必填字段 ${f}`);
    }
});

// ── auth 中件 shell 服务凭证分支 ─────────────────────────────────────────
function shellCfg(apiKey, extra = {}) {
    return {
        shellGateway: { apiKey, tenant: 'shell', role: 'operator', ...extra },
        localAuth: false,
        fusionIdentity: { url: 'http://x', serviceToken: 'svc' },
    };
}

test('issue#51: 网关注入服务凭证 → 放行, 注入 shell 会话主体', async () => {
    const req = makeReq({ headers: { Authorization: 'Bearer fdshell-correct' }, cfg: shellCfg('fdshell-correct') });
    const res = makeRes();
    const blocked = await auth(req, res, {});
    assert.strictEqual(blocked, false);
    assert.strictEqual(req.user.id, 'shell-session');
    assert.strictEqual(req.user.tid, 'shell');
    assert.strictEqual(req.user.role, 'operator');
});

test('issue#51: 错误服务凭证 → 不放行 (落入 identity 路径 fail-closed)', async () => {
    const req = makeReq({ headers: { Authorization: 'Bearer fdshell-wrong' }, cfg: shellCfg('fdshell-correct') });
    const res = makeRes();
    const blocked = await auth(req, res, {});
    assert.strictEqual(blocked, true);
    assert.strictEqual(res.state.statusCode, 401);
    // 无 X-Tenant-Id → AUTH_TENANT_REQUIRED (证明未走 shell 分支)
    const code = JSON.parse(res.state.body).code;
    assert.strictEqual(code, 'AUTH_TENANT_REQUIRED');
});

test('issue#51: 服务凭证长度不同 → 不 Equal 不抛错 (timingSafeEqual 长度前置判)', async () => {
    const req = makeReq({ headers: { Authorization: 'Bearer short' }, cfg: shellCfg('fdshell-correct') });
    const res = makeRes();
    const blocked = await auth(req, res, {});
    assert.strictEqual(blocked, true);
});

test('issue#51: localAuth 模式下服务凭证同样放行 (网关代理不分模式)', async () => {
    const cfg = shellCfg('fdshell-correct', {});
    cfg.localAuth = true;
    const req = makeReq({ headers: { Authorization: 'Bearer fdshell-correct' }, cfg });
    const res = makeRes();
    const blocked = await auth(req, res, {});
    assert.strictEqual(blocked, false);
    assert.strictEqual(req.user.id, 'shell-session');
});

test('issue#51: 未配置 shellGateway.apiKey → 分支不激活 (存量行为不变)', async () => {
    const req = makeReq({ headers: { Authorization: 'Bearer whatever' }, cfg: shellCfg('') });
    const res = makeRes();
    const blocked = await auth(req, res, {});
    assert.strictEqual(blocked, true);
});

// ── teardown: 清理生成的凭证文件 (只留最终输出件和日志) ──────────────────
test('teardown: 清理测试生成的服务凭证文件', () => {
    // 若测试前不存在则删除 (避免污染真实运行时状态)
    const keyFile = shellRegister.SERVICE_KEY_FILE;
    if (fs.existsSync(keyFile)) {
        fs.unlinkSync(keyFile);
        console.log(`  [teardown] 已清理 ${keyFile}`);
    }
});
