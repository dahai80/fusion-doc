// =============================================================================
// Fusion-Doc — 数据库核心
// SQLite 主存储 + JSON 文件降级，支持迁移系统
// 参考 DocMost Prisma + Wiki.js 数据库层设计
// =============================================================================

const fs = require('fs');
const path = require('path');
const config = require('./config');

let db = null;
const DB_DIR = path.join(config.dataDir, 'db');
const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

// ── 初始化数据库 ──────────────────────────────────────────────────────────
function initDB() {
  try {
    const Database = require('better-sqlite3');
    fs.mkdirSync(DB_DIR, { recursive: true });
    db = new Database(path.join(DB_DIR, 'fusion-doc.db'));
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.pragma('cache_size = -64000'); // 64MB cache
    db.pragma('busy_timeout = 5000');

    // 执行 Schema 迁移
    runMigrations();

    console.log('  [DB] SQLite 初始化成功');
    return db;
  } catch (e) {
    console.log(`  [DB] SQLite 不可用: ${e.message}，使用 JSON 文件存储`);
    db = null;
    return null;
  }
}

// ── 迁移系统 ──────────────────────────────────────────────────────────────
function runMigrations() {
  if (!db) return;

  // 创建迁移记录表
  db.exec(`CREATE TABLE IF NOT EXISTS _migrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    applied_at TEXT DEFAULT (datetime('now'))
  )`);

  // 按顺序执行迁移
  const applied = new Set(
    db.prepare('SELECT name FROM _migrations').all().map(r => r.name)
  );

  const migrations = [
    { name: '001_initial_schema', sql: getInitialSchema() },
    { name: '002_rag_index', sql: getRagIndexSchema() },
    { name: '003_activity_webhook', sql: getActivityWebhookSchema() },
    { name: '004_metadata_vocabulary', sql: getMetadataVocabularySchema() },
  ];

  for (const migration of migrations) {
    if (applied.has(migration.name)) continue;
    try {
      db.exec(migration.sql);
      db.prepare('INSERT INTO _migrations (name) VALUES (?)').run(migration.name);
      console.log(`  [迁移] ${migration.name} ✓`);
    } catch (e) {
      console.error(`  [迁移] ${migration.name} ✗ ${e.message}`);
    }
  }
}

