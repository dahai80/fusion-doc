// =============================================================================
// Fusion-Doc — 用户管理控制器 (商用级: 防越权 + 最小信息暴露)
// =============================================================================

const { parseBody } = require('../middleware/body-parser');
const { json, list } = require('../utils/response');
const { errorResponse } = require('../middleware/error-handler');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_NAME = 64;

function register(app) {
  const { db } = app;

  // ── 用户列表: 仅 admin 可列, 普通用户仅返回自身 ──────────────────────
  app.registerRoute('GET', '/api/users', (req, res) => {
    const isAdmin = req.user?.role === 'admin';
    if (!isAdmin) {
      // 非管理员只看自身, 不暴露他人 email
      const self = db
        ? db.prepare('SELECT id, name, email, role, avatar, created_at FROM users WHERE id = ?').get(req.user?.id || 'local')
        : { id: req.user?.id || 'local', name: 'Me', email: '', role: req.user?.role || 'user' };
      return list(res, self ? [self] : []);
    }
    const data = db
      ? db.prepare('SELECT id, email, name, role, avatar, created_at FROM users ORDER BY name').all()
      : require('../db').listJSON('users').map(u => ({ id: u.id, email: u.email, name: u.name, role: u.role }));
    list(res, data);
  });

  // ── 更新自身/他人: 强制 req.user.id 作目标, 防越权 ──────────────────
  app.registerRoute('POST', '/api/users/update', async (req, res) => {
    const body = await parseBody(req);
    const isAdmin = req.user?.role === 'admin';
    // 目标 id: 普通用户只能改自己; admin 可指定他人
    const targetId = (isAdmin && body.id) ? body.id : (req.user?.id || 'local');
    if (!isAdmin && body.id && body.id !== (req.user?.id || 'local')) {
      return errorResponse(res, 403, '无权修改他人信息', 'FORBIDDEN');
    }

    // 校验 email 与 name
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, MAX_NAME) : null;
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : null;
    if (!name) return errorResponse(res, 400, 'name 不能为空', 'INVALID_NAME');
    if (!email || !EMAIL_RE.test(email)) return errorResponse(res, 400, 'email 格式非法', 'INVALID_EMAIL');

    try {
      if (db) {
        const result = db.prepare('UPDATE users SET name = ?, email = ?, updated_at = datetime(\'now\') WHERE id = ?').run(name, email, targetId);
        if (result.changes === 0) return errorResponse(res, 404, '用户不存在', 'USER_NOT_FOUND');
      } else {
        const { readJSON, writeJSON } = require('../db');
        const u = readJSON('users', targetId);
        if (!u) return errorResponse(res, 404, '用户不存在', 'USER_NOT_FOUND');
        u.name = name; u.email = email;
        writeJSON('users', targetId, u);
      }
      console.log(`  [User] ${req.user?.id} 更新用户 ${targetId}`);
      json(res, { updated: true });
    } catch (e) {
      if (String(e.message).includes('UNIQUE')) {
        return errorResponse(res, 409, 'email 已被占用', 'EMAIL_TAKEN');
      }
      throw e;
    }
  });
}

module.exports = { register };
