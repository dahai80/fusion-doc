// =============================================================================
// Fusion-Doc — hybrid retrieval service
// Vector (0.5) + FTS5 (0.3) + BM25 (0.2) weighted fusion + rerank + paragraph-level chunking
// =============================================================================

const { callFusionMLX } = require('../integrations/fusion-mlx');
const { getDB, isVecLoaded } = require('../db');
const { uid } = require('../utils/helpers');

const WEIGHTS = { vector: 0.5, fts5: 0.3, bm25: 0.2 };

// ── Large-KB fix: sqlite-vec ANN dimension ─────────────────────────────────
// The vec0 table locks its dimension at creation (migration 017 uses env AI_EMBEDDING_DIM, default 384 = bge-small-en-v1.5).
// Search/write paths use it to decide whether a vector is ANN-compatible; on dimension mismatch, fall back to a linear scan (supports model switching).
const VEC_DIM = parseInt(process.env.AI_EMBEDDING_DIM || '384', 10);
// ANN KNN oversampling factor: KNN fetches topK × this factor, then filters by accessiblePageIds to fill topK.
// Permission filtering may drop some neighbors; oversampling keeps enough candidates after filtering. No waste when unrestricted (admin).
const KNN_OVERSAMPLE = 4;

// ── P0-P1/P0-P2 fix: offload vector scan to a worker_thread ──────────────
// Previously JSON.parse + cosine × candidate rows ran on the main thread, blocking the event loop and serializing all requests. Moved to a worker
// so CPU-heavy work does not hold the main event loop. Single lazily-started reusable worker; on failure fall back to the main thread (zero regression).
// env RAG_WORKER=0 disables it (debugging/rollback).
const { Worker } = require('worker_threads');
let _ragWorker = null;
let _reqSeq = 0;
const _pending = new Map();
let _workerDisabled = process.env.RAG_WORKER === '0';

function getRagWorker() {
    if (_workerDisabled) return null;
    if (_ragWorker) return _ragWorker;
    try {
        _ragWorker = new Worker(require('path').join(__dirname, 'rag-worker.js'));
        _ragWorker.on('message', (msg) => {
            const cb = _pending.get(msg.reqId);
            if (!cb) return;
            _pending.delete(msg.reqId);
            if (msg.ok) cb.resolve(msg.result);
            else cb.reject(new Error(msg.error));
        });
        _ragWorker.on('error', (err) => {
            console.warn('[RAG-Hybrid] worker error, falling back to main thread:', err.message);
            for (const { reject } of _pending.values()) reject(err);
            _pending.clear();
            _ragWorker = null;
            _workerDisabled = true;
        });
        _ragWorker.on('exit', (code) => {
            if (code !== 0) console.warn(`[RAG-Hybrid] worker exit code=${code}`);
            _ragWorker = null;
        });
        console.log('[RAG-Hybrid] vector scan worker started (offloading the event loop)');
        return _ragWorker;
    } catch (e) {
        console.warn('[RAG-Hybrid] worker failed to start, falling back to main thread:', e.message);
        _workerDisabled = true;
        return null;
    }
}

function workerScore(rows, queryVec, topK, weight) {
    const w = getRagWorker();
    if (!w) return Promise.reject(new Error('worker disabled'));
    const reqId = ++_reqSeq;
    return new Promise((resolve, reject) => {
        _pending.set(reqId, { resolve, reject });
        try {
            w.postMessage({ rows, queryVec, topK, weight, reqId });
        } catch (e) {
            _pending.delete(reqId);
            reject(e);
        }
    });
}
const CHUNK_SIZE = 800;
const CHUNK_OVERLAP = 200;
// Production-grade: cap full-table scan size to prevent OOM (P2-23)
const MAX_VECTOR_CANDIDATES = 5000;
const MAX_BM25_CANDIDATES = 5000;
const MAX_QUERY_LEN = 2000;
// E25 fix: cap total chunk count so a 5MB giant page cannot produce thousands of chunks and an embedding call storm
const MAX_CHUNKS = 2000;