// ── Schema 定义 ───────────────────────────────────────────────────────────
function getInitialSchema() {
  return `
    -- 用户（参考 Wiki.js 多认证设计）
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
      password TEXT NOT NULL, role TEXT DEFAULT 'user',
      avatar TEXT, provider TEXT DEFAULT 'local',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- 工作空间（参考 DocMost 空间设计）
    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT UNIQUE NOT NULL,
      description TEXT DEFAULT '', logo TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- 书架（参考 BookStack 书→章→页三层结构）
    CREATE TABLE IF NOT EXISTS books (
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL,
      name TEXT NOT NULL, slug TEXT NOT NULL,
      description TEXT DEFAULT '', sort_order REAL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
    );

    -- 章节
    CREATE TABLE IF NOT EXISTS chapters (
      id TEXT PRIMARY KEY, book_id TEXT NOT NULL,
      name TEXT NOT NULL, slug TEXT NOT NULL,
      description TEXT DEFAULT '', sort_order REAL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (book_id) REFERENCES books(id)
    );

    -- 页面（DocMost + BookStack 融合）
    CREATE TABLE IF NOT EXISTS pages (
      id TEXT PRIMARY KEY, workspace_id TEXT,
      book_id TEXT, chapter_id TEXT,
      title TEXT NOT NULL, slug TEXT NOT NULL,
      content TEXT DEFAULT '', markdown TEXT DEFAULT '',
      editor_mode TEXT DEFAULT 'rich-text',
      parent_id TEXT, sort_order REAL DEFAULT 0,
      created_by TEXT, is_published INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (book_id) REFERENCES books(id),
      FOREIGN KEY (chapter_id) REFERENCES chapters(id)
    );

    -- 页面历史版本
    CREATE TABLE IF NOT EXISTS page_versions (
      id TEXT PRIMARY KEY, page_id TEXT NOT NULL,
      title TEXT NOT NULL, content TEXT DEFAULT '',
      version INTEGER DEFAULT 1, created_by TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (page_id) REFERENCES pages(id)
    );

    -- 标签
    CREATE TABLE IF NOT EXISTS tags (
      id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE,
      color TEXT DEFAULT '#6366f1', created_at TEXT DEFAULT (datetime('now'))
    );

    -- 页面-标签关联
    CREATE TABLE IF NOT EXISTS page_tags (
      page_id TEXT NOT NULL, tag_id TEXT NOT NULL,
      PRIMARY KEY (page_id, tag_id),
      FOREIGN KEY (page_id) REFERENCES pages(id),
      FOREIGN KEY (tag_id) REFERENCES tags(id)
    );

    -- 双向链接
    CREATE TABLE IF NOT EXISTS page_links (
      id TEXT PRIMARY KEY, source_page_id TEXT NOT NULL,
      target_page_id TEXT NOT NULL,
      link_type TEXT DEFAULT 'reference',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (source_page_id) REFERENCES pages(id),
      FOREIGN KEY (target_page_id) REFERENCES pages(id)
    );

    -- 文件附件
    CREATE TABLE IF NOT EXISTS files (
      id TEXT PRIMARY KEY, name TEXT NOT NULL,
      path TEXT NOT NULL, mime TEXT NOT NULL,
      size INTEGER DEFAULT 0, page_id TEXT,
      encrypted INTEGER DEFAULT 0,
      created_by TEXT, created_at TEXT DEFAULT (datetime('now'))
    );

    -- 评论
    CREATE TABLE IF NOT EXISTS comments (
      id TEXT PRIMARY KEY, page_id TEXT NOT NULL,
      user_id TEXT NOT NULL, content TEXT NOT NULL,
      parent_id TEXT, created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (page_id) REFERENCES pages(id)
    );

    -- 收藏
    CREATE TABLE IF NOT EXISTS favorites (
      user_id TEXT NOT NULL, page_id TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, page_id)
    );

    -- 系统设置
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY, value TEXT NOT NULL
    );

    -- 全文搜索索引（SQLite FTS5）
    CREATE VIRTUAL TABLE IF NOT EXISTS pages_fts USING fts5(
      title, content, markdown, content=pages, content_rowid=rowid
    );

    -- FTS 触发器
    CREATE TRIGGER IF NOT EXISTS pages_ai AFTER INSERT ON pages BEGIN
      INSERT INTO pages_fts(rowid, title, content, markdown)
      VALUES (new.rowid, new.title, new.content, new.markdown);
    END;
    CREATE TRIGGER IF NOT EXISTS pages_ad AFTER DELETE ON pages BEGIN
      INSERT INTO pages_fts(pages_fts, rowid, title, content, markdown)
      VALUES ('delete', old.rowid, old.title, old.content, old.markdown);
    END;
    CREATE TRIGGER IF NOT EXISTS pages_au AFTER UPDATE ON pages BEGIN
      INSERT INTO pages_fts(pages_fts, rowid, title, content, markdown)
      VALUES ('delete', old.rowid, old.title, old.content, old.markdown);
      INSERT INTO pages_fts(rowid, title, content, markdown)
      VALUES (new.rowid, new.title, new.content, new.markdown);
    END;

    -- 索引
    CREATE INDEX IF NOT EXISTS idx_pages_workspace ON pages(workspace_id);
    CREATE INDEX IF NOT EXISTS idx_pages_book ON pages(book_id);
    CREATE INDEX IF NOT EXISTS idx_pages_chapter ON pages(chapter_id);
    CREATE INDEX IF NOT EXISTS idx_pages_parent ON pages(parent_id);
    CREATE INDEX IF NOT EXISTS idx_books_workspace ON books(workspace_id);
    CREATE INDEX IF NOT EXISTS idx_chapters_book ON chapters(book_id);
    CREATE INDEX IF NOT EXISTS idx_page_versions_page ON page_versions(page_id);
    CREATE INDEX IF NOT EXISTS idx_page_links_source ON page_links(source_page_id);
    CREATE INDEX IF NOT EXISTS idx_page_links_target ON page_links(target_page_id);
  `;
}

function getRagIndexSchema() {
  return `
    CREATE TABLE IF NOT EXISTS rag_index (
      id TEXT PRIMARY KEY, page_id TEXT UNIQUE,
      chunk TEXT, vector TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `;
}

function getActivityWebhookSchema() {
  return `
    CREATE TABLE IF NOT EXISTS activity (
      id TEXT PRIMARY KEY, user_id TEXT,
      action TEXT, target_type TEXT, target_id TEXT,
      metadata TEXT, created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS webhooks (
      id TEXT PRIMARY KEY, name TEXT, url TEXT,
      events TEXT, enabled INTEGER DEFAULT 1,
      secret TEXT, created_at TEXT DEFAULT (datetime('now'))
    );
  `;
}

function getMetadataVocabularySchema() {
  return `
    CREATE TABLE IF NOT EXISTS metadata (
      id TEXT PRIMARY KEY, page_id TEXT,
      key TEXT, value TEXT, type TEXT DEFAULT 'text',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS vocabulary (
      id TEXT PRIMARY KEY, name TEXT UNIQUE,
      type TEXT, values TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `;
}

// ── JSON 文件降级存储 ────────────────────────────────────────────────────
function readJSON(dir, id) {
  const p = path.join(DB_DIR, 'json', dir, `${id}.json`);
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf-8')) : null;
}

function writeJSON(dir, id, data) {
  const d = path.join(DB_DIR, 'json', dir);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, `${id}.json`), JSON.stringify(data, null, 2));
}

function listJSON(dir) {
  const d = path.join(DB_DIR, 'json', dir);
  if (!fs.existsSync(d)) return [];
  return fs.readdirSync(d).filter(f => f.endsWith('.json')).map(f => {
    try { return JSON.parse(fs.readFileSync(path.join(d, f), 'utf-8')); } catch { return null; }
  }).filter(Boolean);
}

function deleteJSON(dir, id) {
  const p = path.join(DB_DIR, 'json', dir, `${id}.json`);
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

function getDB() { return db; }

module.exports = { initDB, getDB, db, readJSON, writeJSON, listJSON, deleteJSON };