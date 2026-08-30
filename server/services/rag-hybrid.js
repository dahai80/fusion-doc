// =============================================================================
// Fusion-Doc — 混合检索服务
// 向量(0.5) + FTS5(0.3) + BM25(0.2) 加权融合 + rerank + 段落级切分
// =============================================================================

const { callFusionMLX } = require('../integrations/fusion-mlx');
const { getDB } = require('../db');
const { uid } = require('../utils/helpers');

const WEIGHTS = { vector: 0.5, fts5: 0.3, bm25: 0.2 };
const CHUNK_SIZE = 800;
const CHUNK_OVERLAP = 200;
// 商用级: 限制全表扫描规模, 防 OOM (P2-23)
const MAX_VECTOR_CANDIDATES = 5000;
const MAX_BM25_CANDIDATES = 5000;
const MAX_QUERY_LEN = 2000;

// ── 段落级切分 (按 H1/H2 标题 + 段落边界) ─────────────────────────────────
function chunkPage(content, pageId) {
    const plain = (content || '').replace(/<[^>]+>/g, '');
    const lines = plain.split('\n');
    const chunks = [];
    let current = { heading: '', text: '', index: 0 };

    for (const line of lines) {
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

// ── 增量索引页面 ────────────────────────────────────────────────────────────
async function reindexPage(app, pageId) {
    const db = getDB();
    if (!db) throw new Error('DB not available');
    const page = db.prepare('SELECT id, title, content FROM pages WHERE id = ?').get(pageId);
    if (!page) throw new Error('Page not found');

    db.prepare('DELETE FROM rag_chunks WHERE page_id = ?').run(pageId);
    const chunks = chunkPage(page.content, pageId);
    const config = app.config.fusionMlx;

    for (const chunk of chunks) {
        let vector = null;
        try {
            const resp = await callFusionMLX({
                method: 'POST', path: '/v1/embeddings',
                body: { model: config.embeddingModel, input: chunk.chunk_text },
                config,
            });
            vector = resp.data?.[0]?.embedding || null;
        } catch (e) {
            console.warn(`[RAG-Hybrid] Embedding chunk ${chunk.chunk_index} failed:`, e.message);
        }

        const bm25Tokens = tokenizeBM25(chunk.chunk_text);
        db.prepare(`
            INSERT INTO rag_chunks (id, page_id, chunk_index, chunk_text, chunk_type, heading, vector, bm25_tokens, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(chunk.id, chunk.page_id, chunk.chunk_index, chunk.chunk_text, chunk.chunk_type, chunk.heading, vector ? JSON.stringify(vector) : null, JSON.stringify(bm25Tokens), Date.now());
    }

    console.log(`[RAG-Hybrid] Reindexed page ${pageId}: ${chunks.length} chunks`);
    return { page_id: pageId, chunks: chunks.length };
}

// ── 混合检索 ────────────────────────────────────────────────────────────────
async function hybridSearch(app, query, topK) {
    topK = Math.min(Math.max(parseInt(topK, 10) || 10, 1), 50);
    if (typeof query !== 'string' || !query.trim()) return [];
    query = query.slice(0, MAX_QUERY_LEN); // 防 ReDoS / 巨型查询 (P2-23)
    const db = getDB();
    const config = app.config.fusionMlx;

    const [vectorResults, ftsResults, bm25Results] = await Promise.all([
        vectorSearch(db, config, query, topK),
        fts5Search(db, query, topK),
        bm25Search(db, query, topK),
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

// ── 向量检索 ────────────────────────────────────────────────────────────────
async function vectorSearch(db, config, query, topK) {
    let queryVec = null;
    try {
        const resp = await callFusionMLX({
            method: 'POST', path: '/v1/embeddings',
            body: { model: config.embeddingModel, input: query }, config,
        });
        queryVec = resp.data?.[0]?.embedding || null;
    } catch (e) {
        console.warn('[RAG-Hybrid] vectorSearch embedding failed:', e.message);
        return [];
    }
    if (!queryVec || !db) return [];

    // 商用级: 限制候选规模, 防全表 OOM (P2-23)
    const rows = db.prepare('SELECT id, page_id, chunk_index, chunk_text, heading, vector FROM rag_chunks WHERE vector IS NOT NULL LIMIT ?').all(MAX_VECTOR_CANDIDATES);
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

// ── FTS5 检索 (修复: 直接用 chunk_text LIKE, 不误联 pages_fts.content) ──────
function fts5Search(db, query, topK) {
    if (!db) return [];
    try {
        // chunk_text LIKE 定位候选; pages_fts JOIN 原实现引用了 pages 表 content, 与 chunk 无关, 已移除
        const rows = db.prepare(`
            SELECT id, page_id, chunk_index, chunk_text, heading
            FROM rag_chunks
            WHERE chunk_text LIKE ?
            LIMIT ?
        `).all(`%${query}%`, Math.min(topK * 3, 200));
        // 伪分数: 按命中位置/长度归一, 给 RRF 提供稳定排序
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

// ── BM25 检索 ───────────────────────────────────────────────────────────────
function bm25Search(db, query, topK) {
    if (!db) return [];
    try {
        const queryTokens = tokenizeBM25(query);
        if (!queryTokens.length) return [];
        // 商用级: 限制候选规模, 防全表 OOM (P2-23)
        const rows = db.prepare('SELECT id, page_id, chunk_index, chunk_text, heading, bm25_tokens FROM rag_chunks LIMIT ?').all(MAX_BM25_CANDIDATES);
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

// ── 结果融合 (RRF) ──────────────────────────────────────────────────────────
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
        method: 'POST', path: '/v1/rerank',
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

// ── 获取页面段落索引 ────────────────────────────────────────────────────────
function getPageChunks(pageId) {
    const db = getDB();
    if (!db) return [];
    return db.prepare('SELECT id, chunk_index, chunk_text, chunk_type, heading FROM rag_chunks WHERE page_id = ? ORDER BY chunk_index').all(pageId);
}

// ── 辅助函数 ────────────────────────────────────────────────────────────────
function tokenizeBM25(text) {
    return (text || '').toLowerCase()
        .replace(/[^\w一-鿿]/g, ' ')
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
