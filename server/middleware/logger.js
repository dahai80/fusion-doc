// =============================================================================
// Fusion-Doc — 日志中间件
// 参考 Wiki.js 审计追踪设计
// =============================================================================

const levels = { debug: 0, info: 1, warn: 2, error: 3 };

// P3-38: 日志脱敏 — 抹除 query 中敏感参数值 (token/secret/password/key/auth)
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

  // 响应结束时记录日志
  // E14 修复: 加重入守卫并恢复原始 res.end, 防 res.end 在 wrapper 内被再次触发
  // (如 error-handler/errorResponse 在已 end 后兜底再 end) 致递归日志/无限调用。
  const originalEnd = res.end.bind(res);
  let logged = false;
  res.end = function(...args) {
    if (!logged) {
      logged = true;
      res.end = originalEnd; // 先还原, 避免后续 end 再次进 wrapper
      const duration = Date.now() - start;
      const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';

      if (levels[level] >= levels[logLevel]) {
        const timestamp = new Date().toISOString().slice(11, 23);
        console.log(`  [${timestamp}] ${method} ${redactUrl(url)} → ${res.statusCode} (${duration}ms) [${level}]`);
      }
      // P2-O5/P3-O11: 指标计数 + 结构化日志 (env LOG_FORMAT=json 时输出 JSON 行, 便 ELK 采集)
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

  return false; // 继续管道
}

module.exports = { logger };