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
    { name: '005_page_editor', fn: runPageEditorMigration },
    { name: '006_templates', sql: getTemplatesSchema() },
    { name: '007_office_files', sql: getOfficeFilesSchema() },
    { name: '008_rag_chunks', sql: getRagChunksSchema() },
    { name: '009_workflow', sql: getWorkflowSchema() },
    { name: '010_collaboration', sql: getCollaborationSchema() },
    { name: '011_vocabulary_unique', fn: runVocabularyUniqueMigration },
    // A2 修复: append-only 更新日志表。替代 yjs_docs 单行 state 的 read-modify-write,
    // 消除多客户端并发 SELECT 旧 state 各自 concat UPDATE 的 lost update。
    { name: '012_yjs_updates', sql: getYjsUpdatesSchema() },
    { name: '013_yjs_state_seq', fn: runYjsStateSeqMigration },
    // A7 修复: pages_fts 从 external-content(rowid) 改自包含(page_id UNINDEXED)。
    // 重建 FTS 表 + 触发器, 用 pages 现有数据回填, 消除 rowid 错配风险。
    { name: '014_fts_decouple_rowid', fn: runFtsDecoupleMigration },
    // A7 修复补充: 014 的 pages_ad/pages_au 触发器误用 'delete' 特殊命令,
    // 自包含 FTS 表上致 pages DELETE/UPDATE 报 "SQL logic error"。重建为按 page_id 直接删除。
    { name: '015_fts_trigger_fix', fn: runFtsTriggerFixMigration },
    // A8 修复: 三路 RAG 合一。ai.js 内联 + rag.js 用 rag_index 表, rag-hybrid 用 rag_chunks 表,
    // 数据分叉、重索引成本翻倍。统一到 rag_chunks, rag_index 废弃 (down 迁移归档)。
    // 仅迁移已应用计数, 实际合并由 rag 服务层统一写 rag_chunks, 此条无 DDL (幂等占位)。
    { name: '016_rag_unify', fn: runRagUnifyMigration },
  ];

  for (const migration of migrations) {
    if (applied.has(migration.name)) continue;
    // E3 修复: 单迁移 SAVEPOINT 原子化。DDL 在 SQLite 可事务 (CREATE/DROP/ALTER 均可回滚),
    // 失败时 RELEASE 前抛错 → ROLLBACK 回退本迁移已执行的部分语句, 不留半套 schema。
    // _migrations 记录与 DDL 同事务, 全成功才记 applied, 中途崩溃重启不会误判已迁移。
    db.exec('SAVEPOINT fd_migration');
    try {
      if (migration.fn) {
        migration.fn(db);
      } else {
        db.exec(migration.sql);
      }
      db.prepare('INSERT INTO _migrations (name) VALUES (?)').run(migration.name);
      db.exec('RELEASE fd_migration');
      console.log(`  [迁移] ${migration.name} ✓`);
    } catch (e) {
      // 商用级 fail visibly: 迁移失败不可吞, 抛出阻止带病启动 (P2-19)
      // E3 修复: 回滚本迁移的部分 DDL, 保持库一致, 再抛出。
      db.exec('ROLLBACK TO fd_migration');
      db.exec('RELEASE fd_migration');
      console.error(`  [迁移] ${migration.name} ✗ ${e.message}`);
      throw new Error(`数据库迁移 ${migration.name} 失败: ${e.message}`);
    }
  }
}

