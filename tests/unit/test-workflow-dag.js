// =============================================================================
// E8 修复: 行为测试 — 工作流 DAG 依赖规范化与环检测 (A4)
// 验证 normalizeDeps 处理数组/字符串/JSON 字符串, detectCycle 检测循环依赖
// =============================================================================
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeDeps, detectCycle } = require('../../server/services/workflow-engine');

test('A4: normalizeDeps 数组直通', () => {
    assert.deepEqual(normalizeDeps(['a', 'b']), ['a', 'b']);
    assert.deepEqual(normalizeDeps(['a', ' b ', '']), ['a', 'b']);
});

test('A4: normalizeDeps 单字符串转数组', () => {
    assert.deepEqual(normalizeDeps('step1'), ['step1']);
    assert.deepEqual(normalizeDeps('  step1  '), ['step1']);
});

test('A4: normalizeDeps 字符串数组解析 (自研 YAML 存 "[a, b]" 形式)', () => {
    assert.deepEqual(normalizeDeps('[step1, step2]'), ['step1', 'step2']);
    assert.deepEqual(normalizeDeps('[a,b]'), ['a', 'b']);
    assert.deepEqual(normalizeDeps('[a, b, ]'), ['a', 'b']);
});

test('A4: normalizeDeps 空/假值返回空数组', () => {
    assert.deepEqual(normalizeDeps(null), []);
    assert.deepEqual(normalizeDeps(undefined), []);
    assert.deepEqual(normalizeDeps(''), []);
    assert.deepEqual(normalizeDeps('[]'), []);
});

test('A4: detectCycle 检测有向环', () => {
    const steps = [
        { id: 'a', depends_on: ['c'] },
        { id: 'b', depends_on: ['a'] },
        { id: 'c', depends_on: ['b'] },
    ];
    // a 依赖 c, c 依赖 b, b 依赖 a → 形成环
    const visited = new Set(), stack = new Set();
    assert.equal(detectCycle(steps[0], steps, visited, stack), true);
});

test('A4: detectCycle 无环返回 false', () => {
    const steps = [
        { id: 'a', depends_on: [] },
        { id: 'b', depends_on: ['a'] },
        { id: 'c', depends_on: ['b'] },
    ];
    const visited = new Set(), stack = new Set();
    assert.equal(detectCycle(steps[2], steps, visited, stack), false);
});
