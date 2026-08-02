import { useState, useEffect } from 'react';
import { api } from '../../lib/api';

const STATE_COLORS = {
    draft: 'bg-gray-600',
    review: 'bg-yellow-600',
    published: 'bg-green-600',
    archived: 'bg-gray-800',
};

const STATE_LABELS = {
    draft: '草稿',
    review: '审核中',
    published: '已发布',
    archived: '归档',
};

export default function WorkflowBadge({ pageId }) {
    const [workflow, setWorkflow] = useState(null);
    const [transitions, setTransitions] = useState([]);

    useEffect(() => {
        if (!pageId) return;
        api('GET', `/api/workflow/${pageId}`).then(setWorkflow).catch(() => {});
        api('GET', `/api/workflow/${pageId}/transitions`).then(data => {
            setTransitions(data.transitions || []);
        }).catch(() => {});
    }, [pageId]);

    const handleTransition = async (state) => {
        try {
            await api('POST', `/api/workflow/${pageId}/transition`, { state });
            const w = await api('GET', `/api/workflow/${pageId}`);
            setWorkflow(w);
            const t = await api('GET', `/api/workflow/${pageId}/transitions`);
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
                {STATE_LABELS[currentState] || currentState}
            </span>
            {transitions.map(t => (
                <button
                    key={t}
                    onClick={() => handleTransition(t)}
                    className="px-2 py-0.5 text-xs bg-surface-2 hover:bg-surface-3 rounded text-gray-400 transition-colors"
                >
                    → {STATE_LABELS[t] || t}
                </button>
            ))}
        </div>
    );
}
