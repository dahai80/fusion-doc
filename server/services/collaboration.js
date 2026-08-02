// =============================================================================
// Fusion-Doc — 协作服务
// Yjs 文档管理 + 持久化
// =============================================================================

const { getDB } = require('../db');

async function getYjsState(pageId) {
    const db = getDB();
    if (!db) return null;
    try {
        const row = db.prepare('SELECT yjs_state FROM pages WHERE id = ?').get(pageId);
        return row?.yjs_state || null;
    } catch (e) {
        console.warn('[Collaboration] getYjsState error:', e.message);
        return null;
    }
}

async function saveYjsState(pageId, state) {
    const db = getDB();
    if (!db) return;
    try {
        db.prepare('UPDATE pages SET yjs_state = ?, updated_at = ? WHERE id = ?')
            .run(state, Date.now(), pageId);
    } catch (e) {
        console.warn('[Collaboration] saveYjsState error:', e.message);
    }
}

function getActiveUsers(app, pageId) {
    if (!app.collabRooms || !app.collabRooms[pageId]) return [];
    return [...app.collabRooms[pageId].keys()];
}

module.exports = { getYjsState, saveYjsState, getActiveUsers };
