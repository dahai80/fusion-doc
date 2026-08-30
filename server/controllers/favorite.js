// =============================================================================
// Fusion-Doc — 收藏控制器（DocMost 收藏系统）
// =============================================================================

const { parseBody } = require('../middleware/body-parser');
const { json, list, error } = require('../utils/response');

function register(app) {
  const { db } = app;

  // 仅返回当前用户收藏 (按用户隔离, P1-10)
  app.registerRoute('GET', '/api/favorites', (req, res) => {
    const userId = req.user?.id || 'local';
    const data = db ? db.prepare('SELECT p.* FROM pages p JOIN favorites f ON p.id = f.page_id WHERE f.user_id = ?').all(userId) : [];
    list(res, data);
  });

  app.registerRoute('POST', '/api/favorites', async (req, res) => {
    const body = await parseBody(req);
    if (!body.page_id) return error(res, 'page_id 必填', 400);
    const userId = req.user?.id || 'local';
    if (db) { db.prepare('INSERT OR IGNORE INTO favorites (user_id, page_id) VALUES (?, ?)').run(userId, body.page_id); }
    json(res, { favorited: true }, 201);
  });

  app.registerRoute('DELETE', '/api/favorites/:pageId', (req, res) => {
    const { pageId } = req.params;
    const userId = req.user?.id || 'local';
    if (db) { db.prepare('DELETE FROM favorites WHERE user_id = ? AND page_id = ?').run(userId, pageId); }
    json(res, { unfavorited: true });
  });
}

module.exports = { register };