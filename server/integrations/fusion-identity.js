// =============================================================================
// Fusion-Doc — Fusion-Identity 集成 (issue #45)
// 唯一 JWT 签发方 + 租户注册中心; fusion-doc 消费而非自签。
// 端点: POST {IDENTITY_URL}/api/v1/auth/verify (service-token 网关)
//       POST {IDENTITY_URL}/api/v1/tenants/{tid}/usage (用量上报)
// 服务令牌: Authorization: Bearer <FUSION_IDENTITY_SERVICE_TOKEN>
// 返回: { tid, role, scopes, quota, tenant_status, revoked }
// =============================================================================

const crypto = require('crypto');
const httpFetch = globalThis.fetch;
const AbortCtrl = globalThis.AbortController;

const VERIFY_TIMEOUT_MS = parseInt(process.env.FUSION_IDENTITY_TIMEOUT_MS || '5000', 10);
const USAGE_TIMEOUT_MS = parseInt(process.env.FUSION_IDENTITY_USAGE_TIMEOUT_MS || '3000', 10);
const CACHE_TTL_MS = parseInt(process.env.FUSION_IDENTITY_CACHE_TTL_MS || '60000', 10);

// ── verify 结果缓存 (热路径降本; 按 token sha256 键, TTL 60s) ──
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
  // 上限保护: 超过 2048 条淘汰最早 (防内存膨胀)
  if (_cache.size > 2048) {
    const firstKey = _cache.keys().next().value;
    _cache.delete(firstKey);
  }
}

// ── 校验用户 JWT (调 identity verify; fail-closed) ───────────────────────
// 返回: { tid, role, scopes, quota, tenant_status, sub } 或抛错 (调用方 401)
async function verify({ token, config }) {
  if (!token) throw new Error('identity verify: token 缺失');
  if (!config.serviceToken) {
    throw new Error('identity verify 被拒绝: FUSION_IDENTITY_SERVICE_TOKEN 未设置 (fail-closed)');
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
      throw new Error(`identity verify 失败: ${resp.status} ${detail}`);
    }
    const data = await resp.json();
    // revoked/非 active 租户一律拒绝 (fail-closed, 无默认租户降级)
    if (data.revoked || (data.tenant_status && data.tenant_status !== 'active')) {
      throw new Error(`identity verify 拒绝: tenant_status=${data.tenant_status} revoked=${data.revoked}`);
    }
    _cacheSet(key, data);
    return data;
  } finally {
    clearTimeout(timer);
  }
}

// ── 上报 AI token 用量 (fire-and-forget, 永不阻塞/影响 AI 响应) ──────────
// body: { rpm, tpm, tokens } — 由调用方按 mlx 响应 usage 填
async function reportUsage({ tid, usage, config }) {
  if (!tid || !config.serviceToken) return; // 静默跳过 (用量上报非关键路径)
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
      console.warn(`[Identity] 用量上报失败 (非致命): ${resp.status} tid=${tid}`);
    }
  } catch (e) {
    console.warn(`[Identity] 用量上报异常 (非致命): ${e.message} tid=${tid}`);
  } finally {
    clearTimeout(timer);
  }
}

// ── 健康探测 (startup/doctor) ─────────────────────────────────────────────
async function healthCheck(config) {
  if (!config.serviceToken) return { ok: false, reason: 'service token 未设置' };
  const controller = new AbortCtrl();
  const timer = setTimeout(() => controller.abort(), 3000);
  try {
    // verify 端点带空 token 预期 401 (服务存活 + service token 正确则 401 body 为 invalid)
    const resp = await httpFetch(`${config.url}/api/v1/auth/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.serviceToken}`,
      },
      body: JSON.stringify({ token: 'healthcheck-probe' }),
      signal: controller.signal,
    });
    // 401 = 服务在线 (token 无效); 200 不可能; 503/超时 = 离线
    return { ok: resp.status === 401 || resp.status === 200, status: resp.status };
  } catch (e) {
    return { ok: false, reason: e.message };
  } finally {
    clearTimeout(timer);
  }
}

function clearCache() { _cache.clear(); }

module.exports = { verify, reportUsage, healthCheck, clearCache };
