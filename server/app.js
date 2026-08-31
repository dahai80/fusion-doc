// =============================================================================
// Fusion-Doc — 应用核心
// 生命周期管理、中间件栈、插件加载、路由注册
// =============================================================================

const http = require('http');
const https = require('https');
const fs = require('fs');
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

    // 多实例加固: 角色 (primary|replica, 默认 primary)。
    // replica 只接请求, 跳过单实例职责 (E8 僵尸清扫、自动备份), 防多进程重复执行 / 惊群。
    // primary 担运维单点; 数据共享靠 SQLite WAL (同机多进程)。
    this._role = (process.env.FUSION_DOC_ROLE || 'primary').toLowerCase();
    console.log(`  [i] 实例角色: ${this._role}${this._role === 'replica' ? ' (跳过 E8 清扫/自动备份)' : ''}`);

    // E8 修复: 上次进程崩溃 (SIGKILL/掉电) 会留下 status='running' 的僵尸工作流运行,
    // 永不结算, 用户侧表现为"卡死无法再跑"。启动时清扫: running → failed (标记为崩溃中断)。
    // 多实例: 仅 primary 清扫, 避免多进程并发 UPDATE 同行 (replica 不动, primary 独担)。
    if (this._role === 'primary' && this.db && typeof this.db.prepare === 'function') {
        try {
            const swept = this.db.prepare(
                "UPDATE workflow_runs SET status = 'failed', error = ?, completed_at = ? WHERE status = 'running'"
            ).run('进程重启中断 (E8 启动清扫)', new Date().toISOString());
            if (swept.changes > 0) {
                this.db.prepare("UPDATE workflows SET status = 'idle' WHERE status = 'running'")
                    .run();
                console.log(`  [✓] E8 清扫 ${swept.changes} 个僵尸工作流运行 → failed`);
            }
        } catch (e) { console.warn(`  [⚠] E8 工作流清扫失败: ${e.message}`); }
    }

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

    // P1-O2 修复: 自动定时备份 (原仅手动备份无调度)。间隔由 env AUTO_BACKUP_HOURS 控制 (默认 24, <=0 关闭)。
    // 单实例内存定时器, 触发 backupDB(); 失败仅记日志不中断服务。退出时清理。
    // 多实例加固: 仅 primary 跑备份 (replica 跳过, 避免多进程并发 .backup() 抢同一目标文件)。
    this._backupIntervalHours = Number(process.env.AUTO_BACKUP_HOURS ?? 24);
    if (this._role === 'primary' && this._backupIntervalHours > 0) {
        const { backupDB } = require('./db');
        const runBackup = async () => {
            try {
                const dest = await backupDB();
                this._lastAutoBackupAt = new Date().toISOString();
                console.log(`  [System] 自动备份完成: ${path.basename(dest)}`);
            } catch (e) {
                console.error(`  [System] 自动备份失败: ${e.message}`);
            }
        };
        this._backupTimer = setInterval(runBackup, this._backupIntervalHours * 3600 * 1000);
        // 不阻止进程退出
        if (this._backupTimer.unref) this._backupTimer.unref();
        console.log(`  [✓] 自动备份调度: 每 ${this._backupIntervalHours} 小时`);
    }

    this._startTime = Date.now();
    return this;
  }

  // ── 内置中间件 ──────────────────────────────────────────────────────────
  _registerBuiltinMiddleware() {
    const { cors } = require('./middleware/cors');
    const { logger } = require('./middleware/logger');
    const { auth } = require('./middleware/auth');
    const { globalRateLimit } = require('./middleware/rate-limit');

    this.middleware.use('cors', cors, 0);
    this.middleware.use('logger', logger, 10);
    this.middleware.use('rateLimit', globalRateLimit, 15); // 认证前限流, 防爆破
    this.middleware.use('auth', auth, 20);
    // E11 修复: 原 errorHandler 中间件恒返回 false (no-op), 注册却永不拦截 —
    // 既不在路由错误路径上 (管道在 _matchRoute 之前结束), 又给读者"有兜底"的错觉。
    // 实际兜底在两处: pipeline.run 的 catch (中间件异常) + _handleRequest 的 catch (路由异常)。
    // 故移除该死注册, 保留 error-handler.js 仅供 errorResponse/successResponse 工具函数。
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
        // R1 修复: 解码后剔除 .. 段, 再交由 serveStatic 二次沙箱校验 (双重防护)
        let cleanPath = pathname;
        try { cleanPath = decodeURIComponent(pathname); } catch (_) { cleanPath = ''; }
        if (cleanPath.includes('..') || cleanPath.includes('\0')) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Forbidden' }));
          return;
        }
        return serveStatic(res, path.join(config.publicDir, cleanPath), config.publicDir);
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

  // ── 构建 TLS 配置 (内置 HTTPS, 解裸暴露) ────────────────────────────────
  // certPath/keyPath 任一设 → 启用 HTTPS; 两者须同时提供且文件存在, 否则 fail visibly。
  // 不静默降级回 HTTP (会暴露明文凭证)。caPath 可选 (mTLS 双向认证)。
  _buildTlsOptions() {
    const { certPath, keyPath, caPath } = config.tls;
    if (!certPath && !keyPath) return null;
    if (!certPath || !keyPath) {
      console.error('  [✗] TLS 半配置: FUSION_DOC_TLS_CERT 与 FUSION_DOC_TLS_KEY 须同时提供');
      process.exit(1);
    }
    const readCert = (p, label) => {
      try { return fs.readFileSync(p); }
      catch (e) {
        console.error(`  [✗] TLS ${label} 文件不可读: ${p} (${e.message})`);
        process.exit(1);
      }
    };
    const opts = { cert: readCert(certPath, 'cert'), key: readCert(keyPath, 'key') };
    if (caPath) opts.ca = readCert(caPath, 'ca');
    // 启用现代安全默认: 拒绝旧 TLS 版本, 优先服务端 cipher 顺序
    opts.minVersion = 'TLSv1.2';
    opts.honorCipherOrder = true;
    this._tlsEnabled = true;
    console.log(`  [✓] TLS 已启用: cert=${path.basename(certPath)}`);
    return opts;
  }

  // ── 启动 ────────────────────────────────────────────────────────────────
  async start() {
    await this.init();

    const tlsOpts = this._buildTlsOptions();
    const requestHandler = (req, res) => {
      // HTTPS 模式: 注入 HSTS 强制后续连接走 TLS (防降级)
      if (this._tlsEnabled) {
        res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
      }
      this._handleRequest(req, res);
    };
    this.server = tlsOpts
      ? https.createServer(tlsOpts, requestHandler)
      : http.createServer(requestHandler);

    // TLS 已启用但绑 0.0.0.0: 可直接对外 (无需反代终结 TLS), 裸暴露问题已解
    // TLS 关闭且绑 0.0.0.0: 仍需前置反代 + TLS (保留原有告警)

    // 跟踪连接以便优雅关闭时强制销毁 keep-alive
    this.server.on('connection', (socket) => {
      this._sockets.add(socket);
      socket.on('close', () => this._sockets.delete(socket));
    });

    // WebSocket 支持
    if (WebSocketServer && this._wsRoutes.length > 0) {
      // E3 修复: 设 maxPayload 上限 2MB, 拒巨型 WS 帧 OOM (Yjs update 远小于此)
      this.wsServer = new WebSocketServer({ noServer: true, maxPayload: 2 * 1024 * 1024 });
      // R1 修复: handler 抛错隔离为单连接关闭, 不杀全进程 (全员断连丢稿)
      this.wsServer.on('connection', (ws, req) => {
        try {
          const route = req._wsRoute;
          if (route) route.handler(ws, req);
        } catch (err) {
          console.error(`[WS] connection handler error: ${err.message}`);
          try { ws.close(1011, 'internal error'); } catch (_) { /* noop */ }
        }
      });
      // R1 修复: 全局 WS error 兜底, 防未捕获 error 事件杀进程
      this.wsServer.on('error', (err) => {
        console.error('[WS] server error:', err.message);
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
        const scheme = this._tlsEnabled ? 'https' : 'http';
        console.log(`  ─────────────────────────────────────────`);
        console.log(`  📍  ${scheme}://${displayHost}:${config.port}  (绑定 ${config.host}${this._tlsEnabled ? ', TLS' : ''})`);
        if (!this._tlsEnabled && config.host === '0.0.0.0') {
          console.warn('  [⚠] 监听 0.0.0.0 + 未启 TLS: 明文暴露, 须前置反向代理 + TLS 或配置 FUSION_DOC_TLS_CERT/KEY');
        } else if (this._tlsEnabled) {
          console.log('  [✓] 内置 TLS: 裸暴露问题已解, 可直接对外 (无需反代终结 TLS)');
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

        // TLS 模式下的 HTTP→HTTPS 跳转 (防用户误用 http:// 访问致明文凭证暴露)
        // 仅当 TLS 启用 + redirectHttp 开启时起。独立端口 (env FUSION_DOC_HTTP_PORT, 默认 11448)。
        // 置于 listen 回调内, 确保主 HTTPS 先就绪再起跳转, 且不被 return 提前短路。
        if (this._tlsEnabled && config.tls.redirectHttp) {
          const httpPort = parseInt(process.env.FUSION_DOC_HTTP_PORT || '11448', 10);
          this._redirectServer = http.createServer((req, res) => {
            const host = req.headers.host || `localhost:${httpPort}`;
            const target = `https://${host.split(':')[0]}:${config.port}${req.url}`;
            res.writeHead(301, { Location: target, 'Content-Type': 'text/plain' });
            res.end(`Redirecting to ${target}`);
          });
          this._redirectServer.on('error', (err) => {
            console.warn(`  [⚠] HTTP→HTTPS 跳转端口 ${httpPort} 不可用 (忽略, 主 HTTPS 不受影响): ${err.message}`);
          });
          this._redirectServer.listen(httpPort, config.host, () => {
            console.log(`  [✓] HTTP→HTTPS 跳转: :${httpPort} → https://:${config.port}`);
          });
        }
      });
    });
  }

  // ── 优雅关闭 ────────────────────────────────────────────────────────────
  async shutdown() {
    console.log('\n  [Fusion-Doc] 正在关闭...');

    // P1-O2: 停自动备份定时器
    if (this._backupTimer) {
      clearInterval(this._backupTimer);
      this._backupTimer = null;
      console.log('  [✓] 自动备份调度已停止');
    }

    // 杀 officecli 常驻子进程
    try {
      const { stopResident } = require('./integrations/officecli');
      stopResident();
    } catch (_) { /* officecli 未加载 */ }

    // 杀 trainer 子进程 (R15: 等待退出 + SIGKILL 兜底, 防 GPU 孤儿)
    try {
      const trainer = require('./integrations/fusion-trainer');
      if (trainer.stopAllJobs) await trainer.stopAllJobs();
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
    if (this._redirectServer) {
      try { this._redirectServer.close(); } catch (_) { /* noop */ }
      this._redirectServer = null;
      console.log('  [✓] HTTP→HTTPS 跳转服务已关闭');
    }
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