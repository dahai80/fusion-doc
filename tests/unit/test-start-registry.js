// =============================================================================
// Fusion-Doc — issue #67 start.sh register-then-start 自检 单元测试
// 零外部依赖 (node:test + node:assert)。CI 只测拒绝路径 (exit 1, 先于任何
// 启动副作用); 通过/绕过/缺文件三条路径已在 PR 验证矩阵中人工覆盖
// (本地跑 start 会真的拉起服务, 不适合放自动测试)。
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

// 本地已有服务在跑时跳过 (拒绝路径要求 do_start 走到 registry 检查,
// is_running 提前 return 0 会绕过它)
function serverRunning() {
    if (!fs.existsSync(PID_FILE)) return false;
    const pid = fs.readFileSync(PID_FILE, 'utf8').trim();
    if (!pid) return false;
    try { process.kill(Number(pid), 0); return true; } catch (_) { return false; }
}

test('issue#67: 端口未登记 port-registry → 拒绝启动 (exit 1)', { skip: serverRunning() }, () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fd-registry-'));
    const registry = path.join(tmpDir, 'port-registry.yaml');
    // 同格式但不含 fusion-doc 条目
    fs.writeFileSync(registry, 'services:\n  other-svc:\n    port: 12345\n    purpose: test\n');
    try {
        const res = spawnSync('bash', [START_SH, 'start'], {
            cwd: ROOT,
            env: { ...process.env, FUSION_REGISTRY: registry },
            encoding: 'utf8',
            timeout: 30000,
        });
        assert.notStrictEqual(res.status, 0, '未登记端口必须拒绝启动');
        assert.match(res.stderr + res.stdout, /not registered/, '须输出 refusing 原因');
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('issue#67: registry 条目存在但端口不匹配 → 同样拒绝', { skip: serverRunning() }, () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fd-registry-'));
    const registry = path.join(tmpDir, 'port-registry.yaml');
    // fusion-doc 条目存在但端口不是 11449 (默认 PORT)
    fs.writeFileSync(registry, 'services:\n  fusion-doc:\n    port: 19999\n    purpose: test\n');
    try {
        const res = spawnSync('bash', [START_SH, 'start'], {
            cwd: ROOT,
            env: { ...process.env, FUSION_REGISTRY: registry, FUSION_DOC_PORT: '11449' },
            encoding: 'utf8',
            timeout: 30000,
        });
        assert.notStrictEqual(res.status, 0, '端口与登记值不一致必须拒绝启动');
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});
