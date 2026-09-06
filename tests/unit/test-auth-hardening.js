// =============================================================================
// Fusion-Doc — issue #48 密码哈希硬化 单元测试
// 零外部依赖 (node:test + node:assert)。覆盖: verifyPassword 拒绝明文/畸形存储,
// JSON 模式下旧哈希自动升级并持久化回文件, scrypt 往返正确。
// =============================================================================

const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');

// ── AuthService 构造: 最小 app 桩 ───────────────────────────────────────
// auth.js 在构造时读 app.db / app.config.auth, login 里按 this.db 分支。
const AuthService = require('../../server/services/auth');

function makeSvc({ db = null, jwtSecret = 'test-secret', sessionExpiry = 3600 } = {}) {
    return new AuthService({ db, config: { auth: { jwtSecret, sessionExpiry } } });
}

// ── verifyPassword ───────────────────────────────────────────────────────
test('issue#48: scrypt 往返 verifyPassword 命中', () => {
    const svc = makeSvc();
    const stored = svc.hashPassword('correct-horse-battery');
    assert.ok(stored.startsWith('scrypt:'));
    assert.strictEqual(svc.verifyPassword('correct-horse-battery', stored), true);
    assert.strictEqual(svc.verifyPassword('wrong-password', stored), false);
});

test('issue#48: 明文存储被拒绝 (不再走 HMAC 误判/抛错)', () => {
    const svc = makeSvc();
    // 纯明文: 无冒号分隔 → 旧逻辑 split(':') 得单元素, salt=undefined 抛错
    assert.strictEqual(svc.verifyPassword('admin123', 'admin123'), false);
    // 明文带冒号但仍非合法哈希: 第 2 段非 hex 长度不匹配 → false
    assert.strictEqual(svc.verifyPassword('x', 'plain:text'), false);
    // 空字符串
    assert.strictEqual(svc.verifyPassword('x', ''), false);
});

test('issue#48: 合法旧版 HMAC-SHA256 哈希仍兼容 (不误杀存量)', () => {
    const svc = makeSvc();
    const salt = 'oldsalt';
    const hash = crypto.createHmac('sha256', salt).update('legacy-pass').digest('hex');
    const stored = `${salt}:${hash}`;
    assert.strictEqual(svc.verifyPassword('legacy-pass', stored), true);
    assert.strictEqual(svc.verifyPassword('wrong', stored), false);
});

// ── JSON 模式自动升级 ────────────────────────────────────────────────────
test('issue#48: JSON 模式旧哈希登录后自动升级并持久化', () => {
    // 临时 users 目录桩: 拦截 writeJSON, 记录写入
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fd-auth-'));
    const usersDir = path.join(tmpDir, 'users');
    fs.mkdirSync(usersDir, { recursive: true });

    // 桩 db 模块 (auth.js 用 require('../db'))
    const dbPath = require.resolve('../../server/db');
    const origDb = require.cache[dbPath];
    delete require.cache[dbPath];
    const written = {};
    const dbStub = {
        getDB: () => null,
        readJSON: (dir, id) => (dir === 'users' ? written[id] : null),
        writeJSON: (dir, id, data) => { if (dir === 'users') written[id] = { ...data }; },
        listJSON: (dir) => (dir === 'users' ? Object.values(written) : []),
    };
    require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: dbStub };

    // 重新 require auth (它 require ../db 拿到桩) — 先清缓存
    const authPath = require.resolve('../../server/services/auth');
    delete require.cache[authPath];
    const AuthServiceFresh = require(authPath);

    // 预置一个旧版 HMAC 用户到 JSON 存储
    const userId = 'user-legacy-1';
    const salt = 'oldsalt';
    const hash = crypto.createHmac('sha256', salt).update('legacy-pass').digest('hex');
    written[userId] = {
        id: userId,
        email: 'legacy@fusion.local',
        name: 'Legacy',
        password: `${salt}:${hash}`,
        role: 'member',
        created_at: '2026-01-01T00:00:00.000Z',
    };

    const svc = new AuthServiceFresh({
        db: null, // JSON 模式
        config: { auth: { jwtSecret: 't', sessionExpiry: 3600 } },
    });

    const result = svc.login('legacy@fusion.local', 'legacy-pass');
    assert.ok(result.token, 'login 应返回 token');
    assert.ok(written[userId].password.startsWith('scrypt:'), '密码应已升级为 scrypt 并写回 JSON');
    assert.ok(written[userId].password !== `${salt}:${hash}`, '存储哈希确实变化');

    // 还原 require 缓存
    delete require.cache[authPath];
    delete require.cache[dbPath];
    if (origDb) require.cache[dbPath] = origDb;

    // 清理临时目录
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('issue#48: JSON 模式明文种子登录被拒 (不升级不返回 token)', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fd-auth-2-'));
    const usersDir = path.join(tmpDir, 'users');
    fs.mkdirSync(usersDir, { recursive: true });

    const dbPath = require.resolve('../../server/db');
    const origDb = require.cache[dbPath];
    delete require.cache[dbPath];
    const written = {};
    const dbStub = {
        getDB: () => null,
        readJSON: (dir, id) => (dir === 'users' ? written[id] : null),
        writeJSON: (dir, id, data) => { if (dir === 'users') written[id] = { ...data }; },
        listJSON: (dir) => (dir === 'users' ? Object.values(written) : []),
    };
    require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: dbStub };

    const authPath = require.resolve('../../server/services/auth');
    delete require.cache[authPath];
    const AuthServiceFresh = require(authPath);

    const userId = 'admin-plaintext';
    written[userId] = {
        id: userId,
        email: 'admin@fusion.local',
        name: 'Admin',
        password: 'admin123', // 明文
        role: 'admin',
        created_at: '2026-07-15T14:33:33.000Z',
    };

    const svc = new AuthServiceFresh({
        db: null,
        config: { auth: { jwtSecret: 't', sessionExpiry: 3600 } },
    });

    const result = svc.login('admin@fusion.local', 'admin123');
    assert.ok(result.error, '明文种子应登录失败');
    assert.strictEqual(result.token, undefined, '不应签发 token');
    assert.strictEqual(written[userId].password, 'admin123', '明文不应被改写 (verify 已先拒绝)');

    delete require.cache[authPath];
    delete require.cache[dbPath];
    if (origDb) require.cache[dbPath] = origDb;
    fs.rmSync(tmpDir, { recursive: true, force: true });
});
