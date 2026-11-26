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
// S4 fix: export/preview reuse the page read-ownership guard so non-owners can't read others' private page content/artifacts (IDOR)
const { canReadPage } = require('../middleware/authz');

const SAFE_FILENAME_RE = /[^a-zA-Z0-9一-龥_.-]/g; // i18n: user-facing

// Map service errors to HTTP status (OfficeApiError carries .status)
function errStatus(e) {
    return e instanceof OfficeApiError && e.status ? e.status : 500;
}

// Content-Disposition filename sanitization (strip CRLF/quotes, RFC 5987 encoding)
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

// F7 fix: zero-dependency multipart parsing (first file + simple text fields only), written to uploadDir.
// Size capped by MAX_IMPORT_BYTES to prevent OOM; partially written files are cleaned up on failure.
const MAX_IMPORT_BYTES = 50 * 1024 * 1024; // 50MB limit (Office documents)
const SAFE_IMPORT_NAME = /[^a-zA-Z0-9一-龥._-]/g; // i18n: user-facing
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
                reject(new Error('Uploaded file too large (>50MB)'));
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
                    // Strip leading/trailing CRLF
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
                        // Safe filename: strip path, keep only allowlisted characters
                        const rawName = path.basename(fileMatch[1] || 'upload').replace(SAFE_IMPORT_NAME, '_').slice(0, 128);
                        const dest = path.join(uploadDir, `${Date.now()}-${rawName}`);
                        fs.writeFileSync(dest, value);
                        result.file = dest;
                        console.log(`[Office] multipart file saved: ${dest} (${(value.length / 1024).toFixed(1)} KB)`);
                    } else {
                        result.fields[fieldName] = value.toString('utf-8');
                    }
                }
                resolve(result);
            } catch (e) {
                reject(new Error(`multipart parse failed: ${e.message}`));
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

    // ── Import Office document (admin only) ──────────────────────────────────
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

    // ── Upload and import Office document (admin only, multipart) ────────────────
    // F7 fix: client OfficePanel uploads via multipart/form-data, but /import uses parseBody(JSON),
    // so the broken contract made imports always fail. New multipart endpoint: receive file → store in temp area → call officeImport.
    app.registerRoute('POST', '/api/office/upload-import', async (req, res) => {
        if (!requireAdmin(req, res)) return;
        const contentType = (req.headers['content-type'] || '').toLowerCase();
        if (!contentType.includes('multipart/form-data')) {
            return error(res, 'Only multipart/form-data is supported', 400);
        }
        try {
            const uploadDir = path.join(app.config.storage.dir, 'office-uploads');
            fs.mkdirSync(uploadDir, { recursive: true });
            // Simple multipart boundary parsing (zero-dependency, first file + file_path field only)
            const boundaryMatch = contentType.match(/boundary=(.+)$/);
            if (!boundaryMatch) return error(res, 'Invalid multipart boundary', 400);
            const boundary = Buffer.from('--' + boundaryMatch[1].trim().replace(/^"|"$/g, ''));
            const saved = await _saveMultipartUpload(req, boundary, uploadDir);
            if (!saved.file) return error(res, 'No file received', 400);
            // file_path field is optional (filename preferred); book_id/chapter_id come via form fields
            const safeFilePath = safePath(app, saved.file, 'upload-import');
            if (!safeFilePath) return error(res, 'Save path out of bounds', 403);
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

    // ── Export page to Office format ──────────────────────────────────────────
    app.registerRoute('POST', '/api/office/export/:id', async (req, res) => {
        const { id } = req.params;
        const body = await parseBody(req);
        const format = body.format || 'docx';
        try {
            const page = db ? db.prepare('SELECT * FROM pages WHERE id = ?').get(id) : null;
            if (!page) return error(res, 'Page not found', 404);
            // S4 fix: export reads page content, so ownership must be checked, otherwise any user could export others' private pages (IDOR)
            if (!canReadPage(req, res, page)) return;
            const result = await officeExport(app, { page, format });
            if (result.file_path && fs.existsSync(result.file_path)) {
                const ext = format === 'xlsx' ? 'xlsx' : format === 'pptx' ? 'pptx' : 'docx';
                res.writeHead(200, {
                    'Content-Type': 'application/octet-stream',
                    'Content-Disposition': safeContentDisposition(page.title, ext),
                    'Content-Length': fs.statSync(result.file_path).size,
                });
                // E2 fix: streaming export needs an error handler, otherwise an underlying EPIPE/read error throws uncaught and kills the process
                const stream = fs.createReadStream(result.file_path);
                stream.on('error', (e) => {
                    console.error(`[Office] Export stream error: ${e.message}`);
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

    // ── Batch import directory (admin only) ──────────────────────────────────────
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
