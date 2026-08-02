import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { usePageStore } from '../../stores/pageStore';
import { useBookStore } from '../../stores/bookStore';

export default function HomePage() {
    const navigate = useNavigate();
    const { pages, fetchPages, createPage } = usePageStore();
    const { books, fetchBooks } = useBookStore();
    const [health, setHealth] = useState(null);

    useEffect(() => {
        fetchPages();
        fetchBooks();
        api('GET', '/health').then(setHealth).catch(() => {});
    }, []);

    const handleNewPage = async () => {
        const page = await createPage({
            title: '未命名文档',
            content: '',
        });
        navigate(`/page/${page.id}`);
    };

    return (
        <div className="flex-1 overflow-auto p-8">
            <div className="max-w-4xl mx-auto">
                <div className="mb-8">
                    <h1 className="text-4xl font-bold bg-gradient-to-r from-brand-400 to-brand-600 bg-clip-text text-transparent">
                        Fusion-Doc
                    </h1>
                    <p className="text-gray-400 mt-2">
                        AI-First Document OS — 离线可用、AI 深度嵌入、Office 原生操控
                    </p>
                </div>

                <div className="grid grid-cols-2 gap-4 mb-8">
                    <button
                        onClick={handleNewPage}
                        className="p-6 bg-surface-1 hover:bg-surface-2 border border-surface-3 rounded-xl transition-colors text-left"
                    >
                        <div className="text-2xl mb-2">📄</div>
                        <div className="font-semibold">新建文档</div>
                        <div className="text-sm text-gray-400">从空白页面开始</div>
                    </button>
                    <button
                        onClick={() => navigate('/graph')}
                        className="p-6 bg-surface-1 hover:bg-surface-2 border border-surface-3 rounded-xl transition-colors text-left"
                    >
                        <div className="text-2xl mb-2">🕸️</div>
                        <div className="font-semibold">知识图谱</div>
                        <div className="text-sm text-gray-400">浏览文档关系网络</div>
                    </button>
                </div>

                {health && (
                    <div className="mb-8">
                        <h2 className="text-lg font-semibold mb-3">系统状态</h2>
                        <div className="grid grid-cols-3 gap-3">
                            <div className="bg-surface-1 rounded-lg p-3">
                                <div className="text-xs text-gray-400">服务器</div>
                                <div className="text-sm font-medium text-green-400">
                                    {health.status || '运行中'}
                                </div>
                            </div>
                            <div className="bg-surface-1 rounded-lg p-3">
                                <div className="text-xs text-gray-400">Fusion-MLX</div>
                                <div className={`text-sm font-medium ${health.mlx ? 'text-green-400' : 'text-yellow-400'}`}>
                                    {health.mlx ? '已连接' : '未连接'}
                                </div>
                            </div>
                            <div className="bg-surface-1 rounded-lg p-3">
                                <div className="text-xs text-gray-400">文档数</div>
                                <div className="text-sm font-medium">{pages.length}</div>
                            </div>
                        </div>
                    </div>
                )}

                {pages.length > 0 && (
                    <div>
                        <h2 className="text-lg font-semibold mb-3">最近文档</h2>
                        <div className="space-y-2">
                            {pages.slice(0, 10).map((page) => (
                                <button
                                    key={page.id}
                                    onClick={() => navigate(`/page/${page.id}`)}
                                    className="w-full text-left p-3 bg-surface-1 hover:bg-surface-2 border border-surface-3 rounded-lg transition-colors flex items-center justify-between"
                                >
                                    <div>
                                        <div className="font-medium">{page.title || '未命名文档'}</div>
                                        <div className="text-xs text-gray-400">
                                            {page.updated_at || page.created_at}
                                        </div>
                                    </div>
                                    <span className="text-gray-400">→</span>
                                </button>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
