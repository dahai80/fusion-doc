// =============================================================================
// Fusion-Doc — comment controller (DocMost comment system)
// =============================================================================

const { parseBody } = require('../middleware/body-parser');
const { uid, now, parsePaging } = require('../utils/helpers');
const { json, list, error, notFound } = require('../utils/response');

const MAX_CONTENT = 8000;

function register(app) {
  const { db } = app;

  app.registerRoute('GET', '/api/comments', (req, res) => {
    const pageId = req.ctx.url.searchParams.get('pageId');
    // A6 fix: cap list paging to prevent unbounded full-table pulls causing OOM
    const { size, offset } = parsePaging(req);
    let data = db ? db.prepare('SELECT * FROM comments WHERE page_id = ? ORDER BY created_at LIMIT ? OFFSET ?').all(pageId, size, offset) : [];
    list(res, data);
  });

  app.registerRoute('POST', '/api/comments', async (req, res) => {
    const body = await parseBody(req);
    const content = typeof body.content === 'string' ? body.content.slice(0, MAX_CONTENT) : '';
    if (!content) return error(res, 'content must not be empty', 400);
    if (!body.page_id) return error(res, 'page_id is required', 400);
    // R13 fix: verify the page exists + private-page read isolation, preventing comment spam on others' private pages
    if (db) {
      const page = db.prepare('SELECT created_by, is_published FROM pages WHERE id = ?').get(body.page_id);
      if (!page) return error(res, 'Page not found', 404, 'NOT_FOUND');
      const isOwner = page.created_by === (req.user?.id || 'local');
      const isPublished = page.is_published === 1 || page.is_published === '1';
      if (req.user?.role !== 'admin' && req.user?.role !== 'tenant_admin' && !isOwner && page.created_by && !isPublished) {
        return error(res, 'Not allowed to comment on another user\'s private page', 403, 'FORBIDDEN');
      }
    }
    const comment = { id: uid(), page_id: body.page_id, user_id: req.user?.id || 'local', content, parent_id: body.parent_id || null, created_at: now() };
    if (db) { db.prepare('INSERT INTO comments (id, page_id, user_id, content, parent_id, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(comment.id, comment.page_id, comment.user_id, comment.content, comment.parent_id, comment.created_at); }
    json(res, comment, 201);
  });

  // ── Delete comment: author or admin only (P1-10 ownership) ─────────────
  app.registerRoute('DELETE', '/api/comments/:id', (req, res) => {
    const { id } = req.params;
    if (!db) return json(res, { deleted: true });
    const c = db.prepare('SELECT user_id FROM comments WHERE id = ?').get(id);
    if (!c) return notFound(res, 'Comment not found');
    if (req.user?.role !== 'admin' && req.user?.role !== 'tenant_admin' && c.user_id !== (req.user?.id || 'local')) {
      return error(res, 'Not allowed to delete another user\'s comment', 403);
    }
    db.prepare('DELETE FROM comments WHERE id = ?').run(id);
    console.log(`  [Comment] deleted comment ${id} by ${req.user?.id || 'anon'}`);
    json(res, { deleted: true });
  });
}

module.exports = { register };