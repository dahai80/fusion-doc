// =============================================================================
// Fusion-Doc — 知识图谱控制器（增强版）
// 双向链接图谱 + 语义搜索 + RAG 增强
// =============================================================================

const { json, error } = require('../utils/response');
const { search: ragSearch } = require('../services/rag');

function register(app) {
    const { db } = app;

    // ── 图谱数据 ────────────────────────────────────────────────────────
    app.registerRoute('GET', '/api/graph', (req, res) => {
        let nodes = [], edges = [];
        if (db) {
            nodes = db.prepare('SELECT id, title FROM pages').all()
                .map(p => ({ id: p.id, title: p.title, type: 'page' }));

            edges = db.prepare('SELECT id, source_page_id as source, target_page_id as target, link_type as label FROM page_links').all();

            // E17 修复: 原 O(N×M×(N+E)) — 每条 wiki link 都 nodes.find + edges.find 全表扫。
            // 改用 title->node Map + "src|tgt" 去重 Set, 单次建索引后 O(1) 查, 总体 O(N×M)。
            const nodeByTitle = new Map(nodes.map(n => [n.title, n]));
            const edgeSeen = new Set(edges.map(e => `${e.source}|${e.target}`));

            // 从内容中提取 [[]] 双向链接
            const pages = db.prepare('SELECT id, content FROM pages').all();
            for (const page of pages) {
                const links = extractWikiLinks(page.content || '');
                for (const link of links) {
                    const target = nodeByTitle.get(link);
                    if (!target) continue;
                    const key = `${page.id}|${target.id}`;
                    if (edgeSeen.has(key)) continue;
                    edgeSeen.add(key);
                    edges.push({
                        id: `wiki-${page.id}-${target.id}`,
                        source: page.id,
                        target: target.id,
                        label: 'wikilink',
                    });
                }
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
            const results = await ragSearch(app, query, 10);
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

        const node = db.prepare('SELECT id, title FROM pages WHERE id = ?').get(id);
        if (!node) return error(res, 'Node not found', 404);

        const outEdges = db.prepare('SELECT target_page_id as target, link_type as label FROM page_links WHERE source_page_id = ?').all(id);
        const inEdges = db.prepare('SELECT source_page_id as source, link_type as label FROM page_links WHERE target_page_id = ?').all(id);

        const neighborIds = [...new Set([...outEdges.map(e => e.target), ...inEdges.map(e => e.source)])];
        const neighbors = neighborIds.length
            ? db.prepare(`SELECT id, title FROM pages WHERE id IN (${neighborIds.map(() => '?').join(',')})`).all(...neighborIds)
            : [];

        json(res, { node, neighbors, outEdges, inEdges });
    });
}

function extractWikiLinks(content) {
    const matches = content.matchAll(/\[\[([^\]]+)\]\]/g);
    return [...matches].map(m => m[1]);
}

module.exports = { register };
