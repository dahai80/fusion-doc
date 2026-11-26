// =============================================================================
// Fusion-Doc — database core
// SQLite primary storage + JSON file fallback, with a migration system
// Modeled on the DocMost Prisma + Wiki.js database layer design
// =============================================================================

const fs = require('fs');
const path = require('path');
const config = require('./config');

let db = null;
const DB_DIR = path.join(config.dataDir, 'db');
const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

// ── Initialize database ─────────────────────────────────────────────────
function initDB() {
  try {
    const Database = require('better-sqlite3');
    fs.mkdirSync(DB_DIR, { recursive: true });
    db = new Database(path.join(DB_DIR, 'fusion-doc.db'));
    // Multi-process hardening: busy_timeout must be set first so every later pragma/write queues on a lock instead of failing with BUSY immediately.
    // The default 5000ms easily hits SQLITE_BUSY during concurrent multi-process startup (migration lock contention) and wrongly falls back to JSON, so raise it to 10000ms.
    db.pragma('busy_timeout = 10000');
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.pragma('cache_size = -64000'); // 64MB cache

    // Run schema migrations (multi-process safe: BEGIN IMMEDIATE grabs the write lock, busy_retry queues)
    runMigrations();

    console.log('  [DB] SQLite initialized successfully');
    return db;
  } catch (e) {
    console.log(`  [DB] SQLite unavailable: ${e.message}, using JSON file storage`);
    db = null;
    return null;
  }
}

// ── Migration system ────────────────────────────────────────────────────
// Multi-process hardening: grab the write lock (BEGIN IMMEDIATE) to serialize concurrent migrations.
// When several processes start at once → only one gets the write lock and runs migrations; the rest retry on BUSY (busy_timeout as backstop).
// Failing to get the lock beyond busy_timeout still throws (fail visibly) instead of silently serving with an old schema.
function _acquireMigrateLock() {
  const maxRetry = 60; // retry at most 60 × 200ms = 12s (covers busy_timeout 10s)
  for (let i = 0; i < maxRetry; i++) {
    try {
      db.exec('BEGIN IMMEDIATE');
      return true;
    } catch (e) {
      if (e.code === 'SQLITE_BUSY' || /database is locked/.test(e.message)) {
        // Wait 200ms and retry, letting the lock holder finish migrating
        const slept = Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
        void slept;
        continue;
      }
      throw e; // not a busy-lock error, rethrow
    }
  }
  return false;
}

