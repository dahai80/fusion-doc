// =============================================================================
// Fusion-Doc — 应用核心
// 生命周期管理、中间件栈、插件加载、路由注册
// =============================================================================

const http = require('http');
const path = require('path');
const config = require('./config');
const { version: APP_VERSION } = require('../package.json');
const { initDB } = require('./db');
const { registerRoutes } = require('./controllers');
const { loadPlugins } = require('./plugins/loader');
const { serveStatic, serveSPA } = require('./utils/static');
const { createMiddlewarePipeline } = require('./middleware/pipeline');
const { seedTemplates } = require('./services/seed-templates');
let WebSocketServer;
try { WebSocketServer = require('ws').WebSocketServer; } catch { WebSocketServer = null; }

class FusionDocApp {
  constructor() {
    this.config = config;
    this.server = null;
    this.wsServer = null;
    this.middleware = createMiddlewarePipeline();
    this.plugins = [];
    this.routes = [];
    this._wsRoutes = [];
    this.collabRooms = {};
    this._startTime = null;
    this._sockets = new Set();
  }

  // ── 初始化 ──────────────────────────────────────────────────────────────
  async init() {
    console.log(`
  ╔══════════════════════════════════════════╗
  ║         Fusion-Doc V${APP_VERSION}                ║
  ║   Apple Silicon 原生离线智能文档知识库    ║
  ╚══════════════════════════════════════════╝
    `);

    // 1. 初始化数据库
    console.log('  [1/4] 初始化数据库...');
    this.db = initDB();
    if (this.db) seedTemplates(this.db);
    console.log(`  [✓] 数据库: ${this.db ? 'SQLite' : 'JSON 文件存储'}`);

    // 2. 注册内置中间件
    console.log('  [2/4] 加载中间件...');
    this._registerBuiltinMiddleware();
    console.log('  [✓] 中间件已加载');

    // 3. 注册路由（控制器）
    console.log('  [3/4] 注册路由...');
    registerRoutes(this);
    console.log(`  [✓] 路由已注册: ${this.routes.length} 条`);

    // 4. 加载插件
    console.log('  [4/4] 加载插件...');
    this.plugins = await loadPlugins(this);
    console.log(`  [✓] 插件已加载: ${this.plugins.length} 个`);

    this._startTime = Date.now();
    return this;
  }

  // ── 内置中间件 ──────────────────────────────────────────────────────────
  _registerBuiltinMiddleware() {
    const { cors } = require('./middleware/cors');
    const { logger } = require('./middleware/logger');
    const { errorHandler } = require('./middleware/error-handler');
    const { auth } = require('./middleware/auth');
    const { globalRateLimit } = require('./middleware/rate-limit');

    this.middleware.use('cors', cors, 0);
    this.middleware.use('logger', logger, 10);
    this.middleware.use('rateLimit', globalRateLimit, 15); // 认证前限流, 防爆破
    this.middleware.use('auth', auth, 20);
    this.middleware.use('error', errorHandler, 100); // 最后执行
  }

  // ── 注册路由 ────────────────────────────────────────────────────────────
  registerRoute(method, pathname, handler, options = {}) {
    this.routes.push({ method, pathname, handler, options });
  }

  // ── 注册 WebSocket 路由 ────────────────────────────────────────────────
  ws(pathname, handler) {
    this._wsRoutes.push({ pathname, handler });
  }

