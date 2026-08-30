// =============================================================================
// Fusion-Doc — 页面控制器（DocMost 核心 + BookStack 结构化）
// 支持 CRUD、版本历史、双向链接、标签关联
// =============================================================================

const { parseBody } = require('../middleware/body-parser');
const { uid, now, slugify } = require('../utils/helpers');
const { json, list, created, notFound, error } = require('../utils/response');
// 授权守卫统一走共享 middleware/authz (R13 读隔离 + R12 写隔离), 杜绝各控制器重复实现 IDOR
const { canReadPage, canModifyPage, getPage } = require('../middleware/authz');

const EDITOR_MODES = new Set(['rich-text', 'markdown', 'plain']);
const MAX_TITLE = 500;
const MAX_CONTENT = 5 * 1024 * 1024; // 5MB 单页内容上限
const MAX_DIFF_LINES = 5000; // diff 行数上限, 防 DP 矩阵 OOM

function register(app) {
  const { db } = app;

  // ── 页面列表 ──────────────────────────────────────────────────────────
  app.registerRoute('GET', '/api/pages', (req, res) => {
    const bookId = req.ctx.url.searchParams.get('bookId');
    const chapterId = req.ctx.url.searchParams.get('chapterId');
    // E16 修复: 无 bookId/chapterId 全表查询加 LIMIT/OFFSET 分页, 防万页级库一次拉全表 OOM/慢响应
    // 指定 bookId/chapterId 时为结构化子集, 保留全量 (受 book 规模约束)
    const pageRaw = parseInt(req.ctx.url.searchParams.get('page'), 10);
    const sizeRaw = parseInt(req.ctx.url.searchParams.get('size'), 10);
    const size = Number.isFinite(sizeRaw) && sizeRaw > 0 && sizeRaw <= 200 ? sizeRaw : 50;
    const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;
    const offset = (page - 1) * size;
    let data, total;
    if (db) {
      if (chapterId) {
        data = db.prepare('SELECT * FROM pages WHERE chapter_id = ? ORDER BY sort_order').all(chapterId);
        total = data.length;
      } else if (bookId) {
        data = db.prepare('SELECT * FROM pages WHERE book_id = ? ORDER BY sort_order').all(bookId);
        total = data.length;
      } else {
        total = db.prepare('SELECT COUNT(*) as c FROM pages').get().c;
        data = db.prepare('SELECT * FROM pages ORDER BY updated_at DESC LIMIT ? OFFSET ?').all(size, offset);
      }
    } else {
      data = require('../db').listJSON('pages').filter(p => (!bookId || p.book_id === bookId) && (!chapterId || p.chapter_id === chapterId));
      total = data.length;
    }
    // E16 修复: 返回 { data, total, page, size } 结构。客户端 pageStore 取 data.data || data,
    // 既能拿到数组又能读分页元信息; 不破坏既有 list(res, items) => {data: items} 约定。
    json(res, { data, total, page, size });
  });

  // ── 创建页面 ──────────────────────────────────────────────────────────
  app.registerRoute('POST', '/api/pages', async (req, res) => {
    const body = await parseBody(req);
    // 输入校验 (P2-20)
    const title = typeof body.title === 'string' ? body.title.slice(0, MAX_TITLE) : '未命名';
    const content = typeof body.content === 'string' ? body.content.slice(0, MAX_CONTENT) : '';
    const markdown = typeof body.markdown === 'string' ? body.markdown.slice(0, MAX_CONTENT) : '';
    const editor_mode = EDITOR_MODES.has(body.editor_mode) ? body.editor_mode : 'rich-text';
    const sort_order = Number.isFinite(Number(body.sort_order)) ? Number(body.sort_order) : 0;
    const page = {
      id: uid(), workspace_id: body.workspace_id || null, book_id: body.book_id || null, chapter_id: body.chapter_id || null,
      title,
      slug: slugify(title || 'untitled') + '-' + Math.random().toString(36).slice(2, 6),
      content, markdown,
      editor_mode,
      parent_id: body.parent_id || null, sort_order, is_published: 1,
      created_by: req.user?.id || 'local',
      created_at: now(), updated_at: now(),
    };
    try {
      if (db) {
        db.prepare('INSERT INTO pages (id, workspace_id, book_id, chapter_id, title, slug, content, markdown, editor_mode, parent_id, sort_order, is_published, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(page.id, page.workspace_id, page.book_id, page.chapter_id, page.title, page.slug, page.content, page.markdown, page.editor_mode, page.parent_id, page.sort_order, page.is_published, page.created_by, page.created_at, page.updated_at);
      } else { require('../db').writeJSON('pages', page.id, page); }
    } catch (e) {
      if (String(e.message).includes('FOREIGN KEY')) return error(res, '指定的 book/chapter/workspace 不存在', 400);
      throw e;
    }
    created(res, page);
  });

  // ── 单页操作 ──────────────────────────────────────────────────────────
  app.registerRoute('GET', '/api/pages/:id', (req, res) => {
    const { id } = req.params;
    let page = db ? db.prepare('SELECT * FROM pages WHERE id = ?').get(id) : require('../db').readJSON('pages', id);
    if (!page) return notFound(res, '页面不存在');
    // R13 修复: 私有页读隔离 (admin/owner/已发布放行)
    if (!canReadPage(req, res, page)) return;
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
    const page = getPage(app, id);
    if (!page) return notFound(res, '页面不存在');
    if (!canModifyPage(req, res, page)) return;
    const body = await parseBody(req);
    const title = typeof body.title === 'string' ? body.title.slice(0, MAX_TITLE) : page.title;
    const content = typeof body.content === 'string' ? body.content.slice(0, MAX_CONTENT) : page.content;
    const markdown = typeof body.markdown === 'string' ? body.markdown.slice(0, MAX_CONTENT) : page.markdown;
    // R6 修复: 覆盖前先建版本快照 (事务包裹, R8 同源), 原 PUT 直接覆盖丢历史无法回滚。
    if (db) {
      const tx = db.transaction(() => {
        const maxVer = db.prepare('SELECT MAX(version) as m FROM page_versions WHERE page_id = ?').get(id)?.m || 0;
        db.prepare('INSERT INTO page_versions (id, page_id, title, content, version, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(uid(), id, page.title, page.content, maxVer + 1, req.user?.id || 'local', now());
        db.prepare('UPDATE pages SET title = ?, content = ?, markdown = ?, updated_at = ? WHERE id = ?').run(title, content, markdown, now(), id);
      });
      tx();
    } else { Object.assign(page, { title, content, markdown, updated_at: now() }); require('../db').writeJSON('pages', id, page); }
    // P0-F2 修复: 返回完整更新后页对象, 非裸 {updated:true}。
    // 原响应让 pageStore 把 currentPage 覆盖成 {updated:true}, 摧毁编辑器内容。
    const refreshed = getPage(app, id);
    json(res, refreshed || { ...page, title, content, markdown, updated_at: now() });
  });

  app.registerRoute('DELETE', '/api/pages/:id', (req, res) => {
    const { id } = req.params;
    const page = getPage(app, id);
    if (!page) return notFound(res, '页面不存在');
    if (!canModifyPage(req, res, page)) return;
    // R5 修复: FK 强制下需先级联子表 (事务包裹), 原 DELETE 直接删 pages 触发 FK constraint failed。
    if (db) {
      const tx = db.transaction(() => {
        db.prepare('DELETE FROM page_versions WHERE page_id = ?').run(id);
        db.prepare('DELETE FROM page_links WHERE source_page_id = ? OR target_page_id = ?').run(id, id);
        db.prepare('DELETE FROM page_tags WHERE page_id = ?').run(id);
        db.prepare('DELETE FROM comments WHERE page_id = ?').run(id);
        db.prepare('DELETE FROM favorites WHERE page_id = ?').run(id);
        db.prepare('DELETE FROM metadata WHERE page_id = ?').run(id);
        db.prepare('DELETE FROM files WHERE page_id = ?').run(id);
        db.prepare('DELETE FROM rag_chunks WHERE page_id = ?').run(id);
        db.prepare('DELETE FROM office_files WHERE page_id = ?').run(id);
        db.prepare('DELETE FROM yjs_docs WHERE page_id = ?').run(id);
        db.prepare('DELETE FROM pages WHERE id = ?').run(id);
      });
      try { tx(); }
      catch (e) {
        console.error(`[Page] DELETE 级联失败 ${id}: ${e.message}`);
        return error(res, `删除失败: ${e.message}`, 500);
      }
    } else { require('../db').deleteJSON('pages', id); }
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
    const page = getPage(app, id);
    if (!page) return notFound(res, '页面不存在');
    if (!canModifyPage(req, res, page)) return;
    const body = await parseBody(req);
    const maxVer = db ? (db.prepare('SELECT MAX(version) as m FROM page_versions WHERE page_id = ?').get(id)?.m || 0) : 0;
    const v = { id: uid(), page_id: id, title: typeof body.title === 'string' ? body.title.slice(0, MAX_TITLE) : page.title, content: typeof body.content === 'string' ? body.content.slice(0, MAX_CONTENT) : page.content, version: maxVer + 1, created_at: now() };
    if (db) { db.prepare('INSERT INTO page_versions (id, page_id, title, content, version, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(v.id, v.page_id, v.title, v.content, v.version, v.created_at); }
    else { require('../db').writeJSON('page_versions', v.id, v); }
    created(res, v);
  });

  // ── 版本 diff (NaN 守卫 + 行数上限防 OOM) ───────────────────────────
  app.registerRoute('GET', '/api/pages/:id/diff', (req, res) => {
    const { id } = req.params;
    const v1 = req.ctx.url.searchParams.get('v1');
    const v2 = req.ctx.url.searchParams.get('v2');
    if (!v1 || !v2) return json(res, { error: 'v1 and v2 query params required' }, 400);
    const n1 = Number(v1), n2 = Number(v2);
    if (!Number.isFinite(n1) || !Number.isFinite(n2) || n1 < 0 || n2 < 0) return error(res, 'v1/v2 须为非负整数', 400);
    if (!db) return json(res, { error: 'DB not available' }, 503);
    const ver1 = db.prepare('SELECT * FROM page_versions WHERE page_id = ? AND version = ?').get(id, n1);
    const ver2 = db.prepare('SELECT * FROM page_versions WHERE page_id = ? AND version = ?').get(id, n2);
    if (!ver1 || !ver2) return notFound(res, '版本不存在');
    const lines1 = (ver1.content || '').split('\n');
    const lines2 = (ver2.content || '').split('\n');
    // 超长内容直接拒 diff, 防 (m+1)×(n+1) 矩阵 OOM
    if (lines1.length > MAX_DIFF_LINES || lines2.length > MAX_DIFF_LINES) {
      return error(res, `diff 行数超限 (max ${MAX_DIFF_LINES})`, 413);
    }
    const diff = computeDiff(lines1, lines2);
    json(res, { page_id: id, v1: n1, v2: n2, diff });
  });

  // ── 版本恢复 ──────────────────────────────────────────────────────────
  app.registerRoute('POST', '/api/pages/:id/versions/:vid/restore', async (req, res) => {
    const { id, vid } = req.params;
    if (!db) return json(res, { error: 'DB not available' }, 503);
    const page = db.prepare('SELECT * FROM pages WHERE id = ?').get(id);
    if (!page) return notFound(res, '页面不存在');
    if (!canModifyPage(req, res, page)) return;
    const ver = db.prepare('SELECT * FROM page_versions WHERE page_id = ? AND id = ?').get(id, vid);
    if (!ver) return notFound(res, '版本不存在');
    const maxVer = db.prepare('SELECT MAX(version) as m FROM page_versions WHERE page_id = ?').get(id)?.m || 0;
    const snapshot = { id: uid(), page_id: id, title: ver.title, content: ver.content, version: maxVer + 1, created_at: now() };
    // R8 修复: 快照写入 + 页面正文回滚须原子, 否则中途崩溃致快照已记但正文仍旧值 (状态不一致)
    db.transaction(() => {
      db.prepare('INSERT INTO page_versions (id, page_id, title, content, version, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(snapshot.id, snapshot.page_id, snapshot.title, snapshot.content, snapshot.version, snapshot.created_at);
      db.prepare('UPDATE pages SET title = ?, content = ?, updated_at = ? WHERE id = ?').run(ver.title, ver.content, now(), id);
    })();
    console.log(`[Page] Restored page ${id} to version ${ver.version} (snapshot v${snapshot.version})`);
    json(res, { restored: true, page_id: id, restored_version: ver.version, new_snapshot_version: snapshot.version });
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
    // E30 修复: 不用 Object.values(link) 依赖键序与列序对齐 (脆弱, 重排键即静默错列)。显式传参。
    if (db) { db.prepare('INSERT INTO page_links (id, source_page_id, target_page_id, link_type, created_at) VALUES (?, ?, ?, ?, ?)').run(link.id, link.source_page_id, link.target_page_id, link.link_type, link.created_at); }
    created(res, link);
  });

  // ── 页面打标签 (校验存在 + 所有权) ──────────────────────────────────
  app.registerRoute('POST', '/api/pages/tags', async (req, res) => {
    const body = await parseBody(req);
    if (!body.page_id || !body.tag_id) return error(res, 'page_id 和 tag_id 必填', 400);
    if (!db) return json(res, { tagged: true }, 201);
    const page = db.prepare('SELECT id, created_by FROM pages WHERE id = ?').get(body.page_id);
    if (!page) return notFound(res, '页面不存在');
    const tag = db.prepare('SELECT id FROM tags WHERE id = ?').get(body.tag_id);
    if (!tag) return notFound(res, '标签不存在');
    if (!canModifyPage(req, res, page)) return;
    db.prepare('INSERT OR IGNORE INTO page_tags (page_id, tag_id) VALUES (?, ?)').run(body.page_id, body.tag_id);
    json(res, { tagged: true }, 201);
  });
}

function computeDiff(oldLines, newLines) {
    const m = oldLines.length, n = newLines.length;
    const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
    for (let i = 1; i <= m; i++) dp[i][0] = i;
    for (let j = 1; j <= n; j++) dp[0][j] = j;
    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            if (oldLines[i - 1] === newLines[j - 1]) dp[i][j] = dp[i - 1][j - 1];
            else dp[i][j] = 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
        }
    }
    const result = [];
    let i = m, j = n;
    while (i > 0 || j > 0) {
        if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
            result.unshift({ type: 'equal', line: oldLines[i - 1] });
            i--; j--;
        } else if (j > 0 && (i === 0 || dp[i][j - 1] <= dp[i - 1][j])) {
            result.unshift({ type: 'added', line: newLines[j - 1] });
            j--;
        } else {
            result.unshift({ type: 'removed', line: oldLines[i - 1] });
            i--;
        }
    }
    return result;
}

module.exports = { register };