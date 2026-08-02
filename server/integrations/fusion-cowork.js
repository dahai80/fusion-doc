// =============================================================================
// Fusion-Doc — Fusion-Cowork DAG 工作流桥接
// 连接 Fusion-Cowork 协作引擎，支持 DAG 工作流编排
// 默认端口: 11437
// =============================================================================

const httpFetch = globalThis.fetch;
const AbortCtrl = globalThis.AbortController;

const DEFAULT_URL = 'http://localhost:11437';

async function callFusionCowork({ method, path, body, config }) {
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
            throw new Error(`Fusion-Cowork ${resp.status}: ${text}`);
        }
        return await resp.json();
    } finally {
        clearTimeout(timer);
    }
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
    return callFusionCowork({
        method: 'POST',
        path: `/api/workflows/${workflowId}/run`,
        body: { input },
        config,
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
