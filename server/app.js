// =============================================================================
// Fusion-Doc — application core
// Lifecycle management, middleware stack, plugin loading, route registration
// =============================================================================

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
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

// ── issue #60: SPA fallback <base> computation ─────────────────────────────
// Build assets use relative paths (./assets); under deep links (e.g. /page/<uuid>) the browser resolves them to
// the wrong directory. Root-deployed deep links get '/', gateway shell proxy requests (Bearer = module service credential, gateway
// strips the mount prefix before forwarding) get '/shell/<manifest-id>/'.
let _cachedManifestId = null;
function shellManifestId() {
    if (_cachedManifestId) return _cachedManifestId;
    try {
        _cachedManifestId = JSON.parse(
            fs.readFileSync(path.join(__dirname, '..', 'client', 'manifest.json'), 'utf8')
        ).id || 'fusion-doc';
    } catch (e) {
        console.warn('[Fusion-Doc] failed to read manifest.json, shell base falls back to fusion-doc:', e.message);
        _cachedManifestId = 'fusion-doc';
    }
    return _cachedManifestId;
}

function isShellCaller(req, cfg) {
    const key = cfg?.shellGateway?.apiKey || '';
    const header = req.headers['authorization'] || '';
    if (!key || !header.startsWith('Bearer ')) return false;
    const token = header.slice(7);
    const a = Buffer.from(key);
    const b = Buffer.from(token);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function spaBaseHref(req, pathname, cfg) {
    if (isShellCaller(req, cfg)) return `/shell/${shellManifestId()}/`;
    if (
        typeof pathname === 'string'
        && /^\/[A-Za-z0-9\-._/]*$/.test(pathname)
        && !pathname.includes('..')
        && pathname.lastIndexOf('/') > 0
    ) return '/';
    return null;
}

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

  // ── Initialization ──────────────────────────────────────────────────────
  async init() {
    console.log(`
  ╔══════════════════════════════════════════╗
  ║         Fusion-Doc V${APP_VERSION}                ║
  ║   Apple Silicon native offline doc KB    ║
  ╚══════════════════════════════════════════╝
    `);

    // 1. Initialize database
    console.log('  [1/4] Initializing database...');
    this.db = initDB();
    if (this.db) seedTemplates(this.db);
    console.log(`  [✓] Database: ${this.db ? 'SQLite' : 'JSON file storage'}`);

    // Multi-instance hardening: role (primary|replica, default primary).
    // replica only serves requests and skips single-instance duties (E8 zombie sweep, auto backup) to avoid duplicate runs / thundering herd.
    // primary owns the ops singleton duties; data is shared via SQLite WAL (multiple processes on one host).
    this._role = (process.env.FUSION_DOC_ROLE || 'primary').toLowerCase();
    console.log(`  [i] Instance role: ${this._role}${this._role === 'replica' ? ' (skipping E8 sweep/auto backup)' : ''}`);

    // E8 fix: a previous process crash (SIGKILL/power loss) leaves zombie workflow runs with status='running',
    // which never settle; users see them as "stuck, cannot run again". Sweep at startup: running → failed (marked as crash-interrupted).
    // Multi-instance: only primary sweeps, avoiding concurrent UPDATEs of the same rows across processes (replica leaves them alone).
    if (this._role === 'primary' && this.db && typeof this.db.prepare === 'function') {
        try {
            const swept = this.db.prepare(
                "UPDATE workflow_runs SET status = 'failed', error = ?, completed_at = ? WHERE status = 'running'"
            ).run('Interrupted by process restart (E8 startup sweep)', new Date().toISOString());
            if (swept.changes > 0) {
                this.db.prepare("UPDATE workflows SET status = 'idle' WHERE status = 'running'")
                    .run();
                console.log(`  [✓] E8 swept ${swept.changes} zombie workflow runs → failed`);
            }
        } catch (e) { console.warn(`  [⚠] E8 workflow sweep failed: ${e.message}`); }
    }

    // 2. Register built-in middleware
    console.log('  [2/4] Loading middleware...');
    this._registerBuiltinMiddleware();
    console.log('  [✓] Middleware loaded');

    // 3. Register routes (controllers)
    console.log('  [3/4] Registering routes...');
    registerRoutes(this);
    console.log(`  [✓] Routes registered: ${this.routes.length}`);

    // 4. Load plugins
    console.log('  [4/4] Loading plugins...');
    this.plugins = await loadPlugins(this);
    console.log(`  [✓] Plugins loaded: ${this.plugins.length}`);

    // issue #51: Union Web shell module self-registration (PRD R-6)
    // fire-and-forget — an unreachable gateway only warns, never blocks startup; with multiple instances only primary registers.
    if (this._role === 'primary') {
        const { startShellRegistration } = require('./services/shell-register');
        startShellRegistration(this.config).catch((e) => {
            console.warn(`  [⚠] Shell registration orchestration error (service unaffected): ${e.message}`);
        });
    }

    // P1-O2 fix: scheduled automatic backups (previously manual only, no scheduler). Interval set by env AUTO_BACKUP_HOURS (default 24, <=0 disables).
    // In-process memory timer that triggers backupDB(); failures are only logged and never interrupt the service. Cleared on exit.
    // Multi-instance hardening: only primary runs backups (replica skips, avoiding concurrent .backup() calls racing for the same target file).
    this._backupIntervalHours = Number(process.env.AUTO_BACKUP_HOURS ?? 24);
    if (this._role === 'primary' && this._backupIntervalHours > 0) {
        const { backupDB } = require('./db');
        const runBackup = async () => {
            try {
                const dest = await backupDB();
                this._lastAutoBackupAt = new Date().toISOString();
                console.log(`  [System] Auto backup completed: ${path.basename(dest)}`);
            } catch (e) {
                console.error(`  [System] Auto backup failed: ${e.message}`);
            }
        };
        this._backupTimer = setInterval(runBackup, this._backupIntervalHours * 3600 * 1000);
        // Do not keep the process alive
        if (this._backupTimer.unref) this._backupTimer.unref();
        console.log(`  [✓] Auto backup scheduled: every ${this._backupIntervalHours} hours`);
    }

    this._startTime = Date.now();
    return this;
  }

  // ── Built-in middleware ─────────────────────────────────────────────────
  _registerBuiltinMiddleware() {
    const { cors } = require('./middleware/cors');
    const { logger } = require('./middleware/logger');
    const { auth } = require('./middleware/auth');
    const { globalRateLimit } = require('./middleware/rate-limit');

    this.middleware.use('cors', cors, 0);
    this.middleware.use('logger', logger, 10);
    this.middleware.use('rateLimit', globalRateLimit, 15); // rate limit before auth, against brute force
    this.middleware.use('auth', auth, 20);
    // E11 fix: the old errorHandler middleware always returned false (no-op); it was registered but never intercepted anything —
    // it was not on the route error path (the pipeline ends before _matchRoute), and it gave readers a false sense of a safety net.
    // The real safety nets are two: the catch in pipeline.run (middleware errors) + the catch in _handleRequest (route errors).
    // So the dead registration was removed; error-handler.js is kept only for the errorResponse/successResponse helpers.
  }

  // ── Route registration ──────────────────────────────────────────────────
  registerRoute(method, pathname, handler, options = {}) {
    this.routes.push({ method, pathname, handler, options });
  }

  // ── WebSocket route registration ───────────────────────────────────────
  ws(pathname, handler) {
    this._wsRoutes.push({ pathname, handler });
  }

  // ── Request handling ────────────────────────────────────────────────────
  async _handleRequest(req, res) {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = url.pathname;
    const method = req.method;

    // Inject context
    req.ctx = { app: this, db: this.db, config: this.config, url };

    // Run the middleware pipeline
    const pipelineDone = await this.middleware.run(req, res);
    if (pipelineDone) return; // middleware already handled the response (e.g. CORS OPTIONS)

    try {
      // Route matching
      const handled = await this._matchRoute(method, pathname, req, res);
      if (handled) return;

      // API 404
      if (pathname.startsWith('/api/')) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'API endpoint not found', path: pathname }));
        return;
      }

      // Static files
      const assetPaths = ['/assets/', '/icons/', '/manifest.json', '/vite.svg', '/locales/', '/branding/'];
      if (assetPaths.some(p => pathname.startsWith(p))) {
        // R1 fix: decode then reject .. segments, then let serveStatic re-check the sandbox (defense in depth)
        let cleanPath = pathname;
        try { cleanPath = decodeURIComponent(pathname); } catch (_) { cleanPath = ''; }
        if (cleanPath.includes('..') || cleanPath.includes('\0')) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Forbidden' }));
          return;
        }
        return serveStatic(res, path.join(config.publicDir, cleanPath), config.publicDir);
      }

      // SPA fallback (issue #60: inject <base> per request origin to fix relative asset resolution on deep links)
      serveSPA(res, config.publicDir, spaBaseHref(req, pathname, config));
    } catch (err) {
      const status = err.statusCode || 500;
      console.error(`[Fusion-Doc] Error (${status}): ${err.message}`);
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

  // ── Route matching ──────────────────────────────────────────────────────
  async _matchRoute(method, pathname, req, res) {
    // Pass 1: exact match (takes priority)
    for (const route of this.routes) {
      if (route.method !== method && route.method !== 'ALL') continue;
      if (route.pathname === pathname) {
        req.params = {};
        await route.handler(req, res);
        return true;
      }
    }

    // Pass 2: parameterized match (e.g. /api/pages/:id)
    for (const route of this.routes) {
      if (route.method !== method && route.method !== 'ALL') continue;
      // Skip non-parameterized routes (already exact-matched in pass 1)
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

  // ── Build TLS config (built-in HTTPS, fixes bare exposure) ──────────────
  // Setting either certPath/keyPath → enables HTTPS; both must be provided and the files must exist, otherwise fail visibly.
  // Never silently fall back to HTTP (that would expose credentials in plaintext). caPath is optional (mTLS mutual auth).
  _buildTlsOptions() {
    const { certPath, keyPath, caPath } = config.tls;
    if (!certPath && !keyPath) return null;
    if (!certPath || !keyPath) {
      console.error('  [✗] Partial TLS config: FUSION_DOC_TLS_CERT and FUSION_DOC_TLS_KEY must be provided together');
      process.exit(1);
    }
    const readCert = (p, label) => {
      try { return fs.readFileSync(p); }
      catch (e) {
        console.error(`  [✗] TLS ${label} file unreadable: ${p} (${e.message})`);
        process.exit(1);
      }
    };
    const opts = { cert: readCert(certPath, 'cert'), key: readCert(keyPath, 'key') };
    if (caPath) opts.ca = readCert(caPath, 'ca');
    // Enable modern secure defaults: reject old TLS versions, prefer server cipher order
    opts.minVersion = 'TLSv1.2';
    opts.honorCipherOrder = true;
    this._tlsEnabled = true;
    console.log(`  [✓] TLS enabled: cert=${path.basename(certPath)}`);
    return opts;
  }

  // ── Startup ─────────────────────────────────────────────────────────────
  async start() {
    await this.init();

    const tlsOpts = this._buildTlsOptions();
    const requestHandler = (req, res) => {
      // HTTPS mode: inject HSTS to force subsequent connections over TLS (anti-downgrade)
      if (this._tlsEnabled) {
        res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
      }
      this._handleRequest(req, res);
    };
    this.server = tlsOpts
      ? https.createServer(tlsOpts, requestHandler)
      : http.createServer(requestHandler);

    // TLS enabled and bound to 0.0.0.0: can be exposed directly (no reverse proxy needed to terminate TLS), bare exposure resolved
    // TLS disabled and bound to 0.0.0.0: still needs a fronting reverse proxy + TLS (original warning kept)

    // Track connections so graceful shutdown can force-destroy keep-alive sockets
    this.server.on('connection', (socket) => {
      this._sockets.add(socket);
      socket.on('close', () => this._sockets.delete(socket));
    });

    // WebSocket support
    if (WebSocketServer && this._wsRoutes.length > 0) {
      // E3 fix: cap maxPayload at 2MB to reject giant WS frames causing OOM (Yjs updates are far smaller)
      this.wsServer = new WebSocketServer({ noServer: true, maxPayload: 2 * 1024 * 1024 });
      // R1 fix: isolate handler exceptions to closing that one connection instead of killing the whole process (disconnecting everyone, losing drafts)
      this.wsServer.on('connection', (ws, req) => {
        try {
          const route = req._wsRoute;
          if (route) route.handler(ws, req);
        } catch (err) {
          console.error(`[WS] connection handler error: ${err.message}`);
          try { ws.close(1011, 'internal error'); } catch (_) { /* noop */ }
        }
      });
      // R1 fix: global WS error fallback so an uncaught error event cannot kill the process
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

      console.log(`  [✓] WebSocket: ${this._wsRoutes.length} routes`);
    } else {
      console.log('  [i] WebSocket: ws not installed or no routes');
    }

    return new Promise((resolve) => {
      this.server.listen(config.port, config.host, () => {
        const elapsed = ((Date.now() - this._startTime) / 1000).toFixed(1);
        const displayHost = config.host === '0.0.0.0' ? 'localhost' : config.host;
        const scheme = this._tlsEnabled ? 'https' : 'http';
        console.log(`  ─────────────────────────────────────────`);
        console.log(`  📍  ${scheme}://${displayHost}:${config.port}  (bound to ${config.host}${this._tlsEnabled ? ', TLS' : ''})`);
        if (!this._tlsEnabled && config.host === '0.0.0.0') {
          console.warn('  [⚠] Listening on 0.0.0.0 without TLS: plaintext exposure; put a reverse proxy + TLS in front or set FUSION_DOC_TLS_CERT/KEY');
        } else if (this._tlsEnabled) {
          console.log('  [✓] Built-in TLS: bare exposure resolved, can be exposed directly (no reverse proxy needed to terminate TLS)');
        }
        console.log(`  🧠  AI: ${config.fusionMlx.url}`);
        console.log(`  💾  Storage: ${this.db ? 'SQLite' : 'JSON'}`);
        console.log(`  ⚡  Startup time: ${elapsed}s`);
        console.log(`  ─────────────────────────────────────────`);
        console.log(`  Integrated features:`);
        console.log(`  ✅ DocMost    → TipTap editor + Yjs collaboration`);
        console.log(`  ✅ Wiki.js    → Modular architecture + multiple auth`);
        console.log(`  ✅ BookStack  → Three-level structure + export`);
        console.log(`  ✅ Teedy      → OCR + tags + workflows`);
        console.log(`  ✅ Zettlr     → Bidirectional links + knowledge graph`);
        console.log(`  ✅ MacDown    → Native macOS experience`);
        console.log(`  ✅ LibreOffice→ Office format conversion`);
        console.log(`  ✅ Fusion-MLX → Local AI inference`);
        console.log(`  ✅ Fusion-Coder → AI coding assistance`);
        console.log(`  ─────────────────────────────────────────`);
        resolve(this);

        // HTTP→HTTPS redirect in TLS mode (keeps users who mistakenly visit http:// from exposing credentials in plaintext)
        // Started only when TLS is enabled + redirectHttp is on. Separate port (env FUSION_DOC_HTTP_PORT, default 11448).
        // Placed inside the listen callback so the main HTTPS server is ready before the redirect starts, and an early return cannot short-circuit it.
        if (this._tlsEnabled && config.tls.redirectHttp) {
          const httpPort = parseInt(process.env.FUSION_DOC_HTTP_PORT || '11448', 10);
          this._redirectServer = http.createServer((req, res) => {
            const host = req.headers.host || `localhost:${httpPort}`;
            const target = `https://${host.split(':')[0]}:${config.port}${req.url}`;
            res.writeHead(301, { Location: target, 'Content-Type': 'text/plain' });
            res.end(`Redirecting to ${target}`);
          });
          this._redirectServer.on('error', (err) => {
            console.warn(`  [⚠] HTTP→HTTPS redirect port ${httpPort} unavailable (ignored, main HTTPS unaffected): ${err.message}`);
          });
          this._redirectServer.listen(httpPort, config.host, () => {
            console.log(`  [✓] HTTP→HTTPS redirect: :${httpPort} → https://:${config.port}`);
          });
        }
      });
    });
  }

  // ── Graceful shutdown ───────────────────────────────────────────────────
  async shutdown() {
    console.log('\n  [Fusion-Doc] Shutting down...');

    // P1-O2: stop the auto backup timer
    if (this._backupTimer) {
      clearInterval(this._backupTimer);
      this._backupTimer = null;
      console.log('  [✓] Auto backup schedule stopped');
    }

    // Kill trainer child processes (R15: wait for exit + SIGKILL fallback, prevents orphaned GPU processes)
    try {
      const trainer = require('./integrations/fusion-trainer');
      if (trainer.stopAllJobs) await trainer.stopAllJobs();
    } catch (_) { /* trainer not loaded */ }

    // Shut down plugins
    for (const plugin of this.plugins) {
      if (plugin.shutdown) await plugin.shutdown();
    }

    // Close WebSocket
    if (this.wsServer) {
      this.wsServer.close();
      console.log('  [✓] WebSocket closed');
    }

    // Close database
    if (this.db && typeof this.db.close === 'function') {
      this.db.close();
    }

    // Close servers: force-close keep-alive connections, with a timeout fallback
    if (this._redirectServer) {
      try { this._redirectServer.close(); } catch (_) { /* noop */ }
      this._redirectServer = null;
      console.log('  [✓] HTTP→HTTPS redirect server closed');
    }
    if (this.server) {
      return new Promise((resolve) => {
        const forceTimer = setTimeout(() => {
          console.warn('  [⚠] Shutdown timed out, force-closing remaining connections');
          for (const socket of this._sockets) {
            try { socket.destroy(); } catch (_) { /* noop */ }
          }
          resolve();
        }, 5000);
        forceTimer.unref();

        this.server.close(() => {
          clearTimeout(forceTimer);
          console.log('  [Fusion-Doc] Shut down safely');
          resolve();
        });

        // Immediately destroy all idle keep-alive connections
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