// =============================================================================
// Fusion-Doc — Fusion-Cowork DAG 工作流桥接
// 连接 Fusion-Cowork 协作引擎，支持 DAG 工作流编排
// 默认端口: 11437
// =============================================================================

const httpFetch = globalThis.fetch;
const AbortCtrl = globalThis.AbortController;
const { fetchWithRetry } = require('./http-retry');

const DEFAULT_URL = 'http://localhost:11437';

// E19 修复: 兄弟服务瞬时抖动加指数退避重试。
// retries 可由调用方覆盖: 写操作 (runWorkflow) 传 0 防止重放致 DAG 重复执行。
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
    // 写操作不重试, 防止 5xx 后重放致 DAG 重复执行
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
