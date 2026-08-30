// =============================================================================
// Fusion-Doc — 核心入口 (版本见 package.json)
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
// E14 修复: SIGINT/SIGTERM 共用 _shuttingDown 重入闸, 连按 Ctrl+C 不并发 shutdown。
// A9 修复: shutdown 加外层 10s 硬超时, 防 shutdown 卡死 (DB close/WS drain 挂) 成僵尸。
let _shuttingDown = false;
async function _gracefulShutdown(sig) {
  if (_shuttingDown) { console.warn(`[Fusion-Doc] 已在关闭中, 忽略重复 ${sig}`); return; }
  _shuttingDown = true;
  console.log(`[Fusion-Doc] 收到 ${sig}, 开始优雅关闭...`);
  const forceTimer = setTimeout(() => {
    console.error('[Fusion-Doc] shutdown 超过 10s, 强制退出');
    process.exit(1);
  }, 10000);
  try {
    await app.shutdown();
  } catch (e) {
    console.error(`[Fusion-Doc] shutdown 异常: ${e.message}`);
  } finally {
    clearTimeout(forceTimer);
    process.exit(0);
  }
}
process.on('SIGINT', () => _gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => _gracefulShutdown('SIGTERM'));
// R4 修复: uncaughtException/unhandledRejection 后进程状态不可预测, 必须退出交守护重启。
// 原设计仅记录不退出, 进程带伤持续接客, 返回脏数据/写半截 DB/WS 丢稿。
async function _fatalExit(reason, err) {
  console.error(`[Fusion-Doc] ${reason}: ${err && err.message || err}`);
  console.error((err && err.stack) || '');
  if (_shuttingDown) return;
  _shuttingDown = true;
  try { await app.shutdown(); } catch (_) { /* noop */ }
  process.exit(1);
}
process.on('uncaughtException', (err) => _fatalExit('未捕获异常', err));
process.on('unhandledRejection', (err) => _fatalExit('未处理的 Promise 拒绝', err));