// =============================================================================
// Fusion-Doc — Office document controller (issue #82)
// xlsx import + docx template merge via fusion-office office-api (:11492).
// Endpoints without an upstream office-api counterpart degrade visibly (422,
// kept below 500 so the actionable message survives production masking).
// =============================================================================

const { parseBody } = require('../middleware/body-parser');
const { json, error } = require('../utils/response');
const { requireAdmin } = require('../middleware/require-admin');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { officeImport, officeExport, officeMerge, getOfficeStatus } = require('../services/office');
const { OfficeApiError } = require('../integrations/office-api');
// S4 修复: export/preview 复用页读归属守卫, 杜绝非 owner 读他人私有页内容/产物 (IDOR)
const { canReadPage } = require('../middleware/authz');

const SAFE_FILENAME_RE = /[^a-zA-Z0-9一-龥_.-]/g;

// Map service errors to HTTP status (OfficeApiError carries .status)
function errStatus(e) {
    return e instanceof OfficeApiError && e.status ? e.status : 500;
}

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
                // Buffer has no .split — round-trip through latin1 (byte-preserving)
                // to split on the boundary, then restore Buffer per part.
                const boundaryStr = boundary.toString('latin1');
                const parts = buf.toString('latin1').split(boundaryStr)
                    .map((p) => Buffer.from(p, 'latin1'))
                    .filter((p) => p.length > 4 && !p.equals(Buffer.from('--')));
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

    // ── office-api status + capability map ──────────────────────────────
    app.registerRoute('GET', '/api/office/status', async (req, res) => {
        json(res, await getOfficeStatus(req.ctx?.config?.fusionOfficeApi || app.config.fusionOfficeApi));
    });

    // ── Create Office document — no upstream write endpoint, degrade ────
    app.registerRoute('POST', '/api/office/create', async (req, res) => {
        if (!requireAdmin(req, res)) return;
        return error(res, 'create is not available: office-api has no document write endpoint yet (tracked in fusion-office upstream); use docx template fill via /api/office/merge instead', 422);
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
            error(res, `Import failed: ${e.message}`, errStatus(e));
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
            error(res, `Upload import failed: ${e.message}`, errStatus(e));
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
            error(res, `Export failed: ${e.message}`, errStatus(e));
        }
    });

    // ── Preview — no upstream render endpoint, degrade visibly ──────────
    app.registerRoute('POST', '/api/office/preview/:id', async (req, res) => {
        const { id } = req.params;
        try {
            const officeFile = db
                ? db.prepare('SELECT * FROM office_files WHERE page_id = ?').get(id)
                : null;
            if (!officeFile) return error(res, 'Office file not found for this page', 404);
            const page = db ? db.prepare('SELECT * FROM pages WHERE id = ?').get(id) : null;
            if (page && !canReadPage(req, res, page)) return;
            return error(res, 'preview is not available: office-api has no document render endpoint yet (/v1/docx/snapshot deferred to fusion-office v0.2)', 422);
        } catch (e) {
            error(res, `Preview failed: ${e.message}`, errStatus(e));
        }
    });

    // ── Docx template merge via office-api /v1/docx/fill (admin only) ───
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
            const result = await officeMerge(app, safeTemplate, data || {}, safeOutput);
            json(res, result);
        } catch (e) {
            error(res, `Merge failed: ${e.message}`, errStatus(e));
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
            error(res, `Import-dir failed: ${e.message}`, errStatus(e));
        }
    });
}

module.exports = { register };
