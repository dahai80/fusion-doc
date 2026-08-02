// =============================================================================
// Fusion-Doc — Webhook 控制器（Teedy 自动化 / 事件驱动）
// =============================================================================

const { parseBody } = require('../middleware/body-parser');
const { uid, now } = require('../utils/helpers');
const { json, list } = require('../utils/response');
const httpFetch = globalThis.fetch;

function register(app) {
  const { db } = app;

  app.registerRoute('GET', '/api/webhooks', (req, res) => {
    const data = db ? db.prepare('SELECT * FROM webhooks ORDER BY created_at DESC').all() : [];
    list(res, data);
  });

  app.registerRoute('POST', '/api/webhooks', async (req, res) => {
    const body = await parseBody(req);
    if (db) {
      db.prepare('INSERT INTO webhooks (id, name, url, events, enabled, secret, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(uid(), body.name, body.url, JSON.stringify(body.events || []), body.enabled !== false, body.secret || '', now());
    }
    json(res, { created: true }, 201);
  });

  app.registerRoute('POST', '/api/webhooks/trigger', async (req, res) => {
    const body = await parseBody(req);
    if (db) {
      const hooks = db.prepare('SELECT * FROM webhooks WHERE enabled = 1').all();
      for (const hook of hooks) {
        const events = JSON.parse(hook.events || '[]');
        if (events.length === 0 || events.includes(body.event)) {
          httpFetch(hook.url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Webhook-Secret': hook.secret || '' },
            body: JSON.stringify({ event: body.event, data: body.data, timestamp: now() }),
          }).catch(() => {});
        }
      }
    }
    json(res, { triggered: true });
  });
}

module.exports = { register };