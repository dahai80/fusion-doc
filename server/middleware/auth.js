// =============================================================================
// Fusion-Doc — 认证中间件
// 参考 DocMost + Wiki.js 多认证设计
// =============================================================================

const crypto = require('crypto');

// 简单 JWT 实现（无外部依赖）
function createToken(payload, secret, expiry = 86400) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const body = Buffer.from(JSON.stringify({ ...payload, iat: now, exp: now + expiry })).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

function verifyToken(token, secret) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    // 校验 header alg 必须为 HS256, 杜绝 alg=none/未来第三方 token
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
    if (!header || header.alg !== 'HS256') return null;
    const signature = crypto.createHmac('sha256', secret).update(`${parts[0]}.${parts[1]}`).digest('base64url');
    // 恒定时间比较, 防时序侧信道
    const a = Buffer.from(signature, 'utf-8');
    const b = Buffer.from(parts[2], 'utf-8');
    if (a.length !== b.length) return null;
    if (!crypto.timingSafeEqual(a, b)) return null;
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch (_) { return null; }
}

// 公开路径（无需认证）: 默认所有方法公开; METHOD:PATH 仅指定方法公开
const PUBLIC_PATHS = [
  '/api/health',
  '/api/system/setup',
  '/api/auth/setup',
  '/api/auth/login',
  '/api/branding',
  'GET:/api/theme', // theme 仅 GET 公开, POST 须认证 (防未授权写)
];

function isPublicPath(method, pathname) {
  return PUBLIC_PATHS.some(p =>
    p === pathname || (p.includes(':') && p === `${method}:${pathname}`)
  );
}

function auth(req, res, pipeline) {
  const method = req.method;
  const pathname = req.url.split('?')[0];

  // 公开路径跳过认证
  if (isPublicPath(method, pathname)) {
    return false;
  }

  // 非 API 路径跳过（静态文件 / SPA）
  if (!pathname.startsWith('/api/')) {
    return false;
  }

  // 从请求头获取 token
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';

  if (token) {
    const secret = req.ctx?.config?.auth?.jwtSecret;
    if (!secret) {
      console.error('[Auth] JWT secret not configured — rejecting all token auth');
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Server misconfiguration: JWT secret not set', code: 'AUTH_CONFIG_ERROR' }));
      return true;
    }
    const payload = verifyToken(token, secret);
    if (payload) {
      req.user = payload;
      return false; // 认证通过，继续管道
    }
  }

  // 开发旁路: 仅显式 AUTH_DEV_BYPASS=1 且绑定 127.0.0.1 时生效, 杜绝 LAN 越权
  if (process.env.AUTH_DEV_BYPASS === '1' && req.headers['x-user-id']) {
    const host = req.ctx?.config?.host;
    if (host === '127.0.0.1' || host === 'localhost') {
      req.user = { id: req.headers['x-user-id'], role: 'admin' };
      console.warn('[Auth] DEV bypass used (AUTH_DEV_BYPASS=1, 127.0.0.1 only)');
      return false;
    }
    console.error('[Auth] X-User-Id bypass rejected: not bound to 127.0.0.1');
  }

  // 未认证
  res.writeHead(401, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Unauthorized', code: 'AUTH_REQUIRED' }));
  return true; // 管道停止
}

module.exports = { auth, createToken, verifyToken };