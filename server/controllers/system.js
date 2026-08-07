// =============================================================================
// Fusion-Doc — 系统管理控制器 (商用级: 备份/恢复, 仅 admin)
// =============================================================================

const fs = require('fs');
const path = require('path');
const { backupDB } = require('../db');
const { successResponse, errorResponse } = require('../middleware/error-handler');

function requireAdmin(req, res) {
  if (req.user?.role !== 'admin') {
    errorResponse(res, 403, '需要管理员权限', 'FORBIDDEN');
    return false;
  }
  return true;
}

function register(app) {
  const config = app.config;

  // ── 数据库备份 (在线热备, WAL 安全) ────────────────────────────────────
  app.registerRoute('POST', '/api/system/backup', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const dest = await backupDB();
      const stat = fs.statSync(dest);
      console.log(`  [System] 备份由 ${req.user?.id} 触发: ${dest} (${(stat.size / 1024).toFixed(1)} KB)`);
      successResponse(res, { backup: path.basename(dest), path: dest, size: stat.size, createdAt: new Date().toISOString() });
    } catch (e) {
      console.error('  [System] 备份失败:', e.message);
      errorResponse(res, 500, `备份失败: ${e.message}`, 'BACKUP_FAILED');
    }
  });

  // ── 备份列表 ────────────────────────────────────────────────────────────
  app.registerRoute('GET', '/api/system/backups', (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const backupDir = path.join(config.dataDir, 'db', 'backups');
      if (!fs.existsSync(backupDir)) return successResponse(res, { backups: [] });
      const files = fs.readdirSync(backupDir)
        .filter(f => f.endsWith('.db'))
        .map(f => {
          const st = fs.statSync(path.join(backupDir, f));
          return { name: f, size: st.size, createdAt: st.mtime.toISOString() };
        })
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      successResponse(res, { backups: files });
    } catch (e) {
      errorResponse(res, 500, `获取备份列表失败: ${e.message}`, 'BACKUP_LIST_FAILED');
    }
  });
}

module.exports = { register };
