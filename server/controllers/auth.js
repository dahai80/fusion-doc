// =============================================================================
// Fusion-Doc - 认证控制器
// 参考 DocMost + Wiki.js 多认证设计
// =============================================================================

const { parseBody } = require('../middleware/body-parser');
const AuthService = require('../services/auth');

function register(app) {
  // issue #45: 本地用户注册/登录仅在本地认证旁路 (FUSION_DOC_LOCAL_AUTH=1) 下可用。
  // 默认 (生产) 路径下 fusion-identity 为唯一签发方, 此处路由拒绝 (410 Gone)。
  const localAuthEnabled = app.config?.localAuth === true;
  const authService = localAuthEnabled ? new AuthService(app) : null;

  // ── 首次安装检测 (本地旁路专属; 生产由 identity 管理) ────────────────
  app.registerRoute('GET', '/api/system/setup', (req, res) => {
    const { successResponse } = require('../middleware/error-handler');
    if (!localAuthEnabled) return successResponse(res, { setup: false, managedBy: 'fusion-identity' });
    const { db } = app;
    const count = db ? db.prepare('SELECT COUNT(*) as c FROM users').get().c : require('../db').listJSON('users').length;
    successResponse(res, { setup: count === 0 });
  });

  // ── 注册管理员 (本地旁路专属) ────────────────────────────────────────
  app.registerRoute('POST', '/api/auth/setup', async (req, res) => {
    const { successResponse, errorResponse } = require('../middleware/error-handler');
    if (!localAuthEnabled) return errorResponse(res, 410, '本地注册已停用: 用户由 fusion-identity 统一管理', 'LOCAL_AUTH_DISABLED');
    const { db } = app;
    const { uid } = require('../utils/helpers');
    // 已安装则拒绝重复 setup，避免工作空间 slug 冲突与重复管理员
    const userCount = db
      ? db.prepare('SELECT COUNT(*) as c FROM users').get().c
      : require('../db').listJSON('users').length;
    if (userCount > 0) return errorResponse(res, 409, '系统已安装，拒绝重复 setup', 'ALREADY_SETUP');
    const body = await parseBody(req);
    // 强制密码必填且满足最小长度, 杜绝默认弱口令 'admin'
    const password = typeof body.password === 'string' ? body.password : '';
    if (password.length < 8) {
      return errorResponse(res, 400, '初始密码至少 8 位', 'WEAK_PASSWORD');
    }
    if (!body.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) {
      return errorResponse(res, 400, 'email 格式非法', 'INVALID_EMAIL');
    }
    let result;
    try {
      result = authService.register(body.email, body.name || 'Admin', password, 'admin');
    } catch (e) {
      // 并发 setup TOCTOU 防护: email UNIQUE 冲突即视为已安装
      if (String(e.message).includes('UNIQUE')) {
        return errorResponse(res, 409, '系统已安装，拒绝重复 setup', 'ALREADY_SETUP');
      }
      throw e;
    }
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

  // ── 登录 (本地旁路专属) ──────────────────────────────────────────────
  app.registerRoute('POST', '/api/auth/login', async (req, res) => {
    const { successResponse, errorResponse } = require('../middleware/error-handler');
    if (!localAuthEnabled) return errorResponse(res, 410, '本地登录已停用: 请通过 fusion-identity 获取 token', 'LOCAL_AUTH_DISABLED');
    const body = await parseBody(req);
    const result = authService.login(body.email, body.password);
    if (result.error) return errorResponse(res, 401, result.error, 'AUTH_FAILED');
    successResponse(res, result);
  });

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
    // 强制密码必填且满足最小长度, 杜绝默认弱口令 'admin'
    const password = typeof body.password === 'string' ? body.password : '';
    if (password.length < 8) {
      return errorResponse(res, 400, '初始密码至少 8 位', 'WEAK_PASSWORD');
    }
    if (!body.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) {
      return errorResponse(res, 400, 'email 格式非法', 'INVALID_EMAIL');
    }
    let result;
    try {
      result = authService.register(body.email, body.name || 'Admin', password, 'admin');
    } catch (e) {
      // 并发 setup TOCTOU 防护: email UNIQUE 冲突即视为已安装
      if (String(e.message).includes('UNIQUE')) {
        return errorResponse(res, 409, '系统已安装，拒绝重复 setup', 'ALREADY_SETUP');
      }
      throw e;
    }
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

  // ── 当前用户: 返回真实认证身份, 不再硬编码 admin ─────────────────────
  app.registerRoute('POST', '/api/users/me', (req, res) => {
    const { successResponse, errorResponse } = require('../middleware/error-handler');
    if (!req.user) return errorResponse(res, 401, '未认证', 'UNAUTHORIZED');
    successResponse(res, {
      id: req.user.id,
      email: req.user.email || '',
      name: req.user.name || '',
      role: req.user.role || 'user',
    });
  });
}

module.exports = { register };
