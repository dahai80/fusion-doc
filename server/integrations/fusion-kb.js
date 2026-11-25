// =============================================================================
// Fusion-Doc — Fusion-KB 知识库桥接
// 连接 Fusion-KB (fusion-rag) 向量知识库服务
// 默认端口: 11436
// =============================================================================

const httpFetch = globalThis.fetch;
const AbortCtrl = globalThis.AbortController;
const { fetchWithRetry } = require('./http-retry');

const DEFAULT_URL = 'http://localhost:11436';

async function callFusionKB({ method, path, body, config, retries, timeoutMs }) {
    const baseUrl = config?.url || DEFAULT_URL;
    const url = `${baseUrl}${path}`;
    // fusion-rag auth: X-API-Key when configured (NoAuthBackend otherwise)
    const headers = { 'Content-Type': 'application/json' };
    if (config?.apiKey) headers['X-API-Key'] = config.apiKey;
    // E19 修复: 兄弟服务瞬时抖动加指数退避重试 (网络错误/5xx), 4xx 立即失败
    const resp = await fetchWithRetry(() => {
        const controller = new AbortCtrl();
        const timer = setTimeout(() => controller.abort(), timeoutMs || 30000);
        return httpFetch(url, {
            method: method || 'GET',
            headers,
            body: body ? JSON.stringify(body) : undefined,
            signal: controller.signal,
        }).finally(() => clearTimeout(timer));
    }, { retries: retries ?? 2 });
    if (!resp.ok) {
        const err = new Error(`fusion-rag ${path} failed with ${resp.status}`);
        err.status = resp.status >= 500 ? 502 : resp.status;
        throw err;
    }
    return await resp.json();
}

// ── kb_ask equivalent (issue #84): POST /kb/bases/{kbId}/ask ───────────────
// fusion-rag does retrieval + grounded answer generation; response shape
// { answer, sources, citations, has_low_confidence }. Generation runs a local
// LLM (and first call may lazy-load the embedding model) — needs a longer
// timeout than the generic 30s.
async function askKb(config, { kbId, question, topK }) {
    return callFusionKB({
        method: 'POST',
        path: `/kb/bases/${encodeURIComponent(kbId)}/ask`,
        body: { question, top_k: topK },
        config,
        retries: 0,
        timeoutMs: 120000,
    });
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
    askKb,
};
