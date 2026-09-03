// =============================================================================
// Fusion-Doc — 认证中间件 (issue #45: 消费 fusion-identity, 不再自签)
// 唯一 JWT 签发方 = fusion-identity; 本中间件调 verify 校验 + 注入租户上下文。
// 三条红线: (1) fail-closed (无默认租户降级), (2) 跨租户拒绝 (tid↔X-Tenant-Id),
//           (3) 数据隔离分层 (medium: tenant_id 列 + 守卫, 见 authz.js/各控制器)。
// 本地旁路 FUSION_DOC_LOCAL_AUTH=1: 保留原 HS256 自签 + users 表 (单用户开发; 生产禁)。
// =============================================================================

const crypto = require('crypto');
const identity = require('../integrations/fusion-identity');

// ── 本地旁路用 HS256 (仅 FUSION_DOC_LOCAL_AUTH=1; 保留向后兼容) ──────────
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
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
    if (!header || header.alg !== 'HS256') return null;
    const signature = crypto.createHmac('sha256', secret).update(`${parts[0]}.${parts[1]}`).digest('base64url');
    const a = Buffer.from(signature, 'utf-8');
    const b = Buffer.from(parts[2], 'utf-8');
    if (a.length !== b.length) return null;
    if (!crypto.timingSafeEqual(a, b)) return null;
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch (_) { return null; }
}

// 公开路径 (无需认证): 默认所有方法公开; METHOD:PATH 仅指定方法公开
const PUBLIC_PATHS = [
  '/api/health',
  '/api/health/live',
  '/api/metrics',
  '/api/system/setup',
  '/api/auth/setup',
  '/api/auth/login',
  '/api/branding',
  'GET:/api/theme',
];

function isPublicPath(method, pathname) {
  return PUBLIC_PATHS.some(p =>
    p === pathname || (p.includes(':') && p === `${method}:${pathname}`)
  );
}

// ── 本地旁路: 从 users 表回查权威 role (保留 R3 修复) ────────────────────
function _localVerify(token, req, res) {
  const secret = req.ctx?.config?.auth?.jwtSecret;
  if (!secret) {
    console.error('[Auth] JWT secret not configured — rejecting all token auth');
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Server misconfiguration: JWT secret not set', code: 'AUTH_CONFIG_ERROR' }));
    return null; // null = 未处理 (调用方续判); 但此处已响应 → 返回 sentinel
  }
  const payload = verifyToken(token, secret);
  if (!payload) return false; // false = 校验失败
  const db = req.ctx?.db;
  let verified = payload;
  if (db && payload.id) {
    try {
      const row = db.prepare('SELECT id, role FROM users WHERE id = ?').get(payload.id);
      if (!row) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized: user not found', code: 'AUTH_USER_INVALID' }));
        return null;
      }
      verified = { ...payload, role: row.role };
    } catch (e) {
      console.warn(`[Auth] 用户回查失败, 降级用 token role: ${e.message}`);
    }
  }
  // 本地旁路无真实租户; 用 workspace id 作伪 tid 兼容旧单用户场景
  verified.tid = verified.tid || verified.workspace_id || 'local-tenant';
  return verified;
}

// ── role 映射: 4 统一角色; 兼容 legacy admin/user ─────────────────────────
function _normalizeRole(role) {
  if (!role) return 'member';
  if (role === 'admin') return 'tenant_admin';
  if (role === 'user') return 'member';
  return role; // tenant_admin/operator/member/viewer 原样
}

// ── 主认证 ────────────────────────────────────────────────────────────────
async function auth(req, res, pipeline) {
  const method = req.method;
  const pathname = req.url.split('?')[0];
  const cfg = req.ctx?.config;

  if (isPublicPath(method, pathname)) return false;
  if (!pathname.startsWith('/api/')) return false;

  // ── 提取 Bearer token ──
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';

  // ── 本地认证旁路 (FUSION_DOC_LOCAL_AUTH=1) ──
  if (cfg?.localAuth) {
    if (token) {
      const r = _localVerify(token, req, res);
      if (r === null) return true; // 已响应 (配置错误/用户不存在)
      if (r) {
        req.user = { id: r.id, tid: r.tid, role: _normalizeRole(r.role), scopes: r.scope || [] };
        return false;
      }
    }
    // 本地旁路的 dev X-User-Id 兜底 (仅 dev + loopback)
    if (process.env.NODE_ENV === 'development' && req.headers['x-user-id']) {
      const remote = req.socket?.remoteAddress || '';
      const isLoopback = remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1';
      if (isLoopback) {
        req.user = { id: req.headers['x-user-id'], tid: 'local-tenant', role: 'tenant_admin', scopes: [] };
        console.warn('[Auth] LOCAL bypass: X-User-Id (dev loopback only)');
        return false;
      }
    }
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Unauthorized', code: 'AUTH_REQUIRED' }));
    return true;
  }

  // ── 生产/默认: fusion-identity verify (fail-closed) ──
  if (!token) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Unauthorized: token required', code: 'AUTH_REQUIRED' }));
    return true;
  }

  // X-Tenant-Id 必填 (红线1: fail-closed, 无默认租户降级)
  const xTenantId = req.headers['x-tenant-id'] || '';
  if (!xTenantId) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Unauthorized: X-Tenant-Id header required', code: 'AUTH_TENANT_REQUIRED' }));
    return true;
  }

  let claims;
  try {
    claims = await identity.verify({ token, config: cfg.fusionIdentity });
  } catch (e) {
    console.warn(`[Auth] identity verify 拒绝: ${e.message}`);
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Unauthorized: token invalid', code: 'AUTH_TOKEN_INVALID' }));
    return true;
  }

  // 红线2: 跨租户拒绝 — JWT tid 必须匹配 X-Tenant-Id
  if (claims.tid !== xTenantId) {
    console.warn(`[Auth] 跨租户拒绝: token tid=${claims.tid} ≠ X-Tenant-Id=${xTenantId}`);
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Unauthorized: tenant mismatch', code: 'AUTH_TENANT_MISMATCH' }));
    return true;
  }

  // 注入租户上下文 (role 来自 identity 权威回查, 非 token 自报)
  req.user = {
    id: claims.sub || claims.tid,
    tid: claims.tid,
    role: _normalizeRole(claims.role),
    scopes: claims.scopes || [],
    quota: claims.quota || {},
  };
  return false;
}

module.exports = { auth, createToken, verifyToken };
