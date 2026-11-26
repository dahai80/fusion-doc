// =============================================================================
// Fusion-Doc — search controller (Wiki.js + SQLite FTS5 full-text search)
// =============================================================================

const { list, json } = require('../utils/response');
const { errorResponse } = require('../middleware/error-handler');

// ORDER BY identifier allowlist (prevents SQL injection)
const ALLOWED_SORT = new Set(['updated_at', 'created_at', 'title', 'sort_order']);
const ALLOWED_ORDER = new Set(['ASC', 'DESC']);

function register(app) {
  const { db } = app;

  // ── Basic search ──────────────────────────────────────────────────────────
  app.registerRoute('GET', '/api/search', (req, res) => {
    const q = (req.ctx.url.searchParams.get('q') || '').trim();
    if (!q) { list(res, []); return; }

    let results;
    if (db) {
      results = db.prepare(`SELECT p.*, rank FROM pages_fts f JOIN pages p ON f.page_id = p.id WHERE pages_fts MATCH ? ORDER BY rank LIMIT 50`).all(q.replace(/[^\w\u4e00-\u9fff]/g, '') + '*');
    } else {
      const pages = require('../db').listJSON('pages');
      results = pages.filter(p => (p.title || '').toLowerCase().includes(q.toLowerCase()) || (p.content || '').toLowerCase().includes(q.toLowerCase()));
    }
    list(res, results);
  });

  // ── Advanced search (multi-dimensional) ────────────────────────────────────────────────
  app.registerRoute('GET', '/api/search/advanced', (req, res) => {
    const q = (req.ctx.url.searchParams.get('q') || '').trim();
    const tag = req.ctx.url.searchParams.get('tag');
    const type = req.ctx.url.searchParams.get('type');
    const sort = (req.ctx.url.searchParams.get('sort') || 'updated_at');
    const order = (req.ctx.url.searchParams.get('order') || 'DESC').toUpperCase();

    // Identifier allowlist check, rejects injection
    if (!ALLOWED_SORT.has(sort) || !ALLOWED_ORDER.has(order)) {
      return errorResponse(res, 400, 'Invalid sort parameter', 'INVALID_SORT');
    }

    if (!q && !tag) { list(res, []); return; }

    let results = [];
    if (db) {
      let sql = 'SELECT DISTINCT p.* FROM pages p';
      const params = [];
      const wheres = [];
      if (q) {
        sql += ' JOIN pages_fts f ON f.page_id = p.id';
        wheres.push('pages_fts MATCH ?');
        params.push(q.replace(/[^\w\u4e00-\u9fff]/g, '') + '*');
      }
      if (tag) {
        sql += ' JOIN page_tags pt ON pt.page_id = p.id JOIN tags t ON t.id = pt.tag_id';
        wheres.push('t.name = ?');
        params.push(tag);
      }
      if (type) { wheres.push('(p.book_id IS NOT NULL OR p.chapter_id IS NOT NULL)'); }
      if (wheres.length) sql += ' WHERE ' + wheres.join(' AND ');
      sql += ` ORDER BY p.${sort} ${order} LIMIT 50`;
      results = db.prepare(sql).all(...params);
    }
    json(res, { data: results, query: q, tag, total: results.length });
  });
}

module.exports = { register };