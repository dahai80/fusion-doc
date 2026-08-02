// =============================================================================
// Fusion-Doc — 工作流服务
// 文档工作流状态机 + 审批流程
// =============================================================================

const { uid } = require('../utils/helpers');

const STATES = {
    draft: { label: '草稿', transitions: ['review', 'published'] },
    review: { label: '审核中', transitions: ['draft', 'published'] },
    published: { label: '已发布', transitions: ['draft', 'archived'] },
    archived: { label: '归档', transitions: ['draft'] },
};

function isValidTransition(from, to) {
    return STATES[from]?.transitions?.includes(to) || false;
}

async function transitionPage(db, pageId, newState, userId) {
    if (!db) throw new Error('DB not available');

    const page = db.prepare('SELECT id, metadata FROM pages WHERE id = ?').get(pageId);
    if (!page) throw new Error('Page not found');

    const metadata = JSON.parse(page.metadata || '{}');
    const currentState = metadata.workflow?.state || 'draft';

    if (!isValidTransition(currentState, newState)) {
        throw new Error(`Invalid transition: ${currentState} → ${newState}`);
    }

    metadata.workflow = {
        state: newState,
        history: [
            ...(metadata.workflow?.history || []),
            { from: currentState, to: newState, by: userId, at: Date.now() },
        ],
    };

    db.prepare('UPDATE pages SET metadata = ?, updated_at = ? WHERE id = ?')
        .run(JSON.stringify(metadata), Date.now(), pageId);

    console.log(`[Workflow] Page ${pageId}: ${currentState} → ${newState}`);
    return { page_id: pageId, from: currentState, to: newState };
}

function getWorkflowStatus(db, pageId) {
    if (!db) return { state: 'draft', history: [] };
    const page = db.prepare('SELECT metadata FROM pages WHERE id = ?').get(pageId);
    if (!page) return null;
    const metadata = JSON.parse(page.metadata || '{}');
    return metadata.workflow || { state: 'draft', history: [] };
}

function getAvailableTransitions(db, pageId) {
    const status = getWorkflowStatus(db, pageId);
    if (!status) return [];
    return STATES[status.state]?.transitions || [];
}

module.exports = { STATES, transitionPage, getWorkflowStatus, getAvailableTransitions };
