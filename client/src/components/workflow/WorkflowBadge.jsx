import { useState, useEffect } from 'react';
import { api } from '../../lib/api';
import { t } from '../../stores/langStore';

const STATE_COLORS = {
    draft: 'bg-gray-600',
    review: 'bg-yellow-600',
    published: 'bg-green-600',
    archived: 'bg-gray-800',
};

// 语言敏感的状态文案 — 直读 langStore, 不随渲染订阅 (徽标重挂载时刷新)
const stateLabels = () => ({
    draft: t('草稿', 'Draft'),
    review: t('审核中', 'In review'),
    published: t('已发布', 'Published'),
    archived: t('归档', 'Archived'),
});

export default function WorkflowBadge({ pageId }) {
    const [workflow, setWorkflow] = useState(null);
    const [transitions, setTransitions] = useState([]);

    useEffect(() => {
        if (!pageId) return;
        // api() 已拼 API_BASE (/api), 这里只传相对路径 — 原先传 /api/workflow/... 双前缀 404
        api('GET', `/workflow/${pageId}`).then(setWorkflow).catch(() => {});
        api('GET', `/workflow/${pageId}/transitions`).then(data => {
            setTransitions(data.transitions || []);
        }).catch(() => {});
    }, [pageId]);

    const handleTransition = async (state) => {
        try {
            await api('POST', `/workflow/${pageId}/transition`, { state });
            const w = await api('GET', `/workflow/${pageId}`);
            setWorkflow(w);
            const t = await api('GET', `/workflow/${pageId}/transitions`);
            setTransitions(t.transitions || []);
        } catch (e) {
            console.error('[Workflow] Transition error:', e);
        }
    };

    if (!workflow) return null;
    const currentState = workflow.state || 'draft';

    return (
        <div className="flex items-center gap-2">
            <span className={`px-2 py-0.5 text-xs rounded-full text-white ${STATE_COLORS[currentState] || 'bg-gray-600'}`}>
                {stateLabels()[currentState] || currentState}
            </span>
            {transitions.map(tr => (
                <button
                    key={tr}
                    onClick={() => handleTransition(tr)}
                    className="px-2 py-0.5 text-xs bg-surface-2 hover:bg-surface-3 rounded text-gray-400 transition-colors"
                >
                    → {stateLabels()[tr] || tr}
                </button>
            ))}
        </div>
    );
}
