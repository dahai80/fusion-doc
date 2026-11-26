// =============================================================================
// Fusion-Doc — workspace controller (DocMost spaces design)
// =============================================================================

const { list } = require('../utils/response');
const { parsePaging, tenantId } = require('../utils/helpers');

function register(app) {
  const { db } = app;

  // ── Workspace list ──────────────────────────────────────────────────
  app.registerRoute('GET', '/api/workspaces', (req, res) => {
    // A6 fix: list page-size cap, preventing an unbounded full-table pull and OOM
    const { size, offset } = parsePaging(req);
    // issue #45: tenant isolation — workspace bound to the verified tid
    const tid = tenantId(req);
    const data = db ? db.prepare('SELECT * FROM workspaces WHERE tenant_id = ? ORDER BY name LIMIT ? OFFSET ?').all(tid, size, offset) : require('../db').listJSON('workspaces').filter(w => w.tenant_id === tid).slice(offset, offset + size);
    list(res, data);
  });
}

module.exports = { register };