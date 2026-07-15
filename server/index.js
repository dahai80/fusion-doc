// =============================================================================
// Fusion-Doc — 核心入口
// =============================================================================
// 整合 ~/mac-doc 所有开源优势：
//   DocMost 协作 + Wiki.js 模块化 + BookStack 三层结构
//   + Teedy OCR/标签 + Zettlr 图谱 + LibreOffice 格式转换
//   + MacDown 原生体验 + Fusion-MLX AI
// =============================================================================

const http = require('http');
const path = require('path');
const { initDB, db } = require('./db');
const { router } = require('./routes');
const { serveStatic } = require('./utils/static');
const { cors, parseBody } = require('./middleware/common');

const PORT = parseInt(process.env.FUSION_DOC_PORT || '11435', 10);
const FUSION_MLX_URL = process.env.FUSION_MLX_URL || 'http://localhost:11434';
const PUBLIC_DIR = path.join(__dirname, '..', 'gateway', 'public');

console.log(`
  ╔══════════════════════════════════════════╗
  ║         Fusion-Doc V0.1                  ║
  ║  整合 7 大开源优势，macOS 原生优化       ║
  ╚══════════════════════════════════════════╝
`);

// ── 初始化数据库 ──────────────────────────────────────────────────────────
initDB();

// ── 创建 HTTP 服务器 ──────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  // CORS
  cors(req, res);
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  try {
    // 注入依赖
    req.ctx = { db, PUBLIC_DIR, FUSION_MLX_URL };

    // 路由分发
    const handled = await router(req, res);
    if (handled) return;

    // 静态资源文件
    const assetPaths = ['/assets/', '/icons/', '/manifest.json', '/vite.svg', '/locales/', '/branding/'];
    if (assetPaths.some(p => req.url.startsWith(p))) {
      return serveStatic(res, path.join(PUBLIC_DIR, req.url));
    }

    // SPA: 所有非 API 路径 → index.html
    serveStatic(res, path.join(PUBLIC_DIR, 'index.html'));

  } catch (err) {
    console.error(`[Fusion-Doc] ${err.message}`);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
});

server.listen(PORT, () => {
  console.log(`  🚀  Fusion-Doc 已启动`);
  console.log(`  ─────────────────────────────────────────`);
  console.log(`  📍  http://localhost:${PORT}`);
  console.log(`  🧠  AI: ${FUSION_MLX_URL}`);
  console.log(`  💾  存储: SQLite + JSON`);
  console.log(`  ─────────────────────────────────────────`);
  console.log(`  整合特性:`);
  console.log(`  ✅ DocMost    → TipTap 编辑器 + Yjs 协作`);
  console.log(`  ✅ Wiki.js    → 模块化架构 + 多认证`);
  console.log(`  ✅ BookStack  → 三层结构 + 导出`);
  console.log(`  ✅ Teedy      → OCR + 标签 + 工作流`);
  console.log(`  ✅ Zettlr     → 双向链接 + 知识图谱`);
  console.log(`  ✅ MacDown    → macOS 原生体验`);
  console.log(`  ✅ LibreOffice→ Office 格式转换`);
  console.log(`  ✅ Fusion-MLX → 本地 AI 推理`);
  console.log(`  ─────────────────────────────────────────`);
});