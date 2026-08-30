// =============================================================================
// Fusion-Doc — RAG 向量检索 worker (P0-P1/P0-P2 修复)
// 原 vectorSearch 把 "JSON.parse + 余弦 × 候选行" 跑在主线程, 阻塞事件循环,
// 串行化全部请求 (高并发企业级场景塌陷)。offload 此 CPU 重活到 worker_thread:
// 主线程仅 await embedding(HTTP) + 同步 DB 快查, CPU 扫描移出事件循环。
// 零新依赖 (worker_threads 为 Node 标准库)。worker 失败降级回主线程原逻辑。
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

// ── worker 入口: 接收候选行 + queryVec, 解析向量 + 余弦 + 排序, 返回 topK ──
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