function runMigrations() {
  if (!db) return;

  // Create the migrations tracking table
  db.exec(`CREATE TABLE IF NOT EXISTS _migrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    applied_at TEXT DEFAULT (datetime('now'))
  )`);

  // Multi-process: grab the write lock to run migrations (other processes queue while it is held)
  if (!_acquireMigrateLock()) {
    throw new Error('Timed out acquiring database migration lock (concurrent multi-process startup, write lock not obtained within busy_timeout)');
  }

  try {
    // Run migrations in order
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
      // A2 fix: append-only update log table. Replaces the read-modify-write of the single-row state in yjs_docs,
      // eliminating lost updates when multiple clients concurrently SELECT the old state and each concat + UPDATE.
      { name: '012_yjs_updates', sql: getYjsUpdatesSchema() },
      { name: '013_yjs_state_seq', fn: runYjsStateSeqMigration },
      // A7 fix: pages_fts changed from external-content(rowid) to self-contained (page_id UNINDEXED).
      // Rebuild the FTS table + triggers, backfill from existing pages, removing the rowid-mismatch risk.
      { name: '014_fts_decouple_rowid', fn: runFtsDecoupleMigration },
      // A7 follow-up fix: the pages_ad/pages_au triggers from 014 misused the 'delete' special command,
      // which makes pages DELETE/UPDATE fail with "SQL logic error" on a self-contained FTS table. Rebuilt to delete by page_id directly.
      { name: '015_fts_trigger_fix', fn: runFtsTriggerFixMigration },
      // A8 fix: unify the three RAG paths. ai.js inline + rag.js used the rag_index table, rag-hybrid used rag_chunks,
      // so data forked and reindexing cost doubled. Unified on rag_chunks; rag_index is deprecated (archived by the down migration).
      // Only bumps the applied count; the actual merge is done by the rag service layer writing rag_chunks, so no DDL here (idempotent placeholder).
      { name: '016_rag_unify', fn: runRagUnifyMigration },
      // Large-KB fix: sqlite-vec ANN vector index. rag_chunks.id is TEXT but vec0 needs an integer primary key,
      // so create two tables: rag_chunks_vec (vec0, auto-increment rowid) + rag_vec_map (rowid↔chunk_id TEXT).
      // Vector writes go to both (rag_chunks.vector for fallback compatibility + rag_chunks_vec for ANN retrieval).
      // Skipped when the extension is missing (falls back to a linear scan, compatible with zero-dep environments).
      { name: '017_rag_vec_index', fn: runRagVecIndexMigration },
      // issue #45: tenant isolation. workspaces/pages/books get a tenant_id column; existing rows backfilled to local-tenant.
      // Queries filter by req.user.tid (medium tier); controllers fill tenant_id on write.
      { name: '018_tenant_isolation', fn: runTenantIsolationMigration },
      // issue #69 P3: rolling page summary. When a long document is saved, a ≤400-char summary is generated asynchronously and stored on the page;
      // copilot buildContext uses summary + outline + opening excerpt for long documents instead of blindly taking the first 2000 chars.
      { name: '019_page_summary', fn: runPageSummaryMigration },
      // issue #73: collections backend. collections + collection_pages (FK cascade),
      // tenant_id column backfilled local-tenant (same tier as migration 018).
      { name: '020_collections', fn: runCollectionsMigration },
    ];

    for (const migration of migrations) {
      if (applied.has(migration.name)) continue;
      // E3 fix: make each migration atomic with a SAVEPOINT. DDL is transactional in SQLite (CREATE/DROP/ALTER can all roll back);
      // on failure it throws before RELEASE → ROLLBACK undoes the statements this migration already ran, leaving no half-applied schema.
      // The _migrations record shares the DDL transaction, so applied is recorded only on full success; a crash mid-way won't be mistaken for migrated on restart.
      db.exec('SAVEPOINT fd_migration');
      try {
        if (migration.fn) {
          migration.fn(db);
        } else {
          db.exec(migration.sql);
        }
        db.prepare('INSERT INTO _migrations (name) VALUES (?)').run(migration.name);
        db.exec('RELEASE fd_migration');
        console.log(`  [Migration] ${migration.name} ✓`);
      } catch (e) {
        // Production-grade fail visibly: migration failures must not be swallowed; throw to prevent starting in a broken state (P2-19)
        // E3 fix: roll back this migration's partial DDL to keep the DB consistent, then throw.
        db.exec('ROLLBACK TO fd_migration');
        db.exec('RELEASE fd_migration');
        console.error(`  [Migration] ${migration.name} ✗ ${e.message}`);
        throw new Error(`Database migration ${migration.name} failed: ${e.message}`);
      }
    }
  } finally {
    // Release the write lock (whether or not migrations succeeded)
    try { db.exec('COMMIT'); } catch (_) { /* already rolled back or no active transaction */ }
  }
}

// E3 fix: down-migration. Roll back a single migration by name (best-effort DROP, does not restore business data).
// For ops to revert the schema after a mistaken migration; callers: console scripts / a future admin endpoint. Not run automatically by initDB.
// eslint-disable-next-line no-unused-vars
function migrateDown(name) {
  if (!db) throw new Error('DB not available');
  const downMap = {
    '008_rag_chunks': 'DROP TABLE IF EXISTS rag_chunks;',
    '010_collaboration': 'DROP TABLE IF EXISTS yjs_docs;',
    '012_yjs_updates': 'DROP TABLE IF EXISTS yjs_updates;',
  };
  const sql = downMap[name];
  if (!sql) throw new Error(`No down-migration: ${name}`);
  db.exec('SAVEPOINT fd_down');
  try {
    db.exec(sql);
    db.prepare('DELETE FROM _migrations WHERE name = ?').run(name);
    db.exec('RELEASE fd_down');
    console.log(`  [Migration] rolled back ${name} ✓`);
  } catch (e) {
    db.exec('ROLLBACK TO fd_down');
    db.exec('RELEASE fd_down');
    throw new Error(`Rollback of ${name} failed: ${e.message}`);
  }
}

