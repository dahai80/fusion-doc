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

const _jobs = new Map();

function _resolveBin(binPath) {
  const bin = binPath || DEFAULT_BIN;
  if (!fs.existsSync(bin)) {
    throw new Error('fusion-trainer CLI 未找到: ' + bin + ' (请在共享 .venv 安装 fusion-trainer 或设置 FUSION_TRAINER_BIN)');
  }
  return bin;
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
  const job = { jobId, status: 'running', exitCode: null, command: bin, args, startedAt: Date.now(), stdout: '', stderr: '' };
  _jobs.set(jobId, job);

  child.stdout.on('data', (d) => { job.stdout += d.toString(); });
  child.stderr.on('data', (d) => { job.stderr += d.toString(); });
  child.on('error', (err) => {
    job.status = 'error';
    job.error = err.message;
    console.error('[fusion-trainer] spawn error:', err.message);
  });
  child.on('exit', (code) => {
    job.exitCode = code;
    job.status = code === 0 ? 'completed' : 'error';
    console.log('[fusion-trainer] job %s exitCode=%s', jobId, code);
  });

  return { jobId, status: 'running', args };
}

function getJobStatus(jobId) {
  const job = _jobs.get(jobId);
  if (!job) return null;
  return { ...job };
}

async function info(binPath) {
  return new Promise((resolve) => {
    const bin = _resolveBin(binPath);
    const child = spawn(bin, ['info'], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env } });
    let out = '';
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.stderr.on('data', (d) => { out += d.toString(); });
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

module.exports = { startSft, getJobStatus, info, DEFAULT_BIN };
