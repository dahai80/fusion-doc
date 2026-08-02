// =============================================================================
// Fusion-Doc — 收藏控制器（DocMost 收藏系统）
// =============================================================================

const { parseBody } = require('../middleware/body-parser');
const { json, list } = require('../utils/response');

function register(app) {
  const { db } = app;

  app.registerRoute('GET', '/api/favorites', (req, res) => {
    const data = db ? db.prepare('SELECT p.* FROM pages p JOIN favorites f ON p.id = f.page_id').all() : [];
    list(res, data);
  });

  app.registerRoute('POST', '/api/favorites', async (req, res) => {
    const body = await parseBody(req);
    if (db) { db.prepare('INSERT OR IGNORE INTO favorites (user_id, page_id) VALUES (?, ?)').run('local', body.page_id); }
    json(res, { favorited: true }, 201);
  });

  app.registerRoute('DELETE', '/api/favorites/:pageId', (req, res) => {
    const { pageId } = req.params;
    if (db) { db.prepare('DELETE FROM favorites WHERE user_id = ? AND page_id = ?').run('local', pageId); }
    json(res, { unfavorited: true });
  });
}

module.exports = { register };