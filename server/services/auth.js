// =============================================================================
// Fusion-Doc — 服务层：认证服务
// 业务逻辑：密码哈希、Token 管理、多认证策略
// =============================================================================

const crypto = require('crypto');
const { createToken, verifyToken } = require('../middleware/auth');

class AuthService {
  constructor(app) {
    this.app = app;
    this.db = app.db;
    this.config = app.config.auth;
  }

  // 密码哈希（SHA-256 + salt）
  hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.createHmac('sha256', salt).update(password).digest('hex');
    return `${salt}:${hash}`;
  }

  // 验证密码
  verifyPassword(password, stored) {
    const [salt, hash] = stored.split(':');
    const computed = crypto.createHmac('sha256', salt).update(password).digest('hex');
    return hash === computed;
  }

  // 登录
  login(email, password) {
    let user = this.db
      ? this.db.prepare('SELECT * FROM users WHERE email = ?').get(email)
      : require('../db').listJSON('users').find(u => u.email === email);
    if (!user) return { error: '用户不存在' };
    if (!this.verifyPassword(password, user.password)) return { error: '密码错误' };
    const token = createToken({ id: user.id, role: user.role }, this.config.jwtSecret, this.config.sessionExpiry);
    return { token, user: { id: user.id, email: user.email, name: user.name, role: user.role } };
  }

  // 注册
  register(email, name, password, role = 'user') {
    const { uid, now } = require('../utils/helpers');
    const userId = uid();
    const hashed = this.hashPassword(password);
    const user = { id: userId, email, name, password: hashed, role, created_at: now() };
    if (this.db) {
      this.db.prepare('INSERT INTO users (id, email, name, password, role, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(user.id, user.email, user.name, user.password, user.role, user.created_at);
    } else {
      require('../db').writeJSON('users', user.id, user);
    }
    const token = createToken({ id: userId, role }, this.config.jwtSecret, this.config.sessionExpiry);
    return { token, user: { id: userId, email, name, role } };
  }
}

module.exports = AuthService;