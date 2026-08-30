// =============================================================================
// Fusion-Doc — 评论控制器（DocMost 评论系统）
// =============================================================================

const { parseBody } = require('../middleware/body-parser');
const { uid, now } = require('../utils/helpers');
const { json, list, error, notFound } = require('../utils/response');

const MAX_CONTENT = 8000;

function register(app) {
  const { db } = app;

  app.registerRoute('GET', '/api/comments', (req, res) => {
    const pageId = req.ctx.url.searchParams.get('pageId');
    let data = db ? db.prepare('SELECT * FROM comments WHERE page_id = ? ORDER BY created_at').all(pageId) : [];
    list(res, data);
  });

  app.registerRoute('POST', '/api/comments', async (req, res) => {
    const body = await parseBody(req);
    const content = typeof body.content === 'string' ? body.content.slice(0, MAX_CONTENT) : '';
    if (!content) return error(res, 'content 不能为空', 400);
    if (!body.page_id) return error(res, 'page_id 必填', 400);
    const comment = { id: uid(), page_id: body.page_id, user_id: req.user?.id || 'local', content, parent_id: body.parent_id || null, created_at: now() };
    if (db) { db.prepare('INSERT INTO comments (id, page_id, user_id, content, parent_id, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(comment.id, comment.page_id, comment.user_id, comment.content, comment.parent_id, comment.created_at); }
    json(res, comment, 201);
  });

  // ── 删评论: 仅本人或 admin (P1-10 所有权) ─────────────────────────────
  app.registerRoute('DELETE', '/api/comments/:id', (req, res) => {
    const { id } = req.params;
    if (!db) return json(res, { deleted: true });
    const c = db.prepare('SELECT user_id FROM comments WHERE id = ?').get(id);
    if (!c) return notFound(res, '评论不存在');
    if (req.user?.role !== 'admin' && c.user_id !== (req.user?.id || 'local')) {
      return error(res, '无权删除他人评论', 403);
    }
    db.prepare('DELETE FROM comments WHERE id = ?').run(id);
    console.log(`  [Comment] 删除评论 ${id} by ${req.user?.id || 'anon'}`);
    json(res, { deleted: true });
  });
}

module.exports = { register };