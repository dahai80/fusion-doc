// =============================================================================
// Fusion-Doc — Office 文档控制器
// .docx/.xlsx/.pptx 导入导出 + 创建/预览/合并 via OfficeCLI
// =============================================================================

const { parseBody } = require('../middleware/body-parser');
const { json, error } = require('../utils/response');
const path = require('path');
const fs = require('fs');
const { officeImport, officeExport, getOfficeStatus } = require('../services/office');
const officecli = require('../integrations/officecli');

function register(app) {
    const { db } = app;

    // ── OfficeCLI 状态 ──────────────────────────────────────────────────
    app.registerRoute('GET', '/api/office/status', async (req, res) => {
        const status = await getOfficeStatus();
        const cliStatus = await officecli.getStatus();
        json(res, { ...status, resident: cliStatus.resident });
    });

    // ── 创建 Office 文档 ────────────────────────────────────────────────
    app.registerRoute('POST', '/api/office/create', async (req, res) => {
        const body = await parseBody(req);
        const { format, title, content, template } = body;
        if (!format) return error(res, 'format required (docx/xlsx/pptx)', 400);

        try {
            const result = await officecli.createDoc(format, { title, content, template });
            json(res, result);
        } catch (e) {
            error(res, `Create failed: ${e.message}`, 500);
        }
    });

    // ── 导入 Office 文档 ────────────────────────────────────────────────
    app.registerRoute('POST', '/api/office/import', async (req, res) => {
        const body = await parseBody(req);
        const { file_path, book_id, chapter_id } = body;
        if (!file_path) return error(res, 'file_path required', 400);
        try {
            const result = await officeImport(app, { file_path, book_id, chapter_id });
            json(res, result);
        } catch (e) {
            error(res, `Import failed: ${e.message}`, 500);
        }
    });

    // ── 导出页面为 Office 格式 ──────────────────────────────────────────
    app.registerRoute('POST', '/api/office/export/:id', async (req, res) => {
        const { id } = req.params;
        const body = await parseBody(req);
        const format = body.format || 'docx';
        try {
            const page = db ? db.prepare('SELECT * FROM pages WHERE id = ?').get(id) : null;
            if (!page) return error(res, 'Page not found', 404);
            const result = await officeExport(app, { page, format });
            if (result.file_path && fs.existsSync(result.file_path)) {
                const ext = format === 'xlsx' ? 'xlsx' : format === 'pptx' ? 'pptx' : 'docx';
                res.writeHead(200, {
                    'Content-Type': 'application/octet-stream',
                    'Content-Disposition': `attachment; filename="${page.title || 'export'}.${ext}"`,
                    'Content-Length': fs.statSync(result.file_path).size,
                });
                fs.createReadStream(result.file_path).pipe(res);
                return;
            }
            json(res, result);
        } catch (e) {
            error(res, `Export failed: ${e.message}`, 500);
        }
    });

    // ── 预览 Office 文档 ────────────────────────────────────────────────
    app.registerRoute('POST', '/api/office/preview/:id', async (req, res) => {
        const { id } = req.params;
        const body = await parseBody(req);

        try {
            const officeFile = db
                ? db.prepare('SELECT * FROM office_files WHERE page_id = ?').get(id)
                : null;

            if (!officeFile) return error(res, 'Office file not found for this page', 404);

            const result = await officecli.previewDoc(officeFile.file_path, { page: body.page || 1 });
            if (result.success && result.preview_path && fs.existsSync(result.preview_path)) {
                res.writeHead(200, {
                    'Content-Type': 'image/png',
                    'Content-Length': fs.statSync(result.preview_path).size,
                });
                fs.createReadStream(result.preview_path).pipe(res);
                return;
            }
            json(res, result);
        } catch (e) {
            error(res, `Preview failed: ${e.message}`, 500);
        }
    });

    // ── 模板合并生成 ────────────────────────────────────────────────────
    app.registerRoute('POST', '/api/office/merge', async (req, res) => {
        const body = await parseBody(req);
        const { template_path, data, output_path } = body;
        if (!template_path) return error(res, 'template_path required', 400);

        try {
            const result = await officecli.mergeTemplate(template_path, data || {}, output_path);
            json(res, result);
        } catch (e) {
            error(res, `Merge failed: ${e.message}`, 500);
        }
    });

    // ── 批量导入目录 ────────────────────────────────────────────────────
    app.registerRoute('POST', '/api/office/import-dir', async (req, res) => {
        const body = await parseBody(req);
        const { dir_path, book_id } = body;
        if (!dir_path) return error(res, 'dir_path required', 400);
        try {
            const result = await officeImport(app, { dir_path, book_id, recursive: true });
            json(res, result);
        } catch (e) {
            error(res, `Import-dir failed: ${e.message}`, 500);
        }
    });

    // ── 执行 OfficeCLI 命令 ─────────────────────────────────────────────
    app.registerRoute('POST', '/api/office/command', async (req, res) => {
        const body = await parseBody(req);
        const { command, args } = body;
        if (!command) return error(res, 'command required', 400);

        try {
            const result = await officecli.executeCommand(command, args || []);
            json(res, result);
        } catch (e) {
            error(res, `Command failed: ${e.message}`, 500);
        }
    });
}

module.exports = { register };
