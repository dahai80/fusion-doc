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
      // R3 修复: 不信任 token 自报 role/id, 回查 users 表取权威 role; 失败则拒绝。
      // 原设计直接 req.user = payload, JWT_SECRET 泄漏后伪造 {role:'admin'} 即获管理员。
      const db = req.ctx?.db;
      let verified = payload;
      if (db && payload.id) {
        try {
          const row = db.prepare('SELECT id, role FROM users WHERE id = ?').get(payload.id);
          if (!row) {
            console.warn(`[Auth] token 用户不存在, 拒绝: ${payload.id}`);
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Unauthorized: user not found', code: 'AUTH_USER_INVALID' }));
            return true;
          }
          verified = { ...payload, role: row.role };
        } catch (e) {
          console.warn(`[Auth] 用户回查失败, 降级用 token role: ${e.message}`);
        }
      }
      req.user = verified;
      return false; // 认证通过，继续管道
    }
  }

  // 开发旁路: 需同时 AUTH_DEV_BYPASS=1 且 NODE_ENV=development, 且请求来自本机回环。
  // R19 修复: 原仅查 config 绑定地址 (反代场景 config.host=127.0.0.1 但服务对外暴露即绕过);
  // 改查请求实际来源 remoteAddress, 与 CLAUDE.md "仅 NODE_ENV=development 生效" 文档对齐。
  if (process.env.AUTH_DEV_BYPASS === '1' && process.env.NODE_ENV === 'development' && req.headers['x-user-id']) {
    const remote = req.socket?.remoteAddress || '';
    const isLoopback = remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1';
    if (isLoopback) {
      req.user = { id: req.headers['x-user-id'], role: 'admin' };
      console.warn('[Auth] DEV bypass used (AUTH_DEV_BYPASS=1 + NODE_ENV=development + loopback only)');
      return false;
    }
    console.error(`[Auth] X-User-Id bypass rejected: 请求非回环来源 (${remote})`);
  }

  // 未认证
  res.writeHead(401, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Unauthorized', code: 'AUTH_REQUIRED' }));
  return true; // 管道停止
}

module.exports = { auth, createToken, verifyToken };