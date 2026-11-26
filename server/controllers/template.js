// =============================================================================
// Fusion-Doc — template controller
// Document template CRUD + create documents from templates
// =============================================================================

const { parseBody } = require('../middleware/body-parser');
const { json, error } = require('../utils/response');
const { uid, parsePaging } = require('../utils/helpers');
const { extractVariables, fillVariables, createFromTemplate } = require('../services/template-engine');

function register(app) {
    const { db } = app;

    // ── Template list ───────────────────────────────────────────────────
    app.registerRoute('GET', '/api/templates', (req, res) => {
        if (!db) return json(res, []);
        // A6 fix: paging cap on the list to prevent an unbounded full-table pull OOM
        const { size, offset } = parsePaging(req);
        const rows = db.prepare('SELECT * FROM templates ORDER BY category, name LIMIT ? OFFSET ?').all(size, offset);
        json(res, rows);
    });

    // ── Template detail ─────────────────────────────────────────────────
    app.registerRoute('GET', '/api/templates/:id', (req, res) => {
        if (!db) return error(res, 'DB not available', 500);
        const row = db.prepare('SELECT * FROM templates WHERE id = ?').get(req.params.id);
        if (!row) return error(res, 'Template not found', 404);
        json(res, row);
    });

    // ── Create template ─────────────────────────────────────────────────
    app.registerRoute('POST', '/api/templates', async (req, res) => {
        if (!db) return error(res, 'DB not available', 500);
        const body = await parseBody(req);
        const { name, category, description, content, schema } = body;
        if (!name) return error(res, 'name required', 400);

        const id = uid();
        const now = Date.now();
        db.prepare(`
            INSERT INTO templates (id, name, category, description, content, schema, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(id, name, category || 'general', description || '', content || '', JSON.stringify(schema || {}), now, now);

        console.log(`[Template] Created: ${name} (${id})`);
        json(res, { id, name });
    });

    // ── Update template ─────────────────────────────────────────────────
    app.registerRoute('PUT', '/api/templates/:id', async (req, res) => {
        if (!db) return error(res, 'DB not available', 500);
        const body = await parseBody(req);
        const { name, category, description, content, schema } = body;
        const now = Date.now();

        db.prepare(`
            UPDATE templates SET name=COALESCE(?,name), category=COALESCE(?,category),
            description=COALESCE(?,description), content=COALESCE(?,content),
            schema=COALESCE(?,schema), updated_at=? WHERE id=?
        `).run(name, category, description, content, schema ? JSON.stringify(schema) : null, now, req.params.id);

        json(res, { updated: true });
    });

    // ── Delete template ─────────────────────────────────────────────────
    app.registerRoute('DELETE', '/api/templates/:id', (req, res) => {
        if (!db) return error(res, 'DB not available', 500);
        db.prepare('DELETE FROM templates WHERE id = ?').run(req.params.id);
        json(res, { deleted: true });
    });

    // ── Create page from template ───────────────────────────────────────
    app.registerRoute('POST', '/api/templates/:id/instantiate', async (req, res) => {
        if (!db) return error(res, 'DB not available', 500);
        const body = await parseBody(req);

        try {
            const result = await createFromTemplate(db, req.params.id, body.variables || {});
            json(res, result);
        } catch (e) {
            error(res, e.message, 400);
        }
    });

    // ── Extract template variables ────────────────────────────────────────
    app.registerRoute('GET', '/api/templates/:id/variables', (req, res) => {
        if (!db) return error(res, 'DB not available', 500);
        const tpl = db.prepare('SELECT content FROM templates WHERE id = ?').get(req.params.id);
        if (!tpl) return error(res, 'Template not found', 404);
        const variables = extractVariables(tpl.content || '');
        json(res, { variables });
    });
}

module.exports = { register };
