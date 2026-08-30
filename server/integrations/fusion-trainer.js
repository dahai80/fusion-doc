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

const DEFAULT_BIN = process.env.FUSION_TRAINER_BIN || '/Users/dahai/fusion/.venv/bin/fusion-trainer';
const MAX_STDOUT = 256 * 1024; // 单 job stdout/stderr 上限 256KB
const MAX_JOBS = 20; // 内存中保留的 job 上限
const MAX_STATUS_OUTPUT = 4096; // 状态接口返回的输出截断长度

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

function startSft({ dataset, model, config, outputDir, binPath }) {
  if (!dataset) {
    throw new Error('startSft 被拒绝: dataset 路径必填');
  }
  if (!model) {
    throw new Error('startSft 被拒绝: model 必填');
  }
  const bin = _resolveBin(binPath);
  const args = ['sft', '--dataset', dataset, '--model', model];
  if (config) args.push('--config', config);
  if (outputDir) args.push('--output-dir', outputDir);

  const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env } });
  const jobId = 'sft_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  const job = { jobId, status: 'running', exitCode: null, command: bin, args, startedAt: Date.now(), stdout: '', stderr: '', _child: child };
  _jobs.set(jobId, job);
  _gcJobs();

  child.stdout.on('data', (d) => { job.stdout = _appendCapped(job.stdout, d.toString()); });
  child.stderr.on('data', (d) => { job.stderr = _appendCapped(job.stderr, d.toString()); });
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
function stopAllJobs() {
  for (const [, job] of _jobs) {
    if (job._child && job.status === 'running') {
      try {
        job._child.kill('SIGTERM');
        console.log('[fusion-trainer] stopping job %s', job.jobId);
      } catch (_) { /* noop */ }
    }
  }
}

async function info(binPath) {
  return new Promise((resolve) => {
    const bin = _resolveBin(binPath);
    const child = spawn(bin, ['info'], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env } });
    let out = '';
    child.stdout.on('data', (d) => { out = _appendCapped(out, d.toString()); });
    child.stderr.on('data', (d) => { out = _appendCapped(out, d.toString()); });
    child.on('error', () => resolve({ error: 'fusion-trainer info spawn 失败' }));
    child.on('exit', (code) => {
      if (code === 0) {
        resolve({ ok: true, output: out.trim() });
      } else {
        resolve({ error: 'fusion-trainer info 退出码 ' + code, output: out.trim() });
      }
    });
  });
}

module.exports = { startSft, getJobStatus, info, stopAllJobs, DEFAULT_BIN };
