// =============================================================================
// Fusion-Doc — chapter controller (BookStack middle tier)
// =============================================================================

const { parseBody } = require('../middleware/body-parser');
const { uid, now, slugify, parsePaging, tenantId } = require('../utils/helpers');
const { json, list, created, error, notFound } = require('../utils/response');
const { requireAdmin } = require('../middleware/require-admin');

const MAX_NAME = 200;
const MAX_DESC = 2000;

function register(app) {
  const { db } = app;

  // issue #45: cross-tenant access always returns 404 (does not leak existence)
  function _chapterTenantOk(req, res, chapter) {
    if (!chapter) { notFound(res, 'Chapter not found'); return false; }
    const tid = req.user?.tid;
    if (tid && chapter.tenant_id && chapter.tenant_id !== tid) { notFound(res, 'Chapter not found'); return false; }
    return true;
  }

  app.registerRoute('GET', '/api/chapters', (req, res) => {
    const bookId = req.ctx.url.searchParams.get('bookId');
    // A6 fix: list page-size cap, preventing an unbounded full-table pull and OOM
    const { size, offset } = parsePaging(req);
    // issue #45: tenant isolation (medium tier)
    const tid = tenantId(req);
    let data = db ? db.prepare('SELECT * FROM chapters WHERE tenant_id = ? AND book_id = ? ORDER BY sort_order LIMIT ? OFFSET ?').all(tid, bookId, size, offset) : require('../db').listJSON('chapters').filter(c => c.tenant_id === tid && c.book_id === bookId).slice(offset, offset + size);
    list(res, data);
  });

  app.registerRoute('POST', '/api/chapters', async (req, res) => {
    const body = await parseBody(req);
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, MAX_NAME) : '';
    if (!name) return error(res, 'name must not be empty', 400);
    const ch = {
      id: uid(), tenant_id: tenantId(req), book_id: body.book_id || null, name,
      slug: slugify(name),
      description: typeof body.description === 'string' ? body.description.slice(0, MAX_DESC) : '',
      sort_order: Number.isFinite(Number(body.sort_order)) ? Number(body.sort_order) : 0,
      created_at: now(), updated_at: now(),
    };
    try {
      if (db) { db.prepare('INSERT INTO chapters (id, tenant_id, book_id, name, slug, description, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(ch.id, ch.tenant_id, ch.book_id, ch.name, ch.slug, ch.description, ch.sort_order, ch.created_at, ch.updated_at); }
      else { require('../db').writeJSON('chapters', ch.id, ch); }
    } catch (e) {
      if (String(e.message).includes('FOREIGN KEY')) return error(res, 'The specified book does not exist', 400);
      throw e;
    }
    created(res, ch);
  });

  app.registerRoute('GET', '/api/chapters/:id', (req, res) => {
    const { id } = req.params;
    const chapter = db ? db.prepare('SELECT * FROM chapters WHERE id = ?').get(id) : require('../db').readJSON('chapters', id);
    if (!_chapterTenantOk(req, res, chapter)) return;
    json(res, chapter);
  });

  // ── Update/delete chapter: admin gate (structural operation) ──────────
  app.registerRoute('PUT', '/api/chapters/:id', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const { id } = req.params;
    const chapter = db ? db.prepare('SELECT * FROM chapters WHERE id = ?').get(id) : require('../db').readJSON('chapters', id);
    if (!_chapterTenantOk(req, res, chapter)) return;
    const body = await parseBody(req);
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, MAX_NAME) : body.name;
    const description = typeof body.description === 'string' ? body.description.slice(0, MAX_DESC) : body.description;
    if (db) { db.prepare('UPDATE chapters SET name = ?, description = ?, updated_at = ? WHERE id = ?').run(name, description, now(), id); }
    else { Object.assign(chapter, { name, description, updated_at: now() }); require('../db').writeJSON('chapters', id, chapter); }
    json(res, { updated: true });
  });

  app.registerRoute('DELETE', '/api/chapters/:id', (req, res) => {
    if (!requireAdmin(req, res)) return;
    const { id } = req.params;
    const chapter = db ? db.prepare('SELECT * FROM chapters WHERE id = ?').get(id) : require('../db').readJSON('chapters', id);
    if (!_chapterTenantOk(req, res, chapter)) return;
    // E4 fix: DELETE chapters used to fail with FK constraint failed (pages.chapter_id references were not cascaded).
    // In a single transaction, collect all page_ids of the chapter first, cascade-delete page child tables + pages + chapters, rolling back on failure.
    if (db) {
      const tx = db.transaction(() => {
        const pageIds = db.prepare('SELECT id FROM pages WHERE chapter_id = ?').all(id).map(r => r.id);
        if (pageIds.length) {
          const ph = pageIds.map(() => '?').join(',');
          db.prepare(`DELETE FROM page_versions WHERE page_id IN (${ph})`).run(...pageIds);
          db.prepare(`DELETE FROM page_links WHERE source_page_id IN (${ph}) OR target_page_id IN (${ph})`).run(...pageIds, ...pageIds);
          db.prepare(`DELETE FROM page_tags WHERE page_id IN (${ph})`).run(...pageIds);
          db.prepare(`DELETE FROM comments WHERE page_id IN (${ph})`).run(...pageIds);
          db.prepare(`DELETE FROM favorites WHERE page_id IN (${ph})`).run(...pageIds);
          db.prepare(`DELETE FROM metadata WHERE page_id IN (${ph})`).run(...pageIds);
          db.prepare(`DELETE FROM files WHERE page_id IN (${ph})`).run(...pageIds);
          db.prepare(`DELETE FROM rag_chunks WHERE page_id IN (${ph})`).run(...pageIds);
          db.prepare(`DELETE FROM office_files WHERE page_id IN (${ph})`).run(...pageIds);
          db.prepare(`DELETE FROM yjs_docs WHERE page_id IN (${ph})`).run(...pageIds);
          db.prepare(`DELETE FROM yjs_updates WHERE page_id IN (${ph})`).run(...pageIds);
          db.prepare(`DELETE FROM pages WHERE chapter_id = ?`).run(id);
        }
        db.prepare('DELETE FROM chapters WHERE id = ?').run(id);
      });
      try { tx(); }
      catch (e) {
        console.error(`[Chapter] DELETE cascade failed ${id}: ${e.message}`);
        return error(res, `Delete failed: ${e.message}`, 500);
      }
    } else { require('../db').deleteJSON('chapters', id); }
    json(res, { deleted: true });
  });
}

module.exports = { register };