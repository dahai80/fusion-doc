// =============================================================================
// Fusion-Doc — 限流中间件（内存版）
// 参考 Wiki.js 限流设计，防止滥用
// =============================================================================

const requestCounts = new Map();

// 清理过期记录（每 60s 执行一次）
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of requestCounts) {
    if (now - entry.resetTime > 60000) {
      requestCounts.delete(key);
    }
  }
}, 60000);

function rateLimit(options = {}) {
  const windowMs = options.windowMs || 60000;      // 时间窗口（默认 1 分钟）
  const maxRequests = options.maxRequests || 100;   // 最大请求数
  const message = options.message || '请求过于频繁，请稍后再试';

  return function rateLimitMiddleware(req, res, pipeline) {
    const key = req.ip || req.headers['x-forwarded-for'] || req.connection?.remoteAddress || 'unknown';
    const now = Date.now();

    if (!requestCounts.has(key)) {
      requestCounts.set(key, { count: 1, resetTime: now + windowMs });
      return false;
    }

    const entry = requestCounts.get(key);
    if (now > entry.resetTime) {
      entry.count = 1;
      entry.resetTime = now + windowMs;
      return false;
    }

    entry.count++;
    if (entry.count > maxRequests) {
      res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': Math.ceil((entry.resetTime - now) / 1000) });
      res.end(JSON.stringify({ error: message, code: 'RATE_LIMITED' }));
      return true;
    }

    return false;
  };
}

module.exports = { rateLimit };