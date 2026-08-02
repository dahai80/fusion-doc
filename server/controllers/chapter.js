// =============================================================================
// Fusion-Doc — 章节控制器（BookStack 中层结构）
// =============================================================================

const { parseBody } = require('../middleware/body-parser');
const { uid, now, slugify } = require('../utils/helpers');
const { json, list, created, notFound } = require('../utils/response');

function register(app) {
  const { db } = app;

  app.registerRoute('GET', '/api/chapters', (req, res) => {
    const bookId = req.ctx.url.searchParams.get('bookId');
    let data = db ? db.prepare('SELECT * FROM chapters WHERE book_id = ? ORDER BY sort_order').all(bookId) : require('../db').listJSON('chapters').filter(c => c.book_id === bookId);
    list(res, data);
  });

  app.registerRoute('POST', '/api/chapters', async (req, res) => {
    const body = await parseBody(req);
    const ch = {
      id: uid(), book_id: body.book_id, name: body.name,
      slug: slugify(body.name || ''), description: body.description || '',
      sort_order: body.sort_order || 0, created_at: now(), updated_at: now(),
    };
    if (db) { db.prepare('INSERT INTO chapters (id, book_id, name, slug, description, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(...Object.values(ch)); }
    else { require('../db').writeJSON('chapters', ch.id, ch); }
    created(res, ch);
  });

  app.registerRoute('GET', '/api/chapters/:id', (req, res) => {
    const { id } = req.params;
    const chapter = db ? db.prepare('SELECT * FROM chapters WHERE id = ?').get(id) : require('../db').readJSON('chapters', id);
    if (!chapter) return notFound(res, 'Chapter not found');
    json(res, chapter);
  });

  app.registerRoute('PUT', '/api/chapters/:id', async (req, res) => {
    const { id } = req.params;
    const body = await parseBody(req);
    if (db) { db.prepare('UPDATE chapters SET name = ?, description = ?, updated_at = ? WHERE id = ?').run(body.name, body.description, now(), id); }
    json(res, { updated: true });
  });

  app.registerRoute('DELETE', '/api/chapters/:id', (req, res) => {
    const { id } = req.params;
    if (db) { db.prepare('DELETE FROM chapters WHERE id = ?').run(id); } else { require('../db').deleteJSON('chapters', id); }
    json(res, { deleted: true });
  });
}

module.exports = { register };