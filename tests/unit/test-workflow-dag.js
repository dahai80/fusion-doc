// =============================================================================
// E8 fix: behavior tests — workflow DAG dependency normalization and cycle detection (A4)
// Verifies normalizeDeps handles arrays/strings/JSON strings, and detectCycle detects circular dependencies
// =============================================================================
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeDeps, detectCycle } = require('../../server/services/workflow-engine');

test('A4: normalizeDeps passes arrays through', () => {
    assert.deepEqual(normalizeDeps(['a', 'b']), ['a', 'b']);
    assert.deepEqual(normalizeDeps(['a', ' b ', '']), ['a', 'b']);
});

test('A4: normalizeDeps converts a single string to an array', () => {
    assert.deepEqual(normalizeDeps('step1'), ['step1']);
    assert.deepEqual(normalizeDeps('  step1  '), ['step1']);
});

test('A4: normalizeDeps parses string arrays (in-house YAML stores "[a, b]" form)', () => {
    assert.deepEqual(normalizeDeps('[step1, step2]'), ['step1', 'step2']);
    assert.deepEqual(normalizeDeps('[a,b]'), ['a', 'b']);
    assert.deepEqual(normalizeDeps('[a, b, ]'), ['a', 'b']);
});

test('A4: normalizeDeps returns an empty array for empty/falsy values', () => {
    assert.deepEqual(normalizeDeps(null), []);
    assert.deepEqual(normalizeDeps(undefined), []);
    assert.deepEqual(normalizeDeps(''), []);
    assert.deepEqual(normalizeDeps('[]'), []);
});

test('A4: detectCycle detects a directed cycle', () => {
    const steps = [
        { id: 'a', depends_on: ['c'] },
        { id: 'b', depends_on: ['a'] },
        { id: 'c', depends_on: ['b'] },
    ];
    // a depends on c, c depends on b, b depends on a → cycle
    const visited = new Set(), stack = new Set();
    assert.equal(detectCycle(steps[0], steps, visited, stack), true);
});

test('A4: detectCycle returns false when acyclic', () => {
    const steps = [
        { id: 'a', depends_on: [] },
        { id: 'b', depends_on: ['a'] },
        { id: 'c', depends_on: ['b'] },
    ];
    const visited = new Set(), stack = new Set();
    assert.equal(detectCycle(steps[2], steps, visited, stack), false);
});
