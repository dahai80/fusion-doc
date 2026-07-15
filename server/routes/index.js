// =============================================================================
// Fusion-Doc — 路由分发
// 参考 Wiki.js 模块化路由设计
// =============================================================================

const fs = require('fs');
const path = require('path');

const { getDB, readJSON, writeJSON, listJSON, deleteJSON } = require('../db');
const { serveStatic } = require('../utils/static');
const { parseBody } = require('../middleware/common');
const { uid, now } = require('../utils/helpers');

async function router(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;
  const method = req.method;
  const db = getDB();

  const json = (data, status = 200) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(data));
    return true;
  };

  // ═══════════════════════════════════════════════════════════════════════
  // 健康检查
  // ═══════════════════════════════════════════════════════════════════════
  if (pathname === '/api/health' && method === 'GET') {
    return json({
      app: 'Fusion-Doc', version: '0.1.0', status: 'ok',
      features: {
        editor: 'TipTap + Yjs 实时协作',
        structure: '空间→书架→章节→页面（BookStack 三层）',
        search: 'SQLite FTS5 全文搜索（Wiki.js）',
        tags: '标签系统（Teedy）',
        links: '双向链接 + 知识图谱（Zettlr）',
        versions: '页面历史版本（DocMost）',
        export: 'PDF/HTML/Markdown/Office 导出（BookStack + LibreOffice）',
        ai: 'Fusion-MLX 本地 AI 推理',
        ocr: '文档 OCR（Teedy）',
        native: 'macOS 原生优化（MacDown）',
      }
    });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 系统设置 — 首次安装检测
  // ═══════════════════════════════════════════════════════════════════════
  if (pathname === '/api/system/setup' && method === 'GET') {
    const count = db ? db.prepare('SELECT COUNT(*) as c FROM users').get().c : listJSON('users').length;
    return json({ setup: count === 0 });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 注册管理员（首次安装）
  // ═══════════════════════════════════════════════════════════════════════
  if (pathname === '/api/auth/setup' && method === 'POST') {
    const body = await parseBody(req);
    const userId = uid();
    const user = { id: userId, email: body.email, name: body.name || 'Admin', password: body.password || 'admin', role: 'admin', created_at: now() };
    if (db) {
      db.prepare('INSERT INTO users (id, email, name, password, role, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(user.id, user.email, user.name, user.password, user.role, user.created_at);
      db.prepare('INSERT INTO workspaces (id, name, slug, description) VALUES (?, ?, ?, ?)').run(uid(), 'My Workspace', 'my-workspace', '默认工作空间');
    } else {
      writeJSON('users', user.id, user);
      writeJSON('workspaces', uid(), { id: uid(), name: 'My Workspace', slug: 'my-workspace', description: '默认工作空间' });
    }
    return json({ token: uid() + uid(), user }, 201);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 登录
  // ═══════════════════════════════════════════════════════════════════════
  if (pathname === '/api/auth/login' && method === 'POST') {
    const body = await parseBody(req);
    let user = db ? db.prepare('SELECT * FROM users WHERE email = ?').get(body.email) : null;
    if (!user) user = listJSON('users').find(u => u.email === body.email);
    if (!user || user.password !== body.password) return json({ error: '登录失败' }, 401);
    return json({ token: uid() + uid(), user: { id: user.id, email: user.email, name: user.name, role: user.role } });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 当前用户
  // ═══════════════════════════════════════════════════════════════════════
  if (pathname === '/api/users/me' && method === 'POST') {
    return json({ id: 'local', email: 'admin@fusion.local', name: 'Admin', role: 'admin' });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 工作空间列表（DocMost 空间）
  // ═══════════════════════════════════════════════════════════════════════
  if (pathname === '/api/workspaces' && method === 'GET') {
    const data = db ? db.prepare('SELECT * FROM workspaces ORDER BY name').all() : listJSON('workspaces');
    return json({ data });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 书架列表（BookStack 三层结构）
  // ═══════════════════════════════════════════════════════════════════════
  if (pathname === '/api/books' && method === 'GET') {
    const wsId = url.searchParams.get('workspaceId');
    let data;
    if (db) {
      data = wsId ? db.prepare('SELECT * FROM books WHERE workspace_id = ? ORDER BY sort_order').all(wsId) : db.prepare('SELECT * FROM books ORDER BY sort_order').all();
    } else {
      data = listJSON('books').filter(b => !wsId || b.workspace_id === wsId);
    }
    return json({ data });
  }

  if (pathname === '/api/books' && method === 'POST') {
    const body = await parseBody(req);
    const book = { id: uid(), workspace_id: body.workspace_id, name: body.name, slug: (body.name || 'untitled').toLowerCase().replace(/\s+/g, '-'), description: body.description || '', sort_order: body.sort_order || 0, created_at: now(), updated_at: now() };
    if (db) {
      db.prepare('INSERT INTO books (id, workspace_id, name, slug, description, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(book.id, book.workspace_id, book.name, book.slug, book.description, book.sort_order, book.created_at, book.updated_at);
    } else { writeJSON('books', book.id, book); }
    return json(book, 201);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 章节列表（BookStack 中层）
  // ═══════════════════════════════════════════════════════════════════════
  if (pathname === '/api/chapters' && method === 'GET') {
    const bookId = url.searchParams.get('bookId');
    let data = db ? db.prepare('SELECT * FROM chapters WHERE book_id = ? ORDER BY sort_order').all(bookId) : listJSON('chapters').filter(c => c.book_id === bookId);
    return json({ data });
  }

  if (pathname === '/api/chapters' && method === 'POST') {
    const body = await parseBody(req);
    const ch = { id: uid(), book_id: body.book_id, name: body.name, slug: (body.name || '').toLowerCase().replace(/\s+/g, '-'), description: body.description || '', sort_order: body.sort_order || 0, created_at: now(), updated_at: now() };
    if (db) { db.prepare('INSERT INTO chapters (id, book_id, name, slug, description, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(ch.id, ch.book_id, ch.name, ch.slug, ch.description, ch.sort_order, ch.created_at, ch.updated_at); }
    else { writeJSON('chapters', ch.id, ch); }
    return json(ch, 201);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 页面 CRUD（DocMost 核心 + BookStack 结构）
  // ═══════════════════════════════════════════════════════════════════════
  if (pathname === '/api/pages' && method === 'GET') {
    const bookId = url.searchParams.get('bookId');
    const chapterId = url.searchParams.get('chapterId');
    let data;
    if (db) {
      if (chapterId) data = db.prepare('SELECT * FROM pages WHERE chapter_id = ? ORDER BY sort_order').all(chapterId);
      else if (bookId) data = db.prepare('SELECT * FROM pages WHERE book_id = ? ORDER BY sort_order').all(bookId);
      else data = db.prepare('SELECT * FROM pages ORDER BY updated_at DESC').all();
    } else {
      data = listJSON('pages').filter(p => (!bookId || p.book_id === bookId) && (!chapterId || p.chapter_id === chapterId));
    }
    return json({ data });
  }

  if (pathname === '/api/pages' && method === 'POST') {
    const body = await parseBody(req);
    const page = {
      id: uid(), workspace_id: body.workspace_id, book_id: body.book_id, chapter_id: body.chapter_id,
      title: body.title || '未命名', slug: (body.title || 'untitled').toLowerCase().replace(/\s+/g, '-') + '-' + Math.random().toString(36).slice(2, 6),
      content: body.content || '', markdown: body.markdown || '', editor_mode: body.editor_mode || 'rich-text',
      parent_id: body.parent_id, sort_order: body.sort_order || 0, is_published: 1,
      created_at: now(), updated_at: now(),
    };
    if (db) {
      db.prepare('INSERT INTO pages (id, workspace_id, book_id, chapter_id, title, slug, content, markdown, editor_mode, parent_id, sort_order, is_published, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(page.id, page.workspace_id, page.book_id, page.chapter_id, page.title, page.slug, page.content, page.markdown, page.editor_mode, page.parent_id, page.sort_order, page.is_published, page.created_at, page.updated_at);
    } else { writeJSON('pages', page.id, page); }
    return json(page, 201);
  }

  // ── 单页操作 ──────────────────────────────────────────────────────
  if (pathname.startsWith('/api/pages/')) {
    const pageId = pathname.replace('/api/pages/', '').split('/')[0];
    const sub = pathname.replace('/api/pages/', '').slice(pageId.length);

    if (sub === '' && method === 'GET') {
      let page = db ? db.prepare('SELECT * FROM pages WHERE id = ?').get(pageId) : readJSON('pages', pageId);
      if (!page) return json({ error: '页面不存在' }, 404);
      // 获取关联标签
      if (db) {
        page.tags = db.prepare('SELECT t.* FROM tags t JOIN page_tags pt ON t.id = pt.tag_id WHERE pt.page_id = ?').all(pageId);
        page.links = db.prepare('SELECT p.id, p.title FROM pages p JOIN page_links pl ON p.id = pl.target_page_id WHERE pl.source_page_id = ?').all(pageId);
        page.backlinks = db.prepare('SELECT p.id, p.title FROM pages p JOIN page_links pl ON p.id = pl.source_page_id WHERE pl.target_page_id = ?').all(pageId);
      }
      return json(page);
    }

    if (sub === '' && method === 'PUT') {
      const body = await parseBody(req);
      if (db) { db.prepare('UPDATE pages SET title = ?, content = ?, markdown = ?, updated_at = ? WHERE id = ?').run(body.title, body.content, body.markdown, now(), pageId); }
      else { const p = readJSON('pages', pageId); if (p) { Object.assign(p, body, { updated_at: now() }); writeJSON('pages', pageId, p); } }
      return json({ updated: true });
    }

    if (sub === '' && method === 'DELETE') {
      if (db) { db.prepare('DELETE FROM pages WHERE id = ?').run(pageId); } else { deleteJSON('pages', pageId); }
      return json({ deleted: true });
    }

    // ── 页面版本历史（DocMost 版本管理） ──────────────────────────
    if (sub === '/versions' && method === 'GET') {
      let versions = db ? db.prepare('SELECT * FROM page_versions WHERE page_id = ? ORDER BY version DESC').all(pageId) : listJSON('page_versions').filter(v => v.page_id === pageId);
      return json({ data: versions });
    }

    if (sub === '/versions' && method === 'POST') {
      const body = await parseBody(req);
      const v = { id: uid(), page_id: pageId, title: body.title, content: body.content, version: (db ? (db.prepare('SELECT MAX(version) as m FROM page_versions WHERE page_id = ?').get(pageId)?.m || 0) : 0) + 1, created_at: now() };
      if (db) { db.prepare('INSERT INTO page_versions (id, page_id, title, content, version, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(v.id, v.page_id, v.title, v.content, v.version, v.created_at); }
      else { writeJSON('page_versions', v.id, v); }
      return json(v, 201);
    }

    // ── 双向链接（Zettlr 知识图谱） ───────────────────────────────
    if (sub === '/links' && method === 'GET') {
      let links = db ? db.prepare('SELECT p.id, p.title FROM pages p JOIN page_links pl ON p.id = pl.target_page_id WHERE pl.source_page_id = ?').all(pageId) : [];
      let backlinks = db ? db.prepare('SELECT p.id, p.title FROM pages p JOIN page_links pl ON p.id = pl.source_page_id WHERE pl.target_page_id = ?').all(pageId) : [];
      return json({ links, backlinks });
    }

    if (sub === '/links' && method === 'POST') {
      const body = await parseBody(req);
      const link = { id: uid(), source_page_id: pageId, target_page_id: body.target_page_id, link_type: body.link_type || 'reference', created_at: now() };
      if (db) { db.prepare('INSERT INTO page_links (id, source_page_id, target_page_id, link_type, created_at) VALUES (?, ?, ?, ?, ?)').run(link.id, link.source_page_id, link.target_page_id, link.link_type, link.created_at); }
      return json(link, 201);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 标签 CRUD（Teedy 标签系统）
  // ═══════════════════════════════════════════════════════════════════════
  if (pathname === '/api/tags' && method === 'GET') {
    let data = db ? db.prepare('SELECT * FROM tags ORDER BY name').all() : listJSON('tags');
    return json({ data });
  }

  if (pathname === '/api/tags' && method === 'POST') {
    const body = await parseBody(req);
    const tag = { id: uid(), name: body.name, color: body.color || '#6366f1' };
    if (db) { db.prepare('INSERT OR IGNORE INTO tags (id, name, color) VALUES (?, ?, ?)').run(tag.id, tag.name, tag.color); }
    else { writeJSON('tags', tag.id, tag); }
    return json(tag, 201);
  }

  // ── 页面打标签 ──────────────────────────────────────────────────────
  if (pathname === '/api/pages/tags' && method === 'POST') {
    const body = await parseBody(req);
    if (db) {
      db.prepare('INSERT OR IGNORE INTO page_tags (page_id, tag_id) VALUES (?, ?)').run(body.page_id, body.tag_id);
    }
    return json({ tagged: true }, 201);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 全文搜索（Wiki.js + SQLite FTS5）
  // ═══════════════════════════════════════════════════════════════════════
  if (pathname === '/api/search' && method === 'GET') {
    const q = (url.searchParams.get('q') || '').trim();
    if (!q) return json({ data: [] });
    let results;
    if (db) {
      results = db.prepare(`SELECT p.*, rank FROM pages_fts f JOIN pages p ON f.rowid = p.rowid WHERE pages_fts MATCH ? ORDER BY rank LIMIT 50`).all(q.replace(/[^\w\u4e00-\u9fff]/g, '') + '*');
    } else {
      let pages = listJSON('pages');
      results = pages.filter(p => (p.title || '').toLowerCase().includes(q.toLowerCase()) || (p.content || '').toLowerCase().includes(q.toLowerCase()));
    }
    return json({ data: results });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 知识图谱（Zettlr 双向链接图谱）
  // ═══════════════════════════════════════════════════════════════════════
  if (pathname === '/api/graph' && method === 'GET') {
    let nodes = [], edges = [];
    if (db) {
      nodes = db.prepare('SELECT id, title FROM pages').all().map(p => ({ id: p.id, title: p.title, type: 'page' }));
      edges = db.prepare('SELECT id, source_page_id as source, target_page_id as target, link_type as label FROM page_links').all();
    }
    return json({ nodes, edges });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // AI 聊天（Fusion-MLX）
  // ═══════════════════════════════════════════════════════════════════════
  if (pathname === '/api/ai/chat') {
    if (method === 'POST') {
      const body = await parseBody(req);
      const resp = await fetch(`${req.ctx.FUSION_MLX_URL}/v1/chat/completions`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: body.model || 'Qwen3.5-9B-4bit', messages: body.messages || [], stream: false }),
      });
      const data = await resp.json();
      return json({ choices: [{ message: { content: data.choices?.[0]?.message?.content || '' } }] });
    }
    return json({ api: '/api/ai/chat', method: 'POST' });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // AI 嵌入（Fusion-MLX）
  // ═══════════════════════════════════════════════════════════════════════
  if (pathname === '/api/ai/embeddings' && method === 'POST') {
    const body = await parseBody(req);
    const resp = await fetch(`${req.ctx.FUSION_MLX_URL}/v1/embeddings`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'bge-small-en-v1.5', input: body.input || [] }),
    });
    const data = await resp.json();
    return json(data);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 导出（BookStack 导出能力）
  // ═══════════════════════════════════════════════════════════════════════
  if (pathname.startsWith('/api/export/') && method === 'GET') {
    const parts = pathname.replace('/api/export/', '').split('/');
    const format = parts[0]; // pdf, html, markdown, docx
    const pageId = parts[1];
    let page = db ? db.prepare('SELECT * FROM pages WHERE id = ?').get(pageId) : readJSON('pages', pageId);
    if (!page) return json({ error: '页面不存在' }, 404);

    const content = `# ${page.title}\n\n${page.markdown || page.content || ''}`;
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(content);
    return true;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 收藏（DocMost 收藏）
  // ═══════════════════════════════════════════════════════════════════════
  if (pathname === '/api/favorites' && method === 'GET') {
    let data = db ? db.prepare('SELECT p.* FROM pages p JOIN favorites f ON p.id = f.page_id').all() : [];
    return json({ data });
  }

  if (pathname === '/api/favorites' && method === 'POST') {
    const body = await parseBody(req);
    if (db) { db.prepare('INSERT OR IGNORE INTO favorites (user_id, page_id) VALUES (?, ?)').run('local', body.page_id); }
    return json({ favorited: true }, 201);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 文件上传 / 下载（Teedy 文档管理）
  // ═══════════════════════════════════════════════════════════════════════
  if (pathname === '/api/files' && method === 'GET') {
    const pageId = url.searchParams.get('pageId');
    let data;
    if (db) {
      data = pageId ? db.prepare('SELECT id, name, mime, size, page_id, created_at FROM files WHERE page_id = ?').all(pageId) : db.prepare('SELECT id, name, mime, size, page_id, created_at FROM files ORDER BY created_at DESC').all();
    } else { data = listJSON('files').filter(f => !pageId || f.page_id === pageId); }
    return json({ data });
  }

  if (pathname === '/api/files/upload' && method === 'POST') {
    // 简单 base64 上传（实际应用应使用 multipart/form-data）
    const body = await parseBody(req);
    const fileId = uid();
    const ext = path.extname(body.name || 'file.bin');
    const fileName = fileId + ext;
    const storageDir = path.join(__dirname, '..', '..', 'data', 'storage');
    fs.mkdirSync(storageDir, { recursive: true });
    const buf = Buffer.from(body.content || '', 'base64');
    fs.writeFileSync(path.join(storageDir, fileName), buf);

    const file = {
      id: fileId, name: body.name || 'untitled', path: fileName,
      mime: body.mime || 'application/octet-stream', size: buf.length,
      page_id: body.page_id || null, encrypted: 0,
      created_at: now(),
    };
    if (db) {
      db.prepare('INSERT INTO files (id, name, path, mime, size, page_id, encrypted, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(file.id, file.name, file.path, file.mime, file.size, file.page_id, file.encrypted, file.created_at);
    } else { writeJSON('files', file.id, file); }

    // 尝试提取 Office 文档文本内容（LibreOffice）
    if (['.docx', '.xlsx', '.pptx', '.odt', '.ods', '.odp'].includes(ext)) {
      try {
        const execSync = require('child_process').execSync;
        const txtPath = path.join(storageDir, fileId + '.txt');
        execSync(`pandoc "${path.join(storageDir, fileName)}" -t plain -o "${txtPath}" 2>/dev/null || libreoffice --headless --convert-to txt --outdir "${storageDir}" "${path.join(storageDir, fileName)}" 2>/dev/null || true`);
        if (fs.existsSync(txtPath)) {
          file.extracted_text = fs.readFileSync(txtPath, 'utf-8').slice(0, 50000);
          fs.unlinkSync(txtPath);
        }
      } catch (e) { /* Office 转换不可用，忽略 */ }
    }

    return json(file, 201);
  }

  if (pathname.startsWith('/api/files/') && method === 'GET') {
    const fileId = pathname.replace('/api/files/', '');
    let file = db ? db.prepare('SELECT * FROM files WHERE id = ?').get(fileId) : readJSON('files', fileId);
    if (!file) return json({ error: 'File not found' }, 404);
    const storageDir = path.join(__dirname, '..', '..', 'data', 'storage');
    const filePath = path.join(storageDir, file.path);
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath);
      res.writeHead(200, {
        'Content-Type': file.mime,
        'Content-Disposition': `attachment; filename="${encodeURIComponent(file.name)}"`,
        'Content-Length': data.length,
      });
      res.end(data);
      return true;
    }
    return json({ error: 'File not found on disk' }, 404);
  }

  if (pathname.startsWith('/api/files/') && method === 'DELETE') {
    const fileId = pathname.replace('/api/files/', '');
    let file = db ? db.prepare('SELECT * FROM files WHERE id = ?').get(fileId) : readJSON('files', fileId);
    if (file) {
      const storageDir = path.join(__dirname, '..', '..', 'data', 'storage');
      const fp = path.join(storageDir, file.path);
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
      db ? db.prepare('DELETE FROM files WHERE id = ?').run(fileId) : deleteJSON('files', fileId);
    }
    return json({ deleted: true });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 评论 CRUD（DocMost 评论系统）
  // ═══════════════════════════════════════════════════════════════════════
  if (pathname === '/api/comments' && method === 'GET') {
    const pageId = url.searchParams.get('pageId');
    let data = db ? db.prepare('SELECT * FROM comments WHERE page_id = ? ORDER BY created_at').all(pageId) : [];
    return json({ data });
  }

  if (pathname === '/api/comments' && method === 'POST') {
    const body = await parseBody(req);
    const comment = { id: uid(), page_id: body.page_id, user_id: 'local', content: body.content, parent_id: body.parent_id || null, created_at: now() };
    if (db) { db.prepare('INSERT INTO comments (id, page_id, user_id, content, parent_id, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(comment.id, comment.page_id, comment.user_id, comment.content, comment.parent_id, comment.created_at); }
    return json(comment, 201);
  }

  if (pathname.startsWith('/api/comments/') && method === 'DELETE') {
    const commentId = pathname.replace('/api/comments/', '');
    if (db) { db.prepare('DELETE FROM comments WHERE id = ?').run(commentId); }
    return json({ deleted: true });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 活动日志（Wiki.js 审计追踪）
  // ═══════════════════════════════════════════════════════════════════════
  if (pathname === '/api/activity' && method === 'GET') {
    const limit = parseInt(url.searchParams.get('limit') || '50', 10);
    let data = db ? db.prepare('SELECT * FROM activity ORDER BY created_at DESC LIMIT ?').all(limit) : [];
    return json({ data });
  }

  if (pathname === '/api/activity' && method === 'POST') {
    const body = await parseBody(req);
    if (db) {
      db.exec(`CREATE TABLE IF NOT EXISTS activity (id TEXT PRIMARY KEY, user_id TEXT, action TEXT, target_type TEXT, target_id TEXT, metadata TEXT, created_at TEXT)`);
      db.prepare('INSERT INTO activity (id, user_id, action, target_type, target_id, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(uid(), body.user_id || 'local', body.action, body.target_type || '', body.target_id || '', JSON.stringify(body.metadata || {}), now());
    }
    return json({ logged: true }, 201);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 用户管理
  // ═══════════════════════════════════════════════════════════════════════
  if (pathname === '/api/users' && method === 'GET') {
    let data = db ? db.prepare('SELECT id, email, name, role, avatar, created_at FROM users ORDER BY name').all() : listJSON('users').map(u => ({ id: u.id, email: u.email, name: u.name, role: u.role }));
    return json({ data });
  }

  if (pathname === '/api/users/update' && method === 'POST') {
    const body = await parseBody(req);
    if (db) { db.prepare('UPDATE users SET name = ?, email = ? WHERE id = ?').run(body.name, body.email, body.id || 'local'); }
    return json({ updated: true });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // RAG 文档索引（Fusion-MLX 知识库问答）
  // ═══════════════════════════════════════════════════════════════════════
  if (pathname === '/api/rag/index' && method === 'POST') {
    const body = await parseBody(req);
    const pageId = body.page_id;
    let page = db ? db.prepare('SELECT * FROM pages WHERE id = ?').get(pageId) : readJSON('pages', pageId);
    if (!page) return json({ error: 'Page not found' }, 404);

    const text = (page.title + '\n\n' + (page.markdown || page.content || '')).slice(0, 50000);
    // 调用 Fusion-MLX 生成 embedding
    try {
      const resp = await fetch(`${req.ctx.FUSION_MLX_URL}/v1/embeddings`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'bge-small-en-v1.5', input: [text] }),
      });
      const data = await resp.json();
      // 存储向量索引到数据库
      const vector = JSON.stringify(data.data[0].embedding);
      if (db) {
        db.exec(`CREATE TABLE IF NOT EXISTS rag_index (id TEXT PRIMARY KEY, page_id TEXT UNIQUE, chunk TEXT, vector TEXT, created_at TEXT)`);
        db.prepare('INSERT OR REPLACE INTO rag_index (id, page_id, chunk, vector, created_at) VALUES (?, ?, ?, ?, ?)').run(uid(), pageId, text.slice(0, 2000), vector, now());
      }
      return json({ indexed: true, dimensions: data.data[0].embedding.length });
    } catch (e) {
      return json({ error: `Embedding failed: ${e.message}` }, 500);
    }
  }

  if (pathname === '/api/rag/query' && method === 'POST') {
    const body = await parseBody(req);
    const question = body.question || '';
    if (!question) return json({ error: 'Question required' }, 400);

    // 直接调用 Fusion-MLX 问答
    try {
      const resp = await fetch(`${req.ctx.FUSION_MLX_URL}/v1/chat/completions`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: body.model || 'Qwen3.5-9B-4bit',
          messages: [
            { role: 'system', content: 'You are a helpful document assistant. Answer based on the indexed knowledge base.' },
            { role: 'user', content: question },
          ],
          stream: false,
        }),
      });
      const data = await resp.json();
      return json({ answer: data.choices?.[0]?.message?.content || '', sources: [] });
    } catch (e) {
      return json({ error: `AI query failed: ${e.message}` }, 500);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 高级搜索（BookStack 多维度搜索）
  // ═══════════════════════════════════════════════════════════════════════
  if (pathname === '/api/search/advanced' && method === 'GET') {
    const q = (url.searchParams.get('q') || '').trim();
    const tag = url.searchParams.get('tag');
    const type = url.searchParams.get('type'); // page, book, chapter
    const sort = url.searchParams.get('sort') || 'updated_at';
    const order = url.searchParams.get('order') || 'DESC';
    if (!q && !tag) return json({ data: [] });

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
      if (type) {
        // type 搜索：book/chapter 级别
        wheres.push('(p.book_id IS NOT NULL OR p.chapter_id IS NOT NULL)');
      }
      if (wheres.length) sql += ' WHERE ' + wheres.join(' AND ');
      sql += ` ORDER BY p.${sort} ${order} LIMIT 50`;
      results = db.prepare(sql).all(...params);
    }
    return json({ data: results, query: q, tag, total: results.length });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 主题系统（BookStack 主题管理）
  // ═══════════════════════════════════════════════════════════════════════
  if (pathname === '/api/theme' && method === 'GET') {
    let theme = { primary: '#6366f1', secondary: '#06b6d4', background: '#0f172a', surface: '#1e293b', text: '#f1f5f9', mode: 'dark' };
    if (db) {
      const row = db.prepare("SELECT value FROM settings WHERE key = 'theme'").get();
      if (row) theme = JSON.parse(row.value);
    }
    return json(theme);
  }

  if (pathname === '/api/theme' && method === 'POST') {
    const body = await parseBody(req);
    if (db) {
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('theme', ?)").run(JSON.stringify(body));
    }
    return json({ saved: true });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Webhook 系统（Teedy 自动化）
  // ═══════════════════════════════════════════════════════════════════════
  if (pathname === '/api/webhooks' && method === 'GET') {
    let data = [];
    if (db) {
      db.exec(`CREATE TABLE IF NOT EXISTS webhooks (id TEXT PRIMARY KEY, name TEXT, url TEXT, events TEXT, enabled INTEGER DEFAULT 1, secret TEXT, created_at TEXT)`);
      data = db.prepare('SELECT * FROM webhooks ORDER BY created_at DESC').all();
    }
    return json({ data });
  }

  if (pathname === '/api/webhooks' && method === 'POST') {
    const body = await parseBody(req);
    if (db) {
      db.exec(`CREATE TABLE IF NOT EXISTS webhooks (id TEXT PRIMARY KEY, name TEXT, url TEXT, events TEXT, enabled INTEGER DEFAULT 1, secret TEXT, created_at TEXT)`);
      db.prepare('INSERT INTO webhooks (id, name, url, events, enabled, secret, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(uid(), body.name, body.url, JSON.stringify(body.events || []), body.enabled !== false, body.secret || '', now());
    }
    return json({ created: true }, 201);
  }

  // ── Webhook 触发 ─────────────────────────────────────────────────
  if (pathname === '/api/webhooks/trigger' && method === 'POST') {
    const body = await parseBody(req);
    if (db) {
      const hooks = db.prepare('SELECT * FROM webhooks WHERE enabled = 1').all();
      for (const hook of hooks) {
        const events = JSON.parse(hook.events || '[]');
        if (events.length === 0 || events.includes(body.event)) {
          // 异步触发 webhook（不阻塞响应）
          fetch(hook.url, {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Webhook-Secret': hook.secret || '' },
            body: JSON.stringify({ event: body.event, data: body.data, timestamp: now() }),
          }).catch(() => {});
        }
      }
    }
    return json({ triggered: true });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 元数据 / 词汇表系统（Teedy 文档分类）
  // ═══════════════════════════════════════════════════════════════════════
  if (pathname === '/api/metadata' && method === 'GET') {
    let data = [];
    if (db) {
      db.exec(`CREATE TABLE IF NOT EXISTS metadata (id TEXT PRIMARY KEY, page_id TEXT, key TEXT, value TEXT, type TEXT DEFAULT 'text', created_at TEXT)`);
      const pageId = url.searchParams.get('pageId');
      data = pageId ? db.prepare('SELECT * FROM metadata WHERE page_id = ?').all(pageId) : db.prepare('SELECT * FROM metadata ORDER BY created_at DESC').all();
    }
    return json({ data });
  }

  if (pathname === '/api/metadata' && method === 'POST') {
    const body = await parseBody(req);
    if (db) {
      db.exec(`CREATE TABLE IF NOT EXISTS metadata (id TEXT PRIMARY KEY, page_id TEXT, key TEXT, value TEXT, type TEXT DEFAULT 'text', created_at TEXT)`);
      db.prepare('INSERT INTO metadata (id, page_id, key, value, type, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(uid(), body.page_id, body.key, body.value, body.type || 'text', now());
    }
    return json({ created: true }, 201);
  }

  if (pathname === '/api/vocabulary' && method === 'GET') {
    let data = [];
    if (db) {
      db.exec(`CREATE TABLE IF NOT EXISTS vocabulary (id TEXT PRIMARY KEY, name TEXT UNIQUE, type TEXT, values TEXT, created_at TEXT)`);
      data = db.prepare('SELECT * FROM vocabulary ORDER BY name').all();
    }
    return json({ data });
  }

  if (pathname === '/api/vocabulary' && method === 'POST') {
    const body = await parseBody(req);
    if (db) {
      db.exec(`CREATE TABLE IF NOT EXISTS vocabulary (id TEXT PRIMARY KEY, name TEXT UNIQUE, type TEXT, values TEXT, created_at TEXT)`);
      db.prepare('INSERT OR REPLACE INTO vocabulary (id, name, type, values, created_at) VALUES (?, ?, ?, ?, ?)').run(uid(), body.name, body.type || 'text', JSON.stringify(body.values || []), now());
    }
    return json({ created: true }, 201);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 品牌信息
  // ═══════════════════════════════════════════════════════════════════════
  if (pathname === '/api/branding' && method === 'GET') {
    return json({
      name: 'Fusion-Doc', slogan: 'Apple Silicon 原生离线智能文档知识库',
      version: '0.1.0', theme: { primary: '#6366f1', secondary: '#06b6d4' },
      features: [
        'TipTap 编辑器 + Yjs 实时协作（DocMost）',
        '空间→书架→章节→页面 三层结构（BookStack）',
        'SQLite FTS5 全文搜索（Wiki.js）',
        '标签系统 + 工作流（Teedy）',
        '双向链接 + 知识图谱（Zettlr）',
        '页面历史版本 + 评论（DocMost）',
        'PDF/HTML/Markdown/Office 导出（BookStack）',
        'Fusion-MLX 本地 AI 推理（独家）',
        'macOS 原生优化（MacDown）',
      ]
    });
  }

  return false; // 未处理，交给 index.js 的静态文件服务
}

module.exports = { router };