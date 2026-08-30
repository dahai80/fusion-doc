// =============================================================================
// Fusion-Doc — 搜索控制器（Wiki.js + SQLite FTS5 全文搜索）
// =============================================================================

const { list, json } = require('../utils/response');
const { errorResponse } = require('../middleware/error-handler');

// ORDER BY 标识符白名单 (杜绝 SQL 注入)
const ALLOWED_SORT = new Set(['updated_at', 'created_at', 'title', 'sort_order']);
const ALLOWED_ORDER = new Set(['ASC', 'DESC']);

function register(app) {
  const { db } = app;

  // ── 基本搜索 ──────────────────────────────────────────────────────────
  app.registerRoute('GET', '/api/search', (req, res) => {
    const q = (req.ctx.url.searchParams.get('q') || '').trim();
    if (!q) { list(res, []); return; }

    let results;
    if (db) {
      results = db.prepare(`SELECT p.*, rank FROM pages_fts f JOIN pages p ON f.rowid = p.rowid WHERE pages_fts MATCH ? ORDER BY rank LIMIT 50`).all(q.replace(/[^\w\u4e00-\u9fff]/g, '') + '*');
    } else {
      const pages = require('../db').listJSON('pages');
      results = pages.filter(p => (p.title || '').toLowerCase().includes(q.toLowerCase()) || (p.content || '').toLowerCase().includes(q.toLowerCase()));
    }
    list(res, results);
  });

  // ── 高级搜索（多维度） ────────────────────────────────────────────────
  app.registerRoute('GET', '/api/search/advanced', (req, res) => {
    const q = (req.ctx.url.searchParams.get('q') || '').trim();
    const tag = req.ctx.url.searchParams.get('tag');
    const type = req.ctx.url.searchParams.get('type');
    const sort = (req.ctx.url.searchParams.get('sort') || 'updated_at');
    const order = (req.ctx.url.searchParams.get('order') || 'DESC').toUpperCase();

    // 标识符白名单校验, 拒绝注入
    if (!ALLOWED_SORT.has(sort) || !ALLOWED_ORDER.has(order)) {
      return errorResponse(res, 400, '非法的排序参数', 'INVALID_SORT');
    }

    if (!q && !tag) { list(res, []); return; }

    let results = [];
    if (db) {
      let sql = 'SELECT DISTINCT p.* FROM pages p';
      const params = [];
      const wheres = [];
      if (q) {
        sql += ' JOIN pages_fts f ON f.rowid = p.rowid';
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