// =============================================================================
// Fusion-Doc — 工作流控制器
// CRUD + 执行 + 状态转换
// =============================================================================

const { json, error, created } = require('../utils/response');
const { uid } = require('../utils/helpers');
const { parseYAML, validateWorkflow, executeWorkflow, seedPresetWorkflows } = require('../services/workflow-engine');
const { transitionPage, getWorkflowStatus, getAvailableTransitions, STATES } = require('../services/workflow');

function register(app) {
    const { db } = app;

    // ── 列出工作流 ─────────────────────────────────────────────────────
    app.registerRoute('GET', '/api/workflows', (req, res) => {
        if (!db) return json(res, []);
        const workflows = db.prepare('SELECT id, name, description, status, last_run_at, created_at FROM workflows ORDER BY created_at DESC').all();
        json(res, workflows);
    });

    // ── 创建工作流 ─────────────────────────────────────────────────────
    app.registerRoute('POST', '/api/workflows', async (req, res) => {
        if (!db) return error(res, 'DB not available', 503);
        const { parseBody } = require('../middleware/body-parser');
        const body = await parseBody(req);

        if (!body.name) return error(res, 'name required', 400);
        if (!body.yaml_def) return error(res, 'yaml_def required', 400);

        const validation = validateWorkflow(parseYAML(body.yaml_def));
        if (!validation.valid) return error(res, `Invalid workflow: ${validation.errors.join(', ')}`, 400);

        const wf = {
            id: uid(),
            name: body.name,
            description: body.description || '',
            yaml_def: body.yaml_def,
            status: 'idle',
            last_run_at: null,
            created_at: new Date().toISOString(),
        };

        db.prepare('INSERT INTO workflows (id, name, description, yaml_def, status, created_at) VALUES (?, ?, ?, ?, ?, ?)')
            .run(wf.id, wf.name, wf.description, wf.yaml_def, wf.status, wf.created_at);

        console.log(`[Workflow] Created: ${wf.id} "${wf.name}"`);
        created(res, wf);
    });

    // ── 工作流详情 ─────────────────────────────────────────────────────
    app.registerRoute('GET', '/api/workflows/:id', (req, res) => {
        if (!db) return error(res, 'DB not available', 503);
        const wf = db.prepare('SELECT * FROM workflows WHERE id = ?').get(req.params.id);
        if (!wf) return error(res, 'Workflow not found', 404);
        json(res, wf);
    });

    // ── 删除工作流 ─────────────────────────────────────────────────────
    app.registerRoute('DELETE', '/api/workflows/:id', (req, res) => {
        if (!db) return error(res, 'DB not available', 503);
        db.prepare('DELETE FROM workflow_runs WHERE workflow_id = ?').run(req.params.id);
        db.prepare('DELETE FROM workflows WHERE id = ?').run(req.params.id);
        console.log(`[Workflow] Deleted: ${req.params.id}`);
        json(res, { deleted: true });
    });

    // ── 执行工作流 ─────────────────────────────────────────────────────
    app.registerRoute('POST', '/api/workflows/:id/run', async (req, res) => {
        if (!db) return error(res, 'DB not available', 503);
        const { parseBody } = require('../middleware/body-parser');
        const body = await parseBody(req);

        try {
            const result = await executeWorkflow(app, req.params.id, body.input || body);
            json(res, result);
        } catch (e) {
            error(res, e.message, 400);
        }
    });

    // ── 执行历史 ───────────────────────────────────────────────────────
    app.registerRoute('GET', '/api/workflows/:id/runs', (req, res) => {
        if (!db) return json(res, []);
        const runs = db.prepare('SELECT * FROM workflow_runs WHERE workflow_id = ? ORDER BY started_at DESC LIMIT 20').all(req.params.id);
        json(res, runs);
    });

    // ── 初始化预设工作流 ───────────────────────────────────────────────
    app.registerRoute('POST', '/api/workflows/seed', (req, res) => {
        if (!db) return error(res, 'DB not available', 503);
        seedPresetWorkflows(db);
        const workflows = db.prepare('SELECT id, name, description, status FROM workflows').all();
        json(res, { seeded: true, workflows });
    });

    // ── 获取页面工作流状态 ──────────────────────────────────────────────
    app.registerRoute('GET', '/api/workflow/:id', (req, res) => {
        const status = getWorkflowStatus(db, req.params.id);
        if (!status) return error(res, 'Page not found', 404);
        json(res, status);
    });

    // ── 获取可用转换 ────────────────────────────────────────────────────
    app.registerRoute('GET', '/api/workflow/:id/transitions', (req, res) => {
        const transitions = getAvailableTransitions(db, req.params.id);
        json(res, { transitions, states: STATES });
    });

    // ── 执行状态转换 ────────────────────────────────────────────────────
    app.registerRoute('POST', '/api/workflow/:id/transition', async (req, res) => {
        const { parseBody } = require('../middleware/body-parser');
        const body = await parseBody(req);
        const { state, user_id } = body;
        if (!state) return error(res, 'state required', 400);

        try {
            const result = await transitionPage(db, req.params.id, state, user_id || 'system');
            json(res, result);
        } catch (e) {
            error(res, e.message, 400);
        }
    });
}

module.exports = { register };