// E3 修复: down-migration。按名回滚单条迁移 (尽力 DROP, 不恢复业务数据)。
// 供运维误迁移后回退 schema 用, 调用方: 控制台脚本 / 未来 admin 端点。不随 initDB 自动跑。
// eslint-disable-next-line no-unused-vars
function migrateDown(name) {
  if (!db) throw new Error('DB not available');
  const downMap = {
    '008_rag_chunks': 'DROP TABLE IF EXISTS rag_chunks;',
    '010_collaboration': 'DROP TABLE IF EXISTS yjs_docs;',
    '012_yjs_updates': 'DROP TABLE IF EXISTS yjs_updates;',
  };
  const sql = downMap[name];
  if (!sql) throw new Error(`无 down-migration: ${name}`);
  db.exec('SAVEPOINT fd_down');
  try {
    db.exec(sql);
    db.prepare('DELETE FROM _migrations WHERE name = ?').run(name);
    db.exec('RELEASE fd_down');
    console.log(`  [迁移] 回滚 ${name} ✓`);
  } catch (e) {
    db.exec('ROLLBACK TO fd_down');
    db.exec('RELEASE fd_down');
    throw new Error(`回滚 ${name} 失败: ${e.message}`);
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

    -- 全文搜索索引（SQLite FTS5, A7 修复: 解耦 rowid)
    -- pages 主键为 TEXT(id), implicit rowid 在 VACUUM/ALTER 重建后会重排,
    -- external-content(content_rowid=rowid) 会指向错行 → 搜索返回错页。
    -- 改为自包含 FTS, 以 page_id(UNINDEXED) 显式关联, 不依赖 rowid。
    CREATE VIRTUAL TABLE IF NOT EXISTS pages_fts USING fts5(
      page_id UNINDEXED, title, content, markdown, tokenize = 'unicode61'
    );

    -- FTS 触发器 (按 page_id 同步, 与 rowid 无关)
    -- 注意: 自包含 FTS (无 content= 外部表) 不可用 'delete' 特殊命令
    -- (仅 external-content 表支持, 自包含表会报 SQL logic error)。
    -- delete/update 触发器直接按 page_id 删除再插入。
    CREATE TRIGGER IF NOT EXISTS pages_ai AFTER INSERT ON pages BEGIN
      INSERT INTO pages_fts(page_id, title, content, markdown)
      VALUES (new.id, new.title, new.content, new.markdown);
    END;
    CREATE TRIGGER IF NOT EXISTS pages_ad AFTER DELETE ON pages BEGIN
      DELETE FROM pages_fts WHERE page_id = old.id;
    END;
    CREATE TRIGGER IF NOT EXISTS pages_au AFTER UPDATE ON pages BEGIN
      DELETE FROM pages_fts WHERE page_id = old.id;
      INSERT INTO pages_fts(page_id, title, content, markdown)
      VALUES (new.id, new.title, new.content, new.markdown);
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
      type TEXT, value_list TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `;
}

// ── JSON 文件降级存储 ────────────────────────────────────────────────────
// ID 校验: 拒绝含路径分隔符/遍历符的 ID, 防路径穿越 (P3-30)
function _assertSafeId(id) {
  if (typeof id !== 'string' || id.length === 0 || id.length > 256) return false;
  if (id.includes('/') || id.includes('\\') || id.includes('..') || id.includes('\0')) return false;
  if (id === '.' || id === '..') return false;
  return true;
}
function _assertSafeDir(dir) {
  if (typeof dir !== 'string' || dir.length === 0 || dir.length > 128) return false;
  if (dir.includes('/') || dir.includes('\\') || dir.includes('..') || dir.includes('\0')) return false;
  return true;
}

function readJSON(dir, id) {
  if (!_assertSafeDir(dir) || !_assertSafeId(id)) return null;
  const p = path.join(DB_DIR, 'json', dir, `${id}.json`);
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf-8')) : null;
}

function writeJSON(dir, id, data) {
  if (!_assertSafeDir(dir) || !_assertSafeId(id)) {
    console.warn(`  [DB] writeJSON 拒绝非法 dir/id: dir=${dir} id=${id}`);
    return;
  }
  const d = path.join(DB_DIR, 'json', dir);
  fs.mkdirSync(d, { recursive: true });
  // R7 修复: 原子写 (写临时文件 + rename), 崩溃不留截断 JSON; 原 writeFileSync 中途崩溃数据损坏
  const finalPath = path.join(d, `${id}.json`);
  const tmpPath = path.join(d, `.${id}.${process.pid}.tmp`);
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2));
  fs.renameSync(tmpPath, finalPath);
}

function listJSON(dir) {
  if (!_assertSafeDir(dir)) return [];
  const d = path.join(DB_DIR, 'json', dir);
  if (!fs.existsSync(d)) return [];
  return fs.readdirSync(d).filter(f => f.endsWith('.json')).map(f => {
    try { return JSON.parse(fs.readFileSync(path.join(d, f), 'utf-8')); } catch { return null; }
  }).filter(Boolean);
}

function deleteJSON(dir, id) {
  if (!_assertSafeDir(dir) || !_assertSafeId(id)) return;
  const p = path.join(DB_DIR, 'json', dir, `${id}.json`);
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

function runPageEditorMigration(database) {
  const cols = database.prepare("PRAGMA table_info('pages')").all().map(c => c.name);
  if (!cols.includes('editor_schema')) {
    database.exec("ALTER TABLE pages ADD COLUMN editor_schema TEXT DEFAULT '{}'");
  }
  if (!cols.includes('yjs_state')) {
    database.exec("ALTER TABLE pages ADD COLUMN yjs_state BLOB");
  }
}

// ── 011: vocabulary.name 加 UNIQUE (P2-21) ────────────────────────────────
// schema 已声明 UNIQUE, 此迁移处理存量重复行: 保留最早一行, 删去重名行, 再建 UNIQUE 索引兜底
function runVocabularyUniqueMigration(database) {
  // 清理存量重名行: 每组 name 仅保留 created_at 最小的一行
  database.exec(`
    DELETE FROM vocabulary WHERE id NOT IN (
      SELECT id FROM (
        SELECT id, ROW_NUMBER() OVER (PARTITION BY name ORDER BY created_at ASC) AS rn FROM vocabulary
      ) WHERE rn = 1
    )
  `);
  // 兜底建唯一索引 (若 schema 的 UNIQUE 约束已存在, CREATE UNIQUE INDEX IF NOT EXISTS 跳过)
  try {
    database.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_vocabulary_name ON vocabulary(name)');
  } catch (e) {
    console.warn('  [迁移] 011_vocabulary_unique 索引跳过:', e.message);
  }
}

function getDB() { return db; }

// 数据备份: 使用 better-sqlite3 原生 .backup() 在线热备 (WAL 安全, 不阻塞写入)
// 异步返回备份文件绝对路径; 失败抛错 (商用级 fail visibly)
async function backupDB(destDir) {
  if (!db) throw new Error('数据库未初始化, 无法备份');
  const fs = require('fs');
  const targetDir = destDir || path.join(DB_DIR, 'backups');
  fs.mkdirSync(targetDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = path.join(targetDir, `fusion-doc-${stamp}.db`);
  await db.backup(dest);
  console.log(`  [Backup] 数据库已备份: ${dest}`);
  return dest;
}

function getTemplatesSchema() {
  return `
    CREATE TABLE IF NOT EXISTS templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT DEFAULT 'general',
      description TEXT DEFAULT '',
      content TEXT DEFAULT '',
      schema TEXT DEFAULT '{}',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_templates_category ON templates(category);
  `;
}

module.exports = { initDB, getDB, db, readJSON, writeJSON, listJSON, deleteJSON, backupDB, migrateDown };

function getOfficeFilesSchema() {
  return `
    CREATE TABLE IF NOT EXISTS office_files (
      id TEXT PRIMARY KEY,
      page_id TEXT,
      file_path TEXT NOT NULL,
      file_type TEXT NOT NULL,
      preview_path TEXT,
      metadata TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (page_id) REFERENCES pages(id)
    );

    CREATE INDEX IF NOT EXISTS idx_office_files_page ON office_files(page_id);
    CREATE INDEX IF NOT EXISTS idx_office_files_type ON office_files(file_type);
  `;
}

function getRagChunksSchema() {
  return `
    CREATE TABLE IF NOT EXISTS rag_chunks (
      id TEXT PRIMARY KEY,
      page_id TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      chunk_text TEXT NOT NULL,
      chunk_type TEXT DEFAULT 'paragraph',
      heading TEXT,
      vector TEXT,
      bm25_tokens TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (page_id) REFERENCES pages(id)
    );

    CREATE INDEX IF NOT EXISTS idx_rag_chunks_page ON rag_chunks(page_id);
  `;
}

function getWorkflowSchema() {
  return `
    CREATE TABLE IF NOT EXISTS workflows (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      yaml_def TEXT NOT NULL,
      status TEXT DEFAULT 'idle',
      last_run_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS workflow_runs (
      id TEXT PRIMARY KEY,
      workflow_id TEXT NOT NULL,
      status TEXT DEFAULT 'running',
      input TEXT,
      output TEXT,
      steps TEXT,
      error TEXT,
      started_at TEXT,
      completed_at TEXT,
      FOREIGN KEY (workflow_id) REFERENCES workflows(id)
    );

    CREATE INDEX IF NOT EXISTS idx_workflow_runs_wf ON workflow_runs(workflow_id);
  `;
}

function getCollaborationSchema() {
  return `
    CREATE TABLE IF NOT EXISTS yjs_docs (
      id TEXT PRIMARY KEY,
      page_id TEXT UNIQUE NOT NULL,
      state BLOB,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (page_id) REFERENCES pages(id)
    );

    CREATE INDEX IF NOT EXISTS idx_yjs_docs_page ON yjs_docs(page_id);
  `;
}

// A2 修复: Yjs append-only 更新日志。
// 每条 update 单独 INSERT (原子写, 无 read-modify-write), 按自增 seq 顺序回放。
// Yjs updates 交换律 + 幂等, 故按 seq 回放即合法 CRDT state, 无 lost update。
// compaction_flag 标记已压缩进 yjs_docs.state 的旧行, 便于清理。
function getYjsUpdatesSchema() {
  return `
    CREATE TABLE IF NOT EXISTS yjs_updates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      page_id TEXT NOT NULL,
      "update" BLOB NOT NULL,
      compaction_flag INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (page_id) REFERENCES pages(id)
    );
    CREATE INDEX IF NOT EXISTS idx_yjs_updates_page ON yjs_updates(page_id, id);
  `;
}

// A2 配套: 给 yjs_docs 加 state_seq 列, 记录压缩快照覆盖到的最大 update seq。
// SQLite 11+ 支持 ADD COLUMN, 老库 ALTER TABLE IF NOT EXISTS 不支持故用 PRAGMA 探测。
function runYjsStateSeqMigration(db) {
  const cols = db.prepare("PRAGMA table_info(yjs_docs)").all().map(c => c.name);
  if (!cols.includes('state_seq')) {
    db.exec('ALTER TABLE yjs_docs ADD COLUMN state_seq INTEGER DEFAULT 0');
    console.log('  [迁移] yjs_docs.state_seq 列已添加');
  }
}

// A7 修复: pages_fts 解耦 rowid。旧表用 external-content(content_rowid=rowid),
// pages 主键为 TEXT, implicit rowid 在 VACUUM/ALTER 重建后重排 → 搜索错页。
// 重建为自包含 FTS(page_id UNINDEXED), 重建触发器, 回填现有 pages 数据。
function runFtsDecoupleMigration(db) {
  // 1. 丢弃旧 FTS 表与旧触发器 (IF EXISTS 容错首次安装)
  db.exec(`DROP TABLE IF EXISTS pages_fts;`);
  db.exec(`DROP TRIGGER IF EXISTS pages_ai;`);
  db.exec(`DROP TRIGGER IF EXISTS pages_ad;`);
  db.exec(`DROP TRIGGER IF EXISTS pages_au;`);
  // 2. 建自包含 FTS (page_id 不参与全文索引, 仅作关联键)
  db.exec(`CREATE VIRTUAL TABLE pages_fts USING fts5(
    page_id UNINDEXED, title, content, markdown, tokenize = 'unicode61'
  );`);
  // 3. 回填现有 pages 数据
  db.exec(`INSERT INTO pages_fts(page_id, title, content, markdown)
    SELECT id, title, content, markdown FROM pages;`);
  // 4. 重建触发器 (与 getInitialSchema 同步, 按 page_id 维护)
  // 注意: 自包含 FTS 不可用 'delete' 特殊命令, 直接按 page_id DELETE/INSERT。
  db.exec(`CREATE TRIGGER pages_ai AFTER INSERT ON pages BEGIN
    INSERT INTO pages_fts(page_id, title, content, markdown)
    VALUES (new.id, new.title, new.content, new.markdown);
  END;`);
  db.exec(`CREATE TRIGGER pages_ad AFTER DELETE ON pages BEGIN
    DELETE FROM pages_fts WHERE page_id = old.id;
  END;`);
  db.exec(`CREATE TRIGGER pages_au AFTER UPDATE ON pages BEGIN
    DELETE FROM pages_fts WHERE page_id = old.id;
    INSERT INTO pages_fts(page_id, title, content, markdown)
    VALUES (new.id, new.title, new.content, new.markdown);
  END;`);
  console.log('  [迁移] pages_fts 已解耦 rowid, 改用 page_id UNINDEXED 关联');
}

// A7 修复补充: 014 建的 pages_ad/pages_au 触发器误用 FTS5 'delete' 特殊命令,
// 自包含表上会致 DELETE/UPDATE pages 报 "SQL logic error"。本迁移重建为按 page_id 直接删除。
function runFtsTriggerFixMigration(db) {
  db.exec(`DROP TRIGGER IF EXISTS pages_ai;`);
  db.exec(`DROP TRIGGER IF EXISTS pages_ad;`);
  db.exec(`DROP TRIGGER IF EXISTS pages_au;`);
  db.exec(`CREATE TRIGGER pages_ai AFTER INSERT ON pages BEGIN
    INSERT INTO pages_fts(page_id, title, content, markdown)
    VALUES (new.id, new.title, new.content, new.markdown);
  END;`);
  db.exec(`CREATE TRIGGER pages_ad AFTER DELETE ON pages BEGIN
    DELETE FROM pages_fts WHERE page_id = old.id;
  END;`);
  db.exec(`CREATE TRIGGER pages_au AFTER UPDATE ON pages BEGIN
    DELETE FROM pages_fts WHERE page_id = old.id;
    INSERT INTO pages_fts(page_id, title, content, markdown)
    VALUES (new.id, new.title, new.content, new.markdown);
  END;`);
  // 自包含 FTS 在 014 回填后可能存在孤立/重复行, 重建一次保证一致
  db.exec(`DELETE FROM pages_fts;`);
  db.exec(`INSERT INTO pages_fts(page_id, title, content, markdown)
    SELECT id, title, content, markdown FROM pages;`);
  console.log('  [迁移] pages_fts 触发器修正: 自包含表改用 page_id 直接删除 (修复 DELETE 报错)');
}

// A8 修复: 三路 RAG 合一。ai.js 内联索引 + rag.js 写 rag_index 表, rag-hybrid 写 rag_chunks 表,
// 同一页面被双表各索引一遍, 数据分叉、检索路径不一致 (rag_index 无 BM25/FTS 融合)。
// 本迁移将 rag_index 存量数据归并进 rag_chunks (统一存储), 再保留 rag_index 表兼容旧读 (渐进迁移)。
// 新写入一律走 rag_chunks (rag 服务层统一), rag_index 不再写入。幂等: 重复跑不重复归并。
function runRagUnifyMigration(db) {
  // 归并 rag_index → rag_chunks (仅搬未在 rag_chunks 出现的 page, 防重复)
  // rag_index 列: (id, page_id, chunk_index, chunk, vector, created_at)
  // rag_chunks 列: (id, page_id, chunk_index, chunk_text, chunk_type, heading, vector, bm25_tokens, created_at)
  try {
    const existing = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='rag_index'").get();
    if (!existing) {
      console.log('  [迁移] rag_unify: rag_index 不存在, 跳过归并');
      return;
    }
    const orphan = db.prepare(`
      SELECT ri.id, ri.page_id, ri.chunk_index, ri.chunk, ri.vector, ri.created_at
      FROM rag_index ri
      WHERE NOT EXISTS (
        SELECT 1 FROM rag_chunks rc WHERE rc.page_id = ri.page_id AND rc.chunk_index = ri.chunk_index
      )
    `).all();
    if (!orphan.length) {
      console.log('  [迁移] rag_unify: rag_index 已全部归并进 rag_chunks, 无孤儿行');
      return;
    }
    const insert = db.prepare(`
      INSERT INTO rag_chunks (id, page_id, chunk_index, chunk_text, chunk_type, heading, vector, bm25_tokens, created_at)
      VALUES (?, ?, ?, ?, 'paragraph', NULL, ?, '[]', ?)
    `);
    const tx = db.transaction((rows) => {
      for (const r of rows) {
        insert.run(r.id, r.page_id, r.chunk_index, r.chunk, r.vector, r.created_at);
      }
    });
    tx(orphan);
    console.log(`  [迁移] rag_unify: 归并 ${orphan.length} 行 rag_index → rag_chunks (统一存储)`);
  } catch (e) {
    // 归并失败不阻断启动 (rag_index 表结构可能已被旧版 ai.js 改动), 仅告警
    console.warn(`  [迁移] rag_unify 归并跳过: ${e.message}`);
  }
}