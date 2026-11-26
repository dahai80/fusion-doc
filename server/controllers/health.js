// =============================================================================
// Fusion-Doc — health check controller
// P1-O1 fix: the health endpoint actually checks DB connectivity + MLX reachability, no more false positives.
// P2-O7 fix: split liveness (/api/health/live, process alive) from readiness (/api/health, ready including dependencies).
// =============================================================================
/* global AbortController, fetch */

const { version: APP_VERSION } = require('../../package.json');

// Probe DB: better-sqlite3 is synchronous, run one light query; JSON fallback mode counts as degraded, not dead
function checkDb(app) {
    try {
        if (!app.db) return { ok: false, mode: 'none', error: 'db not initialized' };
        app.db.prepare('SELECT 1').get();
        return { ok: true, mode: 'sqlite' };
    } catch (e) {
        return { ok: false, mode: 'error', error: e.message };
    }
}

// P3-O10 fix: disk usage monitoring. Recursively sum dataDir size; mark warn above DISK_WARN_BYTES (default 1GB).
// Ops can alert/clean up based on this, preventing SQLite + storage from growing unbounded and filling the disk.
const fs = require('fs');
const path = require('path');
const DISK_WARN_BYTES = Number(process.env.DISK_WARN_BYTES ?? (1024 * 1024 * 1024));
function dirSize(dir) {
    let total = 0;
    try {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isSymbolicLink()) continue;
            if (entry.isDirectory()) total += dirSize(full);
            else try { total += fs.statSync(full).size; } catch (e) { /* ignore a missing file */ }
        }
    } catch (e) { /* ignore an unreadable directory */ }
    return total;
}
function checkDisk(app) {
    try {
        const dataDir = app.config?.dataDir;
        if (!dataDir || !fs.existsSync(dataDir)) return { ok: true, bytes: 0 };
        const bytes = dirSize(dataDir);
        return { ok: bytes < DISK_WARN_BYTES, bytes, warnBytes: DISK_WARN_BYTES, warn: bytes >= DISK_WARN_BYTES };
    } catch (e) {
        return { ok: true, error: e.message };
    }
}

// Probe Fusion-MLX: HTTP /v1/models, 2s timeout, does not block startup
async function checkMlx(app) {
    const url = app.config?.fusionMlx?.url;
    const key = app.config?.fusionMlx?.apiKey;
    if (!url) return { ok: false, error: 'fusionMlx.url unset' };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);
    try {
        const resp = await fetch(`${url.replace(/\/$/, '')}/v1/models`, {
            headers: key ? { Authorization: `Bearer ${key}` } : {},
            signal: controller.signal,
        });
        return { ok: resp.ok, status: resp.status };
    } catch (e) {
        return { ok: false, error: e.message };
    } finally {
        clearTimeout(timer);
    }
}

function register(app) {
  // liveness: process alive, no dependency checks, always returns 200 (unless the process is gone)
  app.registerRoute('GET', '/api/health/live', (req, res) => {
    const { json } = require('../utils/response');
    json(res, { app: 'Fusion-Doc', status: 'alive', uptime: Math.floor((Date.now() - (app._startTime || Date.now())) / 1000) });
  });

  // readiness: dependencies ready (DB + MLX); if any is down return 503 + details, for the readiness probe
  app.registerRoute('GET', '/api/health', async (req, res) => {
    const { json } = require('../utils/response');
    const dbCheck = checkDb(app);
    const mlxCheck = await checkMlx(app);
    const diskCheck = checkDisk(app);
    const ready = dbCheck.ok; // DB must be ready; MLX degradation is marked degraded without blocking readiness (AI features are optional)
    const payload = {
      app: 'Fusion-Doc', version: APP_VERSION,
      status: ready ? (mlxCheck.ok ? 'ok' : 'degraded') : 'down',
      uptime: Math.floor((Date.now() - (app._startTime || Date.now())) / 1000),
      checks: { db: dbCheck, mlx: mlxCheck, disk: diskCheck },
      features: {
        editor: 'TipTap 富文本编辑器', // i18n: user-facing
        structure: '空间→书架→章节→页面（BookStack 三层）', // i18n: user-facing
        search: 'SQLite FTS5 全文搜索（Wiki.js）', // i18n: user-facing
        tags: '标签系统（Teedy）', // i18n: user-facing
        links: '双向链接 + 知识图谱（Zettlr）', // i18n: user-facing
        versions: '页面历史版本（DocMost）', // i18n: user-facing
        export: 'PDF/HTML/Markdown/Office 导出（BookStack + LibreOffice）', // i18n: user-facing
        ai: 'Fusion-MLX 本地 AI 推理', // i18n: user-facing
        native: 'macOS 原生优化（MacDown）', // i18n: user-facing
      },
      integrations: {
        fusionMlx: app.config.fusionMlx.url,
        fusionKb: app.config.fusionKb.url,
        fusionCowork: app.config.fusionCowork.url,
        fusionModelHub: app.config.fusionModelHub.url,
        fusionStudio: app.config.fusionStudio.socketPath,
      },
      plugins: app.plugins.map(p => ({ name: p.name, version: p.version })),
    };
    if (!ready) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(payload));
      return;
    }
    json(res, payload);
  });
}

module.exports = { register };
