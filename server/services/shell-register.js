// =============================================================================
// Fusion-Doc — Union Web shell 注册编排 (issue #51, PRD R-6)
// 启动时读 client/manifest.json → 覆写 version (package.json 权威) +
// upstream + api_key → POST 到 fusion-gateway; 之后按间隔发心跳。
// 设计约束: 全程 fire-and-forget — 网关不可达只告警, 绝不阻断 fusion-doc 启动。
// =============================================================================

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const gateway = require('../integrations/fusion-gateway');
const { version: APP_VERSION } = require('../../package.json');

const MANIFEST_PATH = path.join(__dirname, '..', '..', 'client', 'manifest.json');
const SERVICE_KEY_FILE = path.join(__dirname, '..', '..', 'data', 'shell-api-key.json');

// ── 服务凭证: env 优先, 缺失则自动生成并持久化 (0600, gitignored data/) ──
// 回写 config.shellGateway.apiKey — auth 中件的 shell 服务凭证分支读的就是它。
function loadServiceKey(config) {
    if (config?.shellGateway?.apiKey) return config.shellGateway.apiKey;
    let key = '';
    try {
        const raw = fs.readFileSync(SERVICE_KEY_FILE, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed?.key) key = parsed.key;
    } catch (_) { /* 首次生成路径 */ }
    if (!key) {
        key = 'fdshell-' + crypto.randomBytes(24).toString('hex');
        try {
            fs.mkdirSync(path.dirname(SERVICE_KEY_FILE), { recursive: true });
            fs.writeFileSync(SERVICE_KEY_FILE, JSON.stringify({ key, createdAt: new Date().toISOString() }, null, 4), { mode: 0o600 });
            console.log('  [Shell] FUSION_DOC_SHELL_API_KEY 未设置, 已自动生成并持久化 data/shell-api-key.json');
        } catch (e) {
            console.error(`  [✗] Shell 服务凭证持久化失败: ${e.message}`);
        }
    }
    if (config?.shellGateway) config.shellGateway.apiKey = key;
    return key;
}

// ── 注册体: manifest.json + version 覆写 + upstream + api_key ────────────
function buildRegistrationBody(config, serviceKey) {
    const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
    const port = config?.port || 11449;
    const body = {
        ...manifest,
        version: APP_VERSION,
        upstream: `http://127.0.0.1:${port}`,
        api_key: serviceKey,
    };
    return body;
}

// ── 单次注册 + 心跳循环 ───────────────────────────────────────────────────
async function registerOnce(config, serviceKey) {
    const body = buildRegistrationBody(config, serviceKey);
    const resp = await gateway.registerManifest({ config: config.shellGateway, manifest: body });
    if (resp?.code && resp.code !== 'ok') {
        throw new Error(`gateway 注册拒绝: ${resp.code} ${resp.message || ''}`);
    }
    console.log(`  [✓] Shell manifest 已注册: id=${body.id} entry=${body.entry} v${body.version}`);
    return body;
}

async function heartbeatOnce(config, moduleId) {
    const resp = await gateway.sendHeartbeat({ config: config.shellGateway, moduleId });
    if (resp?.code && resp.code !== 'ok') {
        throw new Error(`gateway 心跳拒绝: ${resp.code} ${resp.message || ''}`);
    }
}

// 入口: 启动时调用, 永不 throw (内部全捕获)
async function startShellRegistration(config) {
    const sg = config?.shellGateway;
    if (!sg?.adminKey) {
        console.warn('  [⚠] FUSION_ADMIN_KEY 未设置: 跳过 Union Web shell 注册 (单机独立运行不受影响)');
        return;
    }
    // 服务凭证无论注册成败都必须先回写 config (auth 中件 shell 分支依赖)
    const serviceKey = loadServiceKey(config);
    const interval = Math.max(5000, sg.heartbeatInterval || 30000);
    let registered = false;

    // 注册失败不阻断: 网关后启动的场景由心跳兜底重注册感知 (网关侧按 id 幂等 upsert)
    const tryRegister = async () => {
        try {
            await registerOnce(config, serviceKey);
            registered = true;
        } catch (e) {
            console.warn(`  [⚠] Shell 注册失败 (稍后心跳周期重试): ${e.message}`);
        }
    };
    await tryRegister();

    const timer = setInterval(async () => {
        if (!registered) {
            await tryRegister();
            return;
        }
        try {
            await heartbeatOnce(config, 'fusion-doc');
        } catch (e) {
            console.warn(`  [⚠] Shell 心跳失败: ${e.message}`);
            registered = false;
        }
    }, interval);
    timer.unref();
    console.log(`  [i] Shell 心跳已启动: ${interval}ms`);
}

module.exports = {
    MANIFEST_PATH,
    SERVICE_KEY_FILE,
    loadServiceKey,
    buildRegistrationBody,
    registerOnce,
    heartbeatOnce,
    startShellRegistration,
};
