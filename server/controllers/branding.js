// =============================================================================
// Fusion-Doc — branding info controller
// =============================================================================

const { json } = require('../utils/response');
const { version: APP_VERSION } = require('../../package.json');

function register(app) {
  app.registerRoute('GET', '/api/branding', (req, res) => {
    json(res, {
      name: 'Fusion-Doc', slogan: 'Apple Silicon 原生离线智能文档知识库', // i18n: user-facing
      version: APP_VERSION, theme: { primary: '#6366f1', secondary: '#06b6d4' },
      features: [
        'TipTap 编辑器 + Yjs 实时协作（DocMost）', // i18n: user-facing
        '空间→书架→章节→页面 三层结构（BookStack）', // i18n: user-facing
        'SQLite FTS5 全文搜索（Wiki.js）', // i18n: user-facing
        '标签系统 + 工作流（Teedy）', // i18n: user-facing
        '双向链接 + 知识图谱（Zettlr）', // i18n: user-facing
        '页面历史版本 + 评论（DocMost）', // i18n: user-facing
        'PDF/HTML/Markdown/Office 导出（BookStack）', // i18n: user-facing
        'Fusion-MLX 本地 AI 推理（RAG / Streaming / Agent）', // i18n: user-facing
        'Fusion-Coder AI 编码辅助', // i18n: user-facing
        'macOS 原生优化（MacDown）', // i18n: user-facing
        '模块化插件架构（Plugin System）', // i18n: user-facing
      ]
    });
  });
}

module.exports = { register };