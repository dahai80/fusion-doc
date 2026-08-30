// =============================================================================
// Fusion-Doc — 页面发布状态机 (A8 改名: workflow → page-state, 消除命名碰撞)
// 文档发布工作流状态机 + 审批流程 (draft→review→published→archived)
// =============================================================================
// A8 修复: 原名 services/workflow.js 与 services/workflow-engine.js 共用 "workflow" 一词,
// 但二者是不同概念 — 本文件是页面发布状态机 (有限状态自动机), workflow-engine.js 是
// YAML DAG 执行引擎。路由 /api/workflow/:id/transition (本) 与 /api/workflows/:id/run
// (引擎) 仅一字母之差, 维护者极易混淆。改名 page-state 使语义明确, 路由保持不变 (客户端兼容)。
//
// 修复 (metadata-column bug): 原实现 SELECT id, metadata FROM pages 并写 page.metadata.workflow,
// 但 pages 表无 metadata 列 (路由报 no such column: metadata)。pages 的扩展属性存于独立
// metadata 表 (id, page_id, key, value, type, created_at), 每页一行一 key。
// 工作流状态用 key='workflow', value 存 JSON {state, history}。读写走 metadata 表,
// 与 metadata.js 访问模式一致。

const { uid } = require('../utils/helpers');

const WORKFLOW_KEY = 'workflow';

const STATES = {
    draft: { label: '草稿', transitions: ['review', 'published'] },
    review: { label: '审核中', transitions: ['draft', 'published'] },
    published: { label: '已发布', transitions: ['draft', 'archived'] },
    archived: { label: '归档', transitions: ['draft'] },
};

function isValidTransition(from, to) {
    return STATES[from]?.transitions?.includes(to) || false;
}

// ── 读取页面工作流状态 (从 metadata 表 key='workflow') ─────────────────────────
function getWorkflowStatus(db, pageId) {
    if (!db) return { state: 'draft', history: [] };
    // 页面必须存在, 不存在返回 null (控制器据此 404)
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
        console.warn(`[Workflow] page ${pageId} workflow 元数据损坏, 回退 draft: ${e.message}`);
        return { state: 'draft', history: [] };
    }
}

// ── 写入页面工作流状态 (upsert metadata 表 key='workflow', 事务原子) ───────────
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

    // 事务保证 状态+历史 原子写入 (避免半写: 状态改了历史丢)
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
