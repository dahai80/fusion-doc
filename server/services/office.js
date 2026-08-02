// =============================================================================
// Fusion-Doc — Office 服务层
// OfficeCLI SDK 交互 + HTML<->Office 格式转换
// =============================================================================

const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);

const OFFICECLI_PATH = process.env.OFFICECLI_PATH || 'officecli';
const UPLOAD_DIR = path.join(os.tmpdir(), 'fusion-doc-office');

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ── OfficeCLI 状态检查 ──────────────────────────────────────────────────────
async function getOfficeStatus() {
    try {
        const { stdout } = await execFileAsync(OFFICECLI_PATH, ['--version'], { timeout: 5000 });
        return { available: true, version: stdout.trim() };
    } catch (e) {
        console.warn('[Office] OfficeCLI not available:', e.message);
        return { available: false, version: null, error: e.message };
    }
}

// ── 导入 ────────────────────────────────────────────────────────────────────
async function officeImport(app, opts) {
    const { file_path, dir_path, book_id, chapter_id, recursive } = opts;

    if (dir_path) {
        return importDirectory(app, dir_path, book_id, recursive);
    }

    const ext = path.extname(file_path).toLowerCase();
    if (!['.docx', '.xlsx', '.pptx'].includes(ext)) {
        throw new Error(`Unsupported format: ${ext}`);
    }

    const outputPath = path.join(UPLOAD_DIR, `${path.basename(file_path, ext)}.html`);
    await runOfficeCLI('convert', file_path, outputPath, '--to', 'html');

    const html = fs.readFileSync(outputPath, 'utf-8');
    const title = path.basename(file_path, ext);
    const page = await createPageFromHTML(app, title, html, book_id, chapter_id);

    fs.unlinkSync(outputPath);
    console.log(`[Office] Imported: ${file_path} → page ${page.id}`);
    return { success: true, page_id: page.id, title };
}

// ── 导出 ────────────────────────────────────────────────────────────────────
async function officeExport(app, opts) {
    const { page, format } = opts;
    const ext = format === 'xlsx' ? 'xlsx' : format === 'pptx' ? 'pptx' : 'docx';

    const htmlPath = path.join(UPLOAD_DIR, `${page.id}.html`);
    const outputPath = path.join(UPLOAD_DIR, `${page.title || page.id}.${ext}`);

    fs.writeFileSync(htmlPath, page.content || '');
    await runOfficeCLI('convert', htmlPath, outputPath, '--to', ext);

    fs.unlinkSync(htmlPath);
    console.log(`[Office] Exported: page ${page.id} → ${outputPath}`);
    return { success: true, file_path: outputPath, format: ext };
}

// ── 目录批量导入 ────────────────────────────────────────────────────────────
async function importDirectory(app, dirPath, bookId, recursive) {
    const pattern = recursive ? /\.(docx|xlsx|pptx)$/i : /\.(docx|xlsx|pptx)$/i;
    const files = findFiles(dirPath, pattern, recursive);
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
    console.log(`[Office] Imported ${results.filter(r => r.success).length}/${files.length} files from ${dirPath}`);
    return { total: files.length, results };
}

// ── 辅助 ────────────────────────────────────────────────────────────────────
async function runOfficeCLI(...args) {
    const { stdout, stderr } = await execFileAsync(OFFICECLI_PATH, args, { timeout: 30000 });
    if (stderr && !stderr.includes('Warning')) {
        console.warn('[Office] CLI stderr:', stderr);
    }
    return stdout;
}

async function createPageFromHTML(app, title, html, bookId, chapterId) {
    const { db } = app;
    if (!db) throw new Error('Database not available');
    const { uid } = require('../utils/helpers');
    const pageId = uid();
    const now = Date.now();
    db.prepare(`
        INSERT INTO pages (id, title, content, book_id, chapter_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(pageId, title, html, bookId || null, chapterId || null, now, now);
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

module.exports = { officeImport, officeExport, getOfficeStatus };
