// =============================================================================
// Fusion-Doc — RAG 增强服务 (A8 统一: 委托 rag-hybrid 单存储)
// 文档切片 → 向量索引 → 语义检索 → 上下文注入
// =============================================================================
// A8 修复: 原实现独立写 rag_index 表, 与 rag-hybrid 的 rag_chunks 表双存储分叉,
// 同页被两套索引各写一遍, 检索路径不一致 (rag_index 无 BM25/FTS 融合)。
// 统一为 rag-hybrid 单一存储 (rag_chunks), 本模块退为薄委托层, 保持对外导出名不变
// (indexPage/search/buildRAGContext/chunkText) 供 graph.js 等调用方零改动迁移。

const ragHybrid = require('./rag-hybrid');

function chunkText(text, size, overlap) {
    // 委托 rag-hybrid 的段落级切分, 保持切片口径统一 (单处实现, DRY)
    const chunks = ragHybrid.chunkPage(text, null);
    return chunks.map(c => ({ text: c.chunk_text, index: c.chunk_index }));
}

// ── 文档索引 (委托 rag-hybrid.reindexPage, 写 rag_chunks 单表) ──────────────
async function indexPage(app, pageId) {
    return ragHybrid.reindexPage(app, pageId);
}

// ── 语义检索 (委托 rag-hybrid.hybridSearch, 单存储检索) ──────────────────────
// S1: accessiblePageIds 透传, 防 graph 语义搜索泄露他人私有页 chunk
async function search(app, query, topK, accessiblePageIds) {
    const results = await ragHybrid.hybridSearch(app, query, topK || 5, accessiblePageIds);
    // 归一为 graph.js 期望的 {page_id, chunk_index, chunk_text, score} 结构
    return results.map(r => ({
        page_id: r.page_id,
        chunk_index: r.chunk_index,
        chunk_text: r.chunk_text,
        score: r.rrfScore != null ? r.rrfScore : (r.rerankScore != null ? r.rerankScore : r.score),
    }));
}

// ── 上下文构建（给 AI Copilot 用）───────────────────────────────────────────
async function buildRAGContext(app, query, topK) {
    const results = await search(app, query, topK || 3);
    if (!results.length) return '';
    const parts = results.map((r, i) => `[${i + 1}] ${r.chunk_text}`);
    return `相关文档片段:\n${parts.join('\n\n')}`;
}

module.exports = { indexPage, search, buildRAGContext, chunkText };
