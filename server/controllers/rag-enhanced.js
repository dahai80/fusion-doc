// =============================================================================
// Fusion-Doc — RAG 增强控制器
// 混合检索 + 增量索引 + 段落查询
// =============================================================================

const { json, error } = require('../utils/response');
const { hybridSearch, reindexPage, getPageChunks } = require('../services/rag-hybrid');
const { requireAdmin } = require('../middleware/require-admin');

function register(app) {
    const { db } = app;
    // S1 修复: 计算当前用户可见 page_id 集合。admin → null; 普通用户 → 已发布 OR 自建页。
    function accessiblePageIdsFor(req) {
        const { tenantId } = require('../utils/helpers');
        const tid = tenantId(req);
        const isAdmin = req.user?.role === 'admin' || req.user?.role === 'tenant_admin';
        // issue #45: admin 在本租户内无限制; 普通用户仅已发布 OR 自建页 (均按 tid 过滤)
        if (isAdmin) return db.prepare('SELECT id FROM pages WHERE tenant_id = ?').all(tid).map(r => r.id);
        const owner = req.user?.id || 'local';
        const rows = db.prepare('SELECT id FROM pages WHERE tenant_id = ? AND (is_published = 1 OR created_by = ?)').all(tid, owner);
        return rows.map(r => r.id);
    }

    // ── 混合检索 ────────────────────────────────────────────────────────
    app.registerRoute('POST', '/api/rag/enhanced-query', async (req, res) => {
        const { parseBody } = require('../middleware/body-parser');
        const body = await parseBody(req);
        const { query, top_k } = body;
        if (!query) return error(res, 'query required', 400);
        try {
            // S1 修复: 按可见 page_id 过滤, 杜绝检索返回他人私有页 chunk (IDOR)
            const accessiblePageIds = accessiblePageIdsFor(req);
            const results = await hybridSearch(app, query, top_k || 10, accessiblePageIds);
            json(res, { query, results, count: results.length });
        } catch (e) {
            console.error('[RAG-Enhanced] Query error:', e.message);
            error(res, `Query failed: ${e.message}`, 500);
        }
    });

    // ── 获取页面段落索引 (S1: 加读归属校验, 私有页段落不泄露给非 owner) ──
    app.registerRoute('GET', '/api/rag/chunks/:pageId', (req, res) => {
        const { canReadPage } = require('../middleware/authz');
        const page = db ? db.prepare('SELECT * FROM pages WHERE id = ?').get(req.params.pageId) : null;
        if (!page) return error(res, 'Page not found', 404, 'NOT_FOUND');
        if (!canReadPage(req, res, page)) return;
        const chunks = getPageChunks(req.params.pageId);
        json(res, { page_id: req.params.pageId, chunks });
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

    // ── 批量索引所有页面 ─────────────────────────────────────────────────
    app.registerRoute('POST', '/api/rag/reindex-all', async (req, res) => {
        // R10 修复: 全库串行 embedding 独占 GPU, 必须 admin 闸防任意用户 DoS。
        if (!requireAdmin(req, res)) return;
        const { getDB } = require('../db');
        const db = getDB();
        if (!db) return error(res, 'DB not available', 500);
        // A5/P1-P4 修复: 串行 embedding 无上限 → 单请求无限长 + embedding 风暴占满 GPU。
        // 加单批页面上限, 超出部分不处理并在响应中回显, 调用方可分批再来 (避免单请求 hang)。
        const MAX_REINDEX_PAGES = parseInt(process.env.RAG_REINDEX_BATCH || '200', 10);
        try {
            const total = db.prepare('SELECT COUNT(*) AS n FROM pages').get().n;
            const pages = db.prepare('SELECT id FROM pages LIMIT ?').all(MAX_REINDEX_PAGES);
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
            const dropped = total - pages.length;
            console.log(`[RAG-Enhanced] reindex-all: ${indexed} ok / ${failed} fail, batch ${pages.length}/${total}${dropped > 0 ? ` (dropped ${dropped}, 分批再来)` : ''}`);
            json(res, { total, batch: pages.length, indexed, failed, dropped });
        } catch (e) {
            error(res, e.message, 500);
        }
    });
}

module.exports = { register };
