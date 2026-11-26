// =============================================================================
// E8 fix: behavior tests — utility functions (uid uniqueness, slugify)
// =============================================================================
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { uid, now, slugify } = require('../../server/utils/helpers');

test('uid: generates unique, non-repeating ids', () => {
    const set = new Set();
    for (let i = 0; i < 1000; i++) set.add(uid());
    assert.equal(set.size, 1000, 'all 1000 uids are unique');
});

test('uid: non-empty length', () => {
    const id = uid();
    assert.ok(id && id.length >= 16, `uid too short: ${id}`);
});

test('now: ISO8601 format', () => {
    const t = now();
    assert.match(t, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
});

test('slugify: lowercases and hyphenates', () => {
    assert.equal(slugify('Hello World'), 'hello-world');
    assert.equal(slugify('My Doc Title 2'), 'my-doc-title-2');
});

test('slugify: strips special characters', () => {
    assert.equal(slugify('A/B\\C?D=E'), 'abcde');
    assert.equal(slugify('  spaces  '), '-spaces-');
    assert.equal(slugify(''), '');
    assert.equal(slugify(null), '');
});
