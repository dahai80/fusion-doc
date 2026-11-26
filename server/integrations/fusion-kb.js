// =============================================================================
// Fusion-Doc — Fusion-KB knowledge base bridge
// Connects to the Fusion-KB (fusion-rag) vector knowledge base service
// Default port: 11436
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
    // E19 fix: exponential-backoff retries for transient sibling-service blips (network errors/5xx); 4xx fails immediately
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
    // Writes are not retried, to avoid duplicate indexing from a replay after a 5xx
    return callFusionKB({
        method: 'POST',
        path: '/api/index',
        body: params,
        config,
        retries: 0,
    });
}

async function deleteDocument(config, docId) {
    // Deletes are not retried, to avoid replays
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
