// =============================================================================
// Fusion-Doc — RAG 增强控制器
// 混合检索 + 增量索引 + 段落查询
// =============================================================================

const { json, error } = require('../utils/response');
const { hybridSearch, reindexPage, getPageChunks } = require('../services/rag-hybrid');
const { requireAdmin } = require('../middleware/require-admin');

function register(app) {
    // ── 混合检索 ────────────────────────────────────────────────────────
    app.registerRoute('POST', '/api/rag/enhanced-query', async (req, res) => {
        const { parseBody } = require('../middleware/body-parser');
        const body = await parseBody(req);
        const { query, top_k } = body;
        if (!query) return error(res, 'query required', 400);
        try {
            const results = await hybridSearch(app, query, top_k || 10);
            json(res, { query, results, count: results.length });
        } catch (e) {
            console.error('[RAG-Enhanced] Query error:', e.message);
            error(res, `Query failed: ${e.message}`, 500);
        }
    });

    // ── 增量索引单个页面 ─────────────────────────────────────────────────
    app.registerRoute('POST', '/api/rag/reindex/:id', async (req, res) => {
        // R10 修复: 单页重索引也调用 embedding 占 GPU, 加 admin 闸与全库一致。
        if (!requireAdmin(req, res)) return;
        try {
            const result = await reindexPage(app, req.params.id);
            json(res, result);
        } catch (e) {
            console.error('[RAG-Enhanced] Reindex error:', e.message);
            error(res, e.message, 500);
        }
    });

    // ── 获取页面段落索引 ─────────────────────────────────────────────────
    app.registerRoute('GET', '/api/rag/chunks/:pageId', (req, res) => {
        const chunks = getPageChunks(req.params.pageId);
        json(res, { page_id: req.params.pageId, chunks });
    });

    // ── 批量索引所有页面 ─────────────────────────────────────────────────
    app.registerRoute('POST', '/api/rag/reindex-all', async (req, res) => {
        // R10 修复: 全库串行 embedding 独占 GPU, 必须 admin 闸防任意用户 DoS。
        if (!requireAdmin(req, res)) return;
        const { getDB } = require('../db');
        const db = getDB();
        if (!db) return error(res, 'DB not available', 500);
        try {
            const pages = db.prepare('SELECT id FROM pages').all();
            let indexed = 0, failed = 0;
            for (const page of pages) {
                try {
                    await reindexPage(app, page.id);
                    indexed++;
                } catch (e) {
                    console.warn(`[RAG-Enhanced] Skip page ${page.id}:`, e.message);
                    failed++;
                }
            }
            json(res, { total: pages.length, indexed, failed });
        } catch (e) {
            error(res, e.message, 500);
        }
    });
}

module.exports = { register };
