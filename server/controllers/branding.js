// =============================================================================
// Fusion-Doc — 品牌信息控制器
// =============================================================================

const { json } = require('../utils/response');
const { version: APP_VERSION } = require('../../package.json');

function register(app) {
  app.registerRoute('GET', '/api/branding', (req, res) => {
    json(res, {
      name: 'Fusion-Doc', slogan: 'Apple Silicon 原生离线智能文档知识库',
      version: APP_VERSION, theme: { primary: '#6366f1', secondary: '#06b6d4' },
      features: [
        'TipTap 编辑器 + Yjs 实时协作（DocMost）',
        '空间→书架→章节→页面 三层结构（BookStack）',
        'SQLite FTS5 全文搜索（Wiki.js）',
        '标签系统 + 工作流（Teedy）',
        '双向链接 + 知识图谱（Zettlr）',
        '页面历史版本 + 评论（DocMost）',
        'PDF/HTML/Markdown/Office 导出（BookStack）',
        'Fusion-MLX 本地 AI 推理（RAG / Streaming / Agent）',
        'Fusion-Coder AI 编码辅助',
        'macOS 原生优化（MacDown）',
        '模块化插件架构（Plugin System）',
      ]
    });
  });
}

module.exports = { register };