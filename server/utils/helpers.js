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

module.exports = { uid, now, slugify };