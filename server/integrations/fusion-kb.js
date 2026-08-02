// =============================================================================
// Fusion-Doc — Fusion-KB 知识库桥接
// 连接 Fusion-KB (fusion-rag) 向量知识库服务
// 默认端口: 11436
// =============================================================================

const httpFetch = globalThis.fetch;
const AbortCtrl = globalThis.AbortController;

const DEFAULT_URL = 'http://localhost:11436';

async function callFusionKB({ method, path, body, config }) {
    const baseUrl = config?.url || DEFAULT_URL;
    const url = `${baseUrl}${path}`;
    const controller = new AbortCtrl();
    const timer = setTimeout(() => controller.abort(), 30000);
    try {
        const resp = await httpFetch(url, {
            method: method || 'GET',
            headers: { 'Content-Type': 'application/json' },
            body: body ? JSON.stringify(body) : undefined,
            signal: controller.signal,
        });
        if (!resp.ok) {
            const text = await resp.text();
            throw new Error(`Fusion-KB ${resp.status}: ${text}`);
        }
        return await resp.json();
    } finally {
        clearTimeout(timer);
    }
}

async function healthCheck(config) {
    try {
        const resp = await callFusionKB({ path: '/health', config });
        return { available: true, ...resp };
    } catch (e) {
        console.warn(`[Fusion-KB] Health check failed: ${e.message}`);
        return { available: false, error: e.message };
    }
}

async function listCollections(config) {
    return callFusionKB({ path: '/api/collections', config });
}

async function queryKnowledge(config, params) {
    return callFusionKB({
        method: 'POST',
        path: '/api/query',
        body: params,
        config,
    });
}

async function indexDocument(config, params) {
    return callFusionKB({
        method: 'POST',
        path: '/api/index',
        body: params,
        config,
    });
}

async function deleteDocument(config, docId) {
    return callFusionKB({
        method: 'DELETE',
        path: `/api/documents/${docId}`,
        config,
    });
}

module.exports = {
    DEFAULT_URL,
    callFusionKB,
    healthCheck,
    listCollections,
    queryKnowledge,
    indexDocument,
    deleteDocument,
};
