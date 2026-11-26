// =============================================================================
// Fusion-Doc — RAG vector search worker (P0-P1/P0-P2 fix)
// The old vectorSearch ran "JSON.parse + cosine × candidate rows" on the main thread, blocking the event loop
// and serializing all requests (collapses under high-concurrency enterprise load). This CPU-heavy work is offloaded to a worker_thread:
// the main thread only awaits the embedding (HTTP) + a quick synchronous DB query; CPU scanning moves off the event loop.
// Zero new dependencies (worker_threads is in the Node standard library). On worker failure it falls back to the original main-thread logic.
// =============================================================================

const { parentPort } = require('worker_threads');
const { isMainThread } = require('worker_threads');

function cosineSimilarity(a, b) {
    let dot = 0, magA = 0, magB = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        magA += a[i] * a[i];
        magB += b[i] * b[i];
    }
    const d = Math.sqrt(magA) * Math.sqrt(magB);
    return d === 0 ? 0 : dot / d;
}

// ── worker entry: receives candidate rows + queryVec, parses vectors + cosine + sort, returns topK ──
function scoreRows(rows, queryVec, topK, weight) {
    const scored = [];
    for (const r of rows) {
        let v;
        try { v = JSON.parse(r.vector); } catch { continue; }
        if (!Array.isArray(v) || v.length !== queryVec.length) continue;
        scored.push({
            id: r.id,
            page_id: r.page_id,
            chunk_index: r.chunk_index,
            chunk_text: r.chunk_text,
            heading: r.heading,
            score: cosineSimilarity(queryVec, v) * weight,
        });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
}

if (!isMainThread && parentPort) {
    parentPort.on('message', (msg) => {
        try {
            const { rows, queryVec, topK, weight, reqId } = msg;
            const result = scoreRows(rows, queryVec, topK, weight);
            parentPort.postMessage({ reqId, ok: true, result });
        } catch (e) {
            parentPort.postMessage({ reqId: msg.reqId, ok: false, error: e.message });
        }
    });
}

module.exports = { scoreRows, cosineSimilarity };
