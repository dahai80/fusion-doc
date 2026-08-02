// =============================================================================
// Fusion-Doc — 评论控制器（DocMost 评论系统）
// =============================================================================

const { parseBody } = require('../middleware/body-parser');
const { uid, now } = require('../utils/helpers');
const { json, list } = require('../utils/response');

function register(app) {
  const { db } = app;

  app.registerRoute('GET', '/api/comments', (req, res) => {
    const pageId = req.ctx.url.searchParams.get('pageId');
    let data = db ? db.prepare('SELECT * FROM comments WHERE page_id = ? ORDER BY created_at').all(pageId) : [];
    list(res, data);
  });

  app.registerRoute('POST', '/api/comments', async (req, res) => {
    const body = await parseBody(req);
    const comment = { id: uid(), page_id: body.page_id, user_id: req.user?.id || 'local', content: body.content, parent_id: body.parent_id || null, created_at: now() };
    if (db) { db.prepare('INSERT INTO comments (id, page_id, user_id, content, parent_id, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(...Object.values(comment)); }
    json(res, comment, 201);
  });

  app.registerRoute('DELETE', '/api/comments/:id', (req, res) => {
    const { id } = req.params;
    if (db) { db.prepare('DELETE FROM comments WHERE id = ?').run(id); }
    json(res, { deleted: true });
  });
}

module.exports = { register };