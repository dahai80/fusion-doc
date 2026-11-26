// =============================================================================
// Fusion-Doc — bookshelf controller (BookStack three-level structure)
// =============================================================================

const { parseBody } = require('../middleware/body-parser');
const { uid, now, slugify, parsePaging, tenantId } = require('../utils/helpers');
const { json, list, created, error, notFound } = require('../utils/response');
const { requireAdmin } = require('../middleware/require-admin');

const MAX_NAME = 200;
const MAX_DESC = 2000;

function register(app) {
  const { db } = app;

  app.registerRoute('GET', '/api/books', (req, res) => {
    const wsId = req.ctx.url.searchParams.get('workspaceId');
    // A6 fix: cap list pagination to prevent unbounded full-table reads causing OOM
    const { size, offset } = parsePaging(req);
    const tid = tenantId(req); // issue #45: tenant isolation
    let data;
    if (db) {
      data = wsId ? db.prepare('SELECT * FROM books WHERE tenant_id = ? AND workspace_id = ? ORDER BY sort_order LIMIT ? OFFSET ?').all(tid, wsId, size, offset) : db.prepare('SELECT * FROM books WHERE tenant_id = ? ORDER BY sort_order LIMIT ? OFFSET ?').all(tid, size, offset);
    } else {
      data = require('../db').listJSON('books').filter(b => b.tenant_id === tid && (!wsId || b.workspace_id === wsId)).slice(offset, offset + size);
    }
    list(res, data);
  });

  app.registerRoute('POST', '/api/books', async (req, res) => {
    const body = await parseBody(req);
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, MAX_NAME) : '';
    if (!name) return error(res, 'name must not be empty', 400);
    const book = {
      id: uid(), tenant_id: tenantId(req), workspace_id: body.workspace_id || null, name,
      slug: slugify(name),
      description: typeof body.description === 'string' ? body.description.slice(0, MAX_DESC) : '',
      sort_order: Number.isFinite(Number(body.sort_order)) ? Number(body.sort_order) : 0,
      created_at: now(), updated_at: now(),
    };
    try {
      if (db) {
        db.prepare('INSERT INTO books (id, tenant_id, workspace_id, name, slug, description, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(book.id, book.tenant_id, book.workspace_id, book.name, book.slug, book.description, book.sort_order, book.created_at, book.updated_at);
      } else { require('../db').writeJSON('books', book.id, book); }
    } catch (e) {
      if (String(e.message).includes('FOREIGN KEY')) return error(res, 'workspace does not exist', 400);
      throw e;
    }
    created(res, book);
  });

  // issue #45: cross-tenant access always gets 404 (does not leak existence)
  function _bookTenantOk(req, res, book) {
    if (!book) { notFound(res, 'Book not found'); return false; }
    const tid = req.user?.tid;
    if (tid && book.tenant_id && book.tenant_id !== tid) { notFound(res, 'Book not found'); return false; }
    return true;
  }

  app.registerRoute('GET', '/api/books/:id', (req, res) => {
    const { id } = req.params;
    const book = db ? db.prepare('SELECT * FROM books WHERE id = ?').get(id) : require('../db').readJSON('books', id);
    if (!_bookTenantOk(req, res, book)) return;
    json(res, book);
  });

  // ── Update/delete book: admin gate (structural operation, not single-user content) ─────────────────
  app.registerRoute('PUT', '/api/books/:id', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const { id } = req.params;
    const book = db ? db.prepare('SELECT * FROM books WHERE id = ?').get(id) : require('../db').readJSON('books', id);
    if (!_bookTenantOk(req, res, book)) return;
    const body = await parseBody(req);
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, MAX_NAME) : body.name;
    const description = typeof body.description === 'string' ? body.description.slice(0, MAX_DESC) : body.description;
    if (db) { db.prepare('UPDATE books SET name = ?, description = ?, updated_at = ? WHERE id = ?').run(name, description, now(), id); }
    else { Object.assign(book, { name, description, updated_at: now() }); require('../db').writeJSON('books', id, book); }
    json(res, { updated: true });
  });

  app.registerRoute('DELETE', '/api/books/:id', (req, res) => {
    if (!requireAdmin(req, res)) return;
    const { id } = req.params;
    const book = db ? db.prepare('SELECT * FROM books WHERE id = ?').get(id) : require('../db').readJSON('books', id);
    if (!_bookTenantOk(req, res, book)) return;
    // E4 fix: a direct DELETE on books used to hit FK constraint failed (chapters/pages references were not cascaded).
    // In one transaction, collect all page_ids of the book, then cascade-delete page child tables + pages + chapters + books; roll back on failure.
    if (db) {
      const tx = db.transaction(() => {
        const pageIds = db.prepare('SELECT id FROM pages WHERE book_id = ?').all(id).map(r => r.id);
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
          db.prepare(`DELETE FROM pages WHERE book_id = ?`).run(id);
        }
        db.prepare('DELETE FROM chapters WHERE book_id = ?').run(id);
        db.prepare('DELETE FROM books WHERE id = ?').run(id);
      });
      try { tx(); }
      catch (e) {
        console.error(`[Book] DELETE cascade failed ${id}: ${e.message}`);
        return error(res, `Delete failed: ${e.message}`, 500);
      }
    } else { require('../db').deleteJSON('books', id); }
    json(res, { deleted: true });
  });
}

module.exports = { register };