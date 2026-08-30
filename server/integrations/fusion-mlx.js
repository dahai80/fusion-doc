// =============================================================================
// Fusion-Doc — Fusion-MLX 深度集成
// 负责与 Fusion-MLX 本地推理引擎的通信
// 支持：聊天、流式聊天、嵌入、重排序、模型管理
// =============================================================================
//
// Fusion-MLX 是 Apple Silicon 原生 MLX 推理引擎，提供 OpenAI 兼容 API
// 默认端口: 11432 (经 fusion-gateway 统一组网; env 可覆盖回直连 11434)
// 端点: /v1/chat/completions, /v1/embeddings, /v1/models, /v1/rerank
// =============================================================================

const BASE_PATH = '/v1';
const httpFetch = globalThis.fetch;
const AbortCtrl = globalThis.AbortController;

// R6 修复: 非流式调用超时上限 (原设计无 timeout, 引擎 stall 即 hang 全站 AI)
const CALL_TIMEOUT_MS = parseInt(process.env.FUSION_MLX_TIMEOUT_MS || '60000', 10);
const CALL_MAX_RETRIES = parseInt(process.env.FUSION_MLX_RETRIES || '1', 10);

// ── 通用请求 ──────────────────────────────────────────────────────────────
async function callFusionMLX({ method, path, body, config }) {
  // §2.2: key 未设置时 fail visibly, 禁止静默放行 (字面量亦禁止)
  if (!config.apiKey) {
    throw new Error('Fusion-MLX 调用被拒绝: FUSION_MLX_API_KEY 未设置 (请在部署 env 注入)');
  }
  const url = `${config.url}${BASE_PATH}${path}`;
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${config.apiKey}`,
  };

  // R6 修复: timeout + 重试, 对比 healthCheck 有 3s timeout, 主路径此前缺失
  let lastErr = null;
  for (let attempt = 0; attempt <= CALL_MAX_RETRIES; attempt++) {
    const controller = new AbortCtrl();
    const timer = setTimeout(() => controller.abort(), CALL_TIMEOUT_MS);
    try {
      const response = await httpFetch(url, {
        method: method || 'POST',
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`Fusion-MLX API 错误 (${response.status}): ${text.slice(0, 200)}`);
      }
      return await response.json();
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
      // 仅对超时/连接错误重试, 4xx 不重试
      const isAbort = err.name === 'AbortError';
      const isTransient = isAbort || err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT' || err.code === 'ECONNREFUSED';
      if (!isTransient || attempt === CALL_MAX_RETRIES) break;
      console.warn(`[Fusion-MLX] callFusionMLX 重试 ${attempt + 1}/${CALL_MAX_RETRIES}: ${err.message}`);
    }
  }
  throw lastErr || new Error('Fusion-MLX 调用失败');
}

// ── 流式请求（SSE） ───────────────────────────────────────────────────────
// R7 修复: 接受外部 abortSignal, 客户端断开时真正中断上游 fetch (原设计 controller 闭包私有)
async function* callFusionMLXStream({ model, messages, config, timeoutMs = 120000, abortSignal }) {
  // §2.2: key 未设置时 fail visibly, 禁止静默放行
  if (!config.apiKey) {
    throw new Error('Fusion-MLX 流式调用被拒绝: FUSION_MLX_API_KEY 未设置 (请在部署 env 注入)');
  }
  const url = `${config.url}${BASE_PATH}/chat/completions`;
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${config.apiKey}`,
  };

  const controller = new AbortCtrl();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  // R7 修复: 外部 abortSignal 联动内部 controller
  const onExternalAbort = () => controller.abort();
  if (abortSignal) {
    if (abortSignal.aborted) { clearTimeout(timer); controller.abort(); }
    else abortSignal.addEventListener('abort', onExternalAbort, { once: true });
  }

  const response = await httpFetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      messages,
      stream: true,
    }),
    signal: controller.signal,
  });

  if (!response.ok) {
    clearTimeout(timer);
    if (abortSignal) abortSignal.removeEventListener('abort', onExternalAbort);
    const text = await response.text().catch(() => '');
    throw new Error(`Fusion-MLX 流式请求错误 (${response.status}): ${text.slice(0, 200)}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;
        const data = trimmed.slice(6);
        if (data === '[DONE]') { clearTimeout(timer); return; }
        try {
          yield JSON.parse(data);
        } catch (_) { /* 跳过无法解析的 chunk */ }
      }
    }
  } finally {
    clearTimeout(timer);
    if (abortSignal) abortSignal.removeEventListener('abort', onExternalAbort);
    // R7 修复: cancel reader 释放上游 HTTP 响应体 (原仅 releaseLock, 连接不归还致 EMFILE)
    try { await reader.cancel(); } catch (_) { /* noop */ }
    reader.releaseLock();
  }
}

// ── 聊天 ──────────────────────────────────────────────────────────────────
async function chat({ model, messages, config, stream = false }) {
  if (stream) {
    return callFusionMLXStream({ model, messages, config });
  }
  return callFusionMLX({
    method: 'POST', path: '/chat/completions',
    body: { model, messages, stream: false },
    config,
  });
}

// ── 嵌入 ──────────────────────────────────────────────────────────────────
async function embeddings({ input, model, config }) {
  return callFusionMLX({
    method: 'POST', path: '/embeddings',
    body: { model: model || config.embeddingModel, input: Array.isArray(input) ? input : [input] },
    config,
  });
}

// ── 重排序 ────────────────────────────────────────────────────────────────
async function rerank({ query, documents, model, config }) {
  return callFusionMLX({
    method: 'POST', path: '/rerank',
    body: { model: model || config.rerankModel, query, documents },
    config,
  });
}

// ── 模型列表 ──────────────────────────────────────────────────────────────
async function listModels(config) {
  return callFusionMLX({
    method: 'GET', path: '/models',
    config,
  });
}

// ── 健康检查 ──────────────────────────────────────────────────────────────
async function healthCheck(config) {
  const controller = new AbortCtrl();
  const timer = setTimeout(() => controller.abort(), 3000);
  try {
    const response = await httpFetch(`${config.url}/health`, { method: 'GET', signal: controller.signal });
    clearTimeout(timer);
    return response.ok;
  } catch (_) {
    clearTimeout(timer);
    return false;
  }
}

module.exports = {
  callFusionMLX,
  callFusionMLXStream,
  chat,
  embeddings,
  rerank,
  listModels,
  healthCheck,
};