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

  // 密码哈希（scrypt 慢哈希, 抗离线爆破; 商用级）
  // 格式: scrypt:N:r:p:salt:hash (N=2^15, r=8, p=1, salt=16B, keyLen=64B)
  hashPassword(password) {
    const salt = crypto.randomBytes(16);
    const keyLen = 64;
    const opts = { N: 32768, r: 8, p: 1, maxmem: 128 * 32768 * 8 * 2 };
    const hash = crypto.scryptSync(password, salt, keyLen, opts);
    return `scrypt:32768:8:1:${salt.toString('hex')}:${hash.toString('hex')}`;
  }

  // 验证密码 (兼容旧版 SHA-256 哈希, 命中时自动升级到 scrypt)
  verifyPassword(password, stored) {
    if (stored.startsWith('scrypt:')) {
      const [_algo, N, r, p, saltHex, hashHex] = stored.split(':');
      const salt = Buffer.from(saltHex, 'hex');
      const keyLen = Buffer.from(hashHex, 'hex').length;
      const opts = { N: +N, r: +r, p: +p, maxmem: 128 * +N * +r * 2 };
      const computed = crypto.scryptSync(password, salt, keyLen, opts);
      return crypto.timingSafeEqual(computed, Buffer.from(hashHex, 'hex'));
    }
    // 旧版 HMAC-SHA256 (兼容已存量数据) — 恒定时间比较
    const [salt, hash] = stored.split(':');
    const computed = crypto.createHmac('sha256', salt).update(password).digest('hex');
    const a = Buffer.from(hash || '', 'utf-8');
    const b = Buffer.from(computed, 'utf-8');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  }

  // 登录
  login(email, password) {
    let user = this.db
      ? this.db.prepare('SELECT * FROM users WHERE email = ?').get(email)
      : require('../db').listJSON('users').find(u => u.email === email);
    // 统一错误信息, 杜绝用户名枚举 oracle
    const GENERIC = '邮箱或密码错误';
    if (!user) return { error: GENERIC };
    if (!this.verifyPassword(password, user.password)) return { error: GENERIC };
    // 旧版哈希自动升级到 scrypt (透明迁移, 仅在命中旧格式时触发)
    if (!user.password.startsWith('scrypt:') && this.db) {
      const upgraded = this.hashPassword(password);
      this.db.prepare('UPDATE users SET password = ? WHERE id = ?').run(upgraded, user.id);
      console.log(`  [Auth] 用户 ${email} 密码哈希已升级到 scrypt`);
    }
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