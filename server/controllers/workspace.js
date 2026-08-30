// =============================================================================
// Fusion-Doc — 工作空间控制器（DocMost 空间设计）
// =============================================================================

const { list } = require('../utils/response');
const { parsePaging } = require('../utils/helpers');

function register(app) {
  const { db } = app;

  // ── 工作空间列表 ──────────────────────────────────────────────────────
  app.registerRoute('GET', '/api/workspaces', (req, res) => {
    // A6 修复: 列表分页上限, 防 unbounded 全表拉 OOM
    const { size, offset } = parsePaging(req);
    const data = db ? db.prepare('SELECT * FROM workspaces ORDER BY name LIMIT ? OFFSET ?').all(size, offset) : require('../db').listJSON('workspaces').slice(offset, offset + size);
    list(res, data);
  });
}

module.exports = { register };