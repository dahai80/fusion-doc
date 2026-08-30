// =============================================================================
// Fusion-Doc — 健康检查控制器
// P1-O1 修复: health 端点实际校验 DB 连通 + MLX 可达, 不再假阳性。
// P2-O7 修复: 拆分 liveness (/api/health/live 进程存活) 与 readiness (/api/health 就绪含依赖)。
// =============================================================================
/* global AbortController, fetch */

const { version: APP_VERSION } = require('../../package.json');

// 探测 DB: better-sqlite3 同步, 跑一条轻查询; JSON 降级模式视作降级而非死
function checkDb(app) {
    try {
        if (!app.db) return { ok: false, mode: 'none', error: 'db not initialized' };
        app.db.prepare('SELECT 1').get();
        return { ok: true, mode: 'sqlite' };
    } catch (e) {
        return { ok: false, mode: 'error', error: e.message };
    }
}

// P3-O10 修复: 磁盘占用监控。递归统计 dataDir 大小, 超 DISK_WARN_BYTES (默认 1GB) 标 warn。
// 运维侧可据此告警/清理, 防 SQLite + 存储 无限膨胀撑爆磁盘。
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
            else try { total += fs.statSync(full).size; } catch (e) { /* 单文件缺失忽略 */ }
        }
    } catch (e) { /* 目录不可读忽略 */ }
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

// 探测 Fusion-MLX: HTTP /v1/models, 2s 超时, 不阻塞启动
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
  // liveness: 进程存活, 不查依赖, 永返 200 (除非进程不在)
  app.registerRoute('GET', '/api/health/live', (req, res) => {
    const { json } = require('../utils/response');
    json(res, { app: 'Fusion-Doc', status: 'alive', uptime: Math.floor((Date.now() - (app._startTime || Date.now())) / 1000) });
  });

  // readiness: 依赖就绪 (DB + MLX), 任一 down 返 503 + 详情, 供就绪探针
  app.registerRoute('GET', '/api/health', async (req, res) => {
    const { json } = require('../utils/response');
    const dbCheck = checkDb(app);
    const mlxCheck = await checkMlx(app);
    const diskCheck = checkDisk(app);
    const ready = dbCheck.ok; // DB 必就绪; MLX 降级标 degraded 不阻断就绪 (AI 特性可选)
    const payload = {
      app: 'Fusion-Doc', version: APP_VERSION,
      status: ready ? (mlxCheck.ok ? 'ok' : 'degraded') : 'down',
      uptime: Math.floor((Date.now() - (app._startTime || Date.now())) / 1000),
      checks: { db: dbCheck, mlx: mlxCheck, disk: diskCheck },
      features: {
        editor: 'TipTap 富文本编辑器',
        structure: '空间→书架→章节→页面（BookStack 三层）',
        search: 'SQLite FTS5 全文搜索（Wiki.js）',
        tags: '标签系统（Teedy）',
        links: '双向链接 + 知识图谱（Zettlr）',
        versions: '页面历史版本（DocMost）',
        export: 'PDF/HTML/Markdown/Office 导出（BookStack + LibreOffice）',
        ai: 'Fusion-MLX 本地 AI 推理',
        native: 'macOS 原生优化（MacDown）',
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
