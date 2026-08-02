// =============================================================================
// Fusion-Doc — 工作空间控制器（DocMost 空间设计）
// =============================================================================

const { list } = require('../utils/response');

function register(app) {
  const { db } = app;

  // ── 工作空间列表 ──────────────────────────────────────────────────────
  app.registerRoute('GET', '/api/workspaces', (req, res) => {
    const data = db ? db.prepare('SELECT * FROM workspaces ORDER BY name').all() : require('../db').listJSON('workspaces');
    list(res, data);
  });
}

module.exports = { register };