// =============================================================================
// Fusion-Doc — 工具函数
// =============================================================================

const crypto = require('crypto');

// P3-28: 用 crypto.randomUUID 替代 Date.now()+Math.random() — 防碰撞且不可预测
// 保留兼容前缀形 id, 仅在随机源不可用时回退 (极少触发)
function uid() {
  try {
    return crypto.randomUUID();
  } catch (_) {
    // 极端环境兜底 (非密码学安全, 仅防碰撞)
    return Date.now().toString(36) + crypto.randomBytes(6).toString('hex');
  }
}

function now() {
  return new Date().toISOString();
}

function slugify(text) {
  return (text || '').toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

// A6 修复: 列表端点分页解析。从 req.ctx.url.searchParams 读 page/size,
// 返回 { size, offset, page }。size 上限 200, 默认 50; 防 unbounded 全表拉 OOM。
function parsePaging(req) {
  const sizeRaw = parseInt(req.ctx.url.searchParams.get('size'), 10);
  const pageRaw = parseInt(req.ctx.url.searchParams.get('page'), 10);
  const size = Number.isFinite(sizeRaw) && sizeRaw > 0 && sizeRaw <= 200 ? sizeRaw : 50;
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;
  return { size, offset: (page - 1) * size, page };
}

module.exports = { uid, now, slugify, parsePaging };