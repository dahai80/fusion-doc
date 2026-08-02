// =============================================================================
// Fusion-Doc — OfficeCLI 集成层
// 常驻模式 + 预览缓存 + create/import/export/preview/merge/command
// =============================================================================

const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);

const OFFICECLI_PATH = process.env.OFFICECLI_PATH || 'officecli';
const WORK_DIR = path.join(os.tmpdir(), 'fusion-doc-office');
const PREVIEW_DIR = path.join(WORK_DIR, 'previews');

if (!fs.existsSync(WORK_DIR)) fs.mkdirSync(WORK_DIR, { recursive: true });
if (!fs.existsSync(PREVIEW_DIR)) fs.mkdirSync(PREVIEW_DIR, { recursive: true });

let residentProcess = null;

// ── 常驻模式管理 ────────────────────────────────────────────────────────
async function startResident() {
    if (residentProcess) return true;
    try {
        const { spawn } = require('child_process');
        residentProcess = spawn(OFFICECLI_PATH, ['resident', '--port', '0'], {
            stdio: ['pipe', 'pipe', 'pipe'],
            detached: false,
        });
        residentProcess.on('error', (err) => {
            console.warn('[OfficeCLI] Resident mode failed:', err.message);
            residentProcess = null;
        });
        residentProcess.on('exit', () => { residentProcess = null; });
        console.log('[OfficeCLI] Resident mode started');
        return true;
    } catch (e) {
        console.warn('[OfficeCLI] Resident mode unavailable:', e.message);
        return false;
    }
}

function stopResident() {
    if (residentProcess) {
        residentProcess.kill();
        residentProcess = null;
        console.log('[OfficeCLI] Resident mode stopped');
    }
}

async function executeCommand(command, args) {
    try {
        const { stdout, stderr } = await execFileAsync(
            OFFICECLI_PATH, [command, ...args],
            { timeout: 30000 }
        );
        if (stderr && !stderr.includes('Warning')) {
            console.warn(`[OfficeCLI] ${command} stderr:`, stderr);
        }
        return { success: true, output: stdout.trim() };
    } catch (e) {
        console.error(`[OfficeCLI] ${command} failed:`, e.message);
        return { success: false, error: e.message };
    }
}

// ── 创建文档 ────────────────────────────────────────────────────────────
async function createDoc(format, opts) {
    const ext = format || 'docx';
    const fileName = (opts.title || 'Untitled').replace(/[^a-zA-Z0-9一-龥_.-]/g, '_');
    const outputPath = path.join(WORK_DIR, `${fileName}.${ext}`);
    const templatePath = opts.template || null;

    const args = ['create', '--format', ext, '--output', outputPath];
    if (templatePath) args.push('--template', templatePath);
    if (opts.content) {
        const contentPath = path.join(WORK_DIR, `${fileName}-content.html`);
        fs.writeFileSync(contentPath, opts.content);
        args.push('--content', contentPath);
    }

    const result = await executeCommand('create', args.slice(1));
    if (result.success) {
        console.log(`[OfficeCLI] Created: ${outputPath}`);
        return { success: true, file_path: outputPath, format: ext };
    }
    return result;
}

// ── 导入文档 ────────────────────────────────────────────────────────────
async function importDoc(filePath, opts) {
    const ext = path.extname(filePath).toLowerCase();
    if (!['.docx', '.xlsx', '.pptx'].includes(ext)) {
        throw new Error(`Unsupported format: ${ext}`);
    }

    const outputPath = path.join(WORK_DIR, `${path.basename(filePath, ext)}.html`);
    const result = await executeCommand('convert', [filePath, outputPath, '--to', 'html']);

    if (!result.success) return result;

    const html = fs.readFileSync(outputPath, 'utf-8');
    try { fs.unlinkSync(outputPath); } catch (_) { /* cleanup optional */ }

    console.log(`[OfficeCLI] Imported: ${filePath}`);
    return { success: true, html, title: path.basename(filePath, ext) };
}

// ── 导出文档 ────────────────────────────────────────────────────────────
async function exportDoc(htmlContent, format, title) {
    const ext = format || 'docx';
    const safeName = (title || 'export').replace(/[^a-zA-Z0-9一-龥_.-]/g, '_');
    const htmlPath = path.join(WORK_DIR, `${safeName}-input.html`);
    const outputPath = path.join(WORK_DIR, `${safeName}.${ext}`);

    fs.writeFileSync(htmlPath, htmlContent);
    const result = await executeCommand('convert', [htmlPath, outputPath, '--to', ext]);

    try { fs.unlinkSync(htmlPath); } catch (_) { /* cleanup optional */ }

    if (result.success) {
        console.log(`[OfficeCLI] Exported: ${outputPath}`);
        return { success: true, file_path: outputPath, format: ext };
    }
    return result;
}

// ── 预览文档 ────────────────────────────────────────────────────────────
async function previewDoc(filePath, opts) {
    const ext = path.extname(filePath).toLowerCase();
    const baseName = path.basename(filePath, ext);
    const previewPath = path.join(PREVIEW_DIR, `${baseName}-preview.png`);

    if (fs.existsSync(previewPath)) {
        const stat = fs.statSync(previewPath);
        if (Date.now() - stat.mtimeMs < 3600000) {
            return { success: true, preview_path: previewPath, cached: true };
        }
    }

    const page = opts.page || 1;
    const result = await executeCommand('preview', [filePath, previewPath, '--page', String(page)]);

    if (result.success && fs.existsSync(previewPath)) {
        console.log(`[OfficeCLI] Preview generated: ${previewPath}`);
        return { success: true, preview_path: previewPath, cached: false };
    }
    return result;
}

// ── 模板合并 ────────────────────────────────────────────────────────────
async function mergeTemplate(templatePath, data, outputPath) {
    if (!outputPath) {
        outputPath = path.join(WORK_DIR, `merged-${Date.now()}.${path.extname(templatePath) || 'docx'}`);
    }

    const dataPath = path.join(WORK_DIR, `merge-data-${Date.now()}.json`);
    fs.writeFileSync(dataPath, JSON.stringify(data));

    const result = await executeCommand('merge', [templatePath, dataPath, '--output', outputPath]);

    try { fs.unlinkSync(dataPath); } catch (_) { /* cleanup optional */ }

    if (result.success) {
        console.log(`[OfficeCLI] Merged: ${outputPath}`);
        return { success: true, file_path: outputPath };
    }
    return result;
}

// ── 状态检查 ────────────────────────────────────────────────────────────
async function getStatus() {
    try {
        const { stdout } = await execFileAsync(OFFICECLI_PATH, ['--version'], { timeout: 5000 });
        return { available: true, version: stdout.trim(), resident: !!residentProcess };
    } catch (e) {
        return { available: false, version: null, resident: false, error: e.message };
    }
}

module.exports = {
    startResident,
    stopResident,
    executeCommand,
    createDoc,
    importDoc,
    exportDoc,
    previewDoc,
    mergeTemplate,
    getStatus,
};
