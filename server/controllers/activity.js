// =============================================================================
// Fusion-Doc — activity log controller (Wiki.js audit trail)
// =============================================================================

const { parseBody } = require('../middleware/body-parser');
const { uid, now } = require('../utils/helpers');
const { json, list } = require('../utils/response');

function register(app) {
  const { db } = app;

  app.registerRoute('GET', '/api/activity', (req, res) => {
    // Clamp limit to [1,200], preventing -1 from leaking the entire audit log
    let limit = parseInt(req.ctx.url.searchParams.get('limit') || '50', 10);
    if (!Number.isFinite(limit) || limit < 1) limit = 50;
    if (limit > 200) limit = 200;
    const data = db ? db.prepare('SELECT * FROM activity ORDER BY created_at DESC LIMIT ?').all(limit) : [];
    list(res, data);
  });

  app.registerRoute('POST', '/api/activity', async (req, res) => {
    const body = await parseBody(req);
    if (db) {
      // R12 fix: take user_id from the server-authoritative req.user.id and reject body self-reporting (the original design allowed forging audit attribution to others).
      const userId = req.user?.id || 'local';
      db.prepare('INSERT INTO activity (id, user_id, action, target_type, target_id, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(uid(), userId, body.action, body.target_type || '', body.target_id || '', JSON.stringify(body.metadata || {}), now());
    }
    json(res, { logged: true }, 201);
  });
}

module.exports = { register };