  // ── 请求处理 ────────────────────────────────────────────────────────────
  async _handleRequest(req, res) {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = url.pathname;
    const method = req.method;

    // 注入上下文
    req.ctx = { app: this, db: this.db, config: this.config, url };

    // 执行中间件管道
    const pipelineDone = await this.middleware.run(req, res);
    if (pipelineDone) return; // 中间件已处理响应（如 CORS OPTIONS）

    try {
      // 路由匹配
      const handled = await this._matchRoute(method, pathname, req, res);
      if (handled) return;

      // API 404
      if (pathname.startsWith('/api/')) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'API endpoint not found', path: pathname }));
        return;
      }

      // 静态文件
      const assetPaths = ['/assets/', '/icons/', '/manifest.json', '/vite.svg', '/locales/', '/branding/'];
      if (assetPaths.some(p => pathname.startsWith(p))) {
        return serveStatic(res, path.join(config.publicDir, pathname));
      }

      // SPA fallback
      serveSPA(res, config.publicDir);
    } catch (err) {
      const status = err.statusCode || 500;
      console.error(`[Fusion-Doc] 错误 (${status}): ${err.message}`);
      if (!res.headersSent) {
        const isProd = process.env.NODE_ENV === 'production';
        const message = (status >= 500 && isProd)
          ? 'Internal Server Error'
          : err.message;
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: message,
          code: err.code || `ERR_${status}`,
          timestamp: new Date().toISOString(),
        }));
      }
    }
  }

  // ── 路由匹配 ────────────────────────────────────────────────────────────
  async _matchRoute(method, pathname, req, res) {
    // 第一遍：精确匹配（优先）
    for (const route of this.routes) {
      if (route.method !== method && route.method !== 'ALL') continue;
      if (route.pathname === pathname) {
        req.params = {};
        await route.handler(req, res);
        return true;
      }
    }

    // 第二遍：参数化匹配（如 /api/pages/:id）
    for (const route of this.routes) {
      if (route.method !== method && route.method !== 'ALL') continue;
      // 跳过非参数化路由（已在第一遍精确匹配过）
      if (!route.pathname.includes(':')) continue;

      const routeParts = route.pathname.split('/');
      const pathParts = pathname.split('/');
      if (routeParts.length !== pathParts.length) continue;

      const params = {};
      let matched = true;
      for (let i = 0; i < routeParts.length; i++) {
        if (routeParts[i].startsWith(':')) {
          params[routeParts[i].slice(1)] = pathParts[i];
        } else if (routeParts[i] !== pathParts[i]) {
          matched = false;
          break;
        }
      }
      if (matched) {
        req.params = params;
        await route.handler(req, res);
        return true;
      }
    }
    return false;
  }

  // ── 启动 ────────────────────────────────────────────────────────────────
  async start() {
    await this.init();

    this.server = http.createServer((req, res) => this._handleRequest(req, res));

    // 跟踪连接以便优雅关闭时强制销毁 keep-alive
    this.server.on('connection', (socket) => {
      this._sockets.add(socket);
      socket.on('close', () => this._sockets.delete(socket));
    });

    // WebSocket 支持
    if (WebSocketServer && this._wsRoutes.length > 0) {
      this.wsServer = new WebSocketServer({ noServer: true });
      this.wsServer.on('connection', (ws, req) => {
        const route = req._wsRoute;
        if (route) route.handler(ws, req);
      });

      this.server.on('upgrade', (req, socket, head) => {
        const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
        const pathname = url.pathname;
        let matched = false;

        for (const route of this._wsRoutes) {
          const routeParts = route.pathname.split('/');
          const pathParts = pathname.split('/');
          if (routeParts.length !== pathParts.length) continue;

          const params = {};
          let ok = true;
          for (let i = 0; i < routeParts.length; i++) {
            if (routeParts[i].startsWith(':')) {
              params[routeParts[i].slice(1)] = pathParts[i];
            } else if (routeParts[i] !== pathParts[i]) {
              ok = false;
              break;
            }
          }

          if (ok) {
            req.params = params;
            req.query = Object.fromEntries(url.searchParams);
            req._wsRoute = route;
            matched = true;
            this.wsServer.handleUpgrade(req, socket, head, (ws) => {
              this.wsServer.emit('connection', ws, req);
            });
            break;
          }
        }

        if (!matched) {
          socket.destroy();
        }
      });

      console.log(`  [✓] WebSocket: ${this._wsRoutes.length} 条路由`);
    } else {
      console.log('  [i] WebSocket: 未安装 ws 或无路由');
    }

    return new Promise((resolve) => {
      this.server.listen(config.port, config.host, () => {
        const elapsed = ((Date.now() - this._startTime) / 1000).toFixed(1);
        const displayHost = config.host === '0.0.0.0' ? 'localhost' : config.host;
        console.log(`  ─────────────────────────────────────────`);
        console.log(`  📍  http://${displayHost}:${config.port}  (绑定 ${config.host})`);
        if (config.host === '0.0.0.0') {
          console.warn('  [⚠] 监听 0.0.0.0: 已暴露到所有网卡, 商用部署须前置反向代理 + TLS');
        }
        console.log(`  🧠  AI: ${config.fusionMlx.url}`);
        console.log(`  💾  存储: ${this.db ? 'SQLite' : 'JSON'}`);
        console.log(`  ⚡  启动耗时: ${elapsed}s`);
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
        console.log(`  ✅ Fusion-Coder → AI 编码辅助`);
        console.log(`  ─────────────────────────────────────────`);
        resolve(this);
      });
    });
  }

  // ── 优雅关闭 ────────────────────────────────────────────────────────────
  async shutdown() {
    console.log('\n  [Fusion-Doc] 正在关闭...');

    // 杀 officecli 常驻子进程
    try {
      const { stopResident } = require('./integrations/officecli');
      stopResident();
    } catch (_) { /* officecli 未加载 */ }

    // 杀 trainer 子进程
    try {
      const trainer = require('./integrations/fusion-trainer');
      if (trainer.stopAllJobs) trainer.stopAllJobs();
    } catch (_) { /* trainer 未加载 */ }

    // 插件关闭
    for (const plugin of this.plugins) {
      if (plugin.shutdown) await plugin.shutdown();
    }

    // WebSocket 关闭
    if (this.wsServer) {
      this.wsServer.close();
      console.log('  [✓] WebSocket 已关闭');
    }

    // 数据库关闭
    if (this.db && typeof this.db.close === 'function') {
      this.db.close();
    }

    // 服务器关闭: 强制关闭 keep-alive 连接, 加超时兜底
    if (this.server) {
      return new Promise((resolve) => {
        const forceTimer = setTimeout(() => {
          console.warn('  [⚠] 关闭超时, 强制结束剩余连接');
          for (const socket of this._sockets) {
            try { socket.destroy(); } catch (_) { /* noop */ }
          }
          resolve();
        }, 5000);
        forceTimer.unref();

        this.server.close(() => {
          clearTimeout(forceTimer);
          console.log('  [Fusion-Doc] 已安全关闭');
          resolve();
        });

        // 立即销毁所有空闲 keep-alive 连接
        for (const socket of this._sockets) {
          if (socket.writable && socket.bytesWritten === 0) {
            try { socket.destroy(); } catch (_) { /* noop */ }
          }
        }
      });
    }
  }
}

module.exports = FusionDocApp;