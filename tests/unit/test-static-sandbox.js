// =============================================================================
// E8 修复: 行为测试 — 静态文件路径沙箱 (R1)
// 验证 .. 越界 / 符号链接逃逸被拒绝, 合法路径放行
// =============================================================================
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { isPathSafe } = require('../../server/utils/static');

function mkSandbox() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fd-static-'));
    fs.mkdirSync(path.join(root, 'assets'), { recursive: true });
    fs.writeFileSync(path.join(root, 'assets', 'a.js'), 'ok');
    fs.writeFileSync(path.join(root, 'index.html'), '<html></html>');
    return root;
}

test('R1: 合法路径放行', () => {
    const root = mkSandbox();
    try {
        assert.equal(isPathSafe(root, path.join(root, 'assets', 'a.js')), true);
        assert.equal(isPathSafe(root, path.join(root, 'index.html')), true);
        assert.equal(isPathSafe(root, root), true);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('R1: .. 越界路径拒绝', () => {
    const root = mkSandbox();
    try {
        const escape = path.join(root, 'assets', '..', '..', '..', 'etc', 'passwd');
        assert.equal(isPathSafe(root, escape), false);
        // 绝对外部路径
        assert.equal(isPathSafe(root, '/etc/passwd'), false);
        assert.equal(isPathSafe(root, path.join(os.homedir(), '.ssh', 'id_rsa')), false);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('R1: 符号链接逃逸拒绝', () => {
    const root = mkSandbox();
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'fd-outside-'));
    fs.writeFileSync(path.join(outside, 'secret.env'), 'KEY=leak');
    try {
        // 在沙箱内建指向外部的符号链接
        fs.symlinkSync(outside, path.join(root, 'escape-link'));
        assert.equal(isPathSafe(root, path.join(root, 'escape-link', 'secret.env')), false);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
        fs.rmSync(outside, { recursive: true, force: true });
    }
});

test('R1: 不存在路径拒绝 (realpath 失败)', () => {
    const root = mkSandbox();
    try {
        assert.equal(isPathSafe(root, path.join(root, 'nope', 'missing.js')), false);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
