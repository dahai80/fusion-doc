// =============================================================================
// Fusion-Doc — Office service layer (issue #82)
// Backed by fusion-office office-api HTTP service (:11492). xlsx import uses
// /v1/xlsx/parse (sheets -> HTML tables); docx template merge uses /v1/docx/fill.
// Paths with no upstream endpoint yet degrade visibly with an actionable
// message instead of failing on a missing binary:
//   docx import / all-format export / preview / create
//   (pptx pending fusion-office#32; docx parse + write tracked upstream)
// =============================================================================

const path = require('path');
const fs = require('fs');
const os = require('os');
const officeApi = require('../integrations/office-api');

const UPLOAD_DIR = path.join(os.tmpdir(), 'fusion-doc-office');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// Visible degradation errors (OfficeApiError carries an HTTP status)
function pendingError(op, upstream) {
    return new officeApi.OfficeApiError(
        `${op} is not available: fusion-office office-api has no ${upstream} endpoint yet (tracked in fusion-office upstream); xlsx import and docx template fill are functional`,
        422
    );
}

// ── office-api status + capability map ─────────────────────────────────────
async function getOfficeStatus(config) {
    const health = await officeApi.health(config);
    return {
        available: health.available,
        version: health.version || null,
        error: health.error || null,
        backend: 'office-api',
        capabilities: {
            xlsx_import: health.available,
            docx_fill: health.available,
            docx_import: false,
            export: false,
            preview: false,
            create: false,
            pptx: false,
        },
    };
}

// ── Safe temp cleanup ──────────────────────────────────────────────────────
function safeUnlink(p) {
    try { if (p && fs.existsSync(p)) fs.unlinkSync(p); } catch (_) { /* noop */ }
}

// ── xlsx sheets -> HTML tables (import path) ───────────────────────────────
// Cell values are HTML-escaped; merged cells arrive pre-flattened by office-api.
function escapeHtml(v) {
    return String(v == null ? '' : v)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function sheetToHtml(sheet) {
    const tables = Array.isArray(sheet.tables) ? sheet.tables : [];
    if (!tables.length) return `<h2>${escapeHtml(sheet.name)}</h2>\n`;
    return tables.map((t) => {
        const headers = Array.isArray(t.headers) ? t.headers : [];
        const rows = Array.isArray(t.rows) ? t.rows : [];
        const thead = headers.length
            ? `<thead><tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead>`
            : '';
        const tbody = `<tbody>${rows
            .map((r) => `<tr>${(Array.isArray(r) ? r : []).map((c) => `<td>${escapeHtml(c)}</td>`).join('')}</tr>`)
            .join('')}</tbody>`;
        return `<h3>${escapeHtml(sheet.name)}</h3>\n<table>${thead}${tbody}</table>`;
    }).join('\n');
}

// ── Import: xlsx -> HTML page; docx/pptx degrade visibly ───────────────────
async function officeImport(app, opts) {
    const { file_path, dir_path, book_id, chapter_id, recursive } = opts;
    const config = app.config.fusionOfficeApi;

    if (dir_path) {
        return importDirectory(app, dir_path, book_id, recursive);
    }

    const ext = path.extname(file_path).toLowerCase();
    if (!['.docx', '.xlsx', '.pptx'].includes(ext)) {
        throw new officeApi.OfficeApiError(`Unsupported format: ${ext}`, 400);
    }
    if (ext !== '.xlsx') {
        throw pendingError(`${ext.slice(1)} import`, ext === '.docx' ? 'docx parse' : 'pptx parse');
    }

    const content = fs.readFileSync(file_path);
    const data = await officeApi.parseXlsx(content, path.basename(file_path), config);
    const html = (data.sheets || []).map(sheetToHtml).join('\n');
    const title = path.basename(file_path, ext);
    const page = await createPageFromHTML(app, title, html, book_id, chapter_id);
    console.log(`[Office] Imported: ${file_path} -> page ${page.id} (${(data.sheets || []).length} sheets)`);
    return { success: true, page_id: page.id, title };
}

// ── Export: no upstream write endpoint — degrade visibly ───────────────────
async function officeExport(app, opts) {
    const { format } = opts;
    throw pendingError(`${format || 'docx'} export`, 'document write (html->docx/xlsx)');
}

// ── Docx template merge via /v1/docx/fill (replaces officecli merge) ───────
async function officeMerge(app, templatePath, data, outputPath) {
    const config = app.config.fusionOfficeApi;
    const template = fs.readFileSync(templatePath);
    const result = await officeApi.fillDocx(
        template,
        path.basename(templatePath),
        data || {},
        config
    );
    const out = outputPath || path.join(UPLOAD_DIR, `merged-${Date.now()}.docx`);
    fs.writeFileSync(out, result.content);
    if (result.unfilled.length) {
        console.warn(`[Office] Merge unfilled placeholders: ${result.unfilled.join(', ')}`);
    }
    console.log(`[Office] Merged: ${templatePath} -> ${out}`);
    return { success: true, file_path: out, unfilled: result.unfilled };
}

// ── Directory batch import ─────────────────────────────────────────────────
async function importDirectory(app, dirPath, bookId, recursive) {
    const files = findFiles(dirPath, /\.(docx|xlsx|pptx)$/i, recursive);
    const results = [];
    for (const file of files) {
        try {
            const result = await officeImport(app, { file_path: file, book_id: bookId });
            results.push({ file, ...result });
        } catch (e) {
            console.warn(`[Office] Skip ${file}: ${e.message}`);
            results.push({ file, success: false, error: e.message });
        }
    }
    console.log(`[Office] Imported ${results.filter((r) => r.success).length}/${files.length} files from ${dirPath}`);
    return { total: files.length, results };
}

// ── Helpers ────────────────────────────────────────────────────────────────
async function createPageFromHTML(app, title, html, bookId, chapterId) {
    const { db } = app;
    if (!db) throw new Error('Database not available');
    const { uid, now, slugify } = require('../utils/helpers');
    const pageId = uid();
    // slug NOT NULL + random suffix (mirrors controllers/page.js); tenant_id
    // omitted so the DB default (local-tenant, migration 018) applies.
    const slug = (slugify(title) || 'import') + '-' + Math.random().toString(36).slice(2, 6);
    db.prepare(`
        INSERT INTO pages (id, book_id, chapter_id, title, slug, content, markdown, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(pageId, bookId || null, chapterId || null, title, slug, html, html, now(), now());
    return { id: pageId, title };
}

function findFiles(dir, pattern, recursive) {
    let results = [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isFile() && pattern.test(entry.name)) results.push(full);
        else if (entry.isDirectory() && recursive) results = results.concat(findFiles(full, pattern, recursive));
    }
    return results;
}

module.exports = { officeImport, officeExport, officeMerge, getOfficeStatus };
