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
    const signature = crypto.createHmac('sha256', secret).update(`${parts[0]}.${parts[1]}`).digest('base64url');
    if (signature !== parts[2]) return null;
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch (_) { return null; }
}

// 公开路径（无需认证）
const PUBLIC_PATHS = [
  '/api/health',
  '/api/system/setup',
  '/api/auth/setup',
  '/api/auth/login',
  '/api/branding',
  '/api/theme',
];

function auth(req, res, pipeline) {
  // 公开路径跳过认证
  if (PUBLIC_PATHS.includes(req.url.split('?')[0])) {
    return false;
  }

  // 非 API 路径跳过（静态文件 / SPA）
  if (!req.url.startsWith('/api/')) {
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

  // 开发模式：通过 X-User-Id 头模拟用户（仅 NODE_ENV=development 时生效）
  if (process.env.NODE_ENV === 'development' && req.headers['x-user-id']) {
    req.user = { id: req.headers['x-user-id'], role: 'admin' };
    return false;
  }

  // 未认证
  res.writeHead(401, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Unauthorized', code: 'AUTH_REQUIRED' }));
  return true; // 管道停止
}

module.exports = { auth, createToken, verifyToken };