// ── Schema definition ───────────────────────────────────────────────────
function getInitialSchema() {
  return `
    -- Users (modeled on Wiki.js multi-auth design)
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
      password TEXT NOT NULL, role TEXT DEFAULT 'user',
      avatar TEXT, provider TEXT DEFAULT 'local',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- Workspaces (modeled on DocMost spaces)
    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT UNIQUE NOT NULL,
      description TEXT DEFAULT '', logo TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- Bookshelves (modeled on BookStack book → chapter → page hierarchy)
    CREATE TABLE IF NOT EXISTS books (
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL,
      name TEXT NOT NULL, slug TEXT NOT NULL,
      description TEXT DEFAULT '', sort_order REAL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
    );

    -- Chapters
    CREATE TABLE IF NOT EXISTS chapters (
      id TEXT PRIMARY KEY, book_id TEXT NOT NULL,
      name TEXT NOT NULL, slug TEXT NOT NULL,
      description TEXT DEFAULT '', sort_order REAL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (book_id) REFERENCES books(id)
    );

    -- Pages (DocMost + BookStack combined)
    CREATE TABLE IF NOT EXISTS pages (
      id TEXT PRIMARY KEY, workspace_id TEXT,
      book_id TEXT, chapter_id TEXT,
      title TEXT NOT NULL, slug TEXT NOT NULL,
      content TEXT DEFAULT '', markdown TEXT DEFAULT '',
      summary TEXT DEFAULT '',
      summary_source_len INTEGER DEFAULT 0,
      editor_mode TEXT DEFAULT 'rich-text',
      parent_id TEXT, sort_order REAL DEFAULT 0,
      created_by TEXT, is_published INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (book_id) REFERENCES books(id),
      FOREIGN KEY (chapter_id) REFERENCES chapters(id)
    );

    -- Collections (issue #73: cross-book page grouping layer)
    CREATE TABLE IF NOT EXISTS collections (
      id TEXT PRIMARY KEY,
      tenant_id TEXT DEFAULT 'local-tenant',
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      created_by TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS collection_pages (
      collection_id TEXT NOT NULL,
      page_id TEXT NOT NULL,
      added_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (collection_id, page_id),
      FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE CASCADE,
      FOREIGN KEY (page_id) REFERENCES pages(id) ON DELETE CASCADE
    );

    -- Page revision history
    CREATE TABLE IF NOT EXISTS page_versions (
      id TEXT PRIMARY KEY, page_id TEXT NOT NULL,
      title TEXT NOT NULL, content TEXT DEFAULT '',
      version INTEGER DEFAULT 1, created_by TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (page_id) REFERENCES pages(id)
    );

    -- Tags
    CREATE TABLE IF NOT EXISTS tags (
      id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE,
      color TEXT DEFAULT '#6366f1', created_at TEXT DEFAULT (datetime('now'))
    );

    -- Page-tag associations
    CREATE TABLE IF NOT EXISTS page_tags (
      page_id TEXT NOT NULL, tag_id TEXT NOT NULL,
      PRIMARY KEY (page_id, tag_id),
      FOREIGN KEY (page_id) REFERENCES pages(id),
      FOREIGN KEY (tag_id) REFERENCES tags(id)
    );

    -- Bidirectional links
    CREATE TABLE IF NOT EXISTS page_links (
      id TEXT PRIMARY KEY, source_page_id TEXT NOT NULL,
      target_page_id TEXT NOT NULL,
      link_type TEXT DEFAULT 'reference',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (source_page_id) REFERENCES pages(id),
      FOREIGN KEY (target_page_id) REFERENCES pages(id)
    );

    -- File attachments
    CREATE TABLE IF NOT EXISTS files (
      id TEXT PRIMARY KEY, name TEXT NOT NULL,
      path TEXT NOT NULL, mime TEXT NOT NULL,
      size INTEGER DEFAULT 0, page_id TEXT,
      encrypted INTEGER DEFAULT 0,
      created_by TEXT, created_at TEXT DEFAULT (datetime('now'))
    );

    -- Comments
    CREATE TABLE IF NOT EXISTS comments (
      id TEXT PRIMARY KEY, page_id TEXT NOT NULL,
      user_id TEXT NOT NULL, content TEXT NOT NULL,
      parent_id TEXT, created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (page_id) REFERENCES pages(id)
    );

    -- Favorites
    CREATE TABLE IF NOT EXISTS favorites (
      user_id TEXT NOT NULL, page_id TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, page_id)
    );

    -- System settings
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY, value TEXT NOT NULL
    );

    -- Full-text search index (SQLite FTS5, A7 fix: decoupled from rowid)
    -- pages has a TEXT(id) primary key; the implicit rowid gets renumbered after a VACUUM/ALTER rebuild,
    -- so external-content(content_rowid=rowid) would point at the wrong row → search returns the wrong page.
    -- Switched to a self-contained FTS, explicitly linked via page_id(UNINDEXED), independent of rowid.
    CREATE VIRTUAL TABLE IF NOT EXISTS pages_fts USING fts5(
      page_id UNINDEXED, title, content, markdown, tokenize = 'unicode61'
    );

    -- FTS triggers (synced by page_id, independent of rowid)
    -- Note: a self-contained FTS (no content= external table) cannot use the 'delete' special command
    -- (only external-content tables support it; self-contained tables raise SQL logic error).
    -- The delete/update triggers delete by page_id directly, then insert.
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

    -- Indexes
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

// ── JSON file fallback storage ──────────────────────────────────────────
// ID validation: reject IDs containing path separators/traversal sequences to prevent path traversal (P3-30)
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
    console.warn(`  [DB] writeJSON rejected invalid dir/id: dir=${dir} id=${id}`);
    return;
  }
  const d = path.join(DB_DIR, 'json', dir);
  fs.mkdirSync(d, { recursive: true });
  // R7 fix: atomic write (temp file + rename) so a crash leaves no truncated JSON; the old writeFileSync corrupted data if it crashed mid-write
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

// ── 011: add UNIQUE to vocabulary.name (P2-21) ──────────────────────────
// The schema already declares UNIQUE; this migration handles existing duplicates: keep the earliest row, delete duplicates, then create a UNIQUE index as a backstop
function runVocabularyUniqueMigration(database) {
  // Clean up existing duplicate names: keep only the row with the smallest created_at per name
  database.exec(`
    DELETE FROM vocabulary WHERE id NOT IN (
      SELECT id FROM (
        SELECT id, ROW_NUMBER() OVER (PARTITION BY name ORDER BY created_at ASC) AS rn FROM vocabulary
      ) WHERE rn = 1
    )
  `);
  // Backstop unique index (skipped by CREATE UNIQUE INDEX IF NOT EXISTS if the schema's UNIQUE constraint already exists)
  try {
    database.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_vocabulary_name ON vocabulary(name)');
  } catch (e) {
    console.warn('  [Migration] 011_vocabulary_unique index skipped:', e.message);
  }
}

function getDB() { return db; }

// ── sqlite-vec ANN extension loading (large-KB fix) ─────────────────────
// The vec0 virtual table provides approximate nearest neighbor (KNN), lifting the scale limit of a linear vector scan. Falls back to a linear scan if the extension is missing (compatible).
// The load state is cached so the rag-hybrid retrieval path can decide whether to use ANN.
let _vecLoaded = false;
function isVecLoaded() { return _vecLoaded; }
function loadVecExtension(database) {
  if (_vecLoaded) return true;
  try {
    const sqliteVec = require('sqlite-vec');
    sqliteVec.load(database);
    _vecLoaded = true;
    console.log('  [DB] sqlite-vec extension loaded (ANN vector index available)');
    return true;
  } catch (e) {
    console.warn(`  [DB] sqlite-vec extension unavailable, RAG vector retrieval falls back to linear scan: ${e.message}`);
    _vecLoaded = false;
    return false;
  }
}

// Data backup: online hot backup with better-sqlite3's native .backup() (WAL-safe, does not block writes)
// Resolves to the absolute path of the backup file; throws on failure (production-grade fail visibly)
async function backupDB(destDir) {
  if (!db) throw new Error('Database not initialized, cannot back up');
  const fs = require('fs');
  const targetDir = destDir || path.join(DB_DIR, 'backups');
  fs.mkdirSync(targetDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = path.join(targetDir, `fusion-doc-${stamp}.db`);
  await db.backup(dest);
  console.log(`  [Backup] Database backed up: ${dest}`);
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

module.exports = { initDB, getDB, db, readJSON, writeJSON, listJSON, deleteJSON, backupDB, migrateDown, loadVecExtension, isVecLoaded };

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

// A2 fix: Yjs append-only update log.
// Each update is its own INSERT (atomic write, no read-modify-write), replayed in auto-increment seq order.
// Yjs updates are commutative + idempotent, so replaying by seq yields a valid CRDT state with no lost updates.
// compaction_flag marks old rows already compacted into yjs_docs.state, for easy cleanup.
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

// A2 companion: add a state_seq column to yjs_docs recording the max update seq covered by the compacted snapshot.
// SQLite 11+ supports ADD COLUMN, but older DBs lack ALTER TABLE IF NOT EXISTS, so probe with PRAGMA.
function runYjsStateSeqMigration(db) {
  const cols = db.prepare("PRAGMA table_info(yjs_docs)").all().map(c => c.name);
  if (!cols.includes('state_seq')) {
    db.exec('ALTER TABLE yjs_docs ADD COLUMN state_seq INTEGER DEFAULT 0');
    console.log('  [Migration] yjs_docs.state_seq column added');
  }
}

// A7 fix: decouple pages_fts from rowid. The old table used external-content(content_rowid=rowid);
// pages has a TEXT primary key and the implicit rowid is renumbered after a VACUUM/ALTER rebuild → search hits the wrong page.
// Rebuild as a self-contained FTS (page_id UNINDEXED), rebuild the triggers, and backfill existing pages.
function runFtsDecoupleMigration(db) {
  // 1. Drop the old FTS table and old triggers (IF EXISTS tolerates a fresh install)
  db.exec(`DROP TABLE IF EXISTS pages_fts;`);
  db.exec(`DROP TRIGGER IF EXISTS pages_ai;`);
  db.exec(`DROP TRIGGER IF EXISTS pages_ad;`);
  db.exec(`DROP TRIGGER IF EXISTS pages_au;`);
  // 2. Create the self-contained FTS (page_id is not full-text indexed, only used as the join key)
  db.exec(`CREATE VIRTUAL TABLE pages_fts USING fts5(
    page_id UNINDEXED, title, content, markdown, tokenize = 'unicode61'
  );`);
  // 3. Backfill existing pages
  db.exec(`INSERT INTO pages_fts(page_id, title, content, markdown)
    SELECT id, title, content, markdown FROM pages;`);
  // 4. Rebuild triggers (kept in sync with getInitialSchema, maintained by page_id)
  // Note: a self-contained FTS cannot use the 'delete' special command; DELETE/INSERT by page_id directly.
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
  console.log('  [Migration] pages_fts decoupled from rowid, now linked via page_id UNINDEXED');
}

// A7 follow-up fix: the pages_ad/pages_au triggers created by 014 misused the FTS5 'delete' special command,
// which makes DELETE/UPDATE on pages fail with "SQL logic error" on a self-contained table. This migration rebuilds them to delete by page_id directly.
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
  // The self-contained FTS may have orphan/duplicate rows after the 014 backfill; rebuild once to ensure consistency
  db.exec(`DELETE FROM pages_fts;`);
  db.exec(`INSERT INTO pages_fts(page_id, title, content, markdown)
    SELECT id, title, content, markdown FROM pages;`);
  console.log('  [Migration] pages_fts trigger fix: self-contained table now deletes by page_id directly (fixes DELETE error)');
}

// A8 fix: unify the three RAG paths. ai.js inline indexing + rag.js wrote the rag_index table, rag-hybrid wrote rag_chunks,
// so the same page was indexed once in each table, forking data and making retrieval paths inconsistent (rag_index has no BM25/FTS fusion).
// This migration merges existing rag_index data into rag_chunks (unified storage) and keeps the rag_index table for legacy reads (gradual migration).
// All new writes go to rag_chunks (unified in the rag service layer); rag_index is no longer written. Idempotent: rerunning does not merge twice.
function runRagUnifyMigration(db) {
  // Merge rag_index → rag_chunks (only pages not already in rag_chunks, to avoid duplicates)
  // rag_index columns: (id, page_id, chunk_index, chunk, vector, created_at)
  // rag_chunks columns: (id, page_id, chunk_index, chunk_text, chunk_type, heading, vector, bm25_tokens, created_at)
  try {
    const existing = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='rag_index'").get();
    if (!existing) {
      console.log('  [Migration] rag_unify: rag_index does not exist, skipping merge');
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
      console.log('  [Migration] rag_unify: rag_index fully merged into rag_chunks, no orphan rows');
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
    console.log(`  [Migration] rag_unify: merged ${orphan.length} rows rag_index → rag_chunks (unified storage)`);
  } catch (e) {
    // A failed merge does not block startup (the rag_index schema may have been altered by an old ai.js); warn only
    console.warn(`  [Migration] rag_unify merge skipped: ${e.message}`);
  }
}

// ── 017: sqlite-vec ANN vector index (large-KB fix) ─────────────────────
// rag_chunks.id is TEXT and vec0 only accepts an integer rowid primary key → create rag_chunks_vec (vec0, auto-increment rowid)
// + rag_vec_map (vec_rowid INTEGER ↔ chunk_id TEXT) mapping back to rag_chunks.
// Dimension read from env AI_EMBEDDING_DIM (default 384, bge-small-en-v1.5). Existing vectors are backfilled into the vec table.
// If the extension fails to load, skip table creation (linear-scan fallback) without blocking startup — _vecLoaded=false, rag-hybrid uses the old path.
function runRagVecIndexMigration(database) {
  const loaded = loadVecExtension(database);
  if (!loaded) {
    console.log('  [Migration] 017_rag_vec_index skipped: sqlite-vec extension unavailable (linear-scan fallback)');
    return;
  }
  const dim = parseInt(process.env.AI_EMBEDDING_DIM || '384', 10);
  if (!Number.isFinite(dim) || dim <= 0) {
    throw new Error(`Invalid AI_EMBEDDING_DIM: ${dim}`);
  }
  // vec0 virtual table (integer rowid primary key + embedding float[dim])
  database.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS rag_chunks_vec USING vec0(embedding float[${dim}]);`);
  // Mapping table: vec_rowid (rag_chunks_vec.rowid) ↔ chunk_id (rag_chunks.id TEXT)
  database.exec(`CREATE TABLE IF NOT EXISTS rag_vec_map (
    vec_rowid INTEGER PRIMARY KEY,
    chunk_id TEXT NOT NULL UNIQUE
  );`);
  // Backfill existing vectors (rag_chunks.vector JSON → rag_chunks_vec + rag_vec_map)
  const existing = database.prepare("SELECT id, vector FROM rag_chunks WHERE vector IS NOT NULL").all();
  if (existing.length === 0) {
    console.log(`  [Migration] 017_rag_vec_index: vec0 table created (dim=${dim}), no existing vectors to backfill`);
    return;
  }
  const insVec = database.prepare("INSERT INTO rag_chunks_vec(embedding) VALUES (?)");
  const insMap = database.prepare("INSERT OR IGNORE INTO rag_vec_map(vec_rowid, chunk_id) VALUES (?, ?)");
  let filled = 0, skipped = 0;
  const tx = database.transaction(() => {
    for (const r of existing) {
      let v;
      try { v = JSON.parse(r.vector); } catch { skipped++; continue; }
      if (!Array.isArray(v) || v.length !== dim) { skipped++; continue; }
      const info = insVec.run(new Float32Array(v));
      insMap.run(info.lastInsertRowid, r.id);
      filled++;
    }
  });
  tx();
  console.log(`  [Migration] 017_rag_vec_index: vec0 table created (dim=${dim}), backfilled ${filled} vectors (${skipped} skipped: dimension mismatch/parse failure)`);
}

