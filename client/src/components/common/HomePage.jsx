import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { usePageStore } from '../../stores/pageStore';
import { useBookStore } from '../../stores/bookStore';
import { useT } from '../../stores/langStore';

export default function HomePage() {
    const navigate = useNavigate();
    const { pages, fetchPages, createPage } = usePageStore();
    const { books, fetchBooks } = useBookStore();
    const t = useT();
    const [health, setHealth] = useState(null);

    useEffect(() => {
        fetchPages();
        fetchBooks();
        api('GET', '/health').then(setHealth).catch(() => {});
    }, []);

    const handleNewPage = async () => {
        const page = await createPage({
            title: t('未命名文档', 'Untitled document'),
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
                        {t('AI-First Document OS — 离线可用、AI 深度嵌入、Office 原生操控', 'AI-First Document OS — offline-ready, AI-embedded, native Office control')}
                    </p>
                </div>

                <div className="grid grid-cols-2 gap-4 mb-8">
                    <button
                        onClick={handleNewPage}
                        className="p-6 bg-surface-1 hover:bg-surface-2 border border-surface-3 rounded-xl transition-colors text-left"
                    >
                        <div className="text-2xl mb-2">📄</div>
                        <div className="font-semibold">{t('新建文档', 'New Document')}</div>
                        <div className="text-sm text-gray-400">{t('从空白页面开始', 'Start from a blank page')}</div>
                    </button>
                    <button
                        onClick={() => navigate('/graph')}
                        className="p-6 bg-surface-1 hover:bg-surface-2 border border-surface-3 rounded-xl transition-colors text-left"
                    >
                        <div className="text-2xl mb-2">🕸️</div>
                        <div className="font-semibold">{t('知识图谱', 'Knowledge Graph')}</div>
                        <div className="text-sm text-gray-400">{t('浏览文档关系网络', 'Browse the document relation network')}</div>
                    </button>
                </div>

                {health && (
                    <div className="mb-8">
                        <h2 className="text-lg font-semibold mb-3">{t('系统状态', 'System Status')}</h2>
                        <div className="grid grid-cols-3 gap-3">
                            <div className="bg-surface-1 rounded-lg p-3">
                                <div className="text-xs text-gray-400">{t('服务器', 'Server')}</div>
                                <div className="text-sm font-medium text-green-400">
                                    {health.status || t('运行中', 'running')}
                                </div>
                            </div>
                            <div className="bg-surface-1 rounded-lg p-3">
                                <div className="text-xs text-gray-400">Fusion-MLX</div>
                                <div className={`text-sm font-medium ${health.checks?.mlx?.ok ? 'text-green-400' : 'text-yellow-400'}`}>
                                    {health.checks?.mlx?.ok ? t('已连接', 'connected') : t('未连接', 'disconnected')}
                                </div>
                            </div>
                            <div className="bg-surface-1 rounded-lg p-3">
                                <div className="text-xs text-gray-400">{t('文档数', 'Documents')}</div>
                                <div className="text-sm font-medium">{pages.length}</div>
                            </div>
                        </div>
                    </div>
                )}

                {pages.length > 0 && (
                    <div>
                        <h2 className="text-lg font-semibold mb-3">{t('最近文档', 'Recent Documents')}</h2>
                        <div className="space-y-2">
                            {pages.slice(0, 10).map((page) => (
                                <button
                                    key={page.id}
                                    onClick={() => navigate(`/page/${page.id}`)}
                                    className="w-full text-left p-3 bg-surface-1 hover:bg-surface-2 border border-surface-3 rounded-lg transition-colors flex items-center justify-between"
                                >
                                    <div>
                                        <div className="font-medium">{page.title || t('未命名文档', 'Untitled document')}</div>
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
