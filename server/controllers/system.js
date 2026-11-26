// =============================================================================
// Fusion-Doc — system admin controller (production-grade: backup/restore, admin only)
// =============================================================================

const fs = require('fs');
const path = require('path');
const { backupDB } = require('../db');
const { successResponse, errorResponse } = require('../middleware/error-handler');
const { requireAdmin } = require('../middleware/require-admin');

function register(app) {
  const config = app.config;

  // ── Database backup (online hot backup, WAL-safe) ─────────────────────
  app.registerRoute('POST', '/api/system/backup', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const dest = await backupDB();
      const stat = fs.statSync(dest);
      console.log(`  [System] Backup triggered by ${req.user?.id}: ${dest} (${(stat.size / 1024).toFixed(1)} KB)`);
      successResponse(res, { backup: path.basename(dest), path: dest, size: stat.size, createdAt: new Date().toISOString() });
    } catch (e) {
      console.error('  [System] Backup failed:', e.message);
      errorResponse(res, 500, `Backup failed: ${e.message}`, 'BACKUP_FAILED');
    }
  });

  // ── Backup list ───────────────────────────────────────────────────────
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
      errorResponse(res, 500, `Failed to list backups: ${e.message}`, 'BACKUP_LIST_FAILED');
    }
  });

  // ── Restore backup (admin only) ───────────────────────────────────────
  // P1-O3 fix: previously there was backup but no restore path. Restore the DB from a backup file: validate the filename against a whitelist (prevents path traversal),
  // close the current DB connection → copy the backup over the main DB → re-run initDB to reload. Restore is high-risk, admin only.
  app.registerRoute('POST', '/api/system/restore', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const { parseBody } = require('../middleware/body-parser');
    const body = await parseBody(req);
    const backupName = (body.name || '').trim();
    if (!backupName || !/^[a-zA-Z0-9._-]+\.db$/.test(backupName)) {
      return errorResponse(res, 400, 'Invalid backup filename', 'INVALID_BACKUP_NAME');
    }
    const backupDir = path.join(config.dataDir, 'db', 'backups');
    const backupPath = path.resolve(path.join(backupDir, backupName));
    if (!backupPath.startsWith(path.resolve(backupDir) + path.sep)) {
      return errorResponse(res, 403, 'Backup path out of bounds', 'PATH_TRAVERSAL');
    }
    if (!fs.existsSync(backupPath)) {
      return errorResponse(res, 404, 'Backup file not found', 'BACKUP_NOT_FOUND');
    }
    try {
      const dbPath = path.join(config.dataDir, 'db', 'fusion-doc.db');
      console.log(`  [System] Restore triggered by ${req.user?.id}: ${backupName}`);
      // Close the current connection (releases the main DB file lock)
      const { getDB } = require('../db');
      const cur = getDB();
      if (cur && typeof cur.close === 'function') cur.close();
      // Back up the current DB first (rollback point), then overwrite
      if (fs.existsSync(dbPath)) {
        fs.copyFileSync(dbPath, dbPath + `.prerestore-${Date.now()}`);
      }
      fs.copyFileSync(backupPath, dbPath);
      // Re-initialize the DB (rerun migrations, rebuild the connection)
      const { initDB } = require('../db');
      const newDb = initDB();
      app.db = newDb;
      console.log(`  [System] Restore complete: ${backupName}`);
      successResponse(res, { restored: backupName, reloaded: !!newDb });
    } catch (e) {
      console.error('  [System] Restore failed:', e.message);
      errorResponse(res, 500, `Restore failed: ${e.message}`, 'RESTORE_FAILED');
    }
  });

  // ── Trigger auto-backup check (admin only, shared by scheduler and manual use) ──
  // P1-O2 fix: previously only manual backups, no automatic schedule. Provides interval-based auto-backup (see the timer registered in app.js init);
  // this endpoint exposes the last auto-backup time and the next expected time for ops/dashboards.
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
