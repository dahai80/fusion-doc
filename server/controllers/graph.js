// =============================================================================
// Fusion-Doc — 知识图谱控制器（增强版）
// 双向链接图谱 + 语义搜索 + RAG 增强
// =============================================================================

const { json, error } = require('../utils/response');
const { search: ragSearch } = require('../services/rag');

function register(app) {
    const { db } = app;

    // A4/P3 修复: 计算当前用户可见 page_id 集合 (admin 无限制), 图谱只暴露可见页节点/边。
    // 同时为 /api/graph 提供分页上限, 避免万页级库一次拉全部内容 OOM。
    function accessiblePageFilter(req) {
        const { tenantId } = require('../utils/helpers');
        const tid = tenantId(req);
        const isAdmin = req.user?.role === 'admin' || req.user?.role === 'tenant_admin';
        // issue #45: admin 在本租户内无限制; 普通用户仅已发布 OR 自建页
        if (isAdmin) return db.prepare('SELECT id FROM pages WHERE tenant_id = ?').all(tid).map(r => r.id);
        const owner = req.user?.id || 'local';
        return db.prepare('SELECT id FROM pages WHERE tenant_id = ? AND (is_published = 1 OR created_by = ?)').all(tid, owner).map(r => r.id);
    }

    function pageIdInClause(ids) {
        if (ids === null) return { clause: '', params: [] };
        if (!ids.length) return { clause: ' AND 1=0', params: [] };
        return { clause: ` AND id IN (${ids.map(() => '?').join(',')})`, params: ids };
    }

    // ── 图谱数据 ────────────────────────────────────────────────────────
    app.registerRoute('GET', '/api/graph', (req, res) => {
        if (!db) return json(res, { nodes: [], edges: [] });
        // A4/P3: 分页上限 (默认 500, 最大 2000), 防万页库全量拉内容 OOM
        const limit = Math.min(Math.max(parseInt(req.ctx.url.searchParams.get('limit'), 10) || 500, 1), 2000);
        const visible = accessiblePageFilter(req);
        const pf = pageIdInClause(visible);
        if (visible !== null && visible.length === 0) return json(res, { nodes: [], edges: [] });

        // A4: 节点仅取 id/title, 不拉全文; 边按可见页过滤
        const nodes = db.prepare(`SELECT id, title FROM pages WHERE 1=1${pf.clause} ORDER BY updated_at DESC LIMIT ?`).all(...pf.params, limit)
            .map(p => ({ id: p.id, title: p.title, type: 'page' }));
        const nodeIds = nodes.map(n => n.id);
        if (!nodeIds.length) return json(res, { nodes, edges: [] });
        const idPh = nodeIds.map(() => '?').join(',');
        const edges = db.prepare(`SELECT id, source_page_id as source, target_page_id as target, link_type as label FROM page_links WHERE source_page_id IN (${idPh}) OR target_page_id IN (${idPh})`).all(...nodeIds, ...nodeIds);

        // E17 修复: title->node Map + "src|tgt" 去重 Set, O(1) 查。
        // A4: 仅对已加载的 node 取 content 提取 wiki link (已 LIMIT), 不再全表扫 content。
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

    // ── 语义搜索图谱节点 ────────────────────────────────────────────────
    app.registerRoute('GET', '/api/graph/search', async (req, res) => {
        const url = new URL(req.url, `http://${req.headers.host}`);
        const query = url.searchParams.get('q');
        if (!query) return error(res, 'q parameter required', 400);

        try {
            // S1: 语义搜索按可见 page_id 过滤, 不泄露私有页
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

    // ── 节点详情（含关联节点）─────────────────────────────────────────────
    app.registerRoute('GET', '/api/graph/node/:id', (req, res) => {
        const { id } = req.params;
        if (!db) return json(res, { node: null, neighbors: [] });
        const { canReadPage } = require('../middleware/authz');

        const node = db.prepare('SELECT * FROM pages WHERE id = ?').get(id);
        if (!node) return error(res, 'Node not found', 404);
        // S 延伸: 节点详情读页归属校验, 不暴露私有页给非 owner
        if (!canReadPage(req, res, node)) return;

        const outEdges = db.prepare('SELECT target_page_id as target, link_type as label FROM page_links WHERE source_page_id = ?').all(id);
        const inEdges = db.prepare('SELECT source_page_id as source, link_type as label FROM page_links WHERE target_page_id = ?').all(id);

        const neighborIds = [...new Set([...outEdges.map(e => e.target), ...inEdges.map(e => e.source)])];
        // 邻居也按可见页过滤, 避免经图谱边泄露私有页标题
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
