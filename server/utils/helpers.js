// =============================================================================
// Fusion-Doc — 工具函数
// =============================================================================

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function now() {
  return new Date().toISOString();
}

function slugify(text) {
  return (text || '').toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

module.exports = { uid, now, slugify };