// =============================================================================
// Fusion-Doc — 活动日志控制器（Wiki.js 审计追踪）
// =============================================================================

const { parseBody } = require('../middleware/body-parser');
const { uid, now } = require('../utils/helpers');
const { json, list } = require('../utils/response');

function register(app) {
  const { db } = app;

  app.registerRoute('GET', '/api/activity', (req, res) => {
    const limit = parseInt(req.ctx.url.searchParams.get('limit') || '50', 10);
    const data = db ? db.prepare('SELECT * FROM activity ORDER BY created_at DESC LIMIT ?').all(limit) : [];
    list(res, data);
  });

  app.registerRoute('POST', '/api/activity', async (req, res) => {
    const body = await parseBody(req);
    if (db) {
      db.prepare('INSERT INTO activity (id, user_id, action, target_type, target_id, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(uid(), body.user_id || 'local', body.action, body.target_type || '', body.target_id || '', JSON.stringify(body.metadata || {}), now());
    }
    json(res, { logged: true }, 201);
  });
}

module.exports = { register };