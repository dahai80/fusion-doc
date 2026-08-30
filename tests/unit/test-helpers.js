// =============================================================================
// E8 修复: 行为测试 — 工具函数 (uid 唯一性, slugify)
// =============================================================================
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { uid, now, slugify } = require('../../server/utils/helpers');

test('uid: 生成唯一且不重复', () => {
    const set = new Set();
    for (let i = 0; i < 1000; i++) set.add(uid());
    assert.equal(set.size, 1000, '1000 个 uid 全部唯一');
});

test('uid: 长度非空', () => {
    const id = uid();
    assert.ok(id && id.length >= 16, `uid 过短: ${id}`);
});

test('now: ISO8601 格式', () => {
    const t = now();
    assert.match(t, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
});

test('slugify: 转小写连字符', () => {
    assert.equal(slugify('Hello World'), 'hello-world');
    assert.equal(slugify('My Doc Title 2'), 'my-doc-title-2');
});

test('slugify: 剥离特殊字符', () => {
    assert.equal(slugify('A/B\\C?D=E'), 'abcde');
    assert.equal(slugify('  spaces  '), '-spaces-');
    assert.equal(slugify(''), '');
    assert.equal(slugify(null), '');
});
