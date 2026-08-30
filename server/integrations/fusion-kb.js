// =============================================================================
// Fusion-Doc — Fusion-KB 知识库桥接
// 连接 Fusion-KB (fusion-rag) 向量知识库服务
// 默认端口: 11436
// =============================================================================

const httpFetch = globalThis.fetch;
const AbortCtrl = globalThis.AbortController;
const { fetchWithRetry } = require('./http-retry');

const DEFAULT_URL = 'http://localhost:11436';

async function callFusionKB({ method, path, body, config, retries }) {
    const baseUrl = config?.url || DEFAULT_URL;
    const url = `${baseUrl}${path}`;
    // E19 修复: 兄弟服务瞬时抖动加指数退避重试 (网络错误/5xx), 4xx 立即失败
    const resp = await fetchWithRetry(() => {
        const controller = new AbortCtrl();
        const timer = setTimeout(() => controller.abort(), 30000);
        return httpFetch(url, {
            method: method || 'GET',
            headers: { 'Content-Type': 'application/json' },
            body: body ? JSON.stringify(body) : undefined,
            signal: controller.signal,
        }).finally(() => clearTimeout(timer));
    }, { retries: retries ?? 2 });
    return await resp.json();
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
    // 写操作不重试, 防止 5xx 后重放致重复索引
    return callFusionKB({
        method: 'POST',
        path: '/api/index',
        body: params,
        config,
        retries: 0,
    });
}

async function deleteDocument(config, docId) {
    // 删除不重试, 防止重放
    return callFusionKB({
        method: 'DELETE',
        path: `/api/documents/${docId}`,
        config,
        retries: 0,
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