// ── 018: tenant isolation (issue #45) ───────────────────────────────────
// fusion-identity is the sole tenant registry; workspaces/pages/books gain a tenant_id column,
// and all queries filter by req.user.tid (medium tier: tenant_id column + guard).
// Existing rows are backfilled to 'local-tenant' (compatible with local-bypass single-user data); new rows get req.user.tid from the controller.
// ALTER TABLE ADD COLUMN does not support IF NOT EXISTS → check pragma first to avoid errors on repeated migration.
function runTenantIsolationMigration(database) {
  const cols = (table) => database.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
  const addIfMissing = (table, col, def = "TEXT DEFAULT 'local-tenant'") => {
    if (!cols(table).includes(col)) {
      database.exec(`ALTER TABLE ${table} ADD COLUMN tenant_id ${def};`);
      console.log(`  [Migration] 018_tenant_isolation: ${table} +tenant_id`);
    }
  };
  addIfMissing('workspaces', 'tenant_id');
  addIfMissing('pages', 'tenant_id');
  addIfMissing('books', 'tenant_id');
  addIfMissing('chapters', 'tenant_id');
  // Backfill existing rows (NULL → local-tenant)
  for (const t of ['workspaces', 'pages', 'books', 'chapters']) {
    const n = database.prepare(`UPDATE ${t} SET tenant_id = 'local-tenant' WHERE tenant_id IS NULL`).run().changes;
    if (n) console.log(`  [Migration] 018_tenant_isolation: ${t} backfilled ${n} rows → local-tenant`);
  }
  // Tenant isolation indexes (speed up composite tenant_id + workspace_id queries)
  database.exec('CREATE INDEX IF NOT EXISTS idx_pages_tenant ON pages(tenant_id);');
  database.exec('CREATE INDEX IF NOT EXISTS idx_books_tenant ON books(tenant_id);');
  database.exec('CREATE INDEX IF NOT EXISTS idx_workspaces_tenant ON workspaces(tenant_id);');
  database.exec('CREATE INDEX IF NOT EXISTS idx_chapters_tenant ON chapters(tenant_id);');
}

