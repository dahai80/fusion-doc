// =============================================================================
// Fusion-Doc — workflow controller
// CRUD + execution + state transitions
// =============================================================================

const { json, error, created } = require('../utils/response');
const { uid, parsePaging } = require('../utils/helpers');
const { parseYAML, validateWorkflow, executeWorkflow, seedPresetWorkflows } = require('../services/workflow-engine');
// A8 fix: page publishing state machine renamed to page-state (formerly services/workflow) to avoid a name clash with workflow-engine
const { transitionPage, getWorkflowStatus, getAvailableTransitions, STATES } = require('../services/page-state');

function register(app) {
    const { db } = app;

    // ── List workflows ─────────────────────────────────────────────────────
    app.registerRoute('GET', '/api/workflows', (req, res) => {
        if (!db) return json(res, []);
        // A6 fix: cap list pagination to prevent unbounded full-table reads causing OOM
        const { size, offset } = parsePaging(req);
        const workflows = db.prepare('SELECT id, name, description, status, last_run_at, created_at FROM workflows ORDER BY created_at DESC LIMIT ? OFFSET ?').all(size, offset);
        json(res, workflows);
    });

    // ── Create workflow ─────────────────────────────────────────────────────
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

    // ── Workflow details ─────────────────────────────────────────────────────
    app.registerRoute('GET', '/api/workflows/:id', (req, res) => {
        if (!db) return error(res, 'DB not available', 503);
        const wf = db.prepare('SELECT * FROM workflows WHERE id = ?').get(req.params.id);
        if (!wf) return error(res, 'Workflow not found', 404);
        json(res, wf);
    });

    // ── Delete workflow ─────────────────────────────────────────────────────
    app.registerRoute('DELETE', '/api/workflows/:id', (req, res) => {
        if (!db) return error(res, 'DB not available', 503);
        db.prepare('DELETE FROM workflow_runs WHERE workflow_id = ?').run(req.params.id);
        db.prepare('DELETE FROM workflows WHERE id = ?').run(req.params.id);
        console.log(`[Workflow] Deleted: ${req.params.id}`);
        json(res, { deleted: true });
    });

    // ── Run workflow ─────────────────────────────────────────────────────
    app.registerRoute('POST', '/api/workflows/:id/run', async (req, res) => {
        if (!db) return error(res, 'DB not available', 503);
        const { parseBody } = require('../middleware/body-parser');
        const body = await parseBody(req);

        // E8 fix: refuse to re-run a workflow that is already running, preventing concurrent runs of the same DAG from conflicting steps / duplicate page writes.
        // (stale running rows left by a crash are swept to failed by app.js at startup; this blocks duplicate triggers of active runs)
        const wf = db.prepare('SELECT status FROM workflows WHERE id = ?').get(req.params.id);
        if (!wf) return error(res, 'Workflow not found', 404);
        if (wf.status === 'running') {
            console.warn(`[Workflow] Refusing to re-run workflow that is already running: ${req.params.id}`);
            return error(res, 'Workflow is already running', 409);
        }

        try {
            const result = await executeWorkflow(app, req.params.id, body.input || body);
            json(res, result);
        } catch (e) {
            error(res, e.message, 400);
        }
    });

    // ── Run history ───────────────────────────────────────────────────────
    app.registerRoute('GET', '/api/workflows/:id/runs', (req, res) => {
        if (!db) return json(res, []);
        const runs = db.prepare('SELECT * FROM workflow_runs WHERE workflow_id = ? ORDER BY started_at DESC LIMIT 20').all(req.params.id);
        json(res, runs);
    });

    // ── Initialize preset workflows ───────────────────────────────────────────────
    app.registerRoute('POST', '/api/workflows/seed', (req, res) => {
        if (!db) return error(res, 'DB not available', 503);
        seedPresetWorkflows(db);
        const workflows = db.prepare('SELECT id, name, description, status FROM workflows').all();
        json(res, { seeded: true, workflows });
    });

    // ── Get page workflow state ──────────────────────────────────────────────
    app.registerRoute('GET', '/api/workflow/:id', (req, res) => {
        const status = getWorkflowStatus(db, req.params.id);
        if (!status) return error(res, 'Page not found', 404);
        json(res, status);
    });

    // ── Get available transitions ────────────────────────────────────────────────────
    app.registerRoute('GET', '/api/workflow/:id/transitions', (req, res) => {
        const transitions = getAvailableTransitions(db, req.params.id);
        json(res, { transitions, states: STATES });
    });

    // ── Perform state transition ────────────────────────────────────────────────────
    app.registerRoute('POST', '/api/workflow/:id/transition', async (req, res) => {
        const { parseBody } = require('../middleware/body-parser');
        const body = await parseBody(req);
        const { state } = body;
        if (!state) return error(res, 'state required', 400);

        try {
            // E29 fix: attribute the action to req.user.id, never trust body.user_id (same as R12; otherwise the client could forge
            // the actor and pollute audit/permission decisions). transitionPage already validates legal STATES transitions.
            const result = await transitionPage(db, req.params.id, state, req.user?.id || 'system');
            json(res, result);
        } catch (e) {
            error(res, e.message, 400);
        }
    });
}

module.exports = { register };
