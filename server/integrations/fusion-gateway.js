// =============================================================================
// Fusion-Doc — Fusion-Gateway Union Web shell integration (issue #51, PRD R-6)
// Manifest self-registration + heartbeat: POST /api/v1/shell/manifests
// Auth: Authorization: Bearer <FUSION_ADMIN_KEY> (master/admin-key surface)
// Default port: 11432
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
        throw new Error('FUSION_ADMIN_KEY not set, cannot call gateway shell API');
    }
    // Registration/heartbeat are idempotent, so transient blips may be retried (network errors/5xx); 4xx fails immediately
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

// Manifest self-registration (idempotent, upsert by id)
async function registerManifest({ config, manifest }) {
    return callGateway({
        method: 'POST',
        path: '/api/v1/shell/manifests',
        body: manifest,
        config,
    });
}

// Module heartbeat (supplements gateway-side health probing; admin-key surface)
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
