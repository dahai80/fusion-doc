// =============================================================================
// Fusion-Doc — logging middleware
// Based on the Wiki.js audit trail design
// =============================================================================

const levels = { debug: 0, info: 1, warn: 2, error: 3 };

// P3-38: log redaction — scrub sensitive parameter values from the query (token/secret/password/key/auth)
const SENSITIVE_KEYS = /^(token|secret|password|passwd|key|apikey|api_key|authorization|auth)$/i;
function redactUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return rawUrl;
  const qIdx = rawUrl.indexOf('?');
  if (qIdx < 0) return rawUrl;
  const base = rawUrl.slice(0, qIdx);
  const qs = rawUrl.slice(qIdx + 1);
  if (!qs) return rawUrl;
  const parts = qs.split('&').map(kv => {
    const eq = kv.indexOf('=');
    if (eq < 0) return kv;
    const k = kv.slice(0, eq);
    if (SENSITIVE_KEYS.test(k)) return k + '=***';
    return kv;
  });
  return base + '?' + parts.join('&');
}

function logger(req, res, pipeline) {
  const start = Date.now();
  const { method, url } = req;
  const logLevel = process.env.LOG_LEVEL || 'info';

  // Log when the response ends
  // E14 fix: add a re-entrancy guard and restore the original res.end, preventing res.end from being re-triggered inside the wrapper
  // (e.g. error-handler/errorResponse ending again as a fallback after it already ended) causing recursive logging/infinite calls.
  const originalEnd = res.end.bind(res);
  let logged = false;
  res.end = function(...args) {
    if (!logged) {
      logged = true;
      res.end = originalEnd; // Restore first so later end calls do not re-enter the wrapper
      const duration = Date.now() - start;
      const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';

      if (levels[level] >= levels[logLevel]) {
        const timestamp = new Date().toISOString().slice(11, 23);
        console.log(`  [${timestamp}] ${method} ${redactUrl(url)} → ${res.statusCode} (${duration}ms) [${level}]`);
      }
      // P2-O5/P3-O11: metrics counters + structured logging (emits JSON lines when env LOG_FORMAT=json, for ELK ingestion)
      const m = req.ctx?.app?._metrics;
      if (m) {
        m.requests++;
        m.byStatus[res.statusCode] = (m.byStatus[res.statusCode] || 0) + 1;
        if (res.statusCode >= 500) m.errors++;
      }
      if (process.env.LOG_FORMAT === 'json') {
        console.log(JSON.stringify({ ts: new Date().toISOString(), level, method, path: redactUrl(url), status: res.statusCode, ms: duration, ip: req.socket?.remoteAddress }));
      }
    }
    return originalEnd(...args);
  };

  return false; // Continue the pipeline
}

module.exports = { logger };