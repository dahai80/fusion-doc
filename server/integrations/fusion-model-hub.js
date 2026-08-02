// =============================================================================
// Fusion-Doc — Fusion-Model-Hub 模型管理桥接
// 查询可用模型列表和状态，用于 AI 功能的模型选择
// 默认端口: 11444
// =============================================================================

const httpFetch = globalThis.fetch;
const AbortCtrl = globalThis.AbortController;

const DEFAULT_URL = 'http://localhost:11444';

async function callModelHub({ method, path, body, config }) {
    const baseUrl = config?.url || DEFAULT_URL;
    const url = `${baseUrl}${path}`;
    const controller = new AbortCtrl();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
        const resp = await httpFetch(url, {
            method: method || 'GET',
            headers: { 'Content-Type': 'application/json' },
            body: body ? JSON.stringify(body) : undefined,
            signal: controller.signal,
        });
        if (!resp.ok) {
            const text = await resp.text();
            throw new Error(`Fusion-Model-Hub ${resp.status}: ${text}`);
        }
        return await resp.json();
    } finally {
        clearTimeout(timer);
    }
}

async function healthCheck(config) {
    try {
        const resp = await callModelHub({ path: '/health', config });
        return { available: true, ...resp };
    } catch (e) {
        console.warn(`[Fusion-Model-Hub] Health check failed: ${e.message}`);
        return { available: false, error: e.message };
    }
}

async function listModels(config) {
    return callModelHub({ path: '/api/models', config });
}

async function getModelInfo(config, modelId) {
    return callModelHub({ path: `/api/models/${modelId}`, config });
}

async function recommendModel(config, task) {
    return callModelHub({
        method: 'POST',
        path: '/api/recommend',
        body: { task },
        config,
    });
}

module.exports = {
    DEFAULT_URL,
    callModelHub,
    healthCheck,
    listModels,
    getModelInfo,
    recommendModel,
};
