// =============================================================================
// Fusion-Doc — 健康检查控制器
// =============================================================================

function register(app) {
  app.registerRoute('GET', '/api/health', (req, res) => {
    const { json } = require('../utils/response');
    json(res, {
      app: 'Fusion-Doc', version: '1.0.0', status: 'ok',
      uptime: Math.floor((Date.now() - (app._startTime || Date.now())) / 1000),
      features: {
        editor: 'TipTap + Yjs 实时协作',
        structure: '空间→书架→章节→页面（BookStack 三层）',
        search: 'SQLite FTS5 全文搜索（Wiki.js）',
        tags: '标签系统（Teedy）',
        links: '双向链接 + 知识图谱（Zettlr）',
        versions: '页面历史版本（DocMost）',
        export: 'PDF/HTML/Markdown/Office 导出（BookStack + LibreOffice）',
        ai: 'Fusion-MLX 本地 AI 推理',
        ocr: '文档 OCR（Teedy）',
        native: 'macOS 原生优化（MacDown）',
      },
      integrations: {
        fusionMlx: app.config.fusionMlx.url,
        fusionCoder: 'available',
      },
      plugins: app.plugins.map(p => ({ name: p.name, version: p.version })),
    });
  });
}

module.exports = { register };