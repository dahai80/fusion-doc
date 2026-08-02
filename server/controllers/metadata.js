// =============================================================================
// Fusion-Doc — 元数据 / 词汇表控制器（Teedy 文档分类）
// =============================================================================

const { parseBody } = require('../middleware/body-parser');
const { uid, now } = require('../utils/helpers');
const { json, list } = require('../utils/response');

function register(app) {
  const { db } = app;

  // ── 元数据 ────────────────────────────────────────────────────────────
  app.registerRoute('GET', '/api/metadata', (req, res) => {
    let data = [];
    if (db) {
      const pageId = req.ctx.url.searchParams.get('pageId');
      data = pageId ? db.prepare('SELECT * FROM metadata WHERE page_id = ?').all(pageId) : db.prepare('SELECT * FROM metadata ORDER BY created_at DESC').all();
    }
    list(res, data);
  });

  app.registerRoute('POST', '/api/metadata', async (req, res) => {
    const body = await parseBody(req);
    if (db) {
      db.prepare('INSERT INTO metadata (id, page_id, key, value, type, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(uid(), body.page_id, body.key, body.value, body.type || 'text', now());
    }
    json(res, { created: true }, 201);
  });

  // ── 词汇表 ────────────────────────────────────────────────────────────
  app.registerRoute('GET', '/api/vocabulary', (req, res) => {
    let data = [];
    if (db) { data = db.prepare('SELECT * FROM vocabulary ORDER BY name').all(); }
    list(res, data);
  });

  app.registerRoute('POST', '/api/vocabulary', async (req, res) => {
    const body = await parseBody(req);
    if (db) {
      db.prepare('INSERT OR REPLACE INTO vocabulary (id, name, type, values, created_at) VALUES (?, ?, ?, ?, ?)').run(uid(), body.name, body.type || 'text', JSON.stringify(body.values || []), now());
    }
    json(res, { created: true }, 201);
  });
}

module.exports = { register };