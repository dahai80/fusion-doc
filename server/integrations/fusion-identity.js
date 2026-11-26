// =============================================================================
// Fusion-Doc — Fusion-Identity integration (issue #45)
// Sole JWT issuer + tenant registry; fusion-doc consumes tokens rather than signing its own.
// Endpoints: POST {IDENTITY_URL}/api/v1/auth/verify (service-token gateway)
//       POST {IDENTITY_URL}/api/v1/tenants/{tid}/usage (usage reporting)
// Service token: Authorization: Bearer <FUSION_IDENTITY_SERVICE_TOKEN>
// Returns: { tid, role, scopes, quota, tenant_status, revoked }
// =============================================================================

const crypto = require('crypto');
const httpFetch = globalThis.fetch;
const AbortCtrl = globalThis.AbortController;

const VERIFY_TIMEOUT_MS = parseInt(process.env.FUSION_IDENTITY_TIMEOUT_MS || '5000', 10);
const USAGE_TIMEOUT_MS = parseInt(process.env.FUSION_IDENTITY_USAGE_TIMEOUT_MS || '3000', 10);
const CACHE_TTL_MS = parseInt(process.env.FUSION_IDENTITY_CACHE_TTL_MS || '60000', 10);

// ── verify result cache (cuts hot-path cost; keyed by token sha256, TTL 60s) ──
const _cache = new Map();
function _cacheKey(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function _cacheGet(key) {
  const ent = _cache.get(key);
  if (!ent) return undefined;
  if (Date.now() - ent.ts > CACHE_TTL_MS) {
    _cache.delete(key);
    return undefined;
  }
  return ent.value;
}

function _cacheSet(key, value) {
  _cache.set(key, { ts: Date.now(), value });
  // Cap guard: evict the oldest beyond 2048 entries (prevents memory bloat)
  if (_cache.size > 2048) {
    const firstKey = _cache.keys().next().value;
    _cache.delete(firstKey);
  }
}

// ── Verify user JWT (calls identity verify; fail-closed) ─────────────────
// Returns: { tid, role, scopes, quota, tenant_status, sub } or throws (caller returns 401)
async function verify({ token, config }) {
  if (!token) throw new Error('identity verify: token missing');
  if (!config.serviceToken) {
    throw new Error('identity verify rejected: FUSION_IDENTITY_SERVICE_TOKEN not set (fail-closed)');
  }
  const key = _cacheKey(token);
  const cached = _cacheGet(key);
  if (cached) return cached;

  const url = `${config.url}/api/v1/auth/verify`;
  const controller = new AbortCtrl();
  const timer = setTimeout(() => controller.abort(), VERIFY_TIMEOUT_MS);
  try {
    const resp = await httpFetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.serviceToken}`,
      },
      body: JSON.stringify({ token }),
      signal: controller.signal,
    });
    if (!resp.ok) {
      const detail = await resp.text().catch(() => '');
      throw new Error(`identity verify failed: ${resp.status} ${detail}`);
    }
    const data = await resp.json();
    // Reject revoked/non-active tenants outright (fail-closed, no default-tenant fallback)
    if (data.revoked || (data.tenant_status && data.tenant_status !== 'active')) {
      throw new Error(`identity verify rejected: tenant_status=${data.tenant_status} revoked=${data.revoked}`);
    }
    _cacheSet(key, data);
    return data;
  } finally {
    clearTimeout(timer);
  }
}

// ── Report AI token usage (fire-and-forget, never blocks/affects the AI response) ───
// body: { rpm, tpm, tokens } — filled by the caller from the mlx response usage
async function reportUsage({ tid, usage, config }) {
  if (!tid || !config.serviceToken) return; // Skip silently (usage reporting is not on the critical path)
  const url = `${config.url}/api/v1/tenants/${encodeURIComponent(tid)}/usage`;
  const controller = new AbortCtrl();
  const timer = setTimeout(() => controller.abort(), USAGE_TIMEOUT_MS);
  try {
    const resp = await httpFetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.serviceToken}`,
      },
      body: JSON.stringify(usage || {}),
      signal: controller.signal,
    });
    if (!resp.ok) {
      console.warn(`[Identity] usage report failed (non-fatal): ${resp.status} tid=${tid}`);
    }
  } catch (e) {
    console.warn(`[Identity] usage report error (non-fatal): ${e.message} tid=${tid}`);
  } finally {
    clearTimeout(timer);
  }
}

// ── Health probe (startup/doctor) ─────────────────────────────────────────
async function healthCheck(config) {
  if (!config.serviceToken) return { ok: false, reason: 'service token not set' };
  const controller = new AbortCtrl();
  const timer = setTimeout(() => controller.abort(), 3000);
  try {
    // The verify endpoint with an empty token is expected to return 401 (service alive + correct service token gives a 401 body of invalid)
    const resp = await httpFetch(`${config.url}/api/v1/auth/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.serviceToken}`,
      },
      body: JSON.stringify({ token: 'healthcheck-probe' }),
      signal: controller.signal,
    });
    // 401 = service online (token invalid); 200 impossible; 503/timeout = offline
    return { ok: resp.status === 401 || resp.status === 200, status: resp.status };
  } catch (e) {
    return { ok: false, reason: e.message };
  } finally {
    clearTimeout(timer);
  }
}

function clearCache() { _cache.clear(); }

module.exports = { verify, reportUsage, healthCheck, clearCache };
