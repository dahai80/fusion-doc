// =============================================================================
// Fusion-Doc — rate-limit middleware (in-memory)
// Modeled on Wiki.js rate limiting, to prevent abuse
// =============================================================================

const requestCounts = new Map();
const MAX_ENTRIES = 10000; // Map capacity cap, prevents unbounded growth from spoofed XFF

// Whether to trust proxy headers (enable explicitly behind a reverse proxy)
const TRUST_PROXY = process.env.TRUST_PROXY === '1';

// Purge expired entries (runs every 60s)
// unref: do not keep the process alive (otherwise CLIs like node --test hang on the timer)
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of requestCounts) {
    if (now - entry.resetTime > 60000) {
      requestCounts.delete(key);
    }
  }
}, 60000).unref();

function clientKey(req) {
  // raw http.createServer never sets req.ip, so socket.remoteAddress takes priority
  const direct = req.socket?.remoteAddress || req.connection?.remoteAddress;
  if (direct) return direct;
  // Read XFF only when the proxy is explicitly trusted (prevents client spoofing to bypass rate limiting)
  if (TRUST_PROXY && req.headers['x-forwarded-for']) {
    return req.headers['x-forwarded-for'].split(',')[0].trim();
  }
  return 'unknown';
}

// Single-rule rate limiter factory
function rateLimit(options = {}) {
  const windowMs = options.windowMs || 60000;      // time window (default 1 minute)
  const maxRequests = options.maxRequests || 100;   // max requests
  const message = options.message || 'Too many requests, please try again later';
  const tag = options.tag || 'default';

  return function rateLimitMiddleware(req, res, pipeline) {
    const key = `${tag}:${clientKey(req)}`;
    const now = Date.now();

    // R9 fix: when the Map is full, evict the earliest-expiring entry (LRU) instead of permanently rejecting new keys.
    // The original design returned 429 forever for every new key once full; an attacker spoofing 10000 IPs could lock out all normal users for the 60s window.
    if (!requestCounts.has(key) && requestCounts.size >= MAX_ENTRIES) {
      let oldestKey = null, oldestReset = Infinity;
      for (const [k, e] of requestCounts) {
        if (e.resetTime < oldestReset) { oldestReset = e.resetTime; oldestKey = k; }
      }
      if (oldestKey) {
        requestCounts.delete(oldestKey);
        console.warn(`  [RateLimit] Map capacity limit ${MAX_ENTRIES} reached, evicting the earliest-expiring entry to admit a new key`);
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
      console.warn(`  [RateLimit] ${tag} rate limit triggered: ${clientKey(req)} (${entry.count}/${maxRequests})`);
      res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': retry });
      res.end(JSON.stringify({ error: message, code: 'RATE_LIMITED', retryAfter: retry }));
      return true;
    }

    return false;
  };
}

// Pipeline-level rate limiting: stricter for auth endpoints, general quota for other APIs
// Rules match in declaration order; the first match wins
const RULES = [
  { match: (p) => p.startsWith('/api/auth/'), windowMs: 60000, maxRequests: 10, message: 'Too many authentication requests, please try again later', tag: 'auth' },
  { match: (p) => p.startsWith('/api/'), windowMs: 60000, maxRequests: 120, message: 'Too many requests, please try again later', tag: 'api' },
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