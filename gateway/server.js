// =============================================================================
// Fusion-Doc — 自包含一体化服务器
// =============================================================================
// 单进程、单端口、零外部依赖（无需 PostgreSQL / Redis）
// 前端 + API + AI + SQLite 存储，全部在一个进程中
// 参考 ~/mac-doc 中 BookStack/wiki/Zettlr 的架构设计
// =============================================================================

const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = parseInt(process.env.FUSION_DOC_PORT || '11435', 10);
const FUSION_MLX_URL = process.env.FUSION_MLX_URL || 'http://localhost:11434';
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const DATA_DIR = path.join(__dirname, '..', 'data');

// ── 工具函数 ──────────────────────────────────────────────────────────────
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.webp': 'image/webp',
};

function serveStatic(res, filePath) {
  fs.readFile(filePath, (err, data) => {
    if (err) return serveSPA(res);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
}

function serveSPA(res) {
  fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (_, data) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(data);
  });
}

function json(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => { try { resolve(body ? JSON.parse(body) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

// ── SQLite 存储 ────────────────────────────────────────────────────────────
let db = null;
function initDB() {
  try {
    const Database = require('better-sqlite3');
    const dbPath = path.join(DATA_DIR, 'db', 'fusion-doc.db');
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');

    // 创建表结构
    db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        password TEXT NOT NULL,
        role TEXT DEFAULT 'user',
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS spaces (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        slug TEXT UNIQUE NOT NULL,
        description TEXT DEFAULT '',
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS pages (
        id TEXT PRIMARY KEY,
        space_id TEXT,
        title TEXT NOT NULL,
        slug TEXT NOT NULL,
        content TEXT DEFAULT '',
        markdown TEXT DEFAULT '',
        parent_id TEXT,
        sort_order REAL DEFAULT 0,
        created_by TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (space_id) REFERENCES spaces(id),
        FOREIGN KEY (parent_id) REFERENCES pages(id)
      );
      CREATE TABLE IF NOT EXISTS files (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        path TEXT NOT NULL,
        mime TEXT NOT NULL,
        size INTEGER DEFAULT 0,
        page_id TEXT,
        created_by TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_pages_space ON pages(space_id);
      CREATE INDEX IF NOT EXISTS idx_pages_slug ON pages(slug);
      CREATE INDEX IF NOT EXISTS idx_pages_parent ON pages(parent_id);
    `);

    console.log(`[Fusion-Doc] 数据库初始化: ${dbPath}`);
    return true;
  } catch (e) {
    console.log(`[Fusion-Doc] SQLite 不可用: ${e.message}（使用 JSON 文件存储）`);
    return false;
  }
}

// ── JSON 文件存储（SQLite 不可用时的降级方案） ────────────────────────────
function readJSON(dir, id) {
  const p = path.join(DATA_DIR, dir, `${id}.json`);
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf-8')) : null;
}
function writeJSON(dir, id, data) {
  const d = path.join(DATA_DIR, dir);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, `${id}.json`), JSON.stringify(data, null, 2));
}
function listJSON(dir) {
  const d = path.join(DATA_DIR, dir);
  if (!fs.existsSync(d)) return [];
  return fs.readdirSync(d).filter(f => f.endsWith('.json')).map(f => {
    try { return JSON.parse(fs.readFileSync(path.join(d, f), 'utf-8')); } catch { return null; }
  }).filter(Boolean);
}
function deleteJSON(dir, id) {
  const p = path.join(DATA_DIR, dir, `${id}.json`);
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

// ── Fusion-MLX 调用 ────────────────────────────────────────────────────────
async function mlxChat(messages, model = 'Qwen3.5-9B-4bit') {
  const resp = await fetch(`${FUSION_MLX_URL}/v1/chat/completions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages, stream: false }),
  });
  if (!resp.ok) throw new Error(`MLX ${resp.status}`);
  const data = await resp.json();
  return data.choices?.[0]?.message?.content || '';
}

async function mlxEmbed(texts) {
  const resp = await fetch(`${FUSION_MLX_URL}/v1/embeddings`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'bge-small-en-v1.5', input: texts }),
  });
  const data = await resp.json();
  return data.data.map(d => d.embedding);
}

// ── 会话管理（简单 JWT 替代） ──────────────────────────────────────────────
const sessions = new Map();
function getSession(token) {
  return sessions.get(token);
}
function createSession(user) {
  const token = uid() + uid();
  sessions.set(token, { user, expires: Date.now() + 86400000 });
  return token;
}

