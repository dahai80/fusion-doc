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
// S4 修复: export/preview 复用页读归属守卫, 杜绝非 owner 读他人私有页内容/产物 (IDOR)
const { canReadPage } = require('../middleware/authz');

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

// F7 修复: 零依赖 multipart 解析 (仅取首个文件 + 简单文本字段), 落盘到 uploadDir。
// 大小上限沿用 MAX_IMPORT_BYTES 防 OOM; 失败中途清理已写文件。
const MAX_IMPORT_BYTES = 50 * 1024 * 1024; // 50MB 上限 (Office 文档)
const SAFE_IMPORT_NAME = /[^a-zA-Z0-9一-龥._-]/g;
function _saveMultipartUpload(req, boundary, uploadDir) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let received = 0;
        let aborted = false;
        const cleanup = () => {
            req.removeListener('data', onData);
            req.removeListener('end', onEnd);
            req.removeListener('error', onErr);
        };
        const onData = (c) => {
            if (aborted) return;
            received += c.length;
            if (received > MAX_IMPORT_BYTES) {
                aborted = true;
                cleanup();
                req.destroy();
                reject(new Error('上传文件过大 (>50MB)'));
                return;
            }
            chunks.push(c);
        };
        const onEnd = () => {
            if (aborted) return;
            cleanup();
            try {
                const buf = Buffer.concat(chunks);
                const parts = buf.split(boundary).filter(p => p.length > 4 && !p.equals(Buffer.from('--')));
                const result = { file: null, fields: {} };
                for (const part of parts) {
                    // 去首尾 CRLF
                    let body = part;
                    if (body[0] === 0x0d && body[1] === 0x0a) body = body.subarray(2);
                    if (body[body.length - 2] === 0x0d && body[body.length - 1] === 0x0a) body = body.subarray(0, body.length - 2);
                    const headerEnd = body.indexOf('\r\n\r\n');
                    if (headerEnd < 0) continue;
                    const headerStr = body.subarray(0, headerEnd).toString('utf-8');
                    const value = body.subarray(headerEnd + 4);
                    const nameMatch = headerStr.match(/name="([^"]+)"/);
                    if (!nameMatch) continue;
                    const fieldName = nameMatch[1];
                    const fileMatch = headerStr.match(/filename="([^"]+)"/);
                    if (fileMatch) {
                        // 安全文件名: 去路径, 仅留白名单字符
                        const rawName = path.basename(fileMatch[1] || 'upload').replace(SAFE_IMPORT_NAME, '_').slice(0, 128);
                        const dest = path.join(uploadDir, `${Date.now()}-${rawName}`);
                        fs.writeFileSync(dest, value);
                        result.file = dest;
                        console.log(`[Office] multipart 文件落盘: ${dest} (${(value.length / 1024).toFixed(1)} KB)`);
                    } else {
                        result.fields[fieldName] = value.toString('utf-8');
                    }
                }
                resolve(result);
            } catch (e) {
                reject(new Error(`multipart 解析失败: ${e.message}`));
            }
        };
        const onErr = (e) => {
            if (aborted) return;
            aborted = true;
            cleanup();
            reject(e);
        };
        req.on('data', onData);
        req.on('end', onEnd);
        req.on('error', onErr);
    });
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

    // ── 上传并导入 Office 文档 (admin only, multipart) ────────────────
    // F7 修复: 客户端 OfficePanel 走 multipart/form-data 上传文件, 但 /import 走 parseBody(JSON),
    // 契约断裂致导入恒失败。新增 multipart 端点: 接收文件 → 落 storage 临时区 → 调 officeImport。
    app.registerRoute('POST', '/api/office/upload-import', async (req, res) => {
        if (!requireAdmin(req, res)) return;
        const contentType = (req.headers['content-type'] || '').toLowerCase();
        if (!contentType.includes('multipart/form-data')) {
            return error(res, '仅支持 multipart/form-data', 400);
        }
        try {
            const uploadDir = path.join(app.config.storage.dir, 'office-uploads');
            fs.mkdirSync(uploadDir, { recursive: true });
            // 简易 multipart 边界解析 (零依赖, 仅取首个文件 + file_path 字段)
            const boundaryMatch = contentType.match(/boundary=(.+)$/);
            if (!boundaryMatch) return error(res, '无效 multipart boundary', 400);
            const boundary = Buffer.from('--' + boundaryMatch[1].trim().replace(/^"|"$/g, ''));
            const saved = await _saveMultipartUpload(req, boundary, uploadDir);
            if (!saved.file) return error(res, '未收到文件', 400);
            // file_path 字段可选 (优先用文件名); book_id/chapter_id 经 form 字段传
            const safeFilePath = safePath(app, saved.file, 'upload-import');
            if (!safeFilePath) return error(res, '保存路径越界', 403);
            const result = await officeImport(app, {
                file_path: safeFilePath,
                book_id: saved.fields.book_id,
                chapter_id: saved.fields.chapter_id,
            });
            json(res, result);
        } catch (e) {
            console.error('[Office] upload-import failed:', e.message);
            error(res, `Upload import failed: ${e.message}`, 500);
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
            // S4 修复: 导出读页内容, 须校验归属, 否则任意用户导出他人私有页 (IDOR)
            if (!canReadPage(req, res, page)) return;
            const result = await officeExport(app, { page, format });
            if (result.file_path && fs.existsSync(result.file_path)) {
                const ext = format === 'xlsx' ? 'xlsx' : format === 'pptx' ? 'pptx' : 'docx';
                res.writeHead(200, {
                    'Content-Type': 'application/octet-stream',
                    'Content-Disposition': safeContentDisposition(page.title, ext),
                    'Content-Length': fs.statSync(result.file_path).size,
                });
                // E2 修复: 流式导出须挂 error 句柄, 否则底层 EPIPE/读错误抛 uncaught 杀进程
                const stream = fs.createReadStream(result.file_path);
                stream.on('error', (e) => {
                    console.error(`[Office] 导出流错误: ${e.message}`);
                    if (!res.writableEnded) res.end();
                });
                stream.pipe(res);
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

            // S4 修复: 预览读页内容, 须校验归属页读权限, 杜绝任意用户预览他人私有页 (IDOR)
            const page = db ? db.prepare('SELECT * FROM pages WHERE id = ?').get(id) : null;
            if (page && !canReadPage(req, res, page)) return;

            // 路径围栏 (P3-32: 纵深防御, 即便 DB 被写脏也拒越界)
            const safePreviewPath = safePath(app, officeFile.file_path, 'preview');
            if (!safePreviewPath) return error(res, 'preview file_path not allowed', 403);

            const result = await officecli.previewDoc(safePreviewPath, { page: body.page || 1 });
            if (result.success && result.preview_path && fs.existsSync(result.preview_path)) {
                res.writeHead(200, {
                    'Content-Type': 'image/png',
                    'Content-Length': fs.statSync(result.preview_path).size,
                });
                // E2 修复: 预览流须挂 error 句柄, 防 EPIPE 抛 uncaught
                const stream = fs.createReadStream(result.preview_path);
                stream.on('error', (e) => {
                    console.error(`[Office] 预览流错误: ${e.message}`);
                    if (!res.writableEnded) res.end();
                });
                stream.pipe(res);
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
