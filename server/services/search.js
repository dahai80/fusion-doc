// =============================================================================
// Fusion-Doc — 服务层：搜索服务
// 业务逻辑：全文搜索、高级搜索、搜索建议
// =============================================================================

class SearchService {
  constructor(app) {
    this.app = app;
    this.db = app.db;
  }

  // 基本全文搜索
  search(query) {
    const q = (query || '').trim();
    if (!q) return [];
    if (this.db) {
      return this.db.prepare(`SELECT p.*, rank FROM pages_fts f JOIN pages p ON f.rowid = p.rowid WHERE pages_fts MATCH ? ORDER BY rank LIMIT 50`).all(q.replace(/[^\w\u4e00-\u9fff]/g, '') + '*');
    }
    const pages = require('../db').listJSON('pages');
    return pages.filter(p =>
      (p.title || '').toLowerCase().includes(q.toLowerCase()) ||
      (p.content || '').toLowerCase().includes(q.toLowerCase())
    );
  }

  // 高级搜索（多维度过滤）
  advancedSearch({ query, tag, type, sort = 'updated_at', order = 'DESC' }) {
    if (!query && !tag) return [];
    let results = [];
    if (this.db) {
      let sql = 'SELECT DISTINCT p.* FROM pages p';
      const params = [];
      const wheres = [];
      if (query) {
        sql += ' JOIN pages_fts f ON f.rowid = p.rowid';
        wheres.push('pages_fts MATCH ?');
        params.push(query.replace(/[^\w\u4e00-\u9fff]/g, '') + '*');
      }
      if (tag) {
        sql += ' JOIN page_tags pt ON pt.page_id = p.id JOIN tags t ON t.id = pt.tag_id';
        wheres.push('t.name = ?');
        params.push(tag);
      }
      if (type) { wheres.push('(p.book_id IS NOT NULL OR p.chapter_id IS NOT NULL)'); }
      if (wheres.length) sql += ' WHERE ' + wheres.join(' AND ');
      sql += ` ORDER BY p.${sort} ${order} LIMIT 50`;
      results = this.db.prepare(sql).all(...params);
    }
    return results;
  }

  // 搜索建议（自动补全）
  suggest(query) {
    const q = (query || '').trim();
    if (!q || !this.db) return [];
    return this.db.prepare(`SELECT title, id FROM pages WHERE title LIKE ? LIMIT 10`).all(`%${q}%`);
  }
}

module.exports = SearchService;