// =============================================================================
// Fusion-Doc — user management controller (production-grade: privilege-escalation guard + minimal information exposure)
// =============================================================================

const { parseBody } = require('../middleware/body-parser');
const { json, list } = require('../utils/response');
const { errorResponse } = require('../middleware/error-handler');
const { parsePaging } = require('../utils/helpers');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_NAME = 64;

function register(app) {
  const { db } = app;

  // ── User list: only admins may list; regular users get only themselves ──
  app.registerRoute('GET', '/api/users', (req, res) => {
    const isAdmin = req.user?.role === 'admin' || req.user?.role === 'tenant_admin';
    if (!isAdmin) {
      // Non-admins see only themselves; other users' emails are not exposed
      const self = db
        ? db.prepare('SELECT id, name, email, role, avatar, created_at FROM users WHERE id = ?').get(req.user?.id || 'local')
        : { id: req.user?.id || 'local', name: 'Me', email: '', role: req.user?.role || 'user' };
      return list(res, self ? [self] : []);
    }
    // A6 fix: page-size cap for the admin list, preventing an unbounded full-table pull and OOM
    const { size, offset } = parsePaging(req);
    const data = db
      ? db.prepare('SELECT id, email, name, role, avatar, created_at FROM users ORDER BY name LIMIT ? OFFSET ?').all(size, offset)
      : require('../db').listJSON('users').map(u => ({ id: u.id, email: u.email, name: u.name, role: u.role })).slice(offset, offset + size);
    list(res, data);
  });

  // ── Update self/others: force req.user.id as the target to prevent privilege escalation ──
  app.registerRoute('POST', '/api/users/update', async (req, res) => {
    const body = await parseBody(req);
    const isAdmin = req.user?.role === 'admin' || req.user?.role === 'tenant_admin';
    // Target id: regular users can only edit themselves; admins may specify another user
    const targetId = (isAdmin && body.id) ? body.id : (req.user?.id || 'local');
    if (!isAdmin && body.id && body.id !== (req.user?.id || 'local')) {
      return errorResponse(res, 403, 'Not allowed to modify other users', 'FORBIDDEN');
    }

    // Validate email and name
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, MAX_NAME) : null;
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : null;
    if (!name) return errorResponse(res, 400, 'name must not be empty', 'INVALID_NAME');
    if (!email || !EMAIL_RE.test(email)) return errorResponse(res, 400, 'Invalid email format', 'INVALID_EMAIL');

    try {
      if (db) {
        const result = db.prepare('UPDATE users SET name = ?, email = ?, updated_at = datetime(\'now\') WHERE id = ?').run(name, email, targetId);
        if (result.changes === 0) return errorResponse(res, 404, 'User not found', 'USER_NOT_FOUND');
      } else {
        const { readJSON, writeJSON } = require('../db');
        const u = readJSON('users', targetId);
        if (!u) return errorResponse(res, 404, 'User not found', 'USER_NOT_FOUND');
        u.name = name; u.email = email;
        writeJSON('users', targetId, u);
      }
      console.log(`  [User] ${req.user?.id} updated user ${targetId}`);
      json(res, { updated: true });
    } catch (e) {
      if (String(e.message).includes('UNIQUE')) {
        return errorResponse(res, 409, 'email already in use', 'EMAIL_TAKEN');
      }
      throw e;
    }
  });
}

module.exports = { register };
