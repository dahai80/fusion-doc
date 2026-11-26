// =============================================================================
// Fusion-Doc — Fusion-Cowork DAG workflow bridge
// Connects to the Fusion-Cowork collaboration engine for DAG workflow orchestration
// Default port: 11437
// =============================================================================

const httpFetch = globalThis.fetch;
const AbortCtrl = globalThis.AbortController;
const { fetchWithRetry } = require('./http-retry');

const DEFAULT_URL = 'http://localhost:11437';

// E19 fix: exponential backoff retries for transient sibling-service hiccups.
// Callers can override retries: write operations (runWorkflow) pass 0 so a replay cannot run the DAG twice.
async function callFusionCowork({ method, path, body, config, retries }) {
    const baseUrl = config?.url || DEFAULT_URL;
    const url = `${baseUrl}${path}`;
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
        const resp = await callFusionCowork({ path: '/health', config });
        return { available: true, ...resp };
    } catch (e) {
        console.warn(`[Fusion-Cowork] Health check failed: ${e.message}`);
        return { available: false, error: e.message };
    }
}

async function listWorkflows(config) {
    return callFusionCowork({ path: '/api/workflows', config });
}

async function getWorkflow(config, workflowId) {
    return callFusionCowork({ path: `/api/workflows/${workflowId}`, config });
}

async function runWorkflow(config, workflowId, input) {
    // Write operations are not retried, so a replay after a 5xx cannot run the DAG twice
    return callFusionCowork({
        method: 'POST',
        path: `/api/workflows/${workflowId}/run`,
        body: { input },
        config,
        retries: 0,
    });
}

async function getRunStatus(config, runId) {
    return callFusionCowork({ path: `/api/runs/${runId}`, config });
}

module.exports = {
    DEFAULT_URL,
    callFusionCowork,
    healthCheck,
    listWorkflows,
    getWorkflow,
    runWorkflow,
    getRunStatus,
};
