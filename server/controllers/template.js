// =============================================================================
// Fusion-Doc — 模板控制器
// 文档模板 CRUD + 从模板创建文档
// =============================================================================

const { parseBody } = require('../middleware/body-parser');
const { json, error } = require('../utils/response');
const { uid, parsePaging } = require('../utils/helpers');
const { extractVariables, fillVariables, createFromTemplate } = require('../services/template-engine');

function register(app) {
    const { db } = app;

    // ── 模板列表 ────────────────────────────────────────────────────────
    app.registerRoute('GET', '/api/templates', (req, res) => {
        if (!db) return json(res, []);
        // A6 修复: 列表分页上限, 防 unbounded 全表拉 OOM
        const { size, offset } = parsePaging(req);
        const rows = db.prepare('SELECT * FROM templates ORDER BY category, name LIMIT ? OFFSET ?').all(size, offset);
        json(res, rows);
    });

    // ── 模板详情 ────────────────────────────────────────────────────────
    app.registerRoute('GET', '/api/templates/:id', (req, res) => {
        if (!db) return error(res, 'DB not available', 500);
        const row = db.prepare('SELECT * FROM templates WHERE id = ?').get(req.params.id);
        if (!row) return error(res, 'Template not found', 404);
        json(res, row);
    });

    // ── 创建模板 ────────────────────────────────────────────────────────
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

    // ── 更新模板 ────────────────────────────────────────────────────────
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

    // ── 删除模板 ────────────────────────────────────────────────────────
    app.registerRoute('DELETE', '/api/templates/:id', (req, res) => {
        if (!db) return error(res, 'DB not available', 500);
        db.prepare('DELETE FROM templates WHERE id = ?').run(req.params.id);
        json(res, { deleted: true });
    });

    // ── 从模板创建页面 ──────────────────────────────────────────────────
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

    // ── 提取模板变量 ──────────────────────────────────────────────────────
    app.registerRoute('GET', '/api/templates/:id/variables', (req, res) => {
        if (!db) return error(res, 'DB not available', 500);
        const tpl = db.prepare('SELECT content FROM templates WHERE id = ?').get(req.params.id);
        if (!tpl) return error(res, 'Template not found', 404);
        const variables = extractVariables(tpl.content || '');
        json(res, { variables });
    });
}

module.exports = { register };
