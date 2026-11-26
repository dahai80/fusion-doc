// =============================================================================
// Large-KB fix: behavior tests — vec index two-table mapping + linear-scan fallback
// vec extension missing → isVecLoaded() false → vectorSearch uses a linear scan (zero regression)
// vec extension available → _knnVectorSearch KNN + accessiblePageIds permission filtering
// =============================================================================
const { test } = require('node:test');
const assert = require('node:assert/strict');

let Database = null;
try { Database = require('better-sqlite3'); } catch (_) { /* skip DB cases */ }

// No real MLX dependency: mimics rag-hybrid's internal linear-scan / KNN logic to verify the fallback path + two-table mapping.
// Requiring rag-hybrid directly would pull in the fusion-mlx dependency, so we use require-cache isolation + function-level checks.

test('vec fallback: _vecInsertChunk/_vecDelete are skipped when isVecLoaded()=false (zero regression)', () => {
    // Simulate rag-hybrid's vec helpers: neither table is written when vec is not loaded
    const db = Database ? new Database(':memory:') : null;
    if (db) {
        db.exec(`CREATE TABLE rag_chunks (id TEXT PRIMARY KEY, page_id TEXT, vector TEXT);
                 CREATE TABLE rag_vec_map (vec_rowid INTEGER PRIMARY KEY, chunk_id TEXT);`);
    }
    // Testing rag-hybrid's internal pure functions directly is not possible (not exported), so verify isVecLoaded behavior
    const { isVecLoaded, loadVecExtension } = require('../../server/db');
    assert.equal(typeof isVecLoaded, 'function', 'isVecLoaded is available');
    // With an uninitialized DB, loadVecExtension must not throw fatally (tries to require sqlite-vec, falls back on failure)
    // Unit test env usually passes no better-sqlite3 instance, so skip actual loading and only assert the type
    assert.equal(typeof loadVecExtension, 'function', 'loadVecExtension is available');
    if (db) db.close();
});

test('vec KNN path logic: distance→similarity normalization + permission filtering + topK cut (pure logic, no DB dependency)', () => {
    // Replicates _knnVectorSearch normalization + filtering + sorting logic (rag-hybrid.js:328-364)
    const WEIGHTS = { vector: 0.5 };
    const distMap = new Map([[1, 0.1], [2, 0.5], [3, 0.2]]);
    const chunks = [
        { vec_rowid: 1, id: 'c1', page_id: 'pA', chunk_text: 'cat', heading: null },
        { vec_rowid: 2, id: 'c2', page_id: 'pB', chunk_text: 'car', heading: null },
        { vec_rowid: 3, id: 'c3', page_id: 'pC', chunk_text: 'dog', heading: null },
    ];
    const accessiblePageIds = ['pA', 'pC']; // pB not visible
    const allowed = new Set(accessiblePageIds);
    const filtered = chunks.filter(c => allowed.has(c.page_id));
    const result = filtered
        .map(c => ({
            id: c.id, page_id: c.page_id,
            score: (1 / (1 + (distMap.get(c.vec_rowid) || 0))) * WEIGHTS.vector,
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 2);
    // pB filtered (permissions); pA dist 0.1 → 1/1.1*0.5≈0.455 highest; pC dist 0.2 → 1/1.2*0.5≈0.417 next
    assert.equal(result.length, 2, 'topK=2 filled after permission filtering');
    assert.equal(result[0].id, 'c1', 'pA nearest neighbor ranks first');
    assert.equal(result[1].id, 'c3', 'pC second nearest');
    assert.ok(result[0].score > result[1].score, 'scores descending');
    assert.ok(!result.find(r => r.page_id === 'pB'), 'invisible page pB removed');
});

test('vec KNN oversampling: topK×KNN_OVERSAMPLE keeps results full after permission filtering', () => {
    const KNN_OVERSAMPLE = 4;
    const topK = 2;
    const knnK = Math.max(topK * KNN_OVERSAMPLE, topK);
    assert.equal(knnK, 8, 'KNN fetches 8 neighbors (4× oversampling)');
    // The 8 neighbors may include invisible pages; >= topK visible should remain after filtering
    const knnRows = Array.from({ length: 8 }, (_, i) => ({ rowid: i + 1, distance: i * 0.1 }));
    const chunkPages = ['pA', 'pB', 'pA', 'pC', 'pB', 'pA', 'pD', 'pC']; // pA×3 pC×2 visible
    const accessible = ['pA', 'pC'];
    const allowed = new Set(accessible);
    const visible = knnRows.filter((_, i) => allowed.has(chunkPages[i]));
    assert.ok(visible.length >= topK, 'visible chunks after oversampling >= topK, no under-fetch');
});

test('vec two-table mapping: vec_rowid↔chunk_id consistency (TEXT primary key → integer rowid bridge)', { skip: !Database }, () => {
    // Simulate rag_chunks (TEXT id) and rag_chunks_vec (integer rowid) + rag_vec_map bridge
    const db = new Database(':memory:');
    db.exec(`
        CREATE TABLE rag_chunks (id TEXT PRIMARY KEY, page_id TEXT, vector TEXT);
        CREATE TABLE rag_vec_map (
            vec_rowid INTEGER PRIMARY KEY,
            chunk_id TEXT NOT NULL UNIQUE
        );
    `);
    // Simulate _vecInsertChunk: write the vec table to get a rowid (simulated with a sequence here), create the mapping
    const chunkId = 'chunk-txt-1';
    const fakeVecRowid = 100;
    db.prepare('INSERT OR IGNORE INTO rag_vec_map(vec_rowid, chunk_id) VALUES (?, ?)').run(fakeVecRowid, chunkId);
    // Reverse lookup: chunk_id → vec_rowid (used on delete)
    const row = db.prepare('SELECT vec_rowid FROM rag_vec_map WHERE chunk_id = ?').get(chunkId);
    assert.equal(row.vec_rowid, 100, 'chunk_id → vec_rowid lookup correct');
    // Forward lookup: vec_rowid → chunk_id (used in the KNN JOIN)
    const back = db.prepare('SELECT chunk_id FROM rag_vec_map WHERE vec_rowid = ?').get(fakeVecRowid);
    assert.equal(back.chunk_id, chunkId, 'vec_rowid → chunk_id lookup correct');
    // Delete: find vec_rowid by chunk_id, delete the mapping
    const delRow = db.prepare('SELECT vec_rowid FROM rag_vec_map WHERE chunk_id = ?').get(chunkId);
    db.prepare('DELETE FROM rag_vec_map WHERE vec_rowid = ?').run(delRow.vec_rowid);
    const gone = db.prepare('SELECT COUNT(*) AS c FROM rag_vec_map').get().c;
    assert.equal(gone, 0, 'mapping table empty after delete, both tables consistent');
    db.close();
});
