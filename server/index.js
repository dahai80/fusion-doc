// =============================================================================
// Fusion-Doc V1.0.0 — 核心入口
// =============================================================================
// 架构: 模块化 MVC（Model-View-Controller）
// 理念: 整合 7 大开源优势 + Fusion 生态，打造 Apple Silicon 原生离线智能文档知识库
// =============================================================================
//
// 架构概览:
//   server/
//   ├── index.js              ← 轻量入口
//   ├── app.js                ← 应用核心（生命周期、中间件、插件）
//   ├── config.js             ← 配置管理
//   ├── db.js                 ← 数据库层（SQLite + JSON 降级）
//   ├── middleware/           ← 中间件栈（CORS/日志/认证/错误处理）
//   ├── controllers/          ← 控制器层（路由分发）
//   ├── services/             ← 服务层（业务逻辑）
//   ├── models/              ← 模型层（数据封装）
//   ├── integrations/        ← 集成层（Fusion-MLX / Fusion-Coder / LibreOffice）
//   ├── plugins/             ← 插件系统
//   └── utils/               ← 工具函数
//
// 生态集成:
//   - Fusion-MLX  → 本地 LLM 推理（聊天/嵌入/重排序/RAG）
//   - Fusion-Coder → AI 编码辅助
//   - Fusion-KB   → 知识库管理
//   - LibreOffice  → Office 文档格式转换
// =============================================================================

const FusionDocApp = require('./app');

// ── 启动应用 ──────────────────────────────────────────────────────────────
const app = new FusionDocApp();

app.start().catch((err) => {
  console.error(`[Fusion-Doc] 启动失败: ${err.message}`);
  process.exit(1);
});

// ── 优雅关闭 ──────────────────────────────────────────────────────────────
process.on('SIGINT', async () => { await app.shutdown(); process.exit(0); });
process.on('SIGTERM', async () => { await app.shutdown(); process.exit(0); });
process.on('uncaughtException', (err) => {
  console.error(`[Fusion-Doc] 未捕获异常: ${err.message}`);
});
process.on('unhandledRejection', (err) => {
  console.error(`[Fusion-Doc] 未处理的 Promise 拒绝: ${err.message}`);
});