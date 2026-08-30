// =============================================================================
// Fusion-Doc — 元数据 / 词汇表控制器（Teedy 文档分类）
// =============================================================================

const { parseBody } = require('../middleware/body-parser');
const { uid, now } = require('../utils/helpers');
const { json, list, error } = require('../utils/response');

const MAX_KEY = 200;
const MAX_VALUE = 8000;
const MAX_NAME = 200;

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
    const key = typeof body.key === 'string' ? body.key.slice(0, MAX_KEY) : '';
    if (!key) return error(res, 'key 不能为空', 400);
    const value = typeof body.value === 'string' ? body.value.slice(0, MAX_VALUE) : '';
    if (db) {
      db.prepare('INSERT INTO metadata (id, page_id, key, value, type, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(uid(), body.page_id || null, key, value, body.type || 'text', now());
    }
    json(res, { created: true }, 201);
  });

  // ── 词汇表 (按 name 查找, 避免每次 INSERT OR REPLACE 生成新行) ──────────
  app.registerRoute('GET', '/api/vocabulary', (req, res) => {
    let data = [];
    if (db) { data = db.prepare('SELECT * FROM vocabulary ORDER BY name').all(); }
    list(res, data);
  });

  app.registerRoute('POST', '/api/vocabulary', async (req, res) => {
    const body = await parseBody(req);
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, MAX_NAME) : '';
    if (!name) return error(res, 'name 不能为空', 400);
    if (db) {
      const existing = db.prepare('SELECT id FROM vocabulary WHERE name = ?').get(name);
      if (existing) {
        // 已存在: 更新而非插入新行 (UNIQUE(name) 约束语义)
        db.prepare('UPDATE vocabulary SET type = ?, value_list = ? WHERE id = ?').run(body.type || 'text', JSON.stringify(Array.isArray(body.values) ? body.values : []), existing.id);
      } else {
        db.prepare('INSERT INTO vocabulary (id, name, type, value_list, created_at) VALUES (?, ?, ?, ?, ?)').run(uid(), name, body.type || 'text', JSON.stringify(Array.isArray(body.values) ? body.values : []), now());
      }
    }
    json(res, { created: true }, 201);
  });
}

module.exports = { register };