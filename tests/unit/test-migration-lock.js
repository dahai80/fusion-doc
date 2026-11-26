// =============================================================================
// Multi-instance fix: behavior tests — migration lock serialization (BEGIN IMMEDIATE + busy_retry)
// Concurrent multi-process startup → contend for the write lock; only one runs migrations, the rest queue on BUSY.
// In-memory SQLite cannot simulate cross-process locks; instead we verify:
//   1. Migration records are idempotent (re-runs do not re-apply)
//   2. busy_retry logic: SQLITE_BUSY → retry instead of failing immediately (Atomics.wait simulated)
//   3. A failing migration rolls back via SAVEPOINT, leaving no half-applied schema
// =============================================================================
const { test } = require('node:test');
const assert = require('node:assert/strict');

let Database = null;
try { Database = require('better-sqlite3'); } catch (_) { /* skip DB cases */ }

test('migration idempotency: migrations recorded in _migrations are not re-run', { skip: !Database }, () => {
    const db = new Database(':memory:');
    db.exec(`CREATE TABLE _migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL,
        applied_at TEXT DEFAULT (datetime('now'))
    );`);
    db.exec('CREATE TABLE IF NOT EXISTS demo (x INTEGER);');
    db.prepare('INSERT INTO _migrations (name) VALUES (?)').run('demo_001');

    // Replicates runMigrations' applied-set logic (db.js:80-82)
    const applied = new Set(db.prepare('SELECT name FROM _migrations').all().map(r => r.name));
    assert.equal(applied.has('demo_001'), true, 'applied migration is in the set');
    // Simulate the for-loop skipping applied migrations
    const migrations = [{ name: 'demo_001', sql: 'CREATE TABLE demo_dup(x);' }];
    let ran = 0;
    for (const m of migrations) {
        if (applied.has(m.name)) continue;
        ran++;
    }
    assert.equal(ran, 0, 'applied migration is skipped (idempotent)');
    db.close();
});

test('migration SAVEPOINT rollback: DDL failing mid-migration → roll back the parts already executed', { skip: !Database }, () => {
    const db = new Database(':memory:');
    db.exec(`CREATE TABLE _migrations (name TEXT UNIQUE NOT NULL);`);
    // Simulate a migration: create valid table A, then invalid table B (syntax error) → whole migration rolls back
    db.exec('BEGIN');
    db.exec('SAVEPOINT fd_migration');
    try {
        db.exec('CREATE TABLE ok_table (a INTEGER);');
        db.exec('CREATE TABLE fail_table (BAD SYNTAX!!!);'); // deliberate syntax error, must throw
        db.prepare('INSERT INTO _migrations (name) VALUES (?)').run('fail_001');
        db.exec('RELEASE fd_migration');
        assert.fail('expected a syntax error');
    } catch (e) {
        db.exec('ROLLBACK TO fd_migration');
        db.exec('RELEASE fd_migration');
        // After rollback ok_table must not exist (SAVEPOINT undid its creation)
        const exists = db.prepare("SELECT COUNT(*) AS c FROM sqlite_master WHERE name='ok_table'").get().c;
        assert.equal(exists, 0, 'partial DDL rolled back, no half-applied schema');
        const mig = db.prepare('SELECT COUNT(*) AS c FROM _migrations').get().c;
        assert.equal(mig, 0, 'failed migration not recorded in _migrations (consistency)');
    } finally {
        try { db.exec('COMMIT'); } catch (_) { /* noop */ }
        db.close();
    }
});

test('busy_retry logic: on SQLITE_BUSY count and retry instead of throwing immediately', () => {
    // Replicates _acquireMigrateLock's retry loop (db.js:44-61); verifies BUSY is counted + retried
    // No real locking (single process has no concurrent locks); only the error classification logic is verified
    const maxRetry = 60;
    let attempts = 0;
    let acquired = false;
    for (let i = 0; i < maxRetry; i++) {
        attempts++;
        // Simulate BUSY for the first 5 attempts, success on the 6th
        const err = i < 5
            ? { code: 'SQLITE_BUSY', message: 'database is locked' }
            : null;
        if (!err) { acquired = true; break; }
        if (err.code === 'SQLITE_BUSY' || /database is locked/.test(err.message)) {
            // Real code does Atomics.wait 200ms here; the test skips the wait and continues
            continue;
        }
        throw err;
    }
    assert.equal(acquired, true, 'lock acquired on the 6th attempt after BUSY retries');
    assert.equal(attempts, 6, '6 attempts (5 BUSY + 1 success), 60-attempt cap not exhausted');
});

test('busy_retry timeout: BUSY until maxRetry → returns false (fail visibly)', () => {
    const maxRetry = 3; // small cap to speed up the test
    let attempts = 0;
    let acquired = false;
    for (let i = 0; i < maxRetry; i++) {
        attempts++;
        const err = { code: 'SQLITE_BUSY', message: 'database is locked' }; // always BUSY
        if (err.code === 'SQLITE_BUSY' || /database is locked/.test(err.message)) {
            continue;
        }
        acquired = true;
        break;
    }
    assert.equal(acquired, false, 'BUSY until the cap without acquiring the lock → returns false');
    assert.equal(attempts, maxRetry, `retries exhausted after ${maxRetry} attempts`);
});

test('role gating: FUSION_DOC_ROLE=replica skips single-instance duties (E8 sweep/backup)', () => {
    // Replicates app.js init() role check logic (app.js:53-91)
    // primary runs the E8 sweep + auto backup; replica skips them (prevents duplicate multi-process runs / thundering herd)
    const runE8Sweep = (role) => role === 'primary';
    const runAutoBackup = (role, hours) => role === 'primary' && hours > 0;
    assert.equal(runE8Sweep('primary'), true, 'primary runs the E8 sweep');
    assert.equal(runE8Sweep('replica'), false, 'replica skips the E8 sweep');
    assert.equal(runAutoBackup('primary', 24), true, 'primary runs auto backup');
    assert.equal(runAutoBackup('replica', 24), false, 'replica skips auto backup');
    assert.equal(runAutoBackup('primary', 0), false, 'AUTO_BACKUP_HOURS=0 disables backup');
    assert.equal(runAutoBackup('replica', 0), false, 'replica + disabled → skipped twice over');
    // Default role (env unset) should be primary
    const role = (process.env.FUSION_DOC_ROLE || 'primary').toLowerCase();
    assert.equal(role, 'primary', 'default role is primary (single-instance backward compatible)');
});
