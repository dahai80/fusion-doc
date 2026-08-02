// =============================================================================
// 知识图谱可视化 — D3.js Force-Directed Layout
// =============================================================================
import { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import { api } from '../../lib/api';

export default function GraphPage() {
    const svgRef = useRef(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [stats, setStats] = useState({ nodes: 0, edges: 0 });

    useEffect(() => {
        loadGraph();
    }, []);

    const loadGraph = async (searchQ) => {
        const endpoint = searchQ ? `/api/graph/search?q=${encodeURIComponent(searchQ)}` : '/api/graph';
        const data = await api('GET', endpoint).catch(() => ({ nodes: [], edges: [] }));
        setStats({ nodes: data.nodes?.length || 0, edges: data.edges?.length || 0 });
        renderGraph(data);
    };

    const handleSearch = (e) => {
        e.preventDefault();
        loadGraph(searchQuery);
    };

    const renderGraph = (data) => {
        const svg = d3.select(svgRef.current);
        svg.selectAll('*').remove();

        const width = svgRef.current.clientWidth;
        const height = svgRef.current.clientHeight || 600;

        svg.attr('viewBox', [0, 0, width, height]);

        const g = svg.append('g');

        svg.call(d3.zoom().scaleExtent([0.1, 4]).on('zoom', (event) => {
            g.attr('transform', event.transform);
        }));

        const nodes = (data.nodes || []).map(n => ({ ...n }));
        const edges = (data.edges || []).map(e => ({
            ...e,
            source: nodes.find(n => n.id === e.source) || e.source,
            target: nodes.find(n => n.id === e.target) || e.target,
        })).filter(e => e.source && e.target && typeof e.source === 'object' && typeof e.target === 'object');

        const simulation = d3.forceSimulation(nodes)
            .force('link', d3.forceLink(edges).id(d => d.id).distance(120))
            .force('charge', d3.forceManyBody().strength(-300))
            .force('center', d3.forceCenter(width / 2, height / 2))
            .force('collision', d3.forceCollide().radius(40));

        const link = g.append('g')
            .selectAll('line')
            .data(edges)
            .join('line')
            .attr('stroke', '#4b5563')
            .attr('stroke-opacity', 0.6)
            .attr('stroke-width', 1.5);

        const linkLabel = g.append('g')
            .selectAll('text')
            .data(edges.filter(e => e.label))
            .join('text')
            .text(d => d.label)
            .attr('fill', '#6b7280')
            .attr('font-size', 10)
            .attr('text-anchor', 'middle');

        const node = g.append('g')
            .selectAll('g')
            .data(nodes)
            .join('g')
            .call(d3.drag()
                .on('start', (event, d) => {
                    if (!event.active) simulation.alphaTarget(0.3).restart();
                    d.fx = d.x;
                    d.fy = d.y;
                })
                .on('drag', (event, d) => {
                    d.fx = event.x;
                    d.fy = event.y;
                })
                .on('end', (event, d) => {
                    if (!event.active) simulation.alphaTarget(0);
                    d.fx = null;
                    d.fy = null;
                })
            );

        node.append('circle')
            .attr('r', d => d.score ? 8 + d.score * 10 : 8)
            .attr('fill', d => d.score ? '#818cf8' : '#6366f1')
            .attr('stroke', '#1e1b4b')
            .attr('stroke-width', 2)
            .style('cursor', 'pointer')
            .on('click', (event, d) => {
                window.location.href = `/page/${d.id}`;
            });

        node.append('text')
            .text(d => (d.title || '').slice(0, 20))
            .attr('dy', -14)
            .attr('fill', '#d1d5db')
            .attr('font-size', 11)
            .attr('text-anchor', 'middle')
            .style('pointer-events', 'none');

        node.append('title')
            .text(d => d.title || d.id);

        simulation.on('tick', () => {
            link
                .attr('x1', d => d.source.x)
                .attr('y1', d => d.source.y)
                .attr('x2', d => d.target.x)
                .attr('y2', d => d.target.y);
            linkLabel
                .attr('x', d => (d.source.x + d.target.x) / 2)
                .attr('y', d => (d.source.y + d.target.y) / 2);
            node.attr('transform', d => `translate(${d.x},${d.y})`);
        });
    };

    return (
        <div className="flex-1 flex flex-col bg-surface-0">
            <div className="border-b border-surface-3 px-4 py-3 flex items-center gap-4">
                <h2 className="text-lg font-semibold text-gray-200">知识图谱</h2>
                <form onSubmit={handleSearch} className="flex gap-2">
                    <input
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="语义搜索..."
                        className="bg-surface-1 border border-surface-3 rounded-lg px-3 py-1 text-sm text-gray-300 outline-none focus:border-brand-500"
                    />
                    <button type="submit" className="px-3 py-1 text-sm bg-brand-600 hover:bg-brand-500 rounded-lg">
                        搜索
                    </button>
                </form>
                <button onClick={() => { setSearchQuery(''); loadGraph(); }} className="text-sm text-gray-400 hover:text-gray-200">
                    重置
                </button>
                <div className="ml-auto text-xs text-gray-500">
                    {stats.nodes} 节点 · {stats.edges} 连接
                </div>
            </div>
            <svg ref={svgRef} className="flex-1 w-full" style={{ minHeight: 600 }} />
        </div>
    );
}
