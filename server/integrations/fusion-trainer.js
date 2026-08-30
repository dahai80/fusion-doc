// =============================================================================
// Fusion-Doc — Fusion-Trainer 集成
// 通过子进程调用共享 .venv 的 fusion-trainer CLI, 基于本文档知识库微调模型
// 镜像 fusion-mlx.js 的 fail-visible 风格
// =============================================================================
//
// fusion-trainer CLI: fusion-trainer sft --dataset <jsonl> --model <id> [--config] [--output-dir]
// 默认 bin: /Users/dahai/fusion/.venv/bin/fusion-trainer (env FUSION_TRAINER_BIN 可覆盖)
// =============================================================================

const { spawn } = require('child_process');
const fs = require('fs');
const crypto = require('crypto');

const DEFAULT_BIN = process.env.FUSION_TRAINER_BIN || '/Users/dahai/fusion/.venv/bin/fusion-trainer';
const MAX_STDOUT = 256 * 1024; // 单 job stdout/stderr 上限 256KB
const MAX_JOBS = 20; // 内存中保留的 job 上限
const MAX_STATUS_OUTPUT = 4096; // 状态接口返回的输出截断长度
// R8 修复: MLX 训练重内存重 GPU, 单节点只能跑 1-2 个; 硬上限防 admin 连发致 OOM 整机卡死
const MAX_RUNNING = parseInt(process.env.FUSION_TRAINER_MAX_RUNNING || '2', 10);

const _jobs = new Map();

function _resolveBin(binPath) {
  const bin = binPath || DEFAULT_BIN;
  if (!fs.existsSync(bin)) {
    throw new Error('fusion-trainer CLI 未找到: ' + bin + ' (请在共享 .venv 安装 fusion-trainer 或设置 FUSION_TRAINER_BIN)');
  }
  return bin;
}

// 限长累加, 防子进程输出爆内存
function _appendCapped(buf, chunk) {
  if (buf.length >= MAX_STDOUT) return buf;
  return (buf + chunk).slice(0, MAX_STDOUT);
}

// 清理已完成且超量的 job, 防内存泄漏
function _gcJobs() {
  if (_jobs.size <= MAX_JOBS) return;
  const finished = [];
  for (const [id, j] of _jobs) {
    if (j.status === 'completed' || j.status === 'error') finished.push(id);
  }
  finished.sort((a, b) => _jobs.get(a).startedAt - _jobs.get(b).startedAt);
  while (_jobs.size > MAX_JOBS && finished.length) {
    _jobs.delete(finished.shift());
  }
}

// R8 修复: 统计运行中 job 数 (硬上限判定依据)
function _runningCount() {
  let n = 0;
  for (const [, j] of _jobs) { if (j.status === 'running') n++; }
  return n;
}

function startSft({ dataset, model, config, outputDir, binPath }) {
  if (!dataset) {
    throw new Error('startSft 被拒绝: dataset 路径必填');
  }
  if (!model) {
    throw new Error('startSft 被拒绝: model 必填');
  }
  // R8 修复: running 计数硬上限, 超限拒绝 (原设计无上限, admin 连发即 GPU OOM 整机卡死)
  const runningCount = _runningCount();
  if (runningCount >= MAX_RUNNING) {
    const err = new Error(`fusion-trainer 并发训练已达上限 ${MAX_RUNNING} (运行中 ${runningCount}), 请等待现有任务完成`);
    err.statusCode = 429;
    err.code = 'TRAINING_BUSY';
    throw err;
  }
  const bin = _resolveBin(binPath);
  const args = ['sft', '--dataset', dataset, '--model', model];
  if (config) args.push('--config', config);
  if (outputDir) args.push('--output-dir', outputDir);

  const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env } });
  // E14 修复: 用 crypto.randomUUID 替代 Date.now()+Math.random (防碰撞越权看他人日志)
  const jobId = 'sft_' + crypto.randomUUID();
  const job = { jobId, status: 'running', exitCode: null, command: bin, args, startedAt: Date.now(), stdout: '', stderr: '', _child: child };
  _jobs.set(jobId, job);
  _gcJobs();

  // E13 修复: 达 cap 后解绑监听器 + destroy, 防 data 事件空转 CPU/GC 浪费
  child.stdout.on('data', (d) => {
    job.stdout = _appendCapped(job.stdout, d.toString());
    if (job.stdout.length >= MAX_STDOUT) { child.stdout.removeAllListeners('data'); child.stdout.destroy(); }
  });
  child.stderr.on('data', (d) => {
    job.stderr = _appendCapped(job.stderr, d.toString());
    if (job.stderr.length >= MAX_STDOUT) { child.stderr.removeAllListeners('data'); child.stderr.destroy(); }
  });
  child.on('error', (err) => {
    job.status = 'error';
    job.error = err.message;
    console.error('[fusion-trainer] spawn error:', err.message);
  });
  child.on('exit', (code) => {
    job.exitCode = code;
    job.status = code === 0 ? 'completed' : 'error';
    job._child = null;
    console.log('[fusion-trainer] job %s exitCode=%s', jobId, code);
  });

  return { jobId, status: 'running', args };
}

