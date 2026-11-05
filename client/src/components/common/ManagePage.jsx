// =============================================================================
// ManagePage — web surface gap (issue #71)
// Un-landed REST surfaces now in UI: RAG pipeline management (reindex-all,
// chunk browse), multi-format page export (markdown/html/pdf), tags admin,
// comments moderation, activity feed. Tabs kept in one page (single nav slot).
// =============================================================================

import React, { useEffect, useState } from 'react';
import { api, apiBlob } from '../../lib/api';
import { useT } from '../../stores/langStore';

// ── RAG tab: reindex-all + per-page chunk browse ────────────────────────────
function RagPanel() {
    const t = useT();
    const [pages, setPages] = useState([]);
    const [chunks, setChunks] = useState(null);
    const [busy, setBusy] = useState(false);
    const [status, setStatus] = useState('');

    useEffect(() => {
        api('GET', '/pages').then((d) => setPages((d.data || d).slice(0, 100))).catch((e) => setStatus(e.message));
    }, []);

    const reindexAll = async () => {
        setBusy(true);
        setStatus('');
        try {
            const r = await api('POST', '/rag/reindex-all');
            setStatus(t(`已重建 ${r.reindexed ?? r.count ?? '?'} 页索引`, `Reindexed ${r.reindexed ?? r.count ?? '?'} pages`));
        } catch (e) {
            setStatus(e.message);
        } finally {
            setBusy(false);
        }
    };

    const browseChunks = async (pageId) => {
        setChunks(null);
        try {
            const r = await api('GET', `/rag/chunks/${pageId}`);
            setChunks(r.chunks || []);
        } catch (e) {
            setStatus(e.message);
        }
    };

    return (
        <div className="space-y-4">
            <div className="flex items-center gap-3">
                <button onClick={reindexAll} disabled={busy}
                    className="bg-brand-600 hover:bg-brand-500 disabled:opacity-40 px-3 py-1.5 rounded-lg text-sm text-white transition-colors">
                    {t('重建全部索引', 'Reindex all')}
                </button>
                {status && <span className="text-xs text-emerald-500">{status}</span>}
            </div>
            <div>
                <div className="text-xs font-semibold mb-1" style={{ color: 'var(--text-muted)' }}>
                    {t('按页浏览分块', 'Browse chunks by page')}
                </div>
                <div className="flex flex-wrap gap-1">
                    {pages.map((p) => (
                        <button key={p.id} onClick={() => browseChunks(p.id)}
                            className="text-xs px-2 py-1 rounded border border-[var(--border-color)] hover:bg-surface-2"
                            style={{ color: 'var(--text-primary)' }}>
                            {p.title || t('未命名', 'Untitled')}
                        </button>
                    ))}
                </div>
            </div>
            {chunks && (
                <div className="space-y-2">
                    {chunks.length === 0 && <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{t('无分块 (未索引)', 'No chunks (not indexed)')}</div>}
                    {chunks.map((c, i) => (
                        <div key={c.id || i} className="border border-[var(--border-color)] rounded-lg p-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
                            <div className="font-mono mb-1" style={{ color: 'var(--text-muted)' }}>#{i} · {c.heading || c.section || 'chunk'}</div>
                            <div className="line-clamp-3">{(c.text || c.content || '').slice(0, 300)}</div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

// ── Export tab: all formats via blob download (auth header attached) ────────
async function downloadExport(pageId, format, slug) {
    const blob = await apiBlob(`/export/${format}/${pageId}`);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${slug || 'page'}.${format}`;
    a.click();
    URL.revokeObjectURL(url);
}

function ExportPanel() {
    const t = useT();
    const [pages, setPages] = useState([]);
    const [busyId, setBusyId] = useState('');
    const [err, setErr] = useState('');

    useEffect(() => {
        api('GET', '/pages').then((d) => setPages((d.data || d).slice(0, 100))).catch((e) => setErr(e.message));
    }, []);

    const formats = ['markdown', 'html', 'pdf'];
    return (
        <div className="space-y-2">
            {err && <div className="text-xs text-red-400">{err}</div>}
            {pages.map((p) => (
                <div key={p.id} className="flex items-center justify-between border border-[var(--border-color)] rounded-lg px-3 py-2">
                    <span className="text-sm truncate" style={{ color: 'var(--text-primary)' }}>{p.title || t('未命名', 'Untitled')}</span>
                    <div className="flex gap-1">
                        {formats.map((f) => (
                            <button key={f} disabled={busyId === p.id}
                                onClick={() => { setBusyId(p.id); downloadExport(p.id, f, p.slug).catch((e) => setErr(e.message)).finally(() => setBusyId('')); }}
                                className="text-xs px-2 py-1 rounded bg-brand-600/15 text-brand-400 hover:bg-brand-600/25 uppercase transition-colors disabled:opacity-40">
                                {f}
                            </button>
                        ))}
                    </div>
                </div>
            ))}
        </div>
    );
}

// ── Tags tab: list + create (tags admin) ────────────────────────────────────
function TagsPanel() {
    const t = useT();
    const [tags, setTags] = useState([]);
    const [name, setName] = useState('');
    const [err, setErr] = useState('');

    const refresh = () => api('GET', '/tags').then((d) => setTags(d.data || d || [])).catch((e) => setErr(e.message));
    useEffect(() => { refresh(); }, []);

    const create = async () => {
        if (!name.trim()) return;
        try {
            await api('POST', '/tags', { name: name.trim() });
            setName('');
            refresh();
        } catch (e) {
            setErr(e.message);
        }
    };

    return (
        <div className="space-y-3">
            <div className="flex gap-2">
                <input value={name} onChange={(e) => setName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && create()}
                    placeholder={t('新标签名', 'New tag name')}
                    className="bg-surface-0 border border-[var(--border-color)] rounded px-2 py-1 text-sm focus:outline-none focus:border-brand-500"
                    style={{ color: 'var(--text-primary)' }} />
                <button onClick={create} className="bg-brand-600 hover:bg-brand-500 px-3 py-1 rounded-lg text-sm text-white transition-colors">
                    {t('创建', 'Create')}
                </button>
            </div>
            {err && <div className="text-xs text-red-400">{err}</div>}
            <div className="flex flex-wrap gap-2">
                {tags.map((tag) => (
                    <span key={tag.id} className="text-xs px-2 py-1 rounded-full border"
                        style={{ color: tag.color || 'var(--text-secondary)', borderColor: tag.color || 'var(--border-color)' }}>
                        {tag.name}
                    </span>
                ))}
                {tags.length === 0 && !err && <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{t('暂无标签', 'No tags')}</span>}
            </div>
        </div>
    );
}

// ── Comments tab: moderation list + delete ──────────────────────────────────
function CommentsPanel() {
    const t = useT();
    const [comments, setComments] = useState([]);
    const [err, setErr] = useState('');

    const refresh = () => api('GET', '/comments').then((d) => setComments(d.data || d || [])).catch((e) => setErr(e.message));
    useEffect(() => { refresh(); }, []);

    const remove = async (id) => {
        try {
            await api('DELETE', `/comments/${id}`);
            refresh();
        } catch (e) {
            setErr(e.message);
        }
    };

    return (
        <div className="space-y-2">
            {err && <div className="text-xs text-red-400">{err}</div>}
            {comments.length === 0 && !err && <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{t('暂无评论', 'No comments')}</span>}
            {comments.map((c) => (
                <div key={c.id} className="flex items-start justify-between gap-3 border border-[var(--border-color)] rounded-lg px-3 py-2">
                    <div className="min-w-0">
                        <div className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>{c.user_id} · {c.page_id?.slice(0, 8)} · {c.created_at}</div>
                        <div className="text-sm break-all" style={{ color: 'var(--text-primary)' }}>{c.content}</div>
                    </div>
                    <button onClick={() => remove(c.id)}
                        className="text-xs px-2 py-1 rounded text-red-400 border border-red-400/30 hover:bg-red-400/10 transition-colors shrink-0">
                        {t('删除', 'Delete')}
                    </button>
                </div>
            ))}
        </div>
    );
}

// ── Activity tab: feed ──────────────────────────────────────────────────────
function ActivityPanel() {
    const t = useT();
    const [items, setItems] = useState([]);
    const [err, setErr] = useState('');

    useEffect(() => {
        api('GET', '/activity').then((d) => setItems(d.data || d || [])).catch((e) => setErr(e.message));
    }, []);

    return (
        <div className="space-y-1">
            {err && <div className="text-xs text-red-400">{err}</div>}
            {items.length === 0 && !err && <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{t('暂无动态', 'No activity')}</span>}
            {items.map((a, i) => (
                <div key={a.id || i} className="text-sm flex gap-2 py-1 border-b border-[var(--border-color)]" style={{ color: 'var(--text-secondary)' }}>
                    <span className="font-mono text-xs shrink-0" style={{ color: 'var(--text-muted)' }}>{a.created_at}</span>
                    <span className="truncate">{a.action || a.type}: {a.detail || a.target || ''}</span>
                </div>
            ))}
        </div>
    );
}

// ── Collections tab: list + create + delete (issue #73) ─────────────────────
function CollectionsPanel() {
    const t = useT();
    const [collections, setCollections] = useState([]);
    const [name, setName] = useState('');
    const [err, setErr] = useState('');

    const refresh = () => api('GET', '/collections').then((d) => setCollections(d.data || d || [])).catch((e) => setErr(e.message));
    useEffect(() => { refresh(); }, []);

    const create = async () => {
        if (!name.trim()) return;
        try {
            await api('POST', '/collections', { name: name.trim() });
            setName('');
            refresh();
        } catch (e) {
            setErr(e.message);
        }
    };

    const remove = async (id) => {
        try {
            await api('DELETE', `/collections/${id}`);
            refresh();
        } catch (e) {
            setErr(e.message);
        }
    };

    return (
        <div className="space-y-3">
            <div className="flex gap-2">
                <input value={name} onChange={(e) => setName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && create()}
                    placeholder={t('新集合名', 'New collection name')}
                    className="bg-surface-0 border border-[var(--border-color)] rounded px-2 py-1 text-sm focus:outline-none focus:border-brand-500"
                    style={{ color: 'var(--text-primary)' }} />
                <button onClick={create} className="bg-brand-600 hover:bg-brand-500 px-3 py-1 rounded-lg text-sm text-white transition-colors">
                    {t('创建', 'Create')}
                </button>
            </div>
            {err && <div className="text-xs text-red-400">{err}</div>}
            {collections.length === 0 && !err && <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{t('暂无集合', 'No collections')}</span>}
            {collections.map((c) => (
                <div key={c.id} className="flex items-start justify-between gap-3 border border-[var(--border-color)] rounded-lg px-3 py-2">
                    <div className="min-w-0">
                        <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{c.name}</div>
                        {c.description && <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{c.description}</div>}
                        <div className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>
                            {t('成员页', 'Members')}: {(c.page_ids || []).length}
                        </div>
                    </div>
                    <button onClick={() => remove(c.id)}
                        className="text-xs px-2 py-1 rounded text-red-400 border border-red-400/30 hover:bg-red-400/10 transition-colors shrink-0">
                        {t('删除', 'Delete')}
                    </button>
                </div>
            ))}
        </div>
    );
}

const TABS = [
    { key: 'rag', label: 'RAG', comp: RagPanel },
    { key: 'export', labelKey: '导出', labelKeyEn: 'Export', comp: ExportPanel },
    { key: 'collections', labelKey: '集合', labelKeyEn: 'Collections', comp: CollectionsPanel },
    { key: 'tags', labelKey: '标签', labelKeyEn: 'Tags', comp: TagsPanel },
    { key: 'comments', labelKey: '评论', labelKeyEn: 'Comments', comp: CommentsPanel },
    { key: 'activity', labelKey: '动态', labelKeyEn: 'Activity', comp: ActivityPanel },
];

export default function ManagePage() {
    const t = useT();
    const [tab, setTab] = useState('rag');
    const Active = TABS.find((x) => x.key === tab)?.comp || RagPanel;
    return (
        <div className="flex-1 overflow-auto p-6">
            <h1 className="text-lg font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
                {t('管理面板', 'Management')}
            </h1>
            <div className="flex gap-1 mb-4 border-b border-[var(--border-color)] pb-2">
                {TABS.map((x) => (
                    <button key={x.key} onClick={() => setTab(x.key)}
                        className={`text-sm px-3 py-1.5 rounded-lg transition-colors ${
                            tab === x.key ? 'bg-brand-600/20 text-brand-400' : 'hover:bg-surface-2'
                        }`} style={tab !== x.key ? { color: 'var(--text-secondary)' } : {}}>
                        {x.key === 'rag' ? 'RAG' : t(x.labelKey, x.labelKeyEn)}
                    </button>
                ))}
            </div>
            <Active />
        </div>
    );
}