// ── Paragraph-level chunking (by H1/H2 headings + paragraph boundaries) ───
function chunkPage(content, pageId) {
    const plain = (content || '').replace(/<[^>]+>/g, '');
    const lines = plain.split('\n');
    const chunks = [];
    let current = { heading: '', text: '', index: 0 };

    for (const line of lines) {
        // E25 fix: stop once the chunk cap is reached, preventing giant pages from producing thousands of chunks
        if (chunks.length >= MAX_CHUNKS) {
            console.warn(`[RAG-Hybrid] chunkPage capped at ${MAX_CHUNKS} (page ${pageId})`);
            break;
        }
        const headingMatch = line.match(/^#{1,3}\s+(.+)/);
        if (headingMatch) {
            if (current.text.trim()) {
                chunks.push({
                    id: uid(),
                    page_id: pageId,
                    chunk_index: current.index,
                    chunk_text: current.text.trim(),
                    chunk_type: 'section',
                    heading: current.heading,
                });
            }
            current = { heading: headingMatch[1], text: line + '\n', index: chunks.length };
        } else {
            current.text += line + '\n';
            if (current.text.length > CHUNK_SIZE) {
                chunks.push({
                    id: uid(),
                    page_id: pageId,
                    chunk_index: current.index,
                    chunk_text: current.text.trim(),
                    chunk_type: current.heading ? 'section' : 'paragraph',
                    heading: current.heading,
                });
                const overlap = current.text.slice(-CHUNK_OVERLAP);
                current = { heading: current.heading, text: overlap, index: chunks.length };
            }
        }
    }
    if (current.text.trim()) {
        chunks.push({
            id: uid(),
            page_id: pageId,
            chunk_index: current.index,
            chunk_text: current.text.trim(),
            chunk_type: current.heading ? 'section' : 'paragraph',
            heading: current.heading,
        });
    }
    return chunks;
}

// ── Large KB: vec index write/delete helpers ────────────────────────────────
// The vec0 table uses an auto-increment rowid while rag_chunks.id is TEXT → rag_vec_map provides a bidirectional mapping.
// When deleting a page's chunks: look up vec_rowid by chunk_id, then delete the vec row + mapping row (keeps both tables consistent).
function _vecDeleteByChunkIds(db, chunkIds) {
    if (!isVecLoaded() || !chunkIds.length) return;
    const rows = db.prepare(`SELECT vec_rowid FROM rag_vec_map WHERE chunk_id IN (${chunkIds.map(() => '?').join(',')})`).all(...chunkIds);
    if (!rows.length) return;
    const vecRowids = rows.map(r => r.vec_rowid);
    // vec0 delete by rowid: DELETE FROM <vec_table> WHERE rowid = ?
    const delVec = db.prepare('DELETE FROM rag_chunks_vec WHERE rowid = ?');
    for (const vr of vecRowids) delVec.run(vr);
    db.prepare(`DELETE FROM rag_vec_map WHERE vec_rowid IN (${vecRowids.map(() => '?').join(',')})`).run(...vecRowids);
}

// Write a single vector: insert into vec0 to get a rowid, then create the mapping. Vector dimension must match VEC_DIM, otherwise skip (fallback).
function _vecInsertChunk(db, chunkId, vector) {
    if (!isVecLoaded() || !Array.isArray(vector) || vector.length !== VEC_DIM) return false;
    try {
        const info = db.prepare('INSERT INTO rag_chunks_vec(embedding) VALUES (?)').run(new Float32Array(vector));
        db.prepare('INSERT OR IGNORE INTO rag_vec_map(vec_rowid, chunk_id) VALUES (?, ?)').run(info.lastInsertRowid, chunkId);
        return true;
    } catch (e) {
        console.warn(`[RAG-Hybrid] vec insert failed chunk=${chunkId} (falling back to linear scan): ${e.message}`);
        return false;
    }
}

// ── Incremental page indexing ───────────────────────────────────────────────
// R8 fix: the old DELETE + per-chunk INSERT had no transaction; a crash midway left old chunks deleted and new ones half-written (inconsistent data).
// A better-sqlite3 transaction is synchronous and cannot contain await, so first collect all embeddings asynchronously,
// then perform DELETE + batch INSERT atomically in a single synchronous transaction (all succeed or all roll back).
// Large-KB fix: vectors are dual-written to rag_chunks_vec (ANN) + rag_chunks.vector (JSON fallback backup).
async function reindexPage(app, pageId) {
    const db = getDB();
    if (!db) throw new Error('DB not available');
    const page = db.prepare('SELECT id, title, content FROM pages WHERE id = ?').get(pageId);
    if (!page) throw new Error('Page not found');

    const chunks = chunkPage(page.content, pageId);
    const config = app.config.fusionMlx;

    // 1. Collect embeddings asynchronously (network IO, outside the transaction)
    const rows = [];
    const vectors = []; // Parallel array of raw vectors for the vec table (the Float[] before JSON.stringify)
    for (const chunk of chunks) {
        let vector = null;
        try {
            const resp = await callFusionMLX({
                method: 'POST', path: '/embeddings',
                body: { model: config.embeddingModel, input: chunk.chunk_text },
                config,
            });
            vector = resp.data?.[0]?.embedding || null;
        } catch (e) {
            console.warn(`[RAG-Hybrid] Embedding chunk ${chunk.chunk_index} failed:`, e.message);
        }
        const bm25Tokens = tokenizeBM25(chunk.chunk_text);
        rows.push([
            chunk.id, chunk.page_id, chunk.chunk_index, chunk.chunk_text,
            chunk.chunk_type, chunk.heading,
            vector ? JSON.stringify(vector) : null,
            JSON.stringify(bm25Tokens), Date.now(),
        ]);
        vectors.push({ chunkId: chunk.id, vector });
    }

    // 2. Atomic write: DELETE + batch INSERT in one transaction; on failure roll back and keep old chunks intact
    const insertStmt = db.prepare(`
        INSERT INTO rag_chunks (id, page_id, chunk_index, chunk_text, chunk_type, heading, vector, bm25_tokens, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const reindexTxn = db.transaction(() => {
        // First delete vec index rows for the old chunks (by the set of chunk_ids about to be deleted)
        const oldChunkIds = db.prepare('SELECT id FROM rag_chunks WHERE page_id = ?').all(pageId).map(r => r.id);
        _vecDeleteByChunkIds(db, oldChunkIds);
        db.prepare('DELETE FROM rag_chunks WHERE page_id = ?').run(pageId);
        for (const r of rows) insertStmt.run(...r);
        // Dual-write to the vec table (ANN); skipped automatically on dimension mismatch/missing extension (rag_chunks.vector JSON as fallback)
        for (const v of vectors) {
            if (v.vector) _vecInsertChunk(db, v.chunkId, v.vector);
        }
    });
    reindexTxn();

    console.log(`[RAG-Hybrid] Reindexed page ${pageId}: ${chunks.length} chunks`);
    return { page_id: pageId, chunks: chunks.length };
}

// ── Hybrid search ───────────────────────────────────────────────────────────
// S1 fix: new accessiblePageIds parameter — the caller passes the set of page_ids visible to the current user,
// and the whole search filters by it, so RAG never returns chunks from other users' private pages (IDOR cross-tenant data leak).
// null/undefined means admin (unrestricted); an empty array means no visible pages (returns empty).
async function hybridSearch(app, query, topK, accessiblePageIds) {
    topK = Math.min(Math.max(parseInt(topK, 10) || 10, 1), 50);
    if (typeof query !== 'string' || !query.trim()) return [];
    query = query.slice(0, MAX_QUERY_LEN); // Prevent ReDoS / huge queries (P2-23)
    const db = getDB();
    const config = app.config.fusionMlx;

    // S1: non-admin with no visible pages → return immediately without scanning (also avoids a pointless full-table scan)
    if (Array.isArray(accessiblePageIds) && accessiblePageIds.length === 0) return [];

    const [vectorResults, ftsResults, bm25Results] = await Promise.all([
        vectorSearch(db, config, query, topK, accessiblePageIds),
        fts5Search(db, query, topK, accessiblePageIds),
        bm25Search(db, query, topK, accessiblePageIds),
    ]);

    const fused = fuseResults(vectorResults, ftsResults, bm25Results, topK);

    if (config.rerankModel && fused.length > 0) {
        try {
            const reranked = await rerankResults(app, query, fused);
            return reranked;
        } catch (e) {
            console.warn('[RAG-Hybrid] Rerank failed, using fused results:', e.message);
        }
    }

    return fused;
}

// S1: build the page_id filter SQL fragment and params.
// accessiblePageIds null → admin, unrestricted; array → IN (?) binding.
function pageIdFilter(accessiblePageIds) {
    if (accessiblePageIds === null || accessiblePageIds === undefined) return { clause: '', params: [] };
    if (!Array.isArray(accessiblePageIds) || accessiblePageIds.length === 0) {
        // No visible pages: block with an always-false condition, return no rows
        return { clause: ' AND 1=0', params: [] };
    }
    const placeholders = accessiblePageIds.map(() => '?').join(',');
    return { clause: ` AND page_id IN (${placeholders})`, params: accessiblePageIds };
}

// ── Vector search ───────────────────────────────────────────────────────────
// Large-KB fix: prefer sqlite-vec ANN KNN (O(logN)) to lift the linear-scan scale limit.
// Path selection: vec loaded + queryVec dimension == VEC_DIM → KNN; otherwise fall back to the original linear scan (worker offload).
// Permission filtering: KNN oversamples topK×KNN_OVERSAMPLE, JOINs rag_chunks for page_id, then filters by accessiblePageIds.
async function vectorSearch(db, config, query, topK, accessiblePageIds) {
    let queryVec = null;
    try {
        const resp = await callFusionMLX({
            method: 'POST', path: '/embeddings',
            body: { model: config.embeddingModel, input: query }, config,
        });
        queryVec = resp.data?.[0]?.embedding || null;
    } catch (e) {
        console.warn('[RAG-Hybrid] vectorSearch embedding failed:', e.message);
        return [];
    }
    if (!queryVec || !db) return [];

    // ANN path: vec loaded + dimension matches → KNN query
    if (isVecLoaded() && Array.isArray(queryVec) && queryVec.length === VEC_DIM) {
        try {
            return _knnVectorSearch(db, queryVec, topK, accessiblePageIds);
        } catch (e) {
            console.warn('[RAG-Hybrid] KNN query failed, falling back to linear scan:', e.message);
        }
    }

    // Fallback path: original linear scan (vec extension missing / dimension mismatch / KNN error)
    // S1: filter candidates by accessiblePageIds; admin (null) is unrestricted
    const pf = pageIdFilter(accessiblePageIds);
    // Production-grade: cap candidate count to prevent full-table OOM (P2-23)
    const rows = db.prepare(`SELECT id, page_id, chunk_index, chunk_text, heading, vector FROM rag_chunks WHERE vector IS NOT NULL${pf.clause} LIMIT ?`).all(...pf.params, MAX_VECTOR_CANDIDATES);
    // P0-P1/P0-P2: offload JSON.parse + cosine × candidate rows to the worker so the event loop is not blocked; fall back to main thread on failure
    try {
        return await workerScore(rows, queryVec, topK, WEIGHTS.vector);
    } catch (e) {
        console.warn('[RAG-Hybrid] worker scoring failed, falling back to main thread:', e.message);
        return rows
            .map(r => {
                let v;
                try { v = JSON.parse(r.vector); } catch { return null; }
                if (!Array.isArray(v) || v.length !== queryVec.length) return null;
                return { id: r.id, page_id: r.page_id, chunk_index: r.chunk_index, chunk_text: r.chunk_text, heading: r.heading, score: cosineSimilarity(queryVec, v) * WEIGHTS.vector };
            })
            .filter(Boolean)
            .sort((a, b) => b.score - a.score)
            .slice(0, topK);
    }
}

// ── KNN vector search (sqlite-vec ANN) ─────────────────────────────────────
// Oversample topK×KNN_OVERSAMPLE neighbors (vec0 KNN does not support JOIN filtering), then via rag_vec_map→rag_chunks
// fetch chunk_text/page_id, filter by accessiblePageIds and take topK. admin (null) is not filtered.
// distance is the L2 distance returned by sqlite-vec (smaller is closer), normalized to a similarity score (1/(1+distance)).
function _knnVectorSearch(db, queryVec, topK, accessiblePageIds) {
    const knnK = Math.max(topK * KNN_OVERSAMPLE, topK);
    const q = new Float32Array(queryVec);
    const knnRows = db.prepare(
        'SELECT rowid, distance FROM rag_chunks_vec WHERE embedding MATCH ? AND k = ? ORDER BY distance'
    ).all(new Uint8Array(q.buffer), knnK);
    if (!knnRows.length) return [];

    // JOIN rag_vec_map → rag_chunks to fetch chunk details
    const vecRowids = knnRows.map(r => r.rowid);
    const distMap = new Map(knnRows.map(r => [r.rowid, r.distance]));
    const placeholders = vecRowids.map(() => '?').join(',');
    const chunks = db.prepare(
        `SELECT m.vec_rowid, c.id, c.page_id, c.chunk_index, c.chunk_text, c.heading
         FROM rag_vec_map m JOIN rag_chunks c ON c.id = m.chunk_id
         WHERE m.vec_rowid IN (${placeholders})`
    ).all(...vecRowids);

    let filtered = chunks;
    // S1 permission filter: accessiblePageIds non-null → keep only chunks from visible pages
    if (accessiblePageIds !== null && accessiblePageIds !== undefined) {
        const allowed = new Set(Array.isArray(accessiblePageIds) ? accessiblePageIds : []);
        filtered = chunks.filter(c => allowed.has(c.page_id));
    }

    return filtered
        .map(c => ({
            id: c.id,
            page_id: c.page_id,
            chunk_index: c.chunk_index,
            chunk_text: c.chunk_text,
            heading: c.heading,
            score: (1 / (1 + (distMap.get(c.vec_rowid) || 0))) * WEIGHTS.vector,
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, topK);
}

// ── FTS5 search (fix: use chunk_text LIKE directly, no mistaken join to pages_fts.content) ───
function fts5Search(db, query, topK, accessiblePageIds) {
    if (!db) return [];
    try {
        const pf = pageIdFilter(accessiblePageIds);
        // chunk_text LIKE locates candidates; the old pages_fts JOIN referenced pages.content, unrelated to chunks, so it was removed
        const rows = db.prepare(`
            SELECT id, page_id, chunk_index, chunk_text, heading
            FROM rag_chunks
            WHERE chunk_text LIKE ?${pf.clause}
            LIMIT ?
        `).all(`%${query}%`, ...pf.params, Math.min(topK * 3, 200));
        // Pseudo-score: normalized by match position/length to give RRF a stable ordering
        return rows
            .map(r => {
                const idx = r.chunk_text.indexOf(query);
                const posScore = idx < 0 ? 0.1 : 1 / (1 + idx);
                return { id: r.id, page_id: r.page_id, chunk_index: r.chunk_index, chunk_text: r.chunk_text, heading: r.heading, score: posScore * WEIGHTS.fts5 };
            })
            .sort((a, b) => b.score - a.score)
            .slice(0, topK);
    } catch (e) {
        console.warn('[RAG-Hybrid] fts5Search error:', e.message);
        return [];
    }
}

// ── BM25 search ─────────────────────────────────────────────────────────────
function bm25Search(db, query, topK, accessiblePageIds) {
    if (!db) return [];
    try {
        const queryTokens = tokenizeBM25(query);
        if (!queryTokens.length) return [];
        const pf = pageIdFilter(accessiblePageIds);
        // Production-grade: cap candidate count to prevent full-table OOM (P2-23)
        const rows = db.prepare(`SELECT id, page_id, chunk_index, chunk_text, heading, bm25_tokens FROM rag_chunks WHERE 1=1${pf.clause} LIMIT ?`).all(...pf.params, MAX_BM25_CANDIDATES);
        return rows
            .map(r => {
                let docTokens;
                try { docTokens = JSON.parse(r.bm25_tokens || '[]'); } catch { return null; }
                if (!Array.isArray(docTokens)) return null;
                const score = bm25Score(queryTokens, docTokens, rows.length) * WEIGHTS.bm25;
                return { id: r.id, page_id: r.page_id, chunk_index: r.chunk_index, chunk_text: r.chunk_text, heading: r.heading, score };
            })
            .filter(Boolean)
            .sort((a, b) => b.score - a.score)
            .slice(0, topK);
    } catch (e) {
        console.warn('[RAG-Hybrid] bm25Search error:', e.message);
        return [];
    }
}

// ── Result fusion (RRF) ─────────────────────────────────────────────────────
function fuseResults(vectorR, ftsR, bm25R, topK) {
    const K = 60;
    const scores = new Map();
    const allItems = [...vectorR, ...ftsR, ...bm25R];

    for (const item of allItems) {
        if (!scores.has(item.id)) {
            scores.set(item.id, { ...item, rrfScore: 0 });
        }
    }

    const rankList = (results) => {
        results.forEach((r, i) => {
            const entry = scores.get(r.id);
            if (entry) entry.rrfScore += 1 / (K + i + 1);
        });
    };
    rankList(vectorR);
    rankList(ftsR);
    rankList(bm25R);

    return [...scores.values()]
        .sort((a, b) => b.rrfScore - a.rrfScore)
        .slice(0, topK);
}

// ── Rerank ──────────────────────────────────────────────────────────────────
async function rerankResults(app, query, results) {
    const config = app.config.fusionMlx;
    const documents = results.map(r => r.chunk_text);
    const resp = await callFusionMLX({
        method: 'POST', path: '/rerank',
        body: { model: config.rerankModel, query, documents }, config,
    });
    if (!resp.results) return results;
    return resp.results
        .sort((a, b) => b.relevance_score - a.relevance_score)
        .map(r => {
            const orig = results[r.index];
            return { ...orig, rerankScore: r.relevance_score };
        });
}

// ── Page paragraph index lookup ─────────────────────────────────────────────
function getPageChunks(pageId) {
    const db = getDB();
    if (!db) return [];
    return db.prepare('SELECT id, chunk_index, chunk_text, chunk_type, heading FROM rag_chunks WHERE page_id = ? ORDER BY chunk_index').all(pageId);
}

// ── Helpers ─────────────────────────────────────────────────────────────────
function tokenizeBM25(text) {
    return (text || '').toLowerCase()
        .replace(/[^\w一-鿿]/g, ' ') // i18n: user-facing (CJK range keeps Chinese tokens)
        .split(/\s+/)
        .filter(t => t.length > 1);
}

function bm25Score(queryTokens, docTokens, totalDocs, k1, b, avgDl) {
    k1 = k1 || 1.2; b = b || 0.75; avgDl = avgDl || 100;
    const dl = docTokens.length;
    const tfMap = {};
    docTokens.forEach(t => { tfMap[t] = (tfMap[t] || 0) + 1; });

    let score = 0;
    const seen = new Set();
    for (const qt of queryTokens) {
        if (seen.has(qt)) continue;
        seen.add(qt);
        const tf = tfMap[qt] || 0;
        const idf = Math.log((totalDocs - tf + 0.5) / (tf + 0.5) + 1);
        const tfNorm = (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * dl / avgDl));
        score += idf * tfNorm;
    }
    return Math.max(0, score);
}

function cosineSimilarity(a, b) {
    if (!a || !b || a.length !== b.length) return 0;
    let dot = 0, magA = 0, magB = 0;
    for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; magA += a[i] * a[i]; magB += b[i] * b[i]; }
    const d = Math.sqrt(magA) * Math.sqrt(magB);
    return d === 0 ? 0 : dot / d;
}

module.exports = { hybridSearch, reindexPage, getPageChunks, chunkPage };
