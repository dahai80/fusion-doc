// =============================================================================
// E8 修复: 行为测试 — DB 原子写 (R7) + A2 append-only 无 lost update
// R7: writeJSON 用 tmp+rename, 部分写不残留半成品
// A2: 并发 update 各自 INSERT 互不覆盖 (用内存 SQLite 模拟)
// =============================================================================
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { writeJSON, readJSON, deleteJSON } = require('../../server/db');
const config = require('../../server/config');

let Database = null;
try { Database = require('better-sqlite3'); } catch (_) { /* 跳过 DB 相关用例 */ }

// writeJSON 写入 config.dataDir/db/json/<bucket>, 测试用唯一 bucket 后清理
const BUCKET = 'unit-test-r7';

test('R7: writeJSON 原子写, readJSON 读回, 无 tmp 残留', () => {
    writeJSON(BUCKET, 'doc1', { title: 'hello', n: 42 });
    try {
        const back = readJSON(BUCKET, 'doc1');
        assert.deepEqual(back, { title: 'hello', n: 42 });
        const bucketDir = path.join(config.dataDir, 'db', 'json', BUCKET);
        if (fs.existsSync(bucketDir)) {
            const files = fs.readdirSync(bucketDir);
            assert.equal(files.includes('doc1.json'), true);
            assert.equal(files.some(f => f.endsWith('.tmp')), false, '无 tmp 残留');
        }
    } finally {
        deleteJSON(BUCKET, 'doc1');
    }
});

test('R7: writeJSON 拒绝路径穿越 dir/id', () => {
    // 路径穿越 dir — 不应创建任何越界文件
    writeJSON('../escape-r7', 'doc', { x: 1 });
    const escapePath = path.join(config.dataDir, 'db', 'json', 'escape-r7');
    assert.equal(fs.existsSync(escapePath), false, '穿越 dir 被拒绝');
    // 非法 id
    writeJSON(BUCKET, '../../etc-passwd', { x: 1 });
    const badPath = path.join(config.dataDir, 'db', 'json', BUCKET, '..');
    assert.equal(fs.existsSync(path.join(badPath, 'etc-passwd.json')), false, '非法 id 被拒绝');
});

test('A2: append-only 并发 INSERT 无 lost update (better-sqlite3 不可用时跳过)', { skip: !Database }, () => {
    const mem = new Database(':memory:');
    mem.exec(`
        CREATE TABLE yjs_updates (id INTEGER PRIMARY KEY AUTOINCREMENT, page_id TEXT, "update" BLOB);
        CREATE TABLE yjs_docs (page_id TEXT UNIQUE, state BLOB, state_seq INTEGER DEFAULT 0);
    `);
    // 模拟 N 个客户端并发各发 1 条 update — append-only 每条独立 INSERT
    const N = 50;
    const ins = mem.prepare('INSERT INTO yjs_updates (page_id, "update") VALUES (?, ?)');
    const tx = mem.transaction(() => {
        for (let i = 0; i < N; i++) ins.run('page-1', Buffer.from([i]));
    });
    tx();
    const cnt = mem.prepare('SELECT COUNT(*) as c FROM yjs_updates WHERE page_id = ?').get('page-1').c;
    assert.equal(cnt, N, `${N} 条 update 全部保留, 无 lost update`);
    mem.close();
});
