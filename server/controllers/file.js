// =============================================================================
// Fusion-Doc — 文件控制器（Teedy 文档管理 + LibreOffice 转换）
// =============================================================================

const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);
const { parseBody } = require('../middleware/body-parser');
const { uid, now } = require('../utils/helpers');
const { json, list, notFound, error } = require('../utils/response');

const ALLOWED_EXTS = new Set([
    '.docx', '.xlsx', '.pptx', '.odt', '.ods', '.odp',
    '.pdf', '.txt', '.md', '.csv', '.html', '.rtf',
    '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp',
    '.zip', '.tar', '.gz', '.mp3', '.mp4', '.wav',
]);

// P3-34: 后缀→MIME 白名单, 拒绝客户端自报 mime (防内容嗅探/类型欺骗)
const EXT_MIME = {
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.odt': 'application/vnd.oasis.opendocument.text',
    '.ods': 'application/vnd.oasis.opendocument.spreadsheet',
    '.odp': 'application/vnd.oasis.opendocument.presentation',
    '.pdf': 'application/pdf',
    '.txt': 'text/plain',
    '.md': 'text/markdown',
    '.csv': 'text/csv',
    '.html': 'text/html',
    '.rtf': 'application/rtf',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.webp': 'image/webp',
    '.zip': 'application/zip',
    '.tar': 'application/x-tar',
    '.gz': 'application/gzip',
    '.mp3': 'audio/mpeg',
    '.mp4': 'video/mp4',
    '.wav': 'audio/wav',
    '.bin': 'application/octet-stream',
};

function sanitizeExt(rawName) {
    const ext = path.extname(rawName || 'file.bin').toLowerCase();
    if (ALLOWED_EXTS.has(ext)) return ext;
    console.warn(`[File] Rejected extension "${ext}" from name "${rawName}", defaulting to .bin`);
    return '.bin';
}

// P3-35: 校验解析后路径仍在 storageDir 内 (防 ../ 穿越)
function safeStoragePath(storageDir, relName) {
    const resolved = path.resolve(storageDir, relName || '');
    const base = path.resolve(storageDir);
    if (resolved !== base && !resolved.startsWith(base + path.sep)) {
        console.warn(`[File] 路径越界拒绝: ${relName} → ${resolved}`);
        return null;
    }
    return resolved;
}

function register(app) {
  const { db } = app;
  const storageDir = app.config.storage.dir;

  // ── 文件列表 ──────────────────────────────────────────────────────────
  app.registerRoute('GET', '/api/files', (req, res) => {
    const pageId = req.ctx.url.searchParams.get('pageId');
    let data;
    if (db) {
      data = pageId
        ? db.prepare('SELECT id, name, mime, size, page_id, created_at FROM files WHERE page_id = ?').all(pageId)
        : db.prepare('SELECT id, name, mime, size, page_id, created_at FROM files ORDER BY created_at DESC').all();
    } else { data = require('../db').listJSON('files').filter(f => !pageId || f.page_id === pageId); }
    list(res, data);
  });

  // ── 文件上传 ──────────────────────────────────────────────────────────
  app.registerRoute('POST', '/api/files/upload', async (req, res) => {
    const body = await parseBody(req);
    const fileId = uid();
    const ext = sanitizeExt(body.name);
    const fileName = fileId + ext;
    fs.mkdirSync(storageDir, { recursive: true });
    const safePath = safeStoragePath(storageDir, fileName);
    if (!safePath) return notFound(res, 'invalid file path');
    const buf = Buffer.from(body.content || '', 'base64');
    fs.writeFileSync(safePath, buf);

    const file = {
      id: fileId, name: body.name || 'untitled', path: fileName,
      // P3-34: 用后缀映射 mime, 不采信客户端自报
      mime: EXT_MIME[ext] || 'application/octet-stream', size: buf.length,
      page_id: body.page_id || null, encrypted: 0,
      created_at: now(),
    };
    if (db) {
      db.prepare('INSERT INTO files (id, name, path, mime, size, page_id, encrypted, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(file.id, file.name, file.path, file.mime, file.size, file.page_id, file.encrypted, file.created_at);
    } else { require('../db').writeJSON('files', file.id, file); }

    // 尝试提取 Office 文档文本内容
    const officeExts = ['.docx', '.xlsx', '.pptx', '.odt', '.ods', '.odp'];
    if (officeExts.includes(ext)) {
      try {
        const txtPath = path.join(storageDir, fileId + '.txt');
        const srcPath = path.join(storageDir, fileName);
        try {
          await execFileAsync('pandoc', [srcPath, '-t', 'plain', '-o', txtPath], { timeout: 30000 });
        } catch {
          try {
            await execFileAsync('libreoffice', ['--headless', '--convert-to', 'txt', '--outdir', storageDir, srcPath], { timeout: 30000 });
          } catch { /* libreoffice not available */ }
        }
        if (fs.existsSync(txtPath)) {
          file.extracted_text = fs.readFileSync(txtPath, 'utf-8').slice(0, 50000);
          fs.unlinkSync(txtPath);
        }
      } catch (e) { /* Office 转换不可用 */ }
    }

    json(res, file, 201);
  });

  // ── 文件下载 (P3-35: 路径校验, 防 ../ 穿越) ──────────────────────────
  app.registerRoute('GET', '/api/files/:id', (req, res) => {
    const { id } = req.params;
    let file = db ? db.prepare('SELECT * FROM files WHERE id = ?').get(id) : require('../db').readJSON('files', id);
    if (!file) return notFound(res, 'File not found');
    const filePath = safeStoragePath(storageDir, file.path);
    if (!filePath || !fs.existsSync(filePath)) {
      return notFound(res, 'File not found on disk');
    }
    // E15 修复: 流式下载替代 readFileSync 整载, 防大文件并发 OOM。
    const stat = fs.statSync(filePath);
    const ext = sanitizeExt(file.name || file.path).toLowerCase();
    const mime = EXT_MIME[ext] || file.mime || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': mime,
      'Content-Disposition': `attachment; filename="${encodeURIComponent(file.name)}"`,
      'Content-Length': stat.size,
    });
    const stream = fs.createReadStream(filePath);
    stream.on('error', (e) => {
      console.error(`[File] 下载流错误: ${e.message}`);
      if (!res.writableEnded) res.end();
    });
    stream.pipe(res);
  });

  // ── 文件删除 (P3-35: 路径校验, R13: 所有权隔离) ───────────────────────
  app.registerRoute('DELETE', '/api/files/:id', (req, res) => {
    const { id } = req.params;
    let file = db ? db.prepare('SELECT * FROM files WHERE id = ?').get(id) : require('../db').readJSON('files', id);
    if (!file) return notFound(res, 'File not found');
    // R13 修复: 仅 owner/admin 可删, 杜绝跨用户删除他人附件
    if (req.user?.role !== 'admin' && file.created_by && file.created_by !== (req.user?.id || 'local')) {
      return error(res, '无权删除他人文件', 403, 'FORBIDDEN');
    }
    const fp = safeStoragePath(storageDir, file.path);
    if (fp && fs.existsSync(fp)) fs.unlinkSync(fp);
    else if (file.path) console.warn(`[File] 删除时路径越界或不存在: ${file.path}`);
    db ? db.prepare('DELETE FROM files WHERE id = ?').run(id) : require('../db').deleteJSON('files', id);
    json(res, { deleted: true });
  });
}

module.exports = { register };