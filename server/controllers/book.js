// =============================================================================
// Fusion-Doc — 书架控制器（BookStack 三层结构）
// =============================================================================

const { parseBody } = require('../middleware/body-parser');
const { uid, now, slugify } = require('../utils/helpers');
const { json, list, created, error, notFound } = require('../utils/response');

function register(app) {
  const { db } = app;

  app.registerRoute('GET', '/api/books', (req, res) => {
    const wsId = req.ctx.url.searchParams.get('workspaceId');
    let data;
    if (db) {
      data = wsId ? db.prepare('SELECT * FROM books WHERE workspace_id = ? ORDER BY sort_order').all(wsId) : db.prepare('SELECT * FROM books ORDER BY sort_order').all();
    } else {
      data = require('../db').listJSON('books').filter(b => !wsId || b.workspace_id === wsId);
    }
    list(res, data);
  });

  app.registerRoute('POST', '/api/books', async (req, res) => {
    const body = await parseBody(req);
    const book = {
      id: uid(), workspace_id: body.workspace_id, name: body.name,
      slug: slugify(body.name || 'untitled'),
      description: body.description || '', sort_order: body.sort_order || 0,
      created_at: now(), updated_at: now(),
    };
    if (db) {
      db.prepare('INSERT INTO books (id, workspace_id, name, slug, description, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(...Object.values(book));
    } else { require('../db').writeJSON('books', book.id, book); }
    created(res, book);
  });

  app.registerRoute('GET', '/api/books/:id', (req, res) => {
    const { id } = req.params;
    const book = db ? db.prepare('SELECT * FROM books WHERE id = ?').get(id) : require('../db').readJSON('books', id);
    if (!book) return notFound(res, 'Book not found');
    json(res, book);
  });

  app.registerRoute('PUT', '/api/books/:id', async (req, res) => {
    const { id } = req.params;
    const body = await parseBody(req);
    if (db) { db.prepare('UPDATE books SET name = ?, description = ?, updated_at = ? WHERE id = ?').run(body.name, body.description, now(), id); }
    json(res, { updated: true });
  });

  app.registerRoute('DELETE', '/api/books/:id', (req, res) => {
    const { id } = req.params;
    if (db) { db.prepare('DELETE FROM books WHERE id = ?').run(id); } else { require('../db').deleteJSON('books', id); }
    json(res, { deleted: true });
  });
}

module.exports = { register };