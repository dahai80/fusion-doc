import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { searchPages } from '../../lib/api';

export default function SearchModal({ open, onClose }) {
    const [query, setQuery] = useState('');
    const [results, setResults] = useState([]);
    const [loading, setLoading] = useState(false);
    const [activeIndex, setActiveIndex] = useState(-1);
    const navigate = useNavigate();
    const inputRef = useRef(null);
    const timerRef = useRef(null);

    useEffect(() => {
        if (open && inputRef.current) {
            inputRef.current.focus();
            setQuery('');
            setResults([]);
            setActiveIndex(-1);
        }
    }, [open]);

    useEffect(() => {
        const handler = (e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
                e.preventDefault();
                if (!open) onClose.__open?.();
                else onClose?.();
            }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [open, onClose]);

    const doSearch = useCallback((q) => {
        if (!q.trim()) { setResults([]); return; }
        setLoading(true);
        searchPages(q)
            .then((data) => {
                setResults(Array.isArray(data) ? data : data?.data || []);
                setActiveIndex(-1);
            })
            .catch(() => setResults([]))
            .finally(() => setLoading(false));
    }, []);

    useEffect(() => {
        clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => doSearch(query), 250);
        return () => clearTimeout(timerRef.current);
    }, [query, doSearch]);

    const handleSelect = (page) => {
        navigate(`/page/${page.id}`);
        setQuery('');
        setResults([]);
        onClose();
    };

    const handleKeyDown = (e) => {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActiveIndex((i) => Math.min(i + 1, results.length - 1));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActiveIndex((i) => Math.max(i - 1, 0));
        } else if (e.key === 'Enter' && activeIndex >= 0 && results[activeIndex]) {
            handleSelect(results[activeIndex]);
        } else if (e.key === 'Escape') {
            onClose();
        }
    };

    if (!open) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]" onClick={onClose}>
            <div className="fixed inset-0 bg-black/50" />
            <div
                className="relative w-full max-w-xl rounded-xl shadow-2xl overflow-hidden"
                style={{ background: 'var(--surface-1)', border: '1px solid var(--border-color)' }}
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-center px-4 border-b" style={{ borderColor: 'var(--border-color)' }}>
                    <span className="mr-2" style={{ color: 'var(--text-muted)' }}>🔍</span>
                    <input
                        ref={inputRef}
                        type="text"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder="搜索文档... (Cmd+K)"
                        className="flex-1 py-3 bg-transparent text-sm focus:outline-none"
                        style={{ color: 'var(--text-primary)' }}
                    />
                    {loading && <span className="text-xs" style={{ color: 'var(--text-muted)' }}>搜索中...</span>}
                    <kbd className="ml-2 text-xs px-1.5 py-0.5 rounded" style={{ background: 'var(--surface-2)', color: 'var(--text-muted)' }}>ESC</kbd>
                </div>

                {results.length > 0 && (
                    <ul className="max-h-80 overflow-auto py-1">
                        {results.map((page, idx) => (
                            <li
                                key={page.id}
                                onClick={() => handleSelect(page)}
                                className="px-4 py-2.5 cursor-pointer flex items-center gap-3 text-sm"
                                style={{
                                    background: idx === activeIndex ? 'var(--surface-2)' : 'transparent',
                                    color: 'var(--text-primary)',
                                }}
                                onMouseEnter={() => setActiveIndex(idx)}
                            >
                                <span>📄</span>
                                <div className="flex-1 min-w-0">
                                    <div className="truncate font-medium">{page.title || '未命名'}</div>
                                    {page.excerpt && (
                                        <div className="text-xs truncate mt-0.5" style={{ color: 'var(--text-muted)' }}>
                                            {page.excerpt}
                                        </div>
                                    )}
                                </div>
                                <kbd className="text-xs px-1.5 py-0.5 rounded" style={{ background: 'var(--surface-2)', color: 'var(--text-muted)' }}>↵</kbd>
                            </li>
                        ))}
                    </ul>
                )}

                {query && !loading && results.length === 0 && (
                    <div className="py-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
                        未找到匹配文档
                    </div>
                )}

                {!query && (
                    <div className="py-6 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
                        输入关键词搜索文档
                    </div>
                )}
            </div>
        </div>
    );
}
