// =============================================================================
// Fusion-Doc — deep Fusion-MLX integration
// Handles communication with the Fusion-MLX local inference engine
// Supports: chat, streaming chat, embeddings, reranking, model management
// =============================================================================
//
// Fusion-MLX is an Apple Silicon native MLX inference engine exposing an OpenAI-compatible API
// Default port: 11432 (unified networking via fusion-gateway; env can override back to direct 11434)
// Endpoints: /v1/chat/completions, /v1/embeddings, /v1/models, /v1/rerank
// =============================================================================

const BASE_PATH = '/v1';
const httpFetch = globalThis.fetch;
const AbortCtrl = globalThis.AbortController;

// R6 fix: upper timeout for non-streaming calls (the original design had no timeout, so an engine stall hung all site AI)
const CALL_TIMEOUT_MS = parseInt(process.env.FUSION_MLX_TIMEOUT_MS || '60000', 10);
const CALL_MAX_RETRIES = parseInt(process.env.FUSION_MLX_RETRIES || '1', 10);

// ── Generic request ─────────────────────────────────────────────────────
async function callFusionMLX({ method, path, body, config }) {
  // §2.2: fail visibly when the key is unset; silent pass-through is forbidden (so are literal keys)
  if (!config.apiKey) {
    throw new Error('Fusion-MLX call rejected: FUSION_CLIENT_KEY not set (inject it via the deployment env)');
  }
  const url = `${config.url}${BASE_PATH}${path}`;
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${config.apiKey}`,
  };

  // R6 fix: timeout + retries; healthCheck had a 3s timeout but the main path lacked one
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
        throw new Error(`Fusion-MLX API error (${response.status}): ${text.slice(0, 200)}`);
      }
      return await response.json();
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
      // Retry only on timeout/connection errors, never on 4xx
      const isAbort = err.name === 'AbortError';
      const isTransient = isAbort || err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT' || err.code === 'ECONNREFUSED';
      if (!isTransient || attempt === CALL_MAX_RETRIES) break;
      console.warn(`[Fusion-MLX] callFusionMLX retry ${attempt + 1}/${CALL_MAX_RETRIES}: ${err.message}`);
    }
  }
  throw lastErr || new Error('Fusion-MLX call failed');
}

// ── Streaming request (SSE) ─────────────────────────────────────────────
// R7 fix: accept an external abortSignal so a client disconnect actually aborts the upstream fetch (originally the controller was closure-private)
async function* callFusionMLXStream({ model, messages, config, timeoutMs = 120000, abortSignal }) {
  // §2.2: fail visibly when the key is unset; silent pass-through is forbidden
  if (!config.apiKey) {
    throw new Error('Fusion-MLX streaming call rejected: FUSION_CLIENT_KEY not set (inject it via the deployment env)');
  }
  const url = `${config.url}${BASE_PATH}/chat/completions`;
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${config.apiKey}`,
  };

  const controller = new AbortCtrl();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  // R7 fix: link the external abortSignal to the internal controller
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
    throw new Error(`Fusion-MLX streaming request error (${response.status}): ${text.slice(0, 200)}`);
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
        } catch (_) { /* skip unparseable chunks */ }
      }
    }
  } finally {
    clearTimeout(timer);
    if (abortSignal) abortSignal.removeEventListener('abort', onExternalAbort);
    // R7 fix: cancel the reader to release the upstream HTTP response body (originally only releaseLock, so connections were not returned, causing EMFILE)
    try { await reader.cancel(); } catch (_) { /* noop */ }
    reader.releaseLock();
  }
}

// ── Chat ────────────────────────────────────────────────────────────────
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

// ── Embeddings ──────────────────────────────────────────────────────────
async function embeddings({ input, model, config }) {
  return callFusionMLX({
    method: 'POST', path: '/embeddings',
    body: { model: model || config.embeddingModel, input: Array.isArray(input) ? input : [input] },
    config,
  });
}

// ── Rerank ──────────────────────────────────────────────────────────────
async function rerank({ query, documents, model, config }) {
  return callFusionMLX({
    method: 'POST', path: '/rerank',
    body: { model: model || config.rerankModel, query, documents },
    config,
  });
}

// ── Model list ──────────────────────────────────────────────────────────
async function listModels(config) {
  return callFusionMLX({
    method: 'GET', path: '/models',
    config,
  });
}

// ── Health check ────────────────────────────────────────────────────────
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