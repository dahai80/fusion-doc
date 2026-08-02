import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { usePageStore } from '../../stores/pageStore';
import { useBookStore } from '../../stores/bookStore';
import { useUIStore } from '../../stores/uiStore';

export default function Sidebar() {
    const navigate = useNavigate();
    const { id: activePageId } = useParams();
    const { pages, fetchPages, createPage } = usePageStore();
    const { books, chapters, fetchBooks, fetchChapters } = useBookStore();
    const setActiveView = useUIStore((s) => s.setActiveView);
    const theme = useUIStore((s) => s.theme);
    const toggleTheme = useUIStore((s) => s.toggleTheme);
    const [search, setSearch] = useState('');

    useEffect(() => {
        fetchPages();
        fetchBooks();
    }, []);

    const filtered = search
        ? pages.filter((p) => (p.title || '').toLowerCase().includes(search.toLowerCase()))
        : pages;

    const grouped = {};
    for (const page of filtered) {
        const key = page.book_id || 'unfiled';
        if (!grouped[key]) grouped[key] = { book: books.find((b) => b.id === key), pages: [] };
        grouped[key].pages.push(page);
    }

    const handleNewPage = async () => {
        const page = await createPage({ title: '未命名文档', content: '' });
        navigate(`/page/${page.id}`);
    };

    return (
        <aside className="w-60 bg-surface-1 border-r border-[var(--border-color)] flex flex-col">
            <div className="p-3 border-b border-[var(--border-color)]">
                <div className="flex items-center justify-between mb-2">
                    <span className="font-semibold text-sm">📚 Fusion-Doc</span>
                    <button onClick={handleNewPage} className="text-xs bg-brand-600 hover:bg-brand-500 px-2 py-1 rounded text-white">
                        + 新建
                    </button>
                </div>
                <input
                    type="text"
                    placeholder="搜索文档..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="w-full bg-surface-0 border border-[var(--border-color)] rounded px-2 py-1 text-xs focus:outline-none focus:border-brand-500"
                    style={{ color: 'var(--text-primary)' }}
                />
            </div>

            <nav className="flex-1 overflow-auto p-2">
                {Object.entries(grouped).map(([key, group]) => (
                    <div key={key} className="mb-2">
                        {group.book && (
                            <div className="text-xs font-semibold px-2 py-1 uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                                📚 {group.book.name}
                            </div>
                        )}
                        {group.pages.map((page) => (
                            <button
                                key={page.id}
                                onClick={() => navigate(`/page/${page.id}`)}
                                className={`w-full text-left px-2 py-1.5 rounded text-sm flex items-center gap-2 transition-colors ${
                                    activePageId === page.id
                                        ? 'bg-brand-600/20 text-brand-300'
                                        : 'hover:bg-surface-2'
                                }`}
                                style={activePageId !== page.id ? { color: 'var(--text-primary)' } : {}}
                            >
                                <span>📄</span>
                                <span className="truncate">{page.title || '未命名'}</span>
                            </button>
                        ))}
                    </div>
                ))}

                {grouped.unfiled && grouped.unfiled.pages.length > 0 && !grouped.unfiled.book && (
                    <div className="mb-2">
                        <div className="text-xs font-semibold px-2 py-1" style={{ color: 'var(--text-muted)' }}>未分类</div>
                        {grouped.unfiled.pages.map((page) => (
                            <button
                                key={page.id}
                                onClick={() => navigate(`/page/${page.id}`)}
                                className={`w-full text-left px-2 py-1.5 rounded text-sm flex items-center gap-2 transition-colors ${
                                    activePageId === page.id
                                        ? 'bg-brand-600/20 text-brand-300'
                                        : 'hover:bg-surface-2'
                                }`}
                                style={activePageId !== page.id ? { color: 'var(--text-primary)' } : {}}
                            >
                                <span>📄</span>
                                <span className="truncate">{page.title || '未命名'}</span>
                            </button>
                        ))}
                    </div>
                )}
            </nav>

            <div className="p-2 border-t border-[var(--border-color)] space-y-1">
                <button
                    onClick={() => navigate('/graph')}
                    className="w-full text-left px-2 py-1.5 rounded text-sm hover:bg-surface-2 flex items-center gap-2"
                    style={{ color: 'var(--text-secondary)' }}
                    onMouseEnter={(e) => e.target.style.color = 'var(--text-primary)'}
                    onMouseLeave={(e) => e.target.style.color = 'var(--text-secondary)'}
                >
                    <span>🕸️</span> 知识图谱
                </button>
                <button
                    onClick={toggleTheme}
                    className="w-full text-left px-2 py-1.5 rounded text-sm hover:bg-surface-2 flex items-center gap-2"
                    style={{ color: 'var(--text-secondary)' }}
                    onMouseEnter={(e) => e.target.style.color = 'var(--text-primary)'}
                    onMouseLeave={(e) => e.target.style.color = 'var(--text-secondary)'}
                >
                    <span>{theme === 'dark' ? '☀️' : '🌙'}</span> {theme === 'dark' ? '亮色模式' : '暗色模式'}
                </button>
            </div>
        </aside>
    );
}
