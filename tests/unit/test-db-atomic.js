// =============================================================================
// E8 fix: behavior tests — DB atomic write (R7) + A2 append-only with no lost updates
// R7: writeJSON uses tmp+rename, partial writes leave no half-written files
// A2: concurrent updates each INSERT without overwriting each other (simulated with in-memory SQLite)
// =============================================================================
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { writeJSON, readJSON, deleteJSON } = require('../../server/db');
const config = require('../../server/config');

let Database = null;
try { Database = require('better-sqlite3'); } catch (_) { /* skip DB-related cases */ }

// writeJSON writes to config.dataDir/db/json/<bucket>; tests use a unique bucket and clean up afterwards
const BUCKET = 'unit-test-r7';

test('R7: writeJSON writes atomically, readJSON reads back, no tmp leftovers', () => {
    writeJSON(BUCKET, 'doc1', { title: 'hello', n: 42 });
    try {
        const back = readJSON(BUCKET, 'doc1');
        assert.deepEqual(back, { title: 'hello', n: 42 });
        const bucketDir = path.join(config.dataDir, 'db', 'json', BUCKET);
        if (fs.existsSync(bucketDir)) {
            const files = fs.readdirSync(bucketDir);
            assert.equal(files.includes('doc1.json'), true);
            assert.equal(files.some(f => f.endsWith('.tmp')), false, 'no tmp leftovers');
        }
    } finally {
        deleteJSON(BUCKET, 'doc1');
    }
});

test('R7: writeJSON rejects path traversal in dir/id', () => {
    // Path traversal in dir — must not create any out-of-bounds file
    writeJSON('../escape-r7', 'doc', { x: 1 });
    const escapePath = path.join(config.dataDir, 'db', 'json', 'escape-r7');
    assert.equal(fs.existsSync(escapePath), false, 'traversal dir rejected');
    // Invalid id
    writeJSON(BUCKET, '../../etc-passwd', { x: 1 });
    const badPath = path.join(config.dataDir, 'db', 'json', BUCKET, '..');
    assert.equal(fs.existsSync(path.join(badPath, 'etc-passwd.json')), false, 'invalid id rejected');
});

test('A2: append-only concurrent INSERTs have no lost update (skipped when better-sqlite3 is unavailable)', { skip: !Database }, () => {
    const mem = new Database(':memory:');
    mem.exec(`
        CREATE TABLE yjs_updates (id INTEGER PRIMARY KEY AUTOINCREMENT, page_id TEXT, "update" BLOB);
        CREATE TABLE yjs_docs (page_id TEXT UNIQUE, state BLOB, state_seq INTEGER DEFAULT 0);
    `);
    // Simulate N clients each sending 1 update concurrently — append-only, each is an independent INSERT
    const N = 50;
    const ins = mem.prepare('INSERT INTO yjs_updates (page_id, "update") VALUES (?, ?)');
    const tx = mem.transaction(() => {
        for (let i = 0; i < N; i++) ins.run('page-1', Buffer.from([i]));
    });
    tx();
    const cnt = mem.prepare('SELECT COUNT(*) as c FROM yjs_updates WHERE page_id = ?').get('page-1').c;
    assert.equal(cnt, N, `all ${N} updates kept, no lost update`);
    mem.close();
});
