// =============================================================================
// Fusion-Doc — 限流中间件（内存版）
// 参考 Wiki.js 限流设计，防止滥用
// =============================================================================

const requestCounts = new Map();
const MAX_ENTRIES = 10000; // Map 容量上限, 防 XFF 伪造导致无界增长

// 是否信任代理头 (反代场景显式开启)
const TRUST_PROXY = process.env.TRUST_PROXY === '1';

// 清理过期记录（每 60s 执行一次）
// unref: 不阻止进程退出 (否则 node --test 等 CLI 会因定时器挂起)
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of requestCounts) {
    if (now - entry.resetTime > 60000) {
      requestCounts.delete(key);
    }
  }
}, 60000).unref();

function clientKey(req) {
  // raw http.createServer 从不设 req.ip, 故 socket.remoteAddress 优先
  const direct = req.socket?.remoteAddress || req.connection?.remoteAddress;
  if (direct) return direct;
  // 仅在显式信任代理时才读 XFF (防客户端伪造绕过限流)
  if (TRUST_PROXY && req.headers['x-forwarded-for']) {
    return req.headers['x-forwarded-for'].split(',')[0].trim();
  }
  return 'unknown';
}

// 单规则限流工厂
function rateLimit(options = {}) {
  const windowMs = options.windowMs || 60000;      // 时间窗口（默认 1 分钟）
  const maxRequests = options.maxRequests || 100;   // 最大请求数
  const message = options.message || '请求过于频繁，请稍后再试';
  const tag = options.tag || 'default';

  return function rateLimitMiddleware(req, res, pipeline) {
    const key = `${tag}:${clientKey(req)}`;
    const now = Date.now();

    // R9 修复: Map 满时淘汰最早到期条目 (LRU) 而非永久拒绝新 key。
    // 原设计满载后对所有新 key 永久 429, 攻击者伪造 10000 IP 填满后正常用户在 60s 窗口内全部被拒。
    if (!requestCounts.has(key) && requestCounts.size >= MAX_ENTRIES) {
      let oldestKey = null, oldestReset = Infinity;
      for (const [k, e] of requestCounts) {
        if (e.resetTime < oldestReset) { oldestReset = e.resetTime; oldestKey = k; }
      }
      if (oldestKey) {
        requestCounts.delete(oldestKey);
        console.warn(`  [RateLimit] Map 容量达上限 ${MAX_ENTRIES}, 淘汰最早到期条目以接纳新 key`);
      }
    }

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
      const retry = Math.ceil((entry.resetTime - now) / 1000);
      console.warn(`  [RateLimit] ${tag} 限流触发: ${clientKey(req)} (${entry.count}/${maxRequests})`);
      res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': retry });
      res.end(JSON.stringify({ error: message, code: 'RATE_LIMITED', retryAfter: retry }));
      return true;
    }

    return false;
  };
}

// 管道级限流: 认证端点加严, 其余 API 走通用配额
// 规则匹配按声明顺序, 首条命中即生效
const RULES = [
  { match: (p) => p.startsWith('/api/auth/'), windowMs: 60000, maxRequests: 10, message: '认证请求过于频繁，请稍后再试', tag: 'auth' },
  { match: (p) => p.startsWith('/api/'), windowMs: 60000, maxRequests: 120, message: '请求过于频繁，请稍后再试', tag: 'api' },
];

const _middlewareCache = RULES.map(r => ({ ...r, fn: rateLimit(r) }));

function globalRateLimit(req, res, pipeline) {
  if (!req.url || !req.url.startsWith('/api/')) return false;
  const pathname = req.url.split('?')[0];
  for (const rule of _middlewareCache) {
    if (rule.match(pathname)) {
      return rule.fn(req, res, pipeline);
    }
  }
  return false;
}

module.exports = { rateLimit, globalRateLimit };