// ── 020: collections (issue #73) ─────────────────────────────────────────
// Collections group pages across books (social/organizational layer, issue #71/#73).
// Membership table uses FK cascade so collection/page deletes clean up automatically.
function runCollectionsMigration(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS collections (
      id TEXT PRIMARY KEY,
      tenant_id TEXT DEFAULT 'local-tenant',
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      created_by TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS collection_pages (
      collection_id TEXT NOT NULL,
      page_id TEXT NOT NULL,
      added_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (collection_id, page_id),
      FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE CASCADE,
      FOREIGN KEY (page_id) REFERENCES pages(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_collections_tenant ON collections(tenant_id);
  `);
  const cols = database.prepare('PRAGMA table_info(collections)').all().map(c => c.name);
  if (!cols.includes('tenant_id')) {
    database.exec("ALTER TABLE collections ADD COLUMN tenant_id TEXT DEFAULT 'local-tenant';");
  }
  const n = database.prepare("UPDATE collections SET tenant_id = 'local-tenant' WHERE tenant_id IS NULL").run().changes;
  if (n) console.log(`  [migration] 020_collections: backfilled ${n} rows -> local-tenant`);
  console.log('  [migration] 020_collections: collections + collection_pages ready');
}

// ── 019: rolling page summary (issue #69 P3) ────────────────────────────
// pages +summary (≤400-char summary) + summary_source_len (plain-text length of the source at generation time, used to detect staleness).
// Generated asynchronously by services/page-summary.js on save; DDL only here.
// ALTER TABLE ADD COLUMN does not support IF NOT EXISTS → check pragma first (same as 018).
function runPageSummaryMigration(database) {
  const cols = database.prepare('PRAGMA table_info(pages)').all().map(c => c.name);
  if (!cols.includes('summary')) {
    database.exec("ALTER TABLE pages ADD COLUMN summary TEXT DEFAULT '';");
    console.log('  [Migration] 019_page_summary: pages +summary');
  }
  if (!cols.includes('summary_source_len')) {
    database.exec('ALTER TABLE pages ADD COLUMN summary_source_len INTEGER DEFAULT 0;');
    console.log('  [Migration] 019_page_summary: pages +summary_source_len');
  }
}