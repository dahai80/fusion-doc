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

  // ── 恢复备份 (admin only) ───────────────────────────────────────────────
  // P1-O3 修复: 原仅有备份无恢复路径。从备份文件恢复 DB: 校验文件名白名单 (防路径穿越),
  // 停当前 DB 连接 → 复制备份覆盖主库 → 重新 initDB 重载。恢复是高危操作, 仅 admin。
  app.registerRoute('POST', '/api/system/restore', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const { parseBody } = require('../middleware/body-parser');
    const body = await parseBody(req);
    const backupName = (body.name || '').trim();
    if (!backupName || !/^[a-zA-Z0-9._-]+\.db$/.test(backupName)) {
      return errorResponse(res, 400, '非法备份文件名', 'INVALID_BACKUP_NAME');
    }
    const backupDir = path.join(config.dataDir, 'db', 'backups');
    const backupPath = path.resolve(path.join(backupDir, backupName));
    if (!backupPath.startsWith(path.resolve(backupDir) + path.sep)) {
      return errorResponse(res, 403, '备份路径越界', 'PATH_TRAVERSAL');
    }
    if (!fs.existsSync(backupPath)) {
      return errorResponse(res, 404, '备份文件不存在', 'BACKUP_NOT_FOUND');
    }
    try {
      const dbPath = path.join(config.dataDir, 'db', 'fusion-doc.db');
      console.log(`  [System] 恢复由 ${req.user?.id} 触发: ${backupName}`);
      // 关闭当前连接 (释放主库文件锁)
      const { getDB } = require('../db');
      const cur = getDB();
      if (cur && typeof cur.close === 'function') cur.close();
      // 先备份当前库 (回滚点), 再覆盖
      if (fs.existsSync(dbPath)) {
        fs.copyFileSync(dbPath, dbPath + `.prerestore-${Date.now()}`);
      }
      fs.copyFileSync(backupPath, dbPath);
      // 重新初始化 DB (重跑迁移, 重建连接)
      const { initDB } = require('../db');
      const newDb = initDB();
      app.db = newDb;
      console.log(`  [System] 恢复完成: ${backupName}`);
      successResponse(res, { restored: backupName, reloaded: !!newDb });
    } catch (e) {
      console.error('  [System] 恢复失败:', e.message);
      errorResponse(res, 500, `恢复失败: ${e.message}`, 'RESTORE_FAILED');
    }
  });

  // ── 触发自动备份检查 (admin only, 供调度与手动共用) ───────────────────
  // P1-O2 修复: 原仅手动备份无自动调度。提供按间隔自动备份 (见 app.js init 注册的定时器),
  // 此端点暴露上次自动备份时间与下次预计时间, 供运维/仪表盘查看。
  app.registerRoute('GET', '/api/system/backup-schedule', (req, res) => {
    if (!requireAdmin(req, res)) return;
    successResponse(res, {
      enabled: !!app._backupTimer,
      intervalHours: app._backupIntervalHours || 0,
      lastAutoBackupAt: app._lastAutoBackupAt || null,
    });
  });
}

module.exports = { register };
