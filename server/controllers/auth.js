// =============================================================================
// Fusion-Doc - 认证控制器
// 参考 DocMost + Wiki.js 多认证设计
// =============================================================================

const { parseBody } = require('../middleware/body-parser');
const AuthService = require('../services/auth');

function register(app) {
  const authService = new AuthService(app);

  // ── 首次安装检测 ──────────────────────────────────────────────────────
  app.registerRoute('GET', '/api/system/setup', (req, res) => {
    const { successResponse } = require('../middleware/error-handler');
    const { db } = app;
    const count = db ? db.prepare('SELECT COUNT(*) as c FROM users').get().c : require('../db').listJSON('users').length;
    successResponse(res, { setup: count === 0 });
  });

  // ── 注册管理员 ────────────────────────────────────────────────────────
  app.registerRoute('POST', '/api/auth/setup', async (req, res) => {
    const { successResponse, errorResponse } = require('../middleware/error-handler');
    const { db } = app;
    const { uid } = require('../utils/helpers');
    // 已安装则拒绝重复 setup，避免工作空间 slug 冲突与重复管理员
    const userCount = db
      ? db.prepare('SELECT COUNT(*) as c FROM users').get().c
      : require('../db').listJSON('users').length;
    if (userCount > 0) return errorResponse(res, 409, '系统已安装，拒绝重复 setup', 'ALREADY_SETUP');
    const body = await parseBody(req);
    const result = authService.register(body.email, body.name || 'Admin', body.password || 'admin', 'admin');
    // 注册时自动创建默认工作空间（幂等：slug 已存在则复用，避免 UNIQUE 冲突）
    const DEFAULT_SLUG = 'my-workspace';
    if (db) {
      const existing = db.prepare('SELECT id FROM workspaces WHERE slug = ?').get(DEFAULT_SLUG);
      if (!existing) {
        db.prepare('INSERT INTO workspaces (id, name, slug, description) VALUES (?, ?, ?, ?)').run(uid(), 'My Workspace', DEFAULT_SLUG, '默认工作空间');
      }
    } else {
      const list = require('../db').listJSON('workspaces');
      if (!list.find(w => w.slug === DEFAULT_SLUG)) {
        require('../db').writeJSON('workspaces', uid(), { id: uid(), name: 'My Workspace', slug: DEFAULT_SLUG, description: '默认工作空间' });
      }
    }
    successResponse(res, result, 201);
  });

  // ── 登录 ──────────────────────────────────────────────────────────────
  app.registerRoute('POST', '/api/auth/login', async (req, res) => {
    const { successResponse, errorResponse } = require('../middleware/error-handler');
    const body = await parseBody(req);
    const result = authService.login(body.email, body.password);
    if (result.error) return errorResponse(res, 401, result.error, 'AUTH_FAILED');
    successResponse(res, result);
  });

  // ── 当前用户 ──────────────────────────────────────────────────────────
  app.registerRoute('POST', '/api/users/me', (req, res) => {
    const { successResponse } = require('../middleware/error-handler');
    successResponse(res, { id: 'local', email: 'admin@fusion.local', name: 'Admin', role: 'admin' });
  });
}

module.exports = { register };
