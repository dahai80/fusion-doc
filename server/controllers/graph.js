// =============================================================================
// Fusion-Doc — knowledge graph controller (enhanced)
// Bidirectional link graph + semantic search + RAG enhancement
// =============================================================================

const { json, error } = require('../utils/response');
const { search: ragSearch } = require('../services/rag');

function register(app) {
    const { db } = app;

    // A4/P3 fix: compute the set of page_ids visible to the current user (admin unrestricted); the graph only exposes visible page nodes/edges.
    // Also caps /api/graph page size so libraries with 10k+ pages don't load all content at once and OOM.
    function accessiblePageFilter(req) {
        const { tenantId } = require('../utils/helpers');
        const tid = tenantId(req);
        const isAdmin = req.user?.role === 'admin' || req.user?.role === 'tenant_admin';
        // issue #45: admin unrestricted within the tenant; regular users see only published OR self-created pages
        if (isAdmin) return db.prepare('SELECT id FROM pages WHERE tenant_id = ?').all(tid).map(r => r.id);
        const owner = req.user?.id || 'local';
        return db.prepare('SELECT id FROM pages WHERE tenant_id = ? AND (is_published = 1 OR created_by = ?)').all(tid, owner).map(r => r.id);
    }

    function pageIdInClause(ids) {
        if (ids === null) return { clause: '', params: [] };
        if (!ids.length) return { clause: ' AND 1=0', params: [] };
        return { clause: ` AND id IN (${ids.map(() => '?').join(',')})`, params: ids };
    }

    // ── Graph data ────────────────────────────────────────────────────────
    app.registerRoute('GET', '/api/graph', (req, res) => {
        if (!db) return json(res, { nodes: [], edges: [] });
        // A4/P3: page size cap (default 500, max 2000) so 10k+ page libraries don't load all content and OOM
        const limit = Math.min(Math.max(parseInt(req.ctx.url.searchParams.get('limit'), 10) || 500, 1), 2000);
        const visible = accessiblePageFilter(req);
        const pf = pageIdInClause(visible);
        if (visible !== null && visible.length === 0) return json(res, { nodes: [], edges: [] });

        // A4: nodes fetch only id/title, not full text; edges filtered by visible pages
        const nodes = db.prepare(`SELECT id, title FROM pages WHERE 1=1${pf.clause} ORDER BY updated_at DESC LIMIT ?`).all(...pf.params, limit)
            .map(p => ({ id: p.id, title: p.title, type: 'page' }));
        const nodeIds = nodes.map(n => n.id);
        if (!nodeIds.length) return json(res, { nodes, edges: [] });
        const idPh = nodeIds.map(() => '?').join(',');
        const edges = db.prepare(`SELECT id, source_page_id as source, target_page_id as target, link_type as label FROM page_links WHERE source_page_id IN (${idPh}) OR target_page_id IN (${idPh})`).all(...nodeIds, ...nodeIds);

        // E17 fix: title->node Map + "src|tgt" dedup Set for O(1) lookups.
        // A4: extract wiki links only from loaded nodes' content (already LIMITed), no more full-table content scan.
        const nodeByTitle = new Map(nodes.map(n => [n.title, n]));
        const nodeById = new Set(nodeIds);
        const edgeSeen = new Set(edges.map(e => `${e.source}|${e.target}`));
        const pages = db.prepare(`SELECT id, content FROM pages WHERE id IN (${idPh})`).all(...nodeIds);
        for (const page of pages) {
            const links = extractWikiLinks(page.content || '');
            for (const link of links) {
                const target = nodeByTitle.get(link);
                if (!target || !nodeById.has(target.id)) continue;
                const key = `${page.id}|${target.id}`;
                if (edgeSeen.has(key)) continue;
                edgeSeen.add(key);
                edges.push({ id: `wiki-${page.id}-${target.id}`, source: page.id, target: target.id, label: 'wikilink' });
            }
        }
        json(res, { nodes, edges });
    });

    // ── Semantic search over graph nodes ────────────────────────────────────────────────
    app.registerRoute('GET', '/api/graph/search', async (req, res) => {
        const url = new URL(req.url, `http://${req.headers.host}`);
        const query = url.searchParams.get('q');
        if (!query) return error(res, 'q parameter required', 400);

        try {
            // S1: filter semantic search by visible page_id so private pages don't leak
            const accessiblePageIds = accessiblePageFilter(req);
            const results = await ragSearch(app, query, 10, accessiblePageIds);
            const pageIds = [...new Set(results.map(r => r.page_id))];

            let nodes = [], edges = [];
            if (db && pageIds.length) {
                const placeholders = pageIds.map(() => '?').join(',');
                nodes = db.prepare(`SELECT id, title FROM pages WHERE id IN (${placeholders})`).all(...pageIds)
                    .map(p => ({ id: p.id, title: p.title, type: 'page', score: results.find(r => r.page_id === p.id)?.score || 0 }));
                edges = db.prepare(`SELECT id, source_page_id as source, target_page_id as target, link_type as label FROM page_links WHERE source_page_id IN (${placeholders}) OR target_page_id IN (${placeholders})`).all(...pageIds, ...pageIds);
            }
            json(res, { nodes, edges, results });
        } catch (e) {
            console.error('[Graph] Search error:', e.message);
            error(res, `Search failed: ${e.message}`, 500);
        }
    });

    // ── Node detail (with related nodes) ─────────────────────────────────────────────
    app.registerRoute('GET', '/api/graph/node/:id', (req, res) => {
        const { id } = req.params;
        if (!db) return json(res, { node: null, neighbors: [] });
        const { canReadPage } = require('../middleware/authz');

        const node = db.prepare('SELECT * FROM pages WHERE id = ?').get(id);
        if (!node) return error(res, 'Node not found', 404);
        // S follow-up: node detail checks page read ownership so private pages aren't exposed to non-owners
        if (!canReadPage(req, res, node)) return;

        const outEdges = db.prepare('SELECT target_page_id as target, link_type as label FROM page_links WHERE source_page_id = ?').all(id);
        const inEdges = db.prepare('SELECT source_page_id as source, link_type as label FROM page_links WHERE target_page_id = ?').all(id);

        const neighborIds = [...new Set([...outEdges.map(e => e.target), ...inEdges.map(e => e.source)])];
        // Neighbors are also filtered by visibility so graph edges don't leak private page titles
        const visible = accessiblePageFilter(req);
        const visibleSet = visible === null ? null : new Set(visible);
        const allowedNeighborIds = visibleSet === null ? neighborIds : neighborIds.filter(nid => visibleSet.has(nid));
        const neighbors = allowedNeighborIds.length
            ? db.prepare(`SELECT id, title FROM pages WHERE id IN (${allowedNeighborIds.map(() => '?').join(',')})`).all(...allowedNeighborIds)
            : [];

        json(res, { node: { id: node.id, title: node.title, type: 'page' }, neighbors, outEdges, inEdges });
    });
}

function extractWikiLinks(content) {
    const matches = content.matchAll(/\[\[([^\]]+)\]\]/g);
    return [...matches].map(m => m[1]);
}

module.exports = { register };
