// =============================================================================
// Fusion-Doc — page publishing state machine (A8 rename: workflow → page-state, removes naming collision)
// Document publishing workflow state machine + approval flow (draft→review→published→archived)
// =============================================================================
// A8 fix: the old name services/workflow.js shared the word "workflow" with services/workflow-engine.js,
// but they are different concepts — this file is the page publishing state machine (finite automaton), workflow-engine.js is the
// YAML DAG execution engine. The routes /api/workflow/:id/transition (this one) and /api/workflows/:id/run
// (engine) differ by a single letter, which maintainers easily confuse. Renaming to page-state clarifies semantics; routes unchanged (client compatibility).
//
// Fix (metadata-column bug): the old implementation did SELECT id, metadata FROM pages and wrote page.metadata.workflow,
// but the pages table has no metadata column (route errored with no such column: metadata). Page extension attributes live in a separate
// metadata table (id, page_id, key, value, type, created_at), one row per key per page.
// Workflow state uses key='workflow', value stores JSON {state, history}. Reads/writes go through the metadata table,
// consistent with the access pattern in metadata.js.

const { uid } = require('../utils/helpers');

const WORKFLOW_KEY = 'workflow';

const STATES = {
    draft: { label: '草稿', transitions: ['review', 'published'] }, // i18n: user-facing
    review: { label: '审核中', transitions: ['draft', 'published'] }, // i18n: user-facing
    published: { label: '已发布', transitions: ['draft', 'archived'] }, // i18n: user-facing
    archived: { label: '归档', transitions: ['draft'] }, // i18n: user-facing
};

function isValidTransition(from, to) {
    return STATES[from]?.transitions?.includes(to) || false;
}

// ── Read page workflow state (from metadata table key='workflow') ─────────────────
function getWorkflowStatus(db, pageId) {
    if (!db) return { state: 'draft', history: [] };
    // Page must exist; returns null if not (controller responds 404 accordingly)
    const page = db.prepare('SELECT id FROM pages WHERE id = ?').get(pageId);
    if (!page) return null;
    const row = db.prepare("SELECT value FROM metadata WHERE page_id = ? AND key = ?").get(pageId, WORKFLOW_KEY);
    if (!row || !row.value) return { state: 'draft', history: [] };
    try {
        const parsed = JSON.parse(row.value);
        return {
            state: parsed.state || 'draft',
            history: Array.isArray(parsed.history) ? parsed.history : [],
        };
    } catch (e) {
        console.warn(`[Workflow] page ${pageId} workflow metadata corrupted, falling back to draft: ${e.message}`);
        return { state: 'draft', history: [] };
    }
}

// ── Write page workflow state (upsert metadata table key='workflow', atomic transaction) ──
function saveWorkflowStatus(db, pageId, status) {
    const value = JSON.stringify(status);
    const existing = db.prepare("SELECT id FROM metadata WHERE page_id = ? AND key = ?").get(pageId, WORKFLOW_KEY);
    if (existing) {
        db.prepare("UPDATE metadata SET value = ? WHERE page_id = ? AND key = ?")
            .run(value, pageId, WORKFLOW_KEY);
    } else {
        db.prepare("INSERT INTO metadata (id, page_id, key, value, type, created_at) VALUES (?, ?, ?, ?, ?, ?)")
            .run(uid(), pageId, WORKFLOW_KEY, value, 'json', Date.now());
    }
}

async function transitionPage(db, pageId, newState, userId) {
    if (!db) throw new Error('DB not available');

    const page = db.prepare('SELECT id FROM pages WHERE id = ?').get(pageId);
    if (!page) throw new Error('Page not found');

    const current = getWorkflowStatus(db, pageId);
    const currentState = current.state;

    if (!isValidTransition(currentState, newState)) {
        throw new Error(`Invalid transition: ${currentState} → ${newState}`);
    }

    const next = {
        state: newState,
        history: [
            ...(current.history || []),
            { from: currentState, to: newState, by: userId, at: Date.now() },
        ],
    };

    // Transaction makes state+history an atomic write (avoids half-writes: state changed but history lost)
    const tx = db.transaction(() => saveWorkflowStatus(db, pageId, next));
    tx();

    console.log(`[Workflow] Page ${pageId}: ${currentState} → ${newState}`);
    return { page_id: pageId, from: currentState, to: newState };
}

function getAvailableTransitions(db, pageId) {
    const status = getWorkflowStatus(db, pageId);
    if (!status) return [];
    return STATES[status.state]?.transitions || [];
}

module.exports = { STATES, transitionPage, getWorkflowStatus, getAvailableTransitions };
