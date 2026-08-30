// =============================================================================
// Fusion-Doc — 标签控制器（Teedy 标签系统）
// =============================================================================

const { parseBody } = require('../middleware/body-parser');
const { uid, parsePaging } = require('../utils/helpers');
const { list, created } = require('../utils/response');

function register(app) {
  const { db } = app;

  app.registerRoute('GET', '/api/tags', (req, res) => {
    // A6 修复: 列表分页上限, 防 unbounded 全表拉 OOM
    const { size, offset } = parsePaging(req);
    const data = db ? db.prepare('SELECT * FROM tags ORDER BY name LIMIT ? OFFSET ?').all(size, offset) : require('../db').listJSON('tags').slice(offset, offset + size);
    list(res, data);
  });

  app.registerRoute('POST', '/api/tags', async (req, res) => {
    const body = await parseBody(req);
    const tag = { id: uid(), name: body.name, color: body.color || '#6366f1' };
    if (db) { db.prepare('INSERT OR IGNORE INTO tags (id, name, color) VALUES (?, ?, ?)').run(tag.id, tag.name, tag.color); }
    else { require('../db').writeJSON('tags', tag.id, tag); }
    created(res, tag);
  });
}

module.exports = { register };