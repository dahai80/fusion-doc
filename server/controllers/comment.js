// =============================================================================
// Fusion-Doc — 评论控制器（DocMost 评论系统）
// =============================================================================

const { parseBody } = require('../middleware/body-parser');
const { uid, now, parsePaging } = require('../utils/helpers');
const { json, list, error, notFound } = require('../utils/response');

const MAX_CONTENT = 8000;

function register(app) {
  const { db } = app;

  app.registerRoute('GET', '/api/comments', (req, res) => {
    const pageId = req.ctx.url.searchParams.get('pageId');
    // A6 修复: 列表分页上限, 防 unbounded 全表拉 OOM
    const { size, offset } = parsePaging(req);
    let data = db ? db.prepare('SELECT * FROM comments WHERE page_id = ? ORDER BY created_at LIMIT ? OFFSET ?').all(pageId, size, offset) : [];
    list(res, data);
  });

  app.registerRoute('POST', '/api/comments', async (req, res) => {
    const body = await parseBody(req);
    const content = typeof body.content === 'string' ? body.content.slice(0, MAX_CONTENT) : '';
    if (!content) return error(res, 'content 不能为空', 400);
    if (!body.page_id) return error(res, 'page_id 必填', 400);
    // R13 修复: 校验页面存在 + 私有页读隔离, 杜绝对他人私有页灌评论
    if (db) {
      const page = db.prepare('SELECT created_by, is_published FROM pages WHERE id = ?').get(body.page_id);
      if (!page) return error(res, '页面不存在', 404, 'NOT_FOUND');
      const isOwner = page.created_by === (req.user?.id || 'local');
      const isPublished = page.is_published === 1 || page.is_published === '1';
      if (req.user?.role !== 'admin' && !isOwner && page.created_by && !isPublished) {
        return error(res, '无权对他人私有页面评论', 403, 'FORBIDDEN');
      }
    }
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