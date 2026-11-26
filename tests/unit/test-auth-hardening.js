// =============================================================================
// Fusion-Doc — issue #48 password hash hardening unit tests
// Zero external dependencies (node:test + node:assert). Covers: verifyPassword rejects plaintext/malformed stored values,
// legacy hashes in JSON mode are auto-upgraded and persisted back to file, scrypt round-trip is correct.
// =============================================================================

const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');

// ── AuthService construction: minimal app stub ──────────────────────────
// auth.js reads app.db / app.config.auth at construction; login branches on this.db.
const AuthService = require('../../server/services/auth');

function makeSvc({ db = null, jwtSecret = 'test-secret', sessionExpiry = 3600 } = {}) {
    return new AuthService({ db, config: { auth: { jwtSecret, sessionExpiry } } });
}

// ── verifyPassword ───────────────────────────────────────────────────────
test('issue#48: scrypt round-trip verifyPassword matches', () => {
    const svc = makeSvc();
    const stored = svc.hashPassword('correct-horse-battery');
    assert.ok(stored.startsWith('scrypt:'));
    assert.strictEqual(svc.verifyPassword('correct-horse-battery', stored), true);
    assert.strictEqual(svc.verifyPassword('wrong-password', stored), false);
});

test('issue#48: plaintext stored value is rejected (no longer HMAC misjudgment/throw)', () => {
    const svc = makeSvc();
    // Pure plaintext: no colon separator → old logic split(':') yields one element, salt=undefined throws
    assert.strictEqual(svc.verifyPassword('admin123', 'admin123'), false);
    // Plaintext with a colon but still not a valid hash: second segment is not hex / length mismatch → false
    assert.strictEqual(svc.verifyPassword('x', 'plain:text'), false);
    // Empty string
    assert.strictEqual(svc.verifyPassword('x', ''), false);
});

test('issue#48: valid legacy HMAC-SHA256 hash still supported (existing users not broken)', () => {
    const svc = makeSvc();
    const salt = 'oldsalt';
    const hash = crypto.createHmac('sha256', salt).update('legacy-pass').digest('hex');
    const stored = `${salt}:${hash}`;
    assert.strictEqual(svc.verifyPassword('legacy-pass', stored), true);
    assert.strictEqual(svc.verifyPassword('wrong', stored), false);
});

// ── JSON mode auto-upgrade ───────────────────────────────────────────────
test('issue#48: legacy hash in JSON mode is auto-upgraded and persisted after login', () => {
    // Temp users directory stub: intercept writeJSON and record writes
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fd-auth-'));
    const usersDir = path.join(tmpDir, 'users');
    fs.mkdirSync(usersDir, { recursive: true });

    // Stub the db module (auth.js uses require('../db'))
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

    // Re-require auth (its require ../db gets the stub) — clear the cache first
    const authPath = require.resolve('../../server/services/auth');
    delete require.cache[authPath];
    const AuthServiceFresh = require(authPath);

    // Seed a legacy HMAC user into JSON storage
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
        db: null, // JSON mode
        config: { auth: { jwtSecret: 't', sessionExpiry: 3600 } },
    });

    const result = svc.login('legacy@fusion.local', 'legacy-pass');
    assert.ok(result.token, 'login should return a token');
    assert.ok(written[userId].password.startsWith('scrypt:'), 'password should be upgraded to scrypt and written back to JSON');
    assert.ok(written[userId].password !== `${salt}:${hash}`, 'stored hash actually changed');

    // Restore the require cache
    delete require.cache[authPath];
    delete require.cache[dbPath];
    if (origDb) require.cache[dbPath] = origDb;

    // Clean up the temp directory
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('issue#48: plaintext seed login in JSON mode is rejected (no upgrade, no token)', () => {
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
        password: 'admin123', // plaintext
        role: 'admin',
        created_at: '2026-07-15T14:33:33.000Z',
    };

    const svc = new AuthServiceFresh({
        db: null,
        config: { auth: { jwtSecret: 't', sessionExpiry: 3600 } },
    });

    const result = svc.login('admin@fusion.local', 'admin123');
    assert.ok(result.error, 'plaintext seed login should fail');
    assert.strictEqual(result.token, undefined, 'should not issue a token');
    assert.strictEqual(written[userId].password, 'admin123', 'plaintext should not be rewritten (verify rejects first)');

    delete require.cache[authPath];
    delete require.cache[dbPath];
    if (origDb) require.cache[dbPath] = origDb;
    fs.rmSync(tmpDir, { recursive: true, force: true });
});
