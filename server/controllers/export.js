// =============================================================================
// Fusion-Doc — 导出控制器（BookStack 导出能力）
// 支持 Markdown / HTML / PDF / Office 格式
// =============================================================================

const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);

const { notFound } = require('../utils/response');

function register(app) {
  const { db } = app;

  app.registerRoute('GET', '/api/export/:format/:id', async (req, res) => {
    const { format, id } = req.params;
    let page = db ? db.prepare('SELECT * FROM pages WHERE id = ?').get(id) : require('../db').readJSON('pages', id);
    if (!page) return notFound(res, '页面不存在');

    const markdown = `# ${page.title}\n\n${page.markdown || page.content || ''}`;

    switch (format) {
      case 'markdown':
        res.writeHead(200, {
          'Content-Type': 'text/markdown; charset=utf-8',
          'Content-Disposition': `attachment; filename="${encodeURIComponent(page.slug || 'page')}.md"`,
        });
        res.end(markdown);
        break;

      case 'html':
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Disposition': `attachment; filename="${encodeURIComponent(page.slug || 'page')}.html"`,
        });
        res.end(htmlTemplate(page.title, markdown));
        break;

      case 'pdf':
        try {
          const tmpDir = path.join(app.config.dataDir, 'exports');
          const { mkdirSync, writeFileSync, readFileSync, unlinkSync } = require('fs');
          mkdirSync(tmpDir, { recursive: true });
          const mdPath = path.join(tmpDir, `${id}.md`);
          const pdfPath = path.join(tmpDir, `${id}.pdf`);
          writeFileSync(mdPath, markdown, 'utf-8');
          try {
            await execFileAsync('pandoc', [mdPath, '-o', pdfPath, '--pdf-engine=weasyprint'], { timeout: 30000 });
          } catch {
            try {
              await execFileAsync('pandoc', [mdPath, '-o', pdfPath], { timeout: 30000 });
            } catch { /* pandoc not available */ }
          }
          if (require('fs').existsSync(pdfPath)) {
            const data = readFileSync(pdfPath);
            res.writeHead(200, {
              'Content-Type': 'application/pdf',
              'Content-Disposition': `attachment; filename="${encodeURIComponent(page.slug || 'page')}.pdf"`,
              'Content-Length': data.length,
            });
            res.end(data);
            try { unlinkSync(mdPath); unlinkSync(pdfPath); } catch (_) { /* cleanup optional */ }
          } else {
            res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end(markdown);
          }
        } catch {
          res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end(markdown);
        }
        break;

      case 'docx':
        try {
          const tmpDir = path.join(app.config.dataDir, 'exports');
          const { mkdirSync, writeFileSync, readFileSync, unlinkSync } = require('fs');
          mkdirSync(tmpDir, { recursive: true });
          const mdPath = path.join(tmpDir, `${id}.md`);
          const docxPath = path.join(tmpDir, `${id}.docx`);
          writeFileSync(mdPath, markdown, 'utf-8');
          try {
            await execFileAsync('pandoc', [mdPath, '-o', docxPath], { timeout: 30000 });
          } catch {
            try {
              await execFileAsync('libreoffice', ['--headless', '--convert-to', 'docx', '--outdir', tmpDir, mdPath], { timeout: 30000 });
            } catch { /* libreoffice not available */ }
          }
          if (require('fs').existsSync(docxPath)) {
            const data = readFileSync(docxPath);
            res.writeHead(200, {
              'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
              'Content-Disposition': `attachment; filename="${encodeURIComponent(page.slug || 'page')}.docx"`,
              'Content-Length': data.length,
            });
            res.end(data);
            try { unlinkSync(mdPath); unlinkSync(docxPath); } catch (_) { /* cleanup optional */ }
          } else {
            res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end(markdown);
          }
        } catch {
          res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end(markdown);
        }
        break;

      default:
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(markdown);
    }
  });
}

function htmlTemplate(title, content) {
  const safeTitle = title.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  return `<!DOCTYPE html><html lang="zh-CN"><head>
<meta charset="utf-8"><title>${safeTitle}</title>
<style>body{max-width:800px;margin:0 auto;padding:2em;font-family:-apple-system,BlinkMacSystemFont,sans-serif;line-height:1.6;color:#334;background:#fff}img{max-width:100%}pre{background:#f5f5f5;padding:1em;overflow-x:auto}code{background:#f0f0f0;padding:.2em .4em;border-radius:3px}</style>
</head><body>${content}</body></html>`;
}

module.exports = { register };