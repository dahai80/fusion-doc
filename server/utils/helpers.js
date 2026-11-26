// =============================================================================
// Fusion-Doc — utility functions
// =============================================================================

const crypto = require('crypto');

// P3-28: use crypto.randomUUID instead of Date.now()+Math.random() — collision-resistant and unpredictable
// Keeps a compatible prefixed id form, falling back only when the random source is unavailable (very rare)
function uid() {
  try {
    return crypto.randomUUID();
  } catch (_) {
    // Last-resort fallback for extreme environments (not cryptographically secure, collision avoidance only)
    return Date.now().toString(36) + crypto.randomBytes(6).toString('hex');
  }
}

function now() {
  return new Date().toISOString();
}

function slugify(text) {
  return (text || '').toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

// A6 fix: paging parser for list endpoints. Reads page/size from req.ctx.url.searchParams,
// returns { size, offset, page }. size capped at 200, default 50; prevents an unbounded full-table pull OOM.
function parsePaging(req) {
  const sizeRaw = parseInt(req.ctx.url.searchParams.get('size'), 10);
  const pageRaw = parseInt(req.ctx.url.searchParams.get('page'), 10);
  const size = Number.isFinite(sizeRaw) && sizeRaw > 0 && sizeRaw <= 200 ? sizeRaw : 50;
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;
  return { size, offset: (page - 1) * size, page };
}

// issue #45: tenant context lookup. req.user.tid is injected by the auth middleware (identity verify or local bypass).
// Falls back to 'local-tenant' if missing (local bypass compatibility only; on the production path auth already rejects with 401, so this is never reached).
function tenantId(req) {
  return req.user?.tid || 'local-tenant';
}

module.exports = { uid, now, slugify, parsePaging, tenantId };