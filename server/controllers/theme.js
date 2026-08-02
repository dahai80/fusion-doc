// =============================================================================
// Fusion-Doc — 主题控制器（BookStack 主题管理）
// =============================================================================

const { parseBody } = require('../middleware/body-parser');
const { json } = require('../utils/response');

function register(app) {
  const { db } = app;

  app.registerRoute('GET', '/api/theme', (req, res) => {
    let theme = { primary: '#6366f1', secondary: '#06b6d4', background: '#0f172a', surface: '#1e293b', text: '#f1f5f9', mode: 'dark' };
    if (db) {
      const row = db.prepare("SELECT value FROM settings WHERE key = 'theme'").get();
      if (row) theme = JSON.parse(row.value);
    }
    json(res, theme);
  });

  app.registerRoute('POST', '/api/theme', async (req, res) => {
    const body = await parseBody(req);
    if (db) { db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('theme', ?)").run(JSON.stringify(body)); }
    json(res, { saved: true });
  });
}

module.exports = { register };