// =============================================================================
// Fusion-Doc — Fusion-Gateway Union Web shell 集成 (issue #51, PRD R-6)
// manifest 自注册 + 心跳: POST /api/v1/shell/manifests
// 鉴权: Authorization: Bearer <FUSION_GATEWAY_ADMIN_KEY> (master/admin-key 面)
// 默认端口: 11432
// =============================================================================

const httpFetch = globalThis.fetch;
const AbortCtrl = globalThis.AbortController;
const { fetchWithRetry } = require('./http-retry');

const DEFAULT_URL = 'http://127.0.0.1:11432';

async function callGateway({ method, path, body, config, retries, timeoutMs }) {
    const baseUrl = config?.url || DEFAULT_URL;
    const adminKey = config?.adminKey || '';
    const url = `${baseUrl}${path}`;
    if (!adminKey) {
        throw new Error('FUSION_GATEWAY_ADMIN_KEY 未设置, 无法调用 gateway shell API');
    }
    // 注册/心跳幂等, 瞬时抖动可重试 (网络错误/5xx); 4xx 立即失败
    const resp = await fetchWithRetry(() => {
        const controller = new AbortCtrl();
        const timer = setTimeout(() => controller.abort(), timeoutMs || 10000);
        return httpFetch(url, {
            method: method || 'GET',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${adminKey}`,
            },
            body: body ? JSON.stringify(body) : undefined,
            signal: controller.signal,
        }).finally(() => clearTimeout(timer));
    }, { retries: retries ?? 2 });
    return await resp.json();
}

// manifest 自注册 (幂等, 按 id upsert)
async function registerManifest({ config, manifest }) {
    return callGateway({
        method: 'POST',
        path: '/api/v1/shell/manifests',
        body: manifest,
        config,
    });
}

// 模块心跳 (网关侧健康探测补充; admin-key 面)
async function sendHeartbeat({ config, moduleId }) {
    return callGateway({
        method: 'POST',
        path: `/api/v1/shell/manifests/${encodeURIComponent(moduleId)}/heartbeat`,
        body: {},
        config,
        timeoutMs: 5000,
    });
}

module.exports = {
    DEFAULT_URL,
    callGateway,
    registerManifest,
    sendHeartbeat,
};
