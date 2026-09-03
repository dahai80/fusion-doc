// =============================================================================
// Fusion-Doc — 书架控制器（BookStack 三层结构）
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
    // A6 修复: 列表分页上限, 防 unbounded 全表拉 OOM
    const { size, offset } = parsePaging(req);
    const tid = tenantId(req); // issue #45: 租户隔离
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
    if (!name) return error(res, 'name 不能为空', 400);
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
      if (String(e.message).includes('FOREIGN KEY')) return error(res, 'workspace 不存在', 400);
      throw e;
    }
    created(res, book);
  });

  // issue #45: 跨租户访问一律 404 (不泄露存在性)
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

  // ── 改/删书架: admin 闸 (结构级操作, 非单用户内容) ─────────────────
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
    // E4 修复: 原直接 DELETE books 触发 FK constraint failed (chapters/pages 引用未级联)。
    // 单事务内先收集该书全部 page_id, 级联删 page 子表 + pages + chapters + books, 失败回滚。
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
        console.error(`[Book] DELETE 级联失败 ${id}: ${e.message}`);
        return error(res, `删除失败: ${e.message}`, 500);
      }
    } else { require('../db').deleteJSON('books', id); }
    json(res, { deleted: true });
  });
}

module.exports = { register };