// =============================================================================
// Fusion-Doc - auth controller
// Based on the DocMost + Wiki.js multi-auth design
// =============================================================================

const { parseBody } = require('../middleware/body-parser');
const AuthService = require('../services/auth');

function register(app) {
  // issue #45: local user registration/login is only available under the local auth bypass (FUSION_DOC_LOCAL_AUTH=1).
  // On the default (production) path fusion-identity is the sole issuer, so these routes reject (410 Gone).
  const localAuthEnabled = app.config?.localAuth === true;
  const authService = localAuthEnabled ? new AuthService(app) : null;

  // ── First-install check (local bypass only; production is managed by identity) ───
  app.registerRoute('GET', '/api/system/setup', (req, res) => {
    const { successResponse } = require('../middleware/error-handler');
    if (!localAuthEnabled) return successResponse(res, { setup: false, managedBy: 'fusion-identity' });
    const { db } = app;
    const count = db ? db.prepare('SELECT COUNT(*) as c FROM users').get().c : require('../db').listJSON('users').length;
    successResponse(res, { setup: count === 0 });
  });

  // ── Register admin (local bypass only) ───────────────────────────────
  app.registerRoute('POST', '/api/auth/setup', async (req, res) => {
    const { successResponse, errorResponse } = require('../middleware/error-handler');
    if (!localAuthEnabled) return errorResponse(res, 410, 'Local registration is disabled: users are managed by fusion-identity', 'LOCAL_AUTH_DISABLED');
    const { db } = app;
    const { uid } = require('../utils/helpers');
    // Reject repeat setup once installed, avoiding workspace slug conflicts and duplicate admins
    const userCount = db
      ? db.prepare('SELECT COUNT(*) as c FROM users').get().c
      : require('../db').listJSON('users').length;
    if (userCount > 0) return errorResponse(res, 409, 'System already installed; repeat setup rejected', 'ALREADY_SETUP');
    const body = await parseBody(req);
    // Require a password of minimum length, ruling out the default weak password 'admin'
    const password = typeof body.password === 'string' ? body.password : '';
    if (password.length < 8) {
      return errorResponse(res, 400, 'Initial password must be at least 8 characters', 'WEAK_PASSWORD');
    }
    if (!body.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) {
      return errorResponse(res, 400, 'Invalid email format', 'INVALID_EMAIL');
    }
    let result;
    try {
      result = authService.register(body.email, body.name || 'Admin', password, 'admin');
    } catch (e) {
      // Concurrent setup TOCTOU guard: an email UNIQUE conflict means already installed
      if (String(e.message).includes('UNIQUE')) {
        return errorResponse(res, 409, 'System already installed; repeat setup rejected', 'ALREADY_SETUP');
      }
      throw e;
    }
    // Auto-create the default workspace on registration (idempotent: reuse if the slug exists, avoiding UNIQUE conflicts)
    const DEFAULT_SLUG = 'my-workspace';
    if (db) {
      const existing = db.prepare('SELECT id FROM workspaces WHERE slug = ?').get(DEFAULT_SLUG);
      if (!existing) {
        db.prepare('INSERT INTO workspaces (id, name, slug, description) VALUES (?, ?, ?, ?)').run(uid(), 'My Workspace', DEFAULT_SLUG, '默认工作空间'); // i18n: user-facing
      }
    } else {
      const list = require('../db').listJSON('workspaces');
      if (!list.find(w => w.slug === DEFAULT_SLUG)) {
        require('../db').writeJSON('workspaces', uid(), { id: uid(), name: 'My Workspace', slug: DEFAULT_SLUG, description: '默认工作空间' }); // i18n: user-facing
      }
    }
    successResponse(res, result, 201);
  });

  // ── Login (local bypass only) ────────────────────────────────────────
  app.registerRoute('POST', '/api/auth/login', async (req, res) => {
    const { successResponse, errorResponse } = require('../middleware/error-handler');
    if (!localAuthEnabled) return errorResponse(res, 410, 'Local login is disabled: obtain a token via fusion-identity', 'LOCAL_AUTH_DISABLED');
    const body = await parseBody(req);
    const result = authService.login(body.email, body.password);
    if (result.error) return errorResponse(res, 401, result.error, 'AUTH_FAILED');
    successResponse(res, result);
  });

  // ── First-install check ───────────────────────────────────────────────
  app.registerRoute('GET', '/api/system/setup', (req, res) => {
    const { successResponse } = require('../middleware/error-handler');
    const { db } = app;
    const count = db ? db.prepare('SELECT COUNT(*) as c FROM users').get().c : require('../db').listJSON('users').length;
    successResponse(res, { setup: count === 0 });
  });

  // ── Register admin ────────────────────────────────────────────────────
  app.registerRoute('POST', '/api/auth/setup', async (req, res) => {
    const { successResponse, errorResponse } = require('../middleware/error-handler');
    const { db } = app;
    const { uid } = require('../utils/helpers');
    // Reject repeat setup once installed, avoiding workspace slug conflicts and duplicate admins
    const userCount = db
      ? db.prepare('SELECT COUNT(*) as c FROM users').get().c
      : require('../db').listJSON('users').length;
    if (userCount > 0) return errorResponse(res, 409, 'System already installed; repeat setup rejected', 'ALREADY_SETUP');
    const body = await parseBody(req);
    // Require a password of minimum length, ruling out the default weak password 'admin'
    const password = typeof body.password === 'string' ? body.password : '';
    if (password.length < 8) {
      return errorResponse(res, 400, 'Initial password must be at least 8 characters', 'WEAK_PASSWORD');
    }
    if (!body.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) {
      return errorResponse(res, 400, 'Invalid email format', 'INVALID_EMAIL');
    }
    let result;
    try {
      result = authService.register(body.email, body.name || 'Admin', password, 'admin');
    } catch (e) {
      // Concurrent setup TOCTOU guard: an email UNIQUE conflict means already installed
      if (String(e.message).includes('UNIQUE')) {
        return errorResponse(res, 409, 'System already installed; repeat setup rejected', 'ALREADY_SETUP');
      }
      throw e;
    }
    // Auto-create the default workspace on registration (idempotent: reuse if the slug exists, avoiding UNIQUE conflicts)
    const DEFAULT_SLUG = 'my-workspace';
    if (db) {
      const existing = db.prepare('SELECT id FROM workspaces WHERE slug = ?').get(DEFAULT_SLUG);
      if (!existing) {
        db.prepare('INSERT INTO workspaces (id, name, slug, description) VALUES (?, ?, ?, ?)').run(uid(), 'My Workspace', DEFAULT_SLUG, '默认工作空间'); // i18n: user-facing
      }
    } else {
      const list = require('../db').listJSON('workspaces');
      if (!list.find(w => w.slug === DEFAULT_SLUG)) {
        require('../db').writeJSON('workspaces', uid(), { id: uid(), name: 'My Workspace', slug: DEFAULT_SLUG, description: '默认工作空间' }); // i18n: user-facing
      }
    }
    successResponse(res, result, 201);
  });

  // ── Login ─────────────────────────────────────────────────────────────
  app.registerRoute('POST', '/api/auth/login', async (req, res) => {
    const { successResponse, errorResponse } = require('../middleware/error-handler');
    const body = await parseBody(req);
    const result = authService.login(body.email, body.password);
    if (result.error) return errorResponse(res, 401, result.error, 'AUTH_FAILED');
    successResponse(res, result);
  });

  // ── Current user: return the real authenticated identity, no longer hardcoded admin ───
  app.registerRoute('POST', '/api/users/me', (req, res) => {
    const { successResponse, errorResponse } = require('../middleware/error-handler');
    if (!req.user) return errorResponse(res, 401, 'Not authenticated', 'UNAUTHORIZED');
    successResponse(res, {
      id: req.user.id,
      email: req.user.email || '',
      name: req.user.name || '',
      role: req.user.role || 'user',
    });
  });
}

module.exports = { register };
