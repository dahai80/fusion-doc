// =============================================================================
// Fusion-Doc — issue #67 start.sh register-then-start self-check unit tests
// Zero external dependencies (node:test + node:assert). CI only tests the refusal path (exit 1, before any
// startup side effects); the pass/bypass/missing-file paths were covered manually in the PR verification matrix
// (running start locally really launches the service, unsuitable for automated tests).
// =============================================================================

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const START_SH = path.join(ROOT, 'start.sh');
const PID_FILE = path.join(ROOT, '.fusion-doc.pid');

// Skip when a local server is already running (the refusal path requires do_start to reach the registry check;
// is_running returning 0 early would bypass it)
function serverRunning() {
    if (!fs.existsSync(PID_FILE)) return false;
    const pid = fs.readFileSync(PID_FILE, 'utf8').trim();
    if (!pid) return false;
    try { process.kill(Number(pid), 0); return true; } catch (_) { return false; }
}

test('issue#67: port not registered in port-registry → refuse to start (exit 1)', { skip: serverRunning() }, () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fd-registry-'));
    const registry = path.join(tmpDir, 'port-registry.yaml');
    // Same format but without a fusion-doc entry
    fs.writeFileSync(registry, 'services:\n  other-svc:\n    port: 12345\n    purpose: test\n');
    try {
        const res = spawnSync('bash', [START_SH, 'start'], {
            cwd: ROOT,
            env: { ...process.env, FUSION_REGISTRY: registry },
            encoding: 'utf8',
            timeout: 30000,
        });
        assert.notStrictEqual(res.status, 0, 'an unregistered port must refuse to start');
        assert.match(res.stderr + res.stdout, /not registered/, 'must print the refusal reason');
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('issue#67: registry entry exists but port mismatches → also refuse', { skip: serverRunning() }, () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fd-registry-'));
    const registry = path.join(tmpDir, 'port-registry.yaml');
    // fusion-doc entry exists but port is not 11449 (default PORT)
    fs.writeFileSync(registry, 'services:\n  fusion-doc:\n    port: 19999\n    purpose: test\n');
    try {
        const res = spawnSync('bash', [START_SH, 'start'], {
            cwd: ROOT,
            env: { ...process.env, FUSION_REGISTRY: registry, FUSION_DOC_PORT: '11449' },
            encoding: 'utf8',
            timeout: 30000,
        });
        assert.notStrictEqual(res.status, 0, 'a port differing from the registered value must refuse to start');
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});
