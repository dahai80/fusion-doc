// =============================================================================
// Fusion-Doc — service layer: authentication service
// Business logic: password hashing, token management, multiple auth strategies
// =============================================================================

const crypto = require('crypto');
const { createToken, verifyToken } = require('../middleware/auth');

class AuthService {
  constructor(app) {
    this.app = app;
    this.db = app.db;
    this.config = app.config.auth;
  }

  // Password hashing (scrypt slow hash, resists offline brute force; production-grade)
  // Format: scrypt:N:r:p:salt:hash (N=2^15, r=8, p=1, salt=16B, keyLen=64B)
  hashPassword(password) {
    const salt = crypto.randomBytes(16);
    const keyLen = 64;
    const opts = { N: 32768, r: 8, p: 1, maxmem: 128 * 32768 * 8 * 2 };
    const hash = crypto.scryptSync(password, salt, keyLen, opts);
    return `scrypt:32768:8:1:${salt.toString('hex')}:${hash.toString('hex')}`;
  }

  // Verify password (compatible with legacy SHA-256 hashes, auto-upgraded to scrypt on match)
  verifyPassword(password, stored) {
    if (stored.startsWith('scrypt:')) {
      const [_algo, N, r, p, saltHex, hashHex] = stored.split(':');
      const salt = Buffer.from(saltHex, 'hex');
      const keyLen = Buffer.from(hashHex, 'hex').length;
      const opts = { N: +N, r: +r, p: +p, maxmem: 128 * +N * +r * 2 };
      const computed = crypto.scryptSync(password, salt, keyLen, opts);
      return crypto.timingSafeEqual(computed, Buffer.from(hashHex, 'hex'));
    }
    // Legacy HMAC-SHA256 (compatible with existing data) — constant-time comparison
    // issue #48: reject non-hash formats (plaintext/malformed) to prevent createHmac(undefined) from throwing
    const parts = stored.split(':');
    if (parts.length < 2 || !parts[0] || !parts[1]) {
      console.warn('[Auth] verifyPassword: rejected non-hash stored format (likely plaintext)');
      return false;
    }
    const salt = parts[0];
    const hash = parts.slice(1).join(':');
    const computed = crypto.createHmac('sha256', salt).update(password).digest('hex');
    const a = Buffer.from(hash, 'utf-8');
    const b = Buffer.from(computed, 'utf-8');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  }

  // Login
  login(email, password) {
    let user = this.db
      ? this.db.prepare('SELECT * FROM users WHERE email = ?').get(email)
      : require('../db').listJSON('users').find(u => u.email === email);
    // Uniform error message to prevent a username-enumeration oracle
    const GENERIC = 'Invalid email or password';
    if (!user) return { error: GENERIC };
    if (!this.verifyPassword(password, user.password)) return { error: GENERIC };
    // Auto-upgrade legacy hashes to scrypt (transparent migration, only triggered on a legacy-format match)
    // issue #48: JSON mode is upgraded and persisted too; previously only SQLite was upgraded, so plaintext seeds never migrated
    if (!user.password.startsWith('scrypt:')) {
      const upgraded = this.hashPassword(password);
      if (this.db) {
        this.db.prepare('UPDATE users SET password = ? WHERE id = ?').run(upgraded, user.id);
      } else {
        const { writeJSON } = require('../db');
        writeJSON('users', user.id, { ...user, password: upgraded });
      }
      console.log(`  [Auth] Password hash for user ${email} upgraded to scrypt`);
    }
    const token = createToken({ id: user.id, role: user.role }, this.config.jwtSecret, this.config.sessionExpiry);
    return { token, user: { id: user.id, email: user.email, name: user.name, role: user.role } };
  }

  // Register
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