// =============================================================================
// Fusion-Doc — 用户管理控制器
// =============================================================================

const { parseBody } = require('../middleware/body-parser');
const { json, list } = require('../utils/response');

function register(app) {
  const { db } = app;

  app.registerRoute('GET', '/api/users', (req, res) => {
    let data = db
      ? db.prepare('SELECT id, email, name, role, avatar, created_at FROM users ORDER BY name').all()
      : require('../db').listJSON('users').map(u => ({ id: u.id, email: u.email, name: u.name, role: u.role }));
    list(res, data);
  });

  app.registerRoute('POST', '/api/users/update', async (req, res) => {
    const body = await parseBody(req);
    if (db) { db.prepare('UPDATE users SET name = ?, email = ? WHERE id = ?').run(body.name, body.email, body.id || 'local'); }
    json(res, { updated: true });
  });
}

module.exports = { register };