function getJobStatus(jobId) {
  const job = _jobs.get(jobId);
  if (!job) return null;
  // 不暴露内部 _child 引用; 截断输出防信息泄漏
  return {
    jobId: job.jobId,
    status: job.status,
    exitCode: job.exitCode,
    startedAt: job.startedAt,
    command: job.command,
    args: job.args,
    stdout: job.stdout.slice(0, MAX_STATUS_OUTPUT),
    stderr: job.stderr.slice(0, MAX_STATUS_OUTPUT),
    stdoutTruncated: job.stdout.length > MAX_STATUS_OUTPUT,
    stderrTruncated: job.stderr.length > MAX_STATUS_OUTPUT,
    error: job.error || null,
  };
}

// 关闭所有仍在运行的 job 子进程 (优雅关闭时调用)
// R15 修复: SIGTERM 后等待 exit (带超时), 超时则 SIGKILL 兜底, 防 MLX 训练子进程变孤儿持续占 GPU。
async function stopAllJobs() {
  const SIGKILL_TIMEOUT_MS = 8000;
  const stops = [];
  for (const [, job] of _jobs) {
    if (job._child && job.status === 'running') {
      stops.push(_stopOneJob(job, SIGKILL_TIMEOUT_MS));
    }
  }
  await Promise.allSettled(stops);
}

function _stopOneJob(job, timeoutMs) {
  return new Promise((resolve) => {
    const child = job._child;
    let settled = false;
    const done = () => { if (!settled) { settled = true; resolve(); } };
    child.once('exit', done);
    child.once('error', done);
    try {
      child.kill('SIGTERM');
      console.log('[fusion-trainer] SIGTERM job %s, 等待退出 (超时 %dms 后 SIGKILL)', job.jobId, timeoutMs);
    } catch (_) { done(); return; }
    // 超时未退则强杀
    const killer = setTimeout(() => {
      if (!settled) {
        console.warn('[fusion-trainer] job %s SIGTERM 超时未退, SIGKILL 兜底', job.jobId);
        try { child.kill('SIGKILL'); } catch (_) { /* noop */ }
        // SIGKILL 后再给 OS 一点回收时间
        setTimeout(done, 500);
      }
    }, timeoutMs);
    killer.unref();
  });
}

async function info(binPath) {
  return new Promise((resolve) => {
    const bin = _resolveBin(binPath);
    const child = spawn(bin, ['info'], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env } });
    let out = '';
    let settled = false;
    // E26 修复: info() 子进程无超时, hang 则 Promise 永挂。加 15s 超时 + SIGKILL。
    const killer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill('SIGKILL'); } catch (_) { /* already gone */ }
      console.warn('[fusion-trainer] info 超时 15s, 已 SIGKILL');
      resolve({ error: 'fusion-trainer info 超时' });
    }, 15000);
    killer.unref();
    child.stdout.on('data', (d) => { out = _appendCapped(out, d.toString()); });
    child.stderr.on('data', (d) => { out = _appendCapped(out, d.toString()); });
    child.on('error', () => {
      if (settled) return;
      settled = true;
      clearTimeout(killer);
      resolve({ error: 'fusion-trainer info spawn 失败' });
    });
    child.on('exit', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(killer);
      if (code === 0) {
        resolve({ ok: true, output: out.trim() });
      } else {
        resolve({ error: 'fusion-trainer info 退出码 ' + code, output: out.trim() });
      }
    });
  });
}

module.exports = { startSft, getJobStatus, info, stopAllJobs, DEFAULT_BIN };
