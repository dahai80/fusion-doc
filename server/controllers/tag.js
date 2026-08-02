// =============================================================================
// Fusion-Doc — 标签控制器（Teedy 标签系统）
// =============================================================================

const { parseBody } = require('../middleware/body-parser');
const { uid } = require('../utils/helpers');
const { list, created } = require('../utils/response');

function register(app) {
  const { db } = app;

  app.registerRoute('GET', '/api/tags', (req, res) => {
    const data = db ? db.prepare('SELECT * FROM tags ORDER BY name').all() : require('../db').listJSON('tags');
    list(res, data);
  });

  app.registerRoute('POST', '/api/tags', async (req, res) => {
    const body = await parseBody(req);
    const tag = { id: uid(), name: body.name, color: body.color || '#6366f1' };
    if (db) { db.prepare('INSERT OR IGNORE INTO tags (id, name, color) VALUES (?, ?, ?)').run(tag.id, tag.name, tag.color); }
    else { require('../db').writeJSON('tags', tag.id, tag); }
    created(res, tag);
  });
}

module.exports = { register };