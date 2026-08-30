// =============================================================================
// Fusion-Doc — 章节控制器（BookStack 中层结构）
// =============================================================================

const { parseBody } = require('../middleware/body-parser');
const { uid, now, slugify } = require('../utils/helpers');
const { json, list, created, error, notFound } = require('../utils/response');
const { requireAdmin } = require('../middleware/require-admin');

const MAX_NAME = 200;
const MAX_DESC = 2000;

function register(app) {
  const { db } = app;

  app.registerRoute('GET', '/api/chapters', (req, res) => {
    const bookId = req.ctx.url.searchParams.get('bookId');
    let data = db ? db.prepare('SELECT * FROM chapters WHERE book_id = ? ORDER BY sort_order').all(bookId) : require('../db').listJSON('chapters').filter(c => c.book_id === bookId);
    list(res, data);
  });

  app.registerRoute('POST', '/api/chapters', async (req, res) => {
    const body = await parseBody(req);
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, MAX_NAME) : '';
    if (!name) return error(res, 'name 不能为空', 400);
    const ch = {
      id: uid(), book_id: body.book_id || null, name,
      slug: slugify(name),
      description: typeof body.description === 'string' ? body.description.slice(0, MAX_DESC) : '',
      sort_order: Number.isFinite(Number(body.sort_order)) ? Number(body.sort_order) : 0,
      created_at: now(), updated_at: now(),
    };
    try {
      if (db) { db.prepare('INSERT INTO chapters (id, book_id, name, slug, description, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(ch.id, ch.book_id, ch.name, ch.slug, ch.description, ch.sort_order, ch.created_at, ch.updated_at); }
      else { require('../db').writeJSON('chapters', ch.id, ch); }
    } catch (e) {
      if (String(e.message).includes('FOREIGN KEY')) return error(res, '指定的 book 不存在', 400);
      throw e;
    }
    created(res, ch);
  });

  app.registerRoute('GET', '/api/chapters/:id', (req, res) => {
    const { id } = req.params;
    const chapter = db ? db.prepare('SELECT * FROM chapters WHERE id = ?').get(id) : require('../db').readJSON('chapters', id);
    if (!chapter) return notFound(res, 'Chapter not found');
    json(res, chapter);
  });

  // ── 改/删章节: admin 闸 (结构级操作) ─────────────────────────────────
  app.registerRoute('PUT', '/api/chapters/:id', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const { id } = req.params;
    const body = await parseBody(req);
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, MAX_NAME) : body.name;
    const description = typeof body.description === 'string' ? body.description.slice(0, MAX_DESC) : body.description;
    if (db) { db.prepare('UPDATE chapters SET name = ?, description = ?, updated_at = ? WHERE id = ?').run(name, description, now(), id); }
    json(res, { updated: true });
  });

  app.registerRoute('DELETE', '/api/chapters/:id', (req, res) => {
    if (!requireAdmin(req, res)) return;
    const { id } = req.params;
    if (db) { db.prepare('DELETE FROM chapters WHERE id = ?').run(id); } else { require('../db').deleteJSON('chapters', id); }
    json(res, { deleted: true });
  });
}

module.exports = { register };