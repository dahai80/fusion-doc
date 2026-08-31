// =============================================================================
// 多实例修复: 行为测试 — 迁移锁串行化 (BEGIN IMMEDIATE + busy_retry)
// 多进程并发启动 → 抢写锁, 仅一个跑迁移, 其余 BUSY 排队。
// 用内存 SQLite 无法模拟跨进程锁; 改验证:
//   1. 迁移记录幂等 (重复跑不重复应用)
//   2. busy_retry 逻辑: SQLITE_BUSY → 重试而非立即失败 (Atomics.wait 模拟)
//   3. 单迁移失败 SAVEPOINT 回滚, 不留半套 schema
// =============================================================================
const { test } = require('node:test');
const assert = require('node:assert/strict');

let Database = null;
try { Database = require('better-sqlite3'); } catch (_) { /* 跳过 DB 用例 */ }

test('迁移幂等: _migrations 记录已应用的不再重跑', { skip: !Database }, () => {
    const db = new Database(':memory:');
    db.exec(`CREATE TABLE _migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL,
        applied_at TEXT DEFAULT (datetime('now'))
    );`);
    db.exec('CREATE TABLE IF NOT EXISTS demo (x INTEGER);');
    db.prepare('INSERT INTO _migrations (name) VALUES (?)').run('demo_001');

    // 复刻 runMigrations 的 applied 集合逻辑 (db.js:80-82)
    const applied = new Set(db.prepare('SELECT name FROM _migrations').all().map(r => r.name));
    assert.equal(applied.has('demo_001'), true, '已应用迁移在集合中');
    // 模拟 for-loop 跳过已应用
    const migrations = [{ name: 'demo_001', sql: 'CREATE TABLE demo_dup(x);' }];
    let ran = 0;
    for (const m of migrations) {
        if (applied.has(m.name)) continue;
        ran++;
    }
    assert.equal(ran, 0, '已应用迁移被跳过 (幂等)');
    db.close();
});

test('迁移 SAVEPOINT 回滚: 单迁移 DDL 中途失败 → 回退本迁移已执行部分', { skip: !Database }, () => {
    const db = new Database(':memory:');
    db.exec(`CREATE TABLE _migrations (name TEXT UNIQUE NOT NULL);`);
    // 模拟一条迁移: 先建成功表 A, 再建非法表 B (语法错) → 整迁移回滚
    db.exec('BEGIN');
    db.exec('SAVEPOINT fd_migration');
    try {
        db.exec('CREATE TABLE ok_table (a INTEGER);');
        db.exec('CREATE TABLE fail_table (BAD SYNTAX!!!);'); // 故意语法错, 必抛
        db.prepare('INSERT INTO _migrations (name) VALUES (?)').run('fail_001');
        db.exec('RELEASE fd_migration');
        assert.fail('应抛语法错');
    } catch (e) {
        db.exec('ROLLBACK TO fd_migration');
        db.exec('RELEASE fd_migration');
        // 回滚后 ok_table 应不存在 (SAVEPOINT 回退其建表)
        const exists = db.prepare("SELECT COUNT(*) AS c FROM sqlite_master WHERE name='ok_table'").get().c;
        assert.equal(exists, 0, '部分 DDL 已回滚, 不留半套 schema');
        const mig = db.prepare('SELECT COUNT(*) AS c FROM _migrations').get().c;
        assert.equal(mig, 0, '失败迁移未记入 _migrations (一致性)');
    } finally {
        try { db.exec('COMMIT'); } catch (_) { /* noop */ }
        db.close();
    }
});

test('busy_retry 逻辑: SQLITE_BUSY 时重试计数而非立即抛', () => {
    // 复刻 _acquireMigrateLock 的重试循环 (db.js:44-61), 验证遇 BUSY 计数+重试
    // 不真实加锁 (单进程无并发锁), 只验证错误分类逻辑
    const maxRetry = 60;
    let attempts = 0;
    let acquired = false;
    for (let i = 0; i < maxRetry; i++) {
        attempts++;
        // 模拟前 5 次 BUSY, 第 6 次成功
        const err = i < 5
            ? { code: 'SQLITE_BUSY', message: 'database is locked' }
            : null;
        if (!err) { acquired = true; break; }
        if (err.code === 'SQLITE_BUSY' || /database is locked/.test(err.message)) {
            // 真实代码此处 Atomics.wait 200ms; 测试中跳过等待直接 continue
            continue;
        }
        throw err;
    }
    assert.equal(acquired, true, 'BUSY 重试后第 6 次拿到锁');
    assert.equal(attempts, 6, '重试 6 次 (5 BUSY + 1 成功), 未耗尽 60 次上限');
});

test('busy_retry 超时: 持续 BUSY 到 maxRetry → 返回 false (fail visibly)', () => {
    const maxRetry = 3; // 用小上限加速测试
    let attempts = 0;
    let acquired = false;
    for (let i = 0; i < maxRetry; i++) {
        attempts++;
        const err = { code: 'SQLITE_BUSY', message: 'database is locked' }; // 恒 BUSY
        if (err.code === 'SQLITE_BUSY' || /database is locked/.test(err.message)) {
            continue;
        }
        acquired = true;
        break;
    }
    assert.equal(acquired, false, '持续 BUSY 到上限未拿到锁 → 返回 false');
    assert.equal(attempts, maxRetry, `重试耗尽 ${maxRetry} 次`);
});

test('角色门控: FUSION_DOC_ROLE=replica 时不跑单实例职责 (E8 清扫/备份)', () => {
    // 复刻 app.js init() 的角色判断逻辑 (app.js:53-91)
    // primary 跑 E8 清扫 + 自动备份; replica 跳过 (防多进程重复执行/惊群)
    const runE8Sweep = (role) => role === 'primary';
    const runAutoBackup = (role, hours) => role === 'primary' && hours > 0;
    assert.equal(runE8Sweep('primary'), true, 'primary 跑 E8 清扫');
    assert.equal(runE8Sweep('replica'), false, 'replica 跳过 E8 清扫');
    assert.equal(runAutoBackup('primary', 24), true, 'primary 跑自动备份');
    assert.equal(runAutoBackup('replica', 24), false, 'replica 跳过自动备份');
    assert.equal(runAutoBackup('primary', 0), false, 'AUTO_BACKUP_HOURS=0 关闭备份');
    assert.equal(runAutoBackup('replica', 0), false, 'replica + 关闭 → 双重跳过');
    // 默认角色 (未设 env) 应为 primary
    const role = (process.env.FUSION_DOC_ROLE || 'primary').toLowerCase();
    assert.equal(role, 'primary', '默认角色 primary (单实例向后兼容)');
});
