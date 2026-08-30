// =============================================================================
// Fusion-Doc — Office 文档控制器
// .docx/.xlsx/.pptx 导入导出 + 创建/预览/合并 via OfficeCLI
// =============================================================================

const { parseBody } = require('../middleware/body-parser');
const { json, error } = require('../utils/response');
const { requireAdmin } = require('../middleware/require-admin');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { officeImport, officeExport, getOfficeStatus } = require('../services/office');
const officecli = require('../integrations/officecli');

const ALLOWED_COMMANDS = new Set(['create', 'convert', 'preview', 'merge']);
const SAFE_FILENAME_RE = /[^a-zA-Z0-9一-龥_.-]/g;

// Content-Disposition 文件名消毒 (剥 CRLF/引号, RFC 5987 编码)
function safeContentDisposition(name, ext) {
    const cleaned = (name || 'export').replace(SAFE_FILENAME_RE, '_').slice(0, 100) || 'export';
    const encoded = encodeURIComponent(cleaned);
    return `attachment; filename="${cleaned}.${ext}"; filename*=UTF-8''${encoded}.${ext}`;
}

function allowedRoots(app) {
    const storageDir = path.resolve(app.config.storage.dir);
    const dataDir = path.resolve(app.config.dataDir);
    const workDir = path.join(os.tmpdir(), 'fusion-doc-office');
    return [storageDir, dataDir, workDir];
}

function safePath(app, rawPath, label) {
    if (!rawPath || typeof rawPath !== 'string') return null;
    const resolved = path.resolve(rawPath);
    const roots = allowedRoots(app);
    const ok = roots.some(root => resolved === root || resolved.startsWith(root + path.sep));
    if (!ok) {
        console.warn(`[Office] Path traversal blocked for ${label}: ${rawPath}`);
        return null;
    }
    return resolved;
}

function register(app) {
    const { db } = app;

    // ── OfficeCLI 状态 ──────────────────────────────────────────────────
    app.registerRoute('GET', '/api/office/status', async (req, res) => {
        const status = await getOfficeStatus();
        const cliStatus = await officecli.getStatus();
        json(res, { ...status, resident: cliStatus.resident });
    });

    // ── 创建 Office 文档 (admin only) ──────────────────────────────────
    app.registerRoute('POST', '/api/office/create', async (req, res) => {
        if (!requireAdmin(req, res)) return;
        const body = await parseBody(req);
        const { format, title, content, template } = body;
        if (!format) return error(res, 'format required (docx/xlsx/pptx)', 400);
        // 模板路径围栏 (P1-12: 杜绝任意文件读作模板)
        const safeTemplate = template ? safePath(app, template, 'create.template') : null;
        if (template && !safeTemplate) return error(res, 'template not allowed', 403);

        try {
            const result = await officecli.createDoc(format, { title, content, template: safeTemplate });
            json(res, result);
        } catch (e) {
            error(res, `Create failed: ${e.message}`, 500);
        }
    });

    // ── 导入 Office 文档 (admin only) ──────────────────────────────────
    app.registerRoute('POST', '/api/office/import', async (req, res) => {
        if (!requireAdmin(req, res)) return;
        const body = await parseBody(req);
        const { file_path, book_id, chapter_id } = body;
        if (!file_path) return error(res, 'file_path required', 400);
        const safeFilePath = safePath(app, file_path, 'import');
        if (!safeFilePath) return error(res, 'file_path not allowed', 403);
        try {
            const result = await officeImport(app, { file_path: safeFilePath, book_id, chapter_id });
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
                    'Content-Disposition': safeContentDisposition(page.title, ext),
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

            // 路径围栏 (P3-32: 纵深防御, 即便 DB 被写脏也拒越界)
            const safePreviewPath = safePath(app, officeFile.file_path, 'preview');
            if (!safePreviewPath) return error(res, 'preview file_path not allowed', 403);

            const result = await officecli.previewDoc(safePreviewPath, { page: body.page || 1 });
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

    // ── 模板合并生成 (admin only) ──────────────────────────────────────
    app.registerRoute('POST', '/api/office/merge', async (req, res) => {
        if (!requireAdmin(req, res)) return;
        const body = await parseBody(req);
        const { template_path, data, output_path } = body;
        if (!template_path) return error(res, 'template_path required', 400);
        const safeTemplate = safePath(app, template_path, 'merge.template');
        if (!safeTemplate) return error(res, 'template_path not allowed', 403);
        const safeOutput = output_path ? safePath(app, output_path, 'merge.output') : undefined;
        if (output_path && !safeOutput) return error(res, 'output_path not allowed', 403);

        try {
            const result = await officecli.mergeTemplate(safeTemplate, data || {}, safeOutput);
            json(res, result);
        } catch (e) {
            error(res, `Merge failed: ${e.message}`, 500);
        }
    });

    // ── 批量导入目录 (admin only) ──────────────────────────────────────
    app.registerRoute('POST', '/api/office/import-dir', async (req, res) => {
        if (!requireAdmin(req, res)) return;
        const body = await parseBody(req);
        const { dir_path, book_id } = body;
        if (!dir_path) return error(res, 'dir_path required', 400);
        const safeDir = safePath(app, dir_path, 'import-dir');
        if (!safeDir) return error(res, 'dir_path not allowed', 403);
        try {
            const result = await officeImport(app, { dir_path: safeDir, book_id, recursive: true });
            json(res, result);
        } catch (e) {
            error(res, `Import-dir failed: ${e.message}`, 500);
        }
    });

    // ── 执行 OfficeCLI 命令 (admin only, 路径围栏) ─────────────────────
    app.registerRoute('POST', '/api/office/command', async (req, res) => {
        if (!requireAdmin(req, res)) return;
        const body = await parseBody(req);
        const { command, args } = body;
        if (!command) return error(res, 'command required', 400);
        if (!ALLOWED_COMMANDS.has(command)) {
            console.warn(`[Office] Rejected disallowed command: ${command}`);
            return error(res, `command not allowed, valid: ${[...ALLOWED_COMMANDS].join(', ')}`, 403);
        }
        // 仅保留字符串参数, 且对路径型参数跑 safePath (P0-4: 杜绝任意文件读写)
        const rawArgs = Array.isArray(args) ? args.filter(a => typeof a === 'string') : [];
        const safeArgs = [];
        for (const a of rawArgs) {
            // --output/--template 及裸路径形参数, 视作路径围栏
            if (a.includes('/') || a.includes(path.sep) || a === '.' || a === '..' || path.isAbsolute(a)) {
                const safe = safePath(app, a, `command.${command}.arg`);
                if (!safe) {
                    console.warn(`[Office] command ${command} arg blocked: ${a}`);
                    return error(res, `arg not allowed: ${a}`, 403);
                }
                safeArgs.push(safe);
            } else {
                safeArgs.push(a);
            }
        }

        try {
            const result = await officecli.executeCommand(command, safeArgs);
            json(res, result);
        } catch (e) {
            error(res, `Command failed: ${e.message}`, 500);
        }
    });
}

module.exports = { register };
