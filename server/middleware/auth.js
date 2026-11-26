// =============================================================================
// Fusion-Doc — auth middleware (issue #45: consumes fusion-identity, no more self-signing)
// The only JWT issuer = fusion-identity; this middleware calls verify + injects tenant context.
// Three red lines: (1) fail-closed (no default-tenant fallback), (2) cross-tenant rejection (tid↔X-Tenant-Id),
//           (3) layered data isolation (medium: tenant_id column + guards, see authz.js/controllers).
// Local bypass FUSION_DOC_LOCAL_AUTH=1: keeps the old HS256 self-signing + users table (single-user dev; forbidden in production).
// =============================================================================

const crypto = require('crypto');
const identity = require('../integrations/fusion-identity');

// ── HS256 for the local bypass (FUSION_DOC_LOCAL_AUTH=1 only; kept for backward compatibility) ──
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

// Public paths (no auth): public for all methods by default; METHOD:PATH is public only for that method
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

// ── Local bypass: look up the authoritative role in the users table (keeps the R3 fix) ──────
function _localVerify(token, req, res) {
  const secret = req.ctx?.config?.auth?.jwtSecret;
  if (!secret) {
    console.error('[Auth] JWT secret not configured — rejecting all token auth');
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Server misconfiguration: JWT secret not set', code: 'AUTH_CONFIG_ERROR' }));
    return null; // null = not handled (caller keeps deciding); but a response was already sent here → return sentinel
  }
  const payload = verifyToken(token, secret);
  if (!payload) return false; // false = verification failed
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
      console.warn(`[Auth] user lookup failed, falling back to token role: ${e.message}`);
    }
  }
  // Local bypass has no real tenant; use the workspace id as a pseudo tid for legacy single-user setups
  verified.tid = verified.tid || verified.workspace_id || 'local-tenant';
  return verified;
}

// ── Role mapping: 4 unified roles; compatible with legacy admin/user ──────
function _normalizeRole(role) {
  if (!role) return 'member';
  if (role === 'admin') return 'tenant_admin';
  if (role === 'user') return 'member';
  return role; // tenant_admin/operator/member/viewer unchanged
}

// ── Main auth ─────────────────────────────────────────────────────────────
async function auth(req, res, pipeline) {
  const method = req.method;
  const pathname = req.url.split('?')[0];
  const cfg = req.ctx?.config;

  if (isPublicPath(method, pathname)) return false;
  if (!pathname.startsWith('/api/')) return false;

  // ── Extract Bearer token ──
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';

  // ── Shell service credential (issue #51: injected by the gateway /shell/ proxy, no self-managed login) ──
  // The gateway strips the caller session and injects the module api_key; allowed here via constant-time comparison.
  // The principal is a service-level shell session (tenant/role configurable, default operator; admin endpoints still reject).
  const shellKey = cfg?.shellGateway?.apiKey || '';
  if (shellKey && token) {
    const a = Buffer.from(shellKey);
    const b = Buffer.from(token);
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
      req.user = {
        id: 'shell-session',
        tid: cfg.shellGateway.tenant || 'shell',
        role: cfg.shellGateway.role || 'operator',
        scopes: [],
      };
      return false;
    }
  }

  // ── Local auth bypass (FUSION_DOC_LOCAL_AUTH=1) ──
  if (cfg?.localAuth) {
    if (token) {
      const r = _localVerify(token, req, res);
      if (r === null) return true; // already responded (config error/user not found)
      if (r) {
        req.user = { id: r.id, tid: r.tid, role: _normalizeRole(r.role), scopes: r.scope || [] };
        return false;
      }
    }
    // Dev X-User-Id fallback for the local bypass (dev + loopback only)
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

  // ── Production/default: fusion-identity verify (fail-closed) ──
  if (!token) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Unauthorized: token required', code: 'AUTH_REQUIRED' }));
    return true;
  }

  // X-Tenant-Id required (red line 1: fail-closed, no default-tenant fallback)
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
    console.warn(`[Auth] identity verify rejected: ${e.message}`);
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Unauthorized: token invalid', code: 'AUTH_TOKEN_INVALID' }));
    return true;
  }

  // Red line 2: cross-tenant rejection — JWT tid must match X-Tenant-Id
  if (claims.tid !== xTenantId) {
    console.warn(`[Auth] cross-tenant rejected: token tid=${claims.tid} ≠ X-Tenant-Id=${xTenantId}`);
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Unauthorized: tenant mismatch', code: 'AUTH_TENANT_MISMATCH' }));
    return true;
  }

  // Inject tenant context (role comes from the authoritative identity lookup, not self-reported by the token)
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
