// =============================================================================
// Fusion-Doc — 服务层：页面服务
// 业务逻辑：页面 CRUD、版本管理、关联数据处理
// =============================================================================

const { uid, now, slugify } = require('../utils/helpers');

class PageService {
  constructor(app) {
    this.app = app;
    this.db = app.db;
  }

  // 获取页面列表
  list(bookId, chapterId) {
    if (this.db) {
      if (chapterId) return this.db.prepare('SELECT * FROM pages WHERE chapter_id = ? ORDER BY sort_order').all(chapterId);
      if (bookId) return this.db.prepare('SELECT * FROM pages WHERE book_id = ? ORDER BY sort_order').all(bookId);
      return this.db.prepare('SELECT * FROM pages ORDER BY updated_at DESC').all();
    }
    return require('../db').listJSON('pages').filter(p => (!bookId || p.book_id === bookId) && (!chapterId || p.chapter_id === chapterId));
  }

  // 获取单个页面（含关联数据）
  get(id) {
    let page = this.db ? this.db.prepare('SELECT * FROM pages WHERE id = ?').get(id) : require('../db').readJSON('pages', id);
    if (!page) return null;
    if (this.db) {
      page.tags = this.db.prepare('SELECT t.* FROM tags t JOIN page_tags pt ON t.id = pt.tag_id WHERE pt.page_id = ?').all(id);
      page.links = this.db.prepare('SELECT p.id, p.title FROM pages p JOIN page_links pl ON p.id = pl.target_page_id WHERE pl.source_page_id = ?').all(id);
      page.backlinks = this.db.prepare('SELECT p.id, p.title FROM pages p JOIN page_links pl ON p.id = pl.source_page_id WHERE pl.target_page_id = ?').all(id);
      page.files = this.db.prepare('SELECT id, name, mime, size, created_at FROM files WHERE page_id = ?').all(id);
      page.comments = this.db.prepare('SELECT * FROM comments WHERE page_id = ? ORDER BY created_at').all(id);
    }
    return page;
  }

  // 创建页面
  create(data) {
    const page = {
      id: uid(), workspace_id: data.workspace_id, book_id: data.book_id, chapter_id: data.chapter_id,
      title: data.title || '未命名',
      slug: slugify(data.title || 'untitled') + '-' + Math.random().toString(36).slice(2, 6),
      content: data.content || '', markdown: data.markdown || '',
      editor_mode: data.editor_mode || 'rich-text',
      parent_id: data.parent_id, sort_order: data.sort_order || 0,
      created_by: data.created_by, is_published: 1,
      created_at: now(), updated_at: now(),
    };
    if (this.db) {
      this.db.prepare('INSERT INTO pages (id, workspace_id, book_id, chapter_id, title, slug, content, markdown, editor_mode, parent_id, sort_order, is_published, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(...Object.values(page));
    } else { require('../db').writeJSON('pages', page.id, page); }
    return page;
  }

  // 更新页面
  update(id, data) {
    if (this.db) {
      this.db.prepare('UPDATE pages SET title = ?, content = ?, markdown = ?, updated_at = ? WHERE id = ?').run(data.title, data.content, data.markdown, now(), id);
    } else {
      const p = require('../db').readJSON('pages', id);
      if (p) { Object.assign(p, data, { updated_at: now() }); require('../db').writeJSON('pages', id, p); }
    }
    return this.get(id);
  }

  // 删除页面
  delete(id) {
    if (this.db) {
      this.db.prepare('DELETE FROM pages WHERE id = ?').run(id);
      this.db.prepare('DELETE FROM page_versions WHERE page_id = ?').run(id);
      this.db.prepare('DELETE FROM page_links WHERE source_page_id = ? OR target_page_id = ?').run(id, id);
      this.db.prepare('DELETE FROM page_tags WHERE page_id = ?').run(id);
      this.db.prepare('DELETE FROM comments WHERE page_id = ?').run(id);
      this.db.prepare('DELETE FROM favorites WHERE page_id = ?').run(id);
    } else { require('../db').deleteJSON('pages', id); }
    return { deleted: true, id };
  }

  // 创建版本
  createVersion(pageId, title, content) {
    const maxVer = this.db
      ? (this.db.prepare('SELECT MAX(version) as m FROM page_versions WHERE page_id = ?').get(pageId)?.m || 0)
      : 0;
    const v = { id: uid(), page_id: pageId, title, content, version: maxVer + 1, created_at: now() };
    if (this.db) {
      this.db.prepare('INSERT INTO page_versions (id, page_id, title, content, version, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(...Object.values(v));
    } else { require('../db').writeJSON('page_versions', v.id, v); }
    return v;
  }

  // 获取版本历史
  getVersions(pageId) {
    return this.db
      ? this.db.prepare('SELECT * FROM page_versions WHERE page_id = ? ORDER BY version DESC').all(pageId)
      : require('../db').listJSON('page_versions').filter(v => v.page_id === pageId);
  }

  // 添加双向链接
  addLink(sourceId, targetId, linkType = 'reference') {
    const link = { id: uid(), source_page_id: sourceId, target_page_id: targetId, link_type: linkType, created_at: now() };
    if (this.db) {
      this.db.prepare('INSERT INTO page_links (id, source_page_id, target_page_id, link_type, created_at) VALUES (?, ?, ?, ?, ?)').run(...Object.values(link));
    }
    return link;
  }
}

module.exports = PageService;