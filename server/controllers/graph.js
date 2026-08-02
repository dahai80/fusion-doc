// =============================================================================
// Fusion-Doc — 知识图谱控制器（Zettlr 双向链接图谱）
// =============================================================================

const { json } = require('../utils/response');

function register(app) {
  const { db } = app;

  app.registerRoute('GET', '/api/graph', (req, res) => {
    let nodes = [], edges = [];
    if (db) {
      nodes = db.prepare('SELECT id, title FROM pages').all().map(p => ({ id: p.id, title: p.title, type: 'page' }));
      edges = db.prepare('SELECT id, source_page_id as source, target_page_id as target, link_type as label FROM page_links').all();
    }
    json(res, { nodes, edges });
  });
}

module.exports = { register };