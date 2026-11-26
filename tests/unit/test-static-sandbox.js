// =============================================================================
// E8 fix: behavior tests — static file path sandbox (R1)
// Verifies that .. traversal / symlink escapes are rejected and valid paths are allowed
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

test('R1: valid paths are allowed', () => {
    const root = mkSandbox();
    try {
        assert.equal(isPathSafe(root, path.join(root, 'assets', 'a.js')), true);
        assert.equal(isPathSafe(root, path.join(root, 'index.html')), true);
        assert.equal(isPathSafe(root, root), true);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('R1: .. traversal paths are rejected', () => {
    const root = mkSandbox();
    try {
        const escape = path.join(root, 'assets', '..', '..', '..', 'etc', 'passwd');
        assert.equal(isPathSafe(root, escape), false);
        // Absolute outside path
        assert.equal(isPathSafe(root, '/etc/passwd'), false);
        assert.equal(isPathSafe(root, path.join(os.homedir(), '.ssh', 'id_rsa')), false);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('R1: symlink escapes are rejected', () => {
    const root = mkSandbox();
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'fd-outside-'));
    fs.writeFileSync(path.join(outside, 'secret.env'), 'KEY=leak');
    try {
        // Create a symlink inside the sandbox pointing outside
        fs.symlinkSync(outside, path.join(root, 'escape-link'));
        assert.equal(isPathSafe(root, path.join(root, 'escape-link', 'secret.env')), false);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
        fs.rmSync(outside, { recursive: true, force: true });
    }
});

test('R1: nonexistent paths are rejected (realpath fails)', () => {
    const root = mkSandbox();
    try {
        assert.equal(isPathSafe(root, path.join(root, 'nope', 'missing.js')), false);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
