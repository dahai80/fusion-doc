// =============================================================================
// Fusion-Doc — Fusion-MLX 深度集成
// 负责与 Fusion-MLX 本地推理引擎的通信
// 支持：聊天、流式聊天、嵌入、重排序、模型管理
// =============================================================================
//
// Fusion-MLX 是 Apple Silicon 原生 MLX 推理引擎，提供 OpenAI 兼容 API
// 默认端口: 11432
// 端点: /v1/chat/completions, /v1/embeddings, /v1/models, /v1/rerank
// =============================================================================

const BASE_PATH = '/v1';
const httpFetch = globalThis.fetch;
const AbortCtrl = globalThis.AbortController;

// ── 通用请求 ──────────────────────────────────────────────────────────────
async function callFusionMLX({ method, path, body, config }) {
  const url = `${config.url}${BASE_PATH}${path}`;
  const headers = {
    'Content-Type': 'application/json',
  };
  if (config.apiKey) {
    headers['Authorization'] = `Bearer ${config.apiKey}`;
  }

  const response = await httpFetch(url, {
    method: method || 'POST',
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Fusion-MLX API 错误 (${response.status}): ${text.slice(0, 200)}`);
  }

  return await response.json();
}

// ── 流式请求（SSE） ───────────────────────────────────────────────────────
async function* callFusionMLXStream({ model, messages, config, timeoutMs = 120000 }) {
  const url = `${config.url}${BASE_PATH}/chat/completions`;
  const headers = {
    'Content-Type': 'application/json',
  };
  if (config.apiKey) {
    headers['Authorization'] = `Bearer ${config.apiKey}`;
  }

  const controller = new AbortCtrl();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

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