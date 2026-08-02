// =============================================================================
// Fusion-Doc — RAG 增强服务
// 文档切片 → 向量索引 → 语义检索 → 上下文注入
// =============================================================================

const { callFusionMLX } = require('../integrations/fusion-mlx');

const CHUNK_SIZE = 800;
const CHUNK_OVERLAP = 200;

// ── 文档切片 ────────────────────────────────────────────────────────────────
function chunkText(text, size, overlap) {
    size = size || CHUNK_SIZE;
    overlap = overlap || CHUNK_OVERLAP;
    const chunks = [];
    let start = 0;
    while (start < text.length) {
        const end = Math.min(start + size, text.length);
        chunks.push({ text: text.slice(start, end), index: chunks.length });
        start += size - overlap;
        if (start >= text.length) break;
    }
    return chunks;
}

// ── 文档索引 ────────────────────────────────────────────────────────────────
async function indexPage(app, pageId) {
    const { db } = app;
    if (!db) throw new Error('DB not available');

    const page = db.prepare('SELECT id, title, content FROM pages WHERE id = ?').get(pageId);
    if (!page) throw new Error('Page not found');

    const plainText = (page.content || '').replace(/<[^>]+>/g, '');
    const chunks = chunkText(plainText);
    const config = app.config.fusionMlx;

    // 删除旧索引
    db.prepare('DELETE FROM rag_index WHERE page_id = ?').run(pageId);

    for (const chunk of chunks) {
        let embedding = null;
        try {
            const resp = await callFusionMLX({
                method: 'POST',
                path: '/v1/embeddings',
                body: { model: config.embeddingModel, input: chunk.text },
                config,
            });
            embedding = resp.data?.[0]?.embedding || null;
        } catch (e) {
            console.warn(`[RAG] Embedding failed for chunk ${chunk.index}:`, e.message);
        }

        db.prepare(`
            INSERT INTO rag_index (page_id, chunk_index, chunk_text, embedding, created_at)
            VALUES (?, ?, ?, ?, ?)
        `).run(pageId, chunk.index, chunk.text, embedding ? JSON.stringify(embedding) : null, Date.now());
    }

    console.log(`[RAG] Indexed page ${pageId}: ${chunks.length} chunks`);
    return { page_id: pageId, chunks: chunks.length };
}

// ── 语义检索 ────────────────────────────────────────────────────────────────
async function search(app, query, topK) {
    topK = topK || 5;
    const { db } = app;
    const config = app.config.fusionMlx;

    let queryEmbedding = null;
    try {
        const resp = await callFusionMLX({
            method: 'POST',
            path: '/v1/embeddings',
            body: { model: config.embeddingModel, input: query },
            config,
        });
        queryEmbedding = resp.data?.[0]?.embedding || null;
    } catch (e) {
        console.warn('[RAG] Query embedding failed:', e.message);
    }

    if (!queryEmbedding || !db) {
        return fallbackSearch(db, query, topK);
    }

    const rows = db.prepare('SELECT page_id, chunk_index, chunk_text, embedding FROM rag_index').all();
    const scored = rows
        .filter(r => r.embedding)
        .map(r => ({
            page_id: r.page_id,
            chunk_index: r.chunk_index,
            chunk_text: r.chunk_text,
            score: cosineSimilarity(queryEmbedding, JSON.parse(r.embedding)),
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, topK);

    console.log(`[RAG] Search "${query}": ${scored.length} results (top score: ${scored[0]?.score?.toFixed(3) || 0})`);
    return scored;
}

// ── 上下文构建（给 AI Copilot 用）───────────────────────────────────────────
async function buildRAGContext(app, query, topK) {
    const results = await search(app, query, topK || 3);
    if (!results.length) return '';
    const parts = results.map((r, i) => `[${i + 1}] ${r.chunk_text}`);
    return `相关文档片段:\n${parts.join('\n\n')}`;
}

// ── Fallback 全文检索 ───────────────────────────────────────────────────────
function fallbackSearch(db, query, topK) {
    if (!db) return [];
    try {
        const rows = db.prepare(`
            SELECT page_id, chunk_index, chunk_text, 0.5 as score
            FROM rag_index WHERE chunk_text LIKE ?
            LIMIT ?
        `).all(`%${query}%`, topK);
        return rows;
    } catch (e) {
        return [];
    }
}

// ── 余弦相似度 ──────────────────────────────────────────────────────────────
function cosineSimilarity(a, b) {
    if (!a || !b || a.length !== b.length) return 0;
    let dot = 0, magA = 0, magB = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        magA += a[i] * a[i];
        magB += b[i] * b[i];
    }
    const denom = Math.sqrt(magA) * Math.sqrt(magB);
    return denom === 0 ? 0 : dot / denom;
}

module.exports = { indexPage, search, buildRAGContext, chunkText };