// ── 服务器 ──────────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;
  const method = req.method;

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  try {
    // ═════════════════════════════════════════════════════════════════════
    // API 路由
    // ═════════════════════════════════════════════════════════════════════

    // ── 健康检查 ──────────────────────────────────────────────────────
    if (pathname === '/api/health' && method === 'GET') {
      return json(res, { app: 'Fusion-Doc', version: '0.1.0', status: 'ok', mlx: true });
    }

    // ── 系统设置 ──────────────────────────────────────────────────────
    if (pathname === '/api/system/setup' && method === 'GET') {
      const isSetup = db ? db.prepare('SELECT COUNT(*) as c FROM users').get().c > 0 : listJSON('users').length > 0;
      return json(res, { setup: !isSetup });
    }

    // ── 注册/设置管理员 ──────────────────────────────────────────────
    if (pathname === '/api/auth/setup' && method === 'POST') {
      const body = await readBody(req);
      const user = { id: uid(), email: body.email, name: body.name || 'Admin', password: body.password || 'admin', role: 'admin', created_at: new Date().toISOString() };
      if (db) {
        db.prepare('INSERT INTO users (id, email, name, password, role, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(user.id, user.email, user.name, user.password, user.role, user.created_at);
      } else {
        writeJSON('users', user.id, user);
      }
      // 创建默认空间
      const space = { id: uid(), name: 'My Workspace', slug: 'my-workspace', description: '默认工作空间' };
      if (db) {
        db.prepare('INSERT INTO spaces (id, name, slug, description) VALUES (?, ?, ?, ?)').run(space.id, space.name, space.slug, space.description);
      } else {
        writeJSON('spaces', space.id, space);
      }
      const token = createSession(user);
      return json(res, { token, user: { id: user.id, email: user.email, name: user.name, role: user.role } }, 201);
    }

    // ── 登录 ──────────────────────────────────────────────────────────
    if (pathname === '/api/auth/login' && method === 'POST') {
      const body = await readBody(req);
      let user = db ? db.prepare('SELECT * FROM users WHERE email = ?').get(body.email) : null;
      if (!user) user = Object.values(listJSON('users')).find(u => u.email === body.email);
      if (!user || user.password !== body.password) return json(res, { error: '登录失败' }, 401);
      const token = createSession(user);
      return json(res, { token, user: { id: user.id, email: user.email, name: user.name, role: user.role } });
    }

    // ── 当前用户信息 ──────────────────────────────────────────────────
    if (pathname === '/api/users/me' && method === 'POST') {
      const auth = req.headers.authorization;
      if (!auth) return json(res, { error: '未登录' }, 401);
      const token = auth.replace('Bearer ', '');
      const session = getSession(token);
      if (!session) return json(res, { error: '会话过期' }, 401);
      return json(res, { id: session.user.id, email: session.user.email, name: session.user.name, role: session.user.role });
    }

    // ── 空间列表 ──────────────────────────────────────────────────────
    if (pathname === '/api/spaces' && method === 'GET') {
      let spaces = db ? db.prepare('SELECT * FROM spaces ORDER BY name').all() : listJSON('spaces');
      return json(res, { data: spaces });
    }

    // ── 创建空间 ──────────────────────────────────────────────────────
    if (pathname === '/api/spaces' && method === 'POST') {
      const body = await readBody(req);
      const space = { id: uid(), name: body.name, slug: body.slug || body.name.toLowerCase().replace(/\s+/g, '-'), description: body.description || '' };
      if (db) {
        db.prepare('INSERT INTO spaces (id, name, slug, description) VALUES (?, ?, ?, ?)').run(space.id, space.name, space.slug, space.description);
      } else {
        writeJSON('spaces', space.id, space);
      }
      return json(res, space, 201);
    }

    // ── 页面列表 ──────────────────────────────────────────────────────
    if (pathname === '/api/pages' && method === 'GET') {
      const spaceId = url.searchParams.get('spaceId');
      let pages;
      if (db) {
        pages = spaceId ? db.prepare('SELECT * FROM pages WHERE space_id = ? ORDER BY sort_order').all(spaceId) : db.prepare('SELECT * FROM pages ORDER BY updated_at DESC').all();
      } else {
        pages = listJSON('pages').filter(p => !spaceId || p.space_id === spaceId);
      }
      return json(res, { data: pages });
    }

    // ── 创建页面 ──────────────────────────────────────────────────────
    if (pathname === '/api/pages' && method === 'POST') {
      const body = await readBody(req);
      const page = {
        id: uid(), space_id: body.space_id || null, title: body.title || '未命名',
        slug: body.slug || (body.title || 'untitled').toLowerCase().replace(/\s+/g, '-') + '-' + Math.random().toString(36).slice(2, 6),
        content: body.content || '', markdown: body.markdown || '',
        parent_id: body.parent_id || null, sort_order: body.sort_order || 0,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      };
      if (db) {
        db.prepare('INSERT INTO pages (id, space_id, title, slug, content, markdown, parent_id, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(page.id, page.space_id, page.title, page.slug, page.content, page.markdown, page.parent_id, page.sort_order, page.created_at, page.updated_at);
      } else {
        writeJSON('pages', page.id, page);
      }
      return json(res, page, 201);
    }

    // ── 单页操作 ──────────────────────────────────────────────────────
    if (pathname.startsWith('/api/pages/')) {
      const pageId = pathname.replace('/api/pages/', '');
      if (method === 'GET') {
        let page = db ? db.prepare('SELECT * FROM pages WHERE id = ?').get(pageId) : readJSON('pages', pageId);
        if (!page) return json(res, { error: '页面不存在' }, 404);
        return json(res, page);
      }
      if (method === 'PUT') {
        const body = await readBody(req);
        if (db) {
          db.prepare('UPDATE pages SET title = ?, content = ?, markdown = ?, updated_at = ? WHERE id = ?').run(body.title, body.content, body.markdown, new Date().toISOString(), pageId);
        } else {
          const page = readJSON('pages', pageId);
          if (page) { Object.assign(page, body, { updated_at: new Date().toISOString() }); writeJSON('pages', pageId, page); }
        }
        return json(res, { updated: true });
      }
      if (method === 'DELETE') {
        db ? db.prepare('DELETE FROM pages WHERE id = ?').run(pageId) : deleteJSON('pages', pageId);
        return json(res, { deleted: true });
      }
    }

    // ── AI 聊天 ──────────────────────────────────────────────────────
    if (pathname === '/api/ai/chat') {
      if (method === 'POST') {
        const body = await readBody(req);
        const answer = await mlxChat(body.messages || []);
        return json(res, { choices: [{ message: { content: answer } }] });
      }
      return json(res, { api: '/api/ai/chat', method: 'POST', note: 'POST with { messages: [{ role: "user", content: "..." }] }' });
    }

    // ── AI Embeddings ────────────────────────────────────────────────
    if (pathname === '/api/ai/embeddings' && method === 'POST') {
      const body = await readBody(req);
      const embeddings = await mlxEmbed(body.input || []);
      return json(res, { data: embeddings.map((e, i) => ({ index: i, embedding: e })) });
    }

    // ── 搜索 ──────────────────────────────────────────────────────────
    if (pathname === '/api/search' && method === 'GET') {
      const q = (url.searchParams.get('q') || '').toLowerCase();
      if (!q) return json(res, { data: [] });
      let pages = db ? db.prepare('SELECT * FROM pages').all() : listJSON('pages');
      const results = pages.filter(p => (p.title || '').toLowerCase().includes(q) || (p.content || '').toLowerCase().includes(q));
      return json(res, { data: results });
    }

    // ═════════════════════════════════════════════════════════════════════
    // 前端静态文件
    // ═════════════════════════════════════════════════════════════════════

    // 静态资源
    const assetPaths = ['/assets/', '/icons/', '/manifest.json', '/vite.svg', '/locales/'];
    if (assetPaths.some(p => pathname.startsWith(p) || pathname === p)) {
      return serveStatic(res, path.join(PUBLIC_DIR, pathname));
    }

    // SPA: 所有非 API 路径 → index.html
    serveSPA(res);

  } catch (err) {
    console.error(`[Fusion-Doc] ${err.message}`);
    json(res, { error: err.message }, 500);
  }
});

// ── 启动 ──────────────────────────────────────────────────────────────────
initDB();
server.listen(PORT, () => {
  console.log(`========================================`);
  console.log(`  Fusion-Doc V0.1`);
  console.log(`  自包含一体化服务器`);
  console.log(`========================================`);
  console.log(`  Port  : ${PORT}`);
  console.log(`  存储  : ${db ? 'SQLite' : 'JSON 文件'}`);
  console.log(`  AI    : ${FUSION_MLX_URL}`);
  console.log(`  前端  : ${PUBLIC_DIR}`);
  console.log(`========================================`);
  console.log(`  http://localhost:${PORT}`);
  console.log(`========================================`);
});