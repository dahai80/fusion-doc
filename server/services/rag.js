// =============================================================================
// Fusion-Doc — RAG enhancement service (A8 unification: delegates to rag-hybrid single store)
// Document chunking → vector index → semantic search → context injection
// =============================================================================
// A8 fix: the original implementation wrote its own rag_index table, forking storage from rag-hybrid's rag_chunks table;
// the same page was written once per index, with inconsistent search paths (rag_index had no BM25/FTS fusion).
// Unified onto the single rag-hybrid store (rag_chunks); this module is now a thin delegation layer keeping export names unchanged
// (indexPage/search/buildRAGContext/chunkText) so callers such as graph.js migrate with zero changes.

const ragHybrid = require('./rag-hybrid');

function chunkText(text, size, overlap) {
    // Delegate to rag-hybrid paragraph-level chunking to keep chunking consistent (single implementation, DRY)
    const chunks = ragHybrid.chunkPage(text, null);
    return chunks.map(c => ({ text: c.chunk_text, index: c.chunk_index }));
}

// ── Document indexing (delegates to rag-hybrid.reindexPage, writes the single rag_chunks table) ───
async function indexPage(app, pageId) {
    return ragHybrid.reindexPage(app, pageId);
}

// ── Semantic search (delegates to rag-hybrid.hybridSearch, single-store search) ───
// S1: pass accessiblePageIds through so graph semantic search does not leak chunks from others' private pages
async function search(app, query, topK, accessiblePageIds) {
    const results = await ragHybrid.hybridSearch(app, query, topK || 5, accessiblePageIds);
    // Normalize to the {page_id, chunk_index, chunk_text, score} shape graph.js expects
    return results.map(r => ({
        page_id: r.page_id,
        chunk_index: r.chunk_index,
        chunk_text: r.chunk_text,
        score: r.rrfScore != null ? r.rrfScore : (r.rerankScore != null ? r.rerankScore : r.score),
    }));
}

// ── Context building (for AI Copilot) ───────────────────────────────────────
async function buildRAGContext(app, query, topK) {
    const results = await search(app, query, topK || 3);
    if (!results.length) return '';
    const parts = results.map((r, i) => `[${i + 1}] ${r.chunk_text}`);
    return `相关文档片段:\n${parts.join('\n\n')}`; // i18n: user-facing (LLM prompt context)
}

module.exports = { indexPage, search, buildRAGContext, chunkText };
