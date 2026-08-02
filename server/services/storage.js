// =============================================================================
// Fusion-Doc — 服务层：存储服务
// 业务逻辑：文件上传、存储、加密、Office 格式转换
// =============================================================================

const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const { uid, now } = require('../utils/helpers');

class StorageService {
  constructor(app) {
    this.app = app;
    this.db = app.db;
    this.storageDir = app.config.storage.dir;
    fs.mkdirSync(this.storageDir, { recursive: true });
  }

  // 保存文件
  save(name, base64Content, mime, pageId = null) {
    const fileId = uid();
    const ext = path.extname(name || 'file.bin');
    const fileName = fileId + ext;
    const buf = Buffer.from(base64Content || '', 'base64');
    fs.writeFileSync(path.join(this.storageDir, fileName), buf);

    const file = {
      id: fileId, name: name || 'untitled', path: fileName,
      mime: mime || 'application/octet-stream', size: buf.length,
      page_id: pageId, encrypted: 0, created_at: now(),
    };

    if (this.db) {
      this.db.prepare('INSERT INTO files (id, name, path, mime, size, page_id, encrypted, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(...Object.values(file));
    } else { require('../db').writeJSON('files', file.id, file); }

    // Office 文档文本提取
    const officeExts = ['.docx', '.xlsx', '.pptx', '.odt', '.ods', '.odp'];
    if (officeExts.includes(ext)) {
      file.extracted_text = this.extractText(fileName, fileId, ext);
    }

    return file;
  }

  // 提取文本（Office 文档 → 纯文本）
  extractText(fileName, fileId, ext) {
    try {
      const txtPath = path.join(this.storageDir, fileId + '.txt');
      execSync(`pandoc "${path.join(this.storageDir, fileName)}" -t plain -o "${txtPath}" 2>/dev/null || libreoffice --headless --convert-to txt --outdir "${this.storageDir}" "${path.join(this.storageDir, fileName)}" 2>/dev/null || true`, { timeout: 30000 });
      if (fs.existsSync(txtPath)) {
        const text = fs.readFileSync(txtPath, 'utf-8').slice(0, 50000);
        fs.unlinkSync(txtPath);
        return text;
      }
    } catch (e) { /* 转换不可用 */ }
    return null;
  }

  // 读取文件
  read(fileId) {
    let file = this.db ? this.db.prepare('SELECT * FROM files WHERE id = ?').get(fileId) : require('../db').readJSON('files', fileId);
    if (!file) return null;
    const filePath = path.join(this.storageDir, file.path);
    if (!fs.existsSync(filePath)) return null;
    return { meta: file, data: fs.readFileSync(filePath) };
  }

  // 删除文件
  delete(fileId) {
    let file = this.db ? this.db.prepare('SELECT * FROM files WHERE id = ?').get(fileId) : require('../db').readJSON('files', fileId);
    if (file) {
      const fp = path.join(this.storageDir, file.path);
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
      this.db ? this.db.prepare('DELETE FROM files WHERE id = ?').run(fileId) : require('../db').deleteJSON('files', fileId);
    }
    return { deleted: true };
  }

  // 获取页面文件列表
  listByPage(pageId) {
    if (this.db) {
      return this.db.prepare('SELECT id, name, mime, size, page_id, created_at FROM files WHERE page_id = ? ORDER BY created_at DESC').all(pageId);
    }
    return require('../db').listJSON('files').filter(f => f.page_id === pageId);
  }
}

module.exports = StorageService;