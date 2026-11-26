// =============================================================================
// Fusion-Doc — file controller (Teedy document management + LibreOffice conversion)
// =============================================================================

const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);
const { parseBody } = require('../middleware/body-parser');
const { uid, now, parsePaging } = require('../utils/helpers');
const { json, list, notFound, error } = require('../utils/response');
// S2 fix: file read/write ownership checks reuse the page authorization guard, preventing cross-user download/deletion of others' attachments (IDOR)
const { canReadPage } = require('../middleware/authz');

const ALLOWED_EXTS = new Set([
    '.docx', '.xlsx', '.pptx', '.odt', '.ods', '.odp',
    '.pdf', '.txt', '.md', '.csv', '.html', '.rtf',
    '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp',
    '.zip', '.tar', '.gz', '.mp3', '.mp4', '.wav',
]);

// P3-34: extension→MIME allowlist; ignore client-reported mime (prevents content sniffing / type spoofing)
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

// P3-35: verify the resolved path stays inside storageDir (prevents ../ traversal)
function safeStoragePath(storageDir, relName) {
    const resolved = path.resolve(storageDir, relName || '');
    const base = path.resolve(storageDir);
    if (resolved !== base && !resolved.startsWith(base + path.sep)) {
        console.warn(`[File] Path escapes storage dir, rejected: ${relName} → ${resolved}`);
        return null;
    }
    return resolved;
}

function register(app) {
  const { db } = app;
  const storageDir = app.config.storage.dir;

  // ── File list ──────────────────────────────────────────────────────────
  app.registerRoute('GET', '/api/files', (req, res) => {
    const pageId = req.ctx.url.searchParams.get('pageId');
    // A6 fix: cap list pagination to prevent unbounded full-table reads causing OOM
    const { size, offset } = parsePaging(req);
    let data;
    if (db) {
      data = pageId
        ? db.prepare('SELECT id, name, mime, size, page_id, created_at FROM files WHERE page_id = ? LIMIT ? OFFSET ?').all(pageId, size, offset)
        : db.prepare('SELECT id, name, mime, size, page_id, created_at FROM files ORDER BY created_at DESC LIMIT ? OFFSET ?').all(size, offset);
    } else { data = require('../db').listJSON('files').filter(f => !pageId || f.page_id === pageId).slice(offset, offset + size); }
    list(res, data);
  });

  // ── File upload ──────────────────────────────────────────────────────────
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
      // P3-34: map mime from the extension; do not trust the client-reported value
      mime: EXT_MIME[ext] || 'application/octet-stream', size: buf.length,
      page_id: body.page_id || null, encrypted: 0,
      // S2 fix: record the uploader; otherwise created_by is always null and the delete ownership gate short-circuits
      created_by: req.user?.id || 'local',
      created_at: now(),
    };
    if (db) {
      db.prepare('INSERT INTO files (id, name, path, mime, size, page_id, encrypted, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(file.id, file.name, file.path, file.mime, file.size, file.page_id, file.encrypted, file.created_by, file.created_at);
    } else { require('../db').writeJSON('files', file.id, file); }

    // Try to extract text content from Office documents
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
      } catch (e) { /* Office conversion unavailable */ }
    }

    json(res, file, 201);
  });

  // ── File download (P3-35: path check against ../ traversal; S2: read ownership check against cross-user download) ─
  app.registerRoute('GET', '/api/files/:id', (req, res) => {
    const { id } = req.params;
    let file = db ? db.prepare('SELECT * FROM files WHERE id = ?').get(id) : require('../db').readJSON('files', id);
    if (!file) return notFound(res, 'File not found');
    // S2 fix: check read permission on the file's page. For loose files without page_id, allow admin/uploader, otherwise reject.
    if (file.page_id) {
      const page = db ? db.prepare('SELECT id, is_published, created_by FROM pages WHERE id = ?').get(file.page_id) : null;
      if (page) {
        if (!canReadPage(req, res, page)) return;
      } else if (req.user?.role !== 'admin' && req.user?.role !== 'tenant_admin' && file.created_by !== (req.user?.id || 'local')) {
        return error(res, 'Not allowed to download this file', 403, 'FORBIDDEN');
      }
    } else if (req.user?.role !== 'admin' && req.user?.role !== 'tenant_admin' && file.created_by !== (req.user?.id || 'local')) {
      return error(res, 'Not allowed to download this file', 403, 'FORBIDDEN');
    }
    const filePath = safeStoragePath(storageDir, file.path);
    if (!filePath || !fs.existsSync(filePath)) {
      return notFound(res, 'File not found on disk');
    }
    // E15 fix: stream downloads instead of loading the whole file with readFileSync, preventing OOM under concurrent large downloads.
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
      console.error(`[File] Download stream error: ${e.message}`);
      if (!res.writableEnded) res.end();
    });
    stream.pipe(res);
  });

  // ── File delete (P3-35: path check, R13: ownership isolation) ───────────────────────
  app.registerRoute('DELETE', '/api/files/:id', (req, res) => {
    const { id } = req.params;
    let file = db ? db.prepare('SELECT * FROM files WHERE id = ?').get(id) : require('../db').readJSON('files', id);
    if (!file) return notFound(res, 'File not found');
    // R13 fix: only owner/admin may delete, preventing cross-user deletion of others' attachments
    // S2 fix: a legacy NULL file.created_by no longer short-circuits to allow (the old logic let any non-admin delete any ownerless file);
    // now admin is allowed; owned files require an owner match; ownerless (legacy data) files can only be deleted by admin.
    if (req.user?.role === 'admin' || req.user?.role === 'tenant_admin') {
      // admin allowed
    } else if (file.created_by && file.created_by === (req.user?.id || 'local')) {
      // owner allowed
    } else {
      return error(res, 'Not allowed to delete files owned by other users', 403, 'FORBIDDEN');
    }
    const fp = safeStoragePath(storageDir, file.path);
    if (fp && fs.existsSync(fp)) fs.unlinkSync(fp);
    else if (file.path) console.warn(`[File] Path escapes storage dir or does not exist on delete: ${file.path}`);
    db ? db.prepare('DELETE FROM files WHERE id = ?').run(id) : require('../db').deleteJSON('files', id);
    json(res, { deleted: true });
  });
}

module.exports = { register };