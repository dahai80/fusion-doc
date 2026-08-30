// =============================================================================
// Fusion-Doc — 导出控制器（BookStack 导出能力）
// 支持 Markdown / HTML / PDF / Office 格式
// =============================================================================

const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);

const { notFound } = require('../utils/response');
// P1-P5 修复: 流式下载替代 readFileSync, 避免大 PDF/DOCX 整文件入内存 OOM
const { createReadStream, mkdirSync, writeFileSync, existsSync, statSync, unlinkSync } = require('fs');

// 流式发送已生成文件, 发完清理 temp; 流错不杀进程
function streamFile(res, filePath, contentType, filename, cleanupPaths) {
    const stat = statSync(filePath);
    res.writeHead(200, {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`,
        'Content-Length': stat.size,
    });
    const stream = createReadStream(filePath);
    stream.on('error', (e) => {
        console.error(`[Export] stream error ${filePath}: ${e.message}`);
        if (!res.writableEnded) res.end();
    });
    stream.on('end', () => {
        for (const p of cleanupPaths) { try { unlinkSync(p); } catch (_) { /* cleanup optional */ } }
    });
    stream.pipe(res);
}

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
          if (existsSync(pdfPath)) {
            streamFile(res, pdfPath, 'application/pdf', `${page.slug || 'page'}.pdf`, [mdPath, pdfPath]);
          } else {
            res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end(markdown);
            try { unlinkSync(mdPath); } catch (_) { /* cleanup optional */ }
          }
        } catch {
          res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end(markdown);
        }
        break;

      case 'docx':
        try {
          const tmpDir = path.join(app.config.dataDir, 'exports');
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
          if (existsSync(docxPath)) {
            streamFile(res, docxPath, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', `${page.slug || 'page'}.docx`, [mdPath, docxPath]);
          } else {
            res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end(markdown);
            try { unlinkSync(mdPath); } catch (_) { /* cleanup optional */ }
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
