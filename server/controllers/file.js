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
const { json, list, notFound } = require('../utils/response');

const ALLOWED_EXTS = new Set([
    '.docx', '.xlsx', '.pptx', '.odt', '.ods', '.odp',
    '.pdf', '.txt', '.md', '.csv', '.html', '.rtf',
    '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp',
    '.zip', '.tar', '.gz', '.mp3', '.mp4', '.wav',
]);

function sanitizeExt(rawName) {
    const ext = path.extname(rawName || 'file.bin').toLowerCase();
    if (ALLOWED_EXTS.has(ext)) return ext;
    console.warn(`[File] Rejected extension "${ext}" from name "${rawName}", defaulting to .bin`);
    return '.bin';
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
    const buf = Buffer.from(body.content || '', 'base64');
    fs.writeFileSync(path.join(storageDir, fileName), buf);

    const file = {
      id: fileId, name: body.name || 'untitled', path: fileName,
      mime: body.mime || 'application/octet-stream', size: buf.length,
      page_id: body.page_id || null, encrypted: 0,
      created_at: now(),
    };
    if (db) {
      db.prepare('INSERT INTO files (id, name, path, mime, size, page_id, encrypted, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(...Object.values(file));
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

  // ── 文件下载 ──────────────────────────────────────────────────────────
  app.registerRoute('GET', '/api/files/:id', (req, res) => {
    const { id } = req.params;
    let file = db ? db.prepare('SELECT * FROM files WHERE id = ?').get(id) : require('../db').readJSON('files', id);
    if (!file) return notFound(res, 'File not found');
    const filePath = path.join(storageDir, file.path);
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath);
      res.writeHead(200, {
        'Content-Type': file.mime,
        'Content-Disposition': `attachment; filename="${encodeURIComponent(file.name)}"`,
        'Content-Length': data.length,
      });
      res.end(data);
    } else {
      notFound(res, 'File not found on disk');
    }
  });

  // ── 文件删除 ──────────────────────────────────────────────────────────
  app.registerRoute('DELETE', '/api/files/:id', (req, res) => {
    const { id } = req.params;
    let file = db ? db.prepare('SELECT * FROM files WHERE id = ?').get(id) : require('../db').readJSON('files', id);
    if (file) {
      const fp = path.join(storageDir, file.path);
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
      db ? db.prepare('DELETE FROM files WHERE id = ?').run(id) : require('../db').deleteJSON('files', id);
    }
    json(res, { deleted: true });
  });
}

module.exports = { register };