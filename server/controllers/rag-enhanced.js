// =============================================================================
// Fusion-Doc — enhanced RAG controller
// Hybrid retrieval + incremental indexing + passage queries
// =============================================================================

const { json, error } = require('../utils/response');
const { hybridSearch, reindexPage, getPageChunks } = require('../services/rag-hybrid');
const { requireAdmin } = require('../middleware/require-admin');

function register(app) {
    const { db } = app;
    // S1 fix: compute the set of page_ids visible to the current user. admin → null; regular users → published OR self-created pages.
    function accessiblePageIdsFor(req) {
        const { tenantId } = require('../utils/helpers');
        const tid = tenantId(req);
        const isAdmin = req.user?.role === 'admin' || req.user?.role === 'tenant_admin';
        // issue #45: admin unrestricted within the tenant; regular users see only published OR self-created pages (all filtered by tid)
        if (isAdmin) return db.prepare('SELECT id FROM pages WHERE tenant_id = ?').all(tid).map(r => r.id);
        const owner = req.user?.id || 'local';
        const rows = db.prepare('SELECT id FROM pages WHERE tenant_id = ? AND (is_published = 1 OR created_by = ?)').all(tid, owner);
        return rows.map(r => r.id);
    }

    // ── Hybrid retrieval ────────────────────────────────────────────────────────
    app.registerRoute('POST', '/api/rag/enhanced-query', async (req, res) => {
        const { parseBody } = require('../middleware/body-parser');
        const body = await parseBody(req);
        const { query, top_k } = body;
        if (!query) return error(res, 'query required', 400);
        try {
            // S1 fix: filter by visible page_id so retrieval never returns chunks from others' private pages (IDOR)
            const accessiblePageIds = accessiblePageIdsFor(req);
            const results = await hybridSearch(app, query, top_k || 10, accessiblePageIds);
            json(res, { query, results, count: results.length });
        } catch (e) {
            console.error('[RAG-Enhanced] Query error:', e.message);
            error(res, `Query failed: ${e.message}`, 500);
        }
    });

    // ── Get page passage index (S1: read ownership check, private passages not leaked to non-owners) ──
    app.registerRoute('GET', '/api/rag/chunks/:pageId', (req, res) => {
        const { canReadPage } = require('../middleware/authz');
        const page = db ? db.prepare('SELECT * FROM pages WHERE id = ?').get(req.params.pageId) : null;
        if (!page) return error(res, 'Page not found', 404, 'NOT_FOUND');
        if (!canReadPage(req, res, page)) return;
        const chunks = getPageChunks(req.params.pageId);
        json(res, { page_id: req.params.pageId, chunks });
    });

    // ── Incrementally index a single page ─────────────────────────────────────────────────
    app.registerRoute('POST', '/api/rag/reindex/:id', async (req, res) => {
        // R10 fix: single-page reindex also runs embeddings on the GPU, so gate it to admin like the full reindex.
        if (!requireAdmin(req, res)) return;
        try {
            const result = await reindexPage(app, req.params.id);
            json(res, result);
        } catch (e) {
            console.error('[RAG-Enhanced] Reindex error:', e.message);
            error(res, e.message, 500);
        }
    });

    // ── Batch index all pages ─────────────────────────────────────────────────
    app.registerRoute('POST', '/api/rag/reindex-all', async (req, res) => {
        // R10 fix: full-library serial embedding monopolizes the GPU, so it must be admin-gated to prevent DoS by any user.
        if (!requireAdmin(req, res)) return;
        const { getDB } = require('../db');
        const db = getDB();
        if (!db) return error(res, 'DB not available', 500);
        // A5/P1-P4 fix: unbounded serial embedding → a single request runs forever + an embedding storm saturates the GPU.
        // Cap pages per batch; the excess is skipped and reported in the response so callers can come back in batches (avoids a hung request).
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
            console.log(`[RAG-Enhanced] reindex-all: ${indexed} ok / ${failed} fail, batch ${pages.length}/${total}${dropped > 0 ? ` (dropped ${dropped}, retry in batches)` : ''}`);
            json(res, { total, batch: pages.length, indexed, failed, dropped });
        } catch (e) {
            error(res, e.message, 500);
        }
    });
}

module.exports = { register };
