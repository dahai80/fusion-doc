// =============================================================================
// Fusion-Doc — 页面控制器（DocMost 核心 + BookStack 结构化）
// 支持 CRUD、版本历史、双向链接、标签关联
// =============================================================================

const { parseBody } = require('../middleware/body-parser');
const { uid, now, slugify } = require('../utils/helpers');
const { json, list, created, notFound } = require('../utils/response');

function register(app) {
  const { db } = app;

  // ── 页面列表 ──────────────────────────────────────────────────────────
  app.registerRoute('GET', '/api/pages', (req, res) => {
    const bookId = req.ctx.url.searchParams.get('bookId');
    const chapterId = req.ctx.url.searchParams.get('chapterId');
    let data;
    if (db) {
      if (chapterId) data = db.prepare('SELECT * FROM pages WHERE chapter_id = ? ORDER BY sort_order').all(chapterId);
      else if (bookId) data = db.prepare('SELECT * FROM pages WHERE book_id = ? ORDER BY sort_order').all(bookId);
      else data = db.prepare('SELECT * FROM pages ORDER BY updated_at DESC').all();
    } else {
      data = require('../db').listJSON('pages').filter(p => (!bookId || p.book_id === bookId) && (!chapterId || p.chapter_id === chapterId));
    }
    list(res, data);
  });

  // ── 创建页面 ──────────────────────────────────────────────────────────
  app.registerRoute('POST', '/api/pages', async (req, res) => {
    const body = await parseBody(req);
    const page = {
      id: uid(), workspace_id: body.workspace_id, book_id: body.book_id, chapter_id: body.chapter_id,
      title: body.title || '未命名',
      slug: slugify(body.title || 'untitled') + '-' + Math.random().toString(36).slice(2, 6),
      content: body.content || '', markdown: body.markdown || '',
      editor_mode: body.editor_mode || 'rich-text',
      parent_id: body.parent_id, sort_order: body.sort_order || 0, is_published: 1,
      created_at: now(), updated_at: now(),
    };
    if (db) {
      db.prepare('INSERT INTO pages (id, workspace_id, book_id, chapter_id, title, slug, content, markdown, editor_mode, parent_id, sort_order, is_published, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(...Object.values(page));
    } else { require('../db').writeJSON('pages', page.id, page); }
    created(res, page);
  });

  // ── 单页操作 ──────────────────────────────────────────────────────────
  app.registerRoute('GET', '/api/pages/:id', (req, res) => {
    const { id } = req.params;
    let page = db ? db.prepare('SELECT * FROM pages WHERE id = ?').get(id) : require('../db').readJSON('pages', id);
    if (!page) return notFound(res, '页面不存在');
    // 关联数据
    if (db) {
      page.tags = db.prepare('SELECT t.* FROM tags t JOIN page_tags pt ON t.id = pt.tag_id WHERE pt.page_id = ?').all(id);
      page.links = db.prepare('SELECT p.id, p.title FROM pages p JOIN page_links pl ON p.id = pl.target_page_id WHERE pl.source_page_id = ?').all(id);
      page.backlinks = db.prepare('SELECT p.id, p.title FROM pages p JOIN page_links pl ON p.id = pl.source_page_id WHERE pl.target_page_id = ?').all(id);
      page.files = db.prepare('SELECT id, name, mime, size, created_at FROM files WHERE page_id = ?').all(id);
    }
    json(res, page);
  });

  app.registerRoute('PUT', '/api/pages/:id', async (req, res) => {
    const { id } = req.params;
    const body = await parseBody(req);
    if (db) { db.prepare('UPDATE pages SET title = ?, content = ?, markdown = ?, updated_at = ? WHERE id = ?').run(body.title, body.content, body.markdown, now(), id); }
    else { const p = require('../db').readJSON('pages', id); if (p) { Object.assign(p, body, { updated_at: now() }); require('../db').writeJSON('pages', id, p); } }
    json(res, { updated: true });
  });

  app.registerRoute('DELETE', '/api/pages/:id', (req, res) => {
    const { id } = req.params;
    if (db) { db.prepare('DELETE FROM pages WHERE id = ?').run(id); } else { require('../db').deleteJSON('pages', id); }
    json(res, { deleted: true });
  });

  // ── 页面版本历史 ──────────────────────────────────────────────────────
  app.registerRoute('GET', '/api/pages/:id/versions', (req, res) => {
    const { id } = req.params;
    let versions = db ? db.prepare('SELECT * FROM page_versions WHERE page_id = ? ORDER BY version DESC').all(id) : require('../db').listJSON('page_versions').filter(v => v.page_id === id);
    list(res, versions);
  });

  app.registerRoute('POST', '/api/pages/:id/versions', async (req, res) => {
    const { id } = req.params;
    const body = await parseBody(req);
    const maxVer = db ? (db.prepare('SELECT MAX(version) as m FROM page_versions WHERE page_id = ?').get(id)?.m || 0) : 0;
    const v = { id: uid(), page_id: id, title: body.title, content: body.content, version: maxVer + 1, created_at: now() };
    if (db) { db.prepare('INSERT INTO page_versions (id, page_id, title, content, version, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(...Object.values(v)); }
    else { require('../db').writeJSON('page_versions', v.id, v); }
    created(res, v);
  });

  // ── 双向链接 ──────────────────────────────────────────────────────────
  app.registerRoute('GET', '/api/pages/:id/links', (req, res) => {
    const { id } = req.params;
    let links = [], backlinks = [];
    if (db) {
      links = db.prepare('SELECT p.id, p.title FROM pages p JOIN page_links pl ON p.id = pl.target_page_id WHERE pl.source_page_id = ?').all(id);
      backlinks = db.prepare('SELECT p.id, p.title FROM pages p JOIN page_links pl ON p.id = pl.source_page_id WHERE pl.target_page_id = ?').all(id);
    }
    json(res, { links, backlinks });
  });

  app.registerRoute('POST', '/api/pages/:id/links', async (req, res) => {
    const { id } = req.params;
    const body = await parseBody(req);
    const link = { id: uid(), source_page_id: id, target_page_id: body.target_page_id, link_type: body.link_type || 'reference', created_at: now() };
    if (db) { db.prepare('INSERT INTO page_links (id, source_page_id, target_page_id, link_type, created_at) VALUES (?, ?, ?, ?, ?)').run(...Object.values(link)); }
    created(res, link);
  });

  // ── 页面打标签 ────────────────────────────────────────────────────────
  app.registerRoute('POST', '/api/pages/tags', async (req, res) => {
    const body = await parseBody(req);
    if (db) { db.prepare('INSERT OR IGNORE INTO page_tags (page_id, tag_id) VALUES (?, ?)').run(body.page_id, body.tag_id); }
    json(res, { tagged: true }, 201);
  });
}

module.exports = { register };