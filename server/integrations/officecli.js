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
        // R16 修复: 消费 stdio 防背压死锁。常驻进程写满 ~64KB pipe 缓冲即阻塞 stall,
        // 必须持续 drain stdout/stderr, 否则 startResident 返回 true 但进程已卡死。
        residentProcess.stdout.on('data', (d) => {
            if (process.env.NODE_ENV !== 'production') console.log('[OfficeCLI:resident]', d.toString().trim());
        });
        residentProcess.stderr.on('data', (d) => {
            console.warn('[OfficeCLI:resident:err]', d.toString().trim());
        });
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

// ── 临时文件清扫 (P2-E11 修复) ────────────────────────────────────────────
// 原导入/导出/预览临时产物落 os.tmpdir()/fusion-doc-office, 进程崩溃 (SIGKILL/掉电)
// 后残留, 累积撑爆 /tmp。清扫: 启动时清超过 STALE_HOURS 的旧文件; 正常退出时清全部。
// 不清当前活跃产物 (仅清过期/退出态), 避免误删进行中任务。
const STALE_HOURS = Number(process.env.OFFICE_STALE_HOURS ?? 24);
function sweepOfficeTemp(opts = {}) {
    const all = opts.all === true;
    const now = Date.now();
    const threshold = STALE_HOURS * 3600 * 1000;
    let removed = 0;
    for (const dir of [WORK_DIR, PREVIEW_DIR]) {
        if (!fs.existsSync(dir)) continue;
        let entries;
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
        for (const e of entries) {
            if (e.isDirectory()) continue;
            const full = path.join(dir, e.name);
            try {
                const st = fs.statSync(full);
                if (all || (now - st.mtimeMs) > threshold) {
                    fs.unlinkSync(full);
                    removed++;
                }
            } catch { /* 已删/无权限忽略 */ }
        }
    }
    if (removed > 0) console.log(`  [OfficeCLI] 临时清扫 ${removed} 个文件 (${all ? '退出' : '过期 ' + STALE_HOURS + 'h'})`);
}
// 启动清扫一次 (清上次崩溃残留)
sweepOfficeTemp();
// 进程退出清扫 (正常关闭路径)
process.on('exit', () => { try { sweepOfficeTemp({ all: true }); } catch (e) { /* 退出清扫忽略错误 */ } });

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

// ── 路径围栏: 拒绝绝对路径与遍历 (纵深防御, 调用者应已 safePath) ──────────
function isSafeTemplate(p) {
    if (!p) return true;
    if (typeof p !== 'string') return false;
    if (path.isAbsolute(p)) return false;
    if (p.includes('..')) return false;
    if (/[<>|:"\0]/.test(p)) return false;
    return true;
}

// ── 创建文档 ────────────────────────────────────────────────────────────
async function createDoc(format, opts) {
    const ext = format || 'docx';
    const fileName = safeFileName(opts.title, 'Untitled');
    const outputPath = path.join(WORK_DIR, `${fileName}.${ext}`);
    const templatePath = opts.template || null;
    let contentPath = null;

    if (!isSafeTemplate(templatePath)) {
        return { success: false, error: 'Invalid template path' };
    }

    const args = ['create', '--format', ext, '--output', outputPath];
    if (templatePath) args.push('--template', templatePath);
    if (opts.content) {
        contentPath = path.join(WORK_DIR, `${fileName}-content.html`);
        fs.writeFileSync(contentPath, opts.content);
        args.push('--content', contentPath);
    }

    const result = await executeCommand('create', args.slice(1));
    if (contentPath) safeUnlink(contentPath);

    if (result.success) {
        console.log(`[OfficeCLI] Created: ${outputPath}`);
        return { success: true, file_path: outputPath, format: ext };
    }
    safeUnlink(outputPath);
    return result;
}

// ── 安全文件名 (剥离路径分隔符与遍历字符) ────────────────────────────────
function safeFileName(name, fallback) {
    const cleaned = (name || '').replace(/[^a-zA-Z0-9一-龥_.-]/g, '_');
    if (!cleaned || cleaned === '.' || cleaned === '..') return fallback || 'untitled';
    return cleaned.slice(0, 100);
}

// ── 临时文件清理 (失败路径也清) ──────────────────────────────────────────
function safeUnlink(p) {
    try { fs.unlinkSync(p); } catch (_) { /* 文件可能不存在 */ }
}

// ── 导入文档 ────────────────────────────────────────────────────────────
async function importDoc(filePath, opts) {
    const ext = path.extname(filePath).toLowerCase();
    if (!['.docx', '.xlsx', '.pptx'].includes(ext)) {
        throw new Error(`Unsupported format: ${ext}`);
    }

    const outputPath = path.join(WORK_DIR, `${safeFileName(path.basename(filePath, ext), 'import')}.html`);
    const result = await executeCommand('convert', [filePath, outputPath, '--to', 'html']);
    if (!result.success) {
        safeUnlink(outputPath);
        return result;
    }

    try {
        const html = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, 'utf-8') : '';
        console.log(`[OfficeCLI] Imported: ${filePath}`);
        return { success: true, html, title: path.basename(filePath, ext) };
    } finally {
        safeUnlink(outputPath);
    }
}

// ── 导出文档 ────────────────────────────────────────────────────────────
async function exportDoc(htmlContent, format, title) {
    const ext = format || 'docx';
    const safeName = safeFileName(title, 'export');
    const htmlPath = path.join(WORK_DIR, `${safeName}-input.html`);
    const outputPath = path.join(WORK_DIR, `${safeName}.${ext}`);

    fs.writeFileSync(htmlPath, htmlContent);
    const result = await executeCommand('convert', [htmlPath, outputPath, '--to', ext]);

    // 始终清输入 html; 输出文件交调用者处理
    safeUnlink(htmlPath);

    if (result.success) {
        console.log(`[OfficeCLI] Exported: ${outputPath}`);
        return { success: true, file_path: outputPath, format: ext };
    }
    safeUnlink(outputPath);
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
    safeUnlink(dataPath);

    if (result.success) {
        console.log(`[OfficeCLI] Merged: ${outputPath}`);
        return { success: true, file_path: outputPath };
    }
    safeUnlink(outputPath);
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
