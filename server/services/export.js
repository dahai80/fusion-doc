// =============================================================================
// Fusion-Doc — 服务层：导出服务
// 业务逻辑：Markdown / HTML / PDF / Office 导出
// =============================================================================

const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);
const fs = require('fs');

class ExportService {
  constructor(app) {
    this.app = app;
    this.db = app.db;
    this.exportDir = path.join(app.config.dataDir, 'exports');
  }

  // 获取页面内容
  _getPage(id) {
    return this.db ? this.db.prepare('SELECT * FROM pages WHERE id = ?').get(id) : require('../db').readJSON('pages', id);
  }

  _getMarkdown(page) {
    return `# ${page.title}\n\n${page.markdown || page.content || ''}`;
  }

  // 导出 Markdown
  exportMarkdown(pageId) {
    const page = this._getPage(pageId);
    if (!page) return null;
    return { content: this._getMarkdown(page), filename: `${page.slug || 'page'}.md`, mime: 'text/markdown' };
  }

  // 导出 HTML
  exportHTML(pageId) {
    const page = this._getPage(pageId);
    if (!page) return null;
    const md = this._getMarkdown(page);
    const html = `<!DOCTYPE html><html lang="zh-CN"><head>
<meta charset="utf-8"><title>${page.title}</title>
<style>body{max-width:800px;margin:0 auto;padding:2em;font-family:-apple-system,BlinkMacSystemFont,sans-serif;line-height:1.6}</style>
</head><body>${md}</body></html>`;
    return { content: html, filename: `${page.slug || 'page'}.html`, mime: 'text/html' };
  }

  // 导出 PDF（通过 pandoc）
  async exportPDF(pageId) {
    const page = this._getPage(pageId);
    if (!page) return null;
    const md = this._getMarkdown(page);
    try {
      fs.mkdirSync(this.exportDir, { recursive: true });
      const mdPath = path.join(this.exportDir, `${pageId}.md`);
      const pdfPath = path.join(this.exportDir, `${pageId}.pdf`);
      fs.writeFileSync(mdPath, md, 'utf-8');
      try {
        await execFileAsync('pandoc', [mdPath, '-o', pdfPath, '--pdf-engine=weasyprint'], { timeout: 30000 });
      } catch {
        try {
          await execFileAsync('pandoc', [mdPath, '-o', pdfPath], { timeout: 30000 });
        } catch { /* pandoc not available */ }
      }
      if (fs.existsSync(pdfPath)) {
        const data = fs.readFileSync(pdfPath);
        try { fs.unlinkSync(mdPath); fs.unlinkSync(pdfPath); } catch (_) { /* cleanup optional */ }
        return { content: data, filename: `${page.slug || 'page'}.pdf`, mime: 'application/pdf', binary: true };
      }
    } catch { /* fallback */ }
    return { content: md, filename: `${page.slug || 'page'}.md`, mime: 'text/markdown' };
  }

  // 导出 DOCX（通过 pandoc）
  async exportDocx(pageId) {
    const page = this._getPage(pageId);
    if (!page) return null;
    const md = this._getMarkdown(page);
    try {
      fs.mkdirSync(this.exportDir, { recursive: true });
      const mdPath = path.join(this.exportDir, `${pageId}.md`);
      const docxPath = path.join(this.exportDir, `${pageId}.docx`);
      fs.writeFileSync(mdPath, md, 'utf-8');
      try {
        await execFileAsync('pandoc', [mdPath, '-o', docxPath], { timeout: 30000 });
      } catch {
        try {
          await execFileAsync('libreoffice', ['--headless', '--convert-to', 'docx', '--outdir', this.exportDir, mdPath], { timeout: 30000 });
        } catch { /* libreoffice not available */ }
      }
      if (fs.existsSync(docxPath)) {
        const data = fs.readFileSync(docxPath);
        try { fs.unlinkSync(mdPath); fs.unlinkSync(docxPath); } catch (_) { /* cleanup optional */ }
        return { content: data, filename: `${page.slug || 'page'}.docx`, mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', binary: true };
      }
    } catch { /* fallback */ }
    return { content: md, filename: `${page.slug || 'page'}.md`, mime: 'text/markdown' };
  }
}

module.exports = ExportService;