// =============================================================================
// Fusion-Doc — Fusion-Trainer integration
// Invokes the fusion-trainer CLI from the shared .venv as a subprocess to fine-tune models on this doc knowledge base
// Mirrors the fail-visible style of fusion-mlx.js
// =============================================================================
//
// fusion-trainer CLI: fusion-trainer sft --dataset <jsonl> --model <id> [--config] [--output-dir]
// Default bin: /Users/dahai/fusion/.venv/bin/fusion-trainer (overridable via env FUSION_TRAINER_BIN)
// =============================================================================

const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const crypto = require('crypto');

// S9 fix: previously a hardcoded machine-absolute path that broke on any other machine. Prefer env, else resolve 'fusion-trainer' on PATH,
// then fall back to the monorepo shared venv (FUSION_VENV env var or derived relative to the repo root).
function resolveDefaultBin() {
    if (process.env.FUSION_TRAINER_BIN) return process.env.FUSION_TRAINER_BIN;
    // PATH lookup (user ran pip install -e fusion-trainer → on PATH)
    try {
        const out = execFileSync('which', ['fusion-trainer'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
        if (out && fs.existsSync(out)) return out;
    } catch (_) { /* not in PATH, fall through */ }
    // Derive shared venv: walk up from this file looking for .venv
    const venv = process.env.FUSION_VENV || require('path').resolve(__dirname, '../../.venv');
    const candidate = `${venv}/bin/fusion-trainer`;
    if (fs.existsSync(candidate)) return candidate;
    console.warn('[Fusion-Trainer] fusion-trainer CLI not found; set env FUSION_TRAINER_BIN to point to it');
    return 'fusion-trainer'; // Let spawn report it fail-visibly
}
const DEFAULT_BIN = resolveDefaultBin();
const MAX_STDOUT = 256 * 1024; // Per-job stdout/stderr cap of 256KB
const MAX_JOBS = 20; // Max jobs kept in memory
const MAX_STATUS_OUTPUT = 4096; // Output truncation length for the status endpoint
// R8 fix: MLX training is memory- and GPU-heavy; a single node can only run 1-2. Hard cap prevents an admin firing repeatedly and OOM-freezing the machine
const MAX_RUNNING = parseInt(process.env.FUSION_TRAINER_MAX_RUNNING || '2', 10);

const _jobs = new Map();

function _resolveBin(binPath) {
  const bin = binPath || DEFAULT_BIN;
  if (!fs.existsSync(bin)) {
    throw new Error('fusion-trainer CLI not found: ' + bin + ' (install fusion-trainer in the shared .venv or set FUSION_TRAINER_BIN)');
  }
  return bin;
}

// Length-capped accumulation to keep subprocess output from blowing up memory
function _appendCapped(buf, chunk) {
  if (buf.length >= MAX_STDOUT) return buf;
  return (buf + chunk).slice(0, MAX_STDOUT);
}

// Prune finished jobs over the cap to prevent memory leaks
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

// R8 fix: count running jobs (basis for the hard cap)
function _runningCount() {
  let n = 0;
  for (const [, j] of _jobs) { if (j.status === 'running') n++; }
  return n;
}

function startSft({ dataset, model, config, outputDir, binPath }) {
  if (!dataset) {
    throw new Error('startSft rejected: dataset path is required');
  }
  if (!model) {
    throw new Error('startSft rejected: model is required');
  }
  // R8 fix: hard cap on running count, reject when exceeded (original design had no cap; repeated admin requests caused GPU OOM freezing the machine)
  const runningCount = _runningCount();
  if (runningCount >= MAX_RUNNING) {
    const err = new Error(`fusion-trainer concurrent training limit reached ${MAX_RUNNING} (running ${runningCount}); wait for existing jobs to finish`);
    err.statusCode = 429;
    err.code = 'TRAINING_BUSY';
    throw err;
  }
  const bin = _resolveBin(binPath);
  const args = ['sft', '--dataset', dataset, '--model', model];
  if (config) args.push('--config', config);
  if (outputDir) args.push('--output-dir', outputDir);

  const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env } });
  // E14 fix: use crypto.randomUUID instead of Date.now()+Math.random (prevents collisions that allow viewing others' logs)
  const jobId = 'sft_' + crypto.randomUUID();
  const job = { jobId, status: 'running', exitCode: null, command: bin, args, startedAt: Date.now(), stdout: '', stderr: '', _child: child };
  _jobs.set(jobId, job);
  _gcJobs();

  // E1 fix: add a timeout to training jobs so a hung subprocess cannot hold a GPU slot forever (default 30min, env-tunable).
  const JOB_TIMEOUT_MS = parseInt(process.env.FUSION_TRAINER_TIMEOUT_MS || `${30 * 60 * 1000}`, 10);
  const timer = setTimeout(() => {
    if (job.status === 'running' && job._child) {
      console.warn('[fusion-trainer] job %s timed out after %sms, SIGKILL', jobId, JOB_TIMEOUT_MS);
      job.status = 'timeout';
      job.error = `job timeout after ${JOB_TIMEOUT_MS}ms`;
      try { job._child.kill('SIGKILL'); } catch (_) { /* noop */ }
    }
  }, JOB_TIMEOUT_MS);
  job._timer = timer;

  // E13 fix: after hitting the cap, detach listeners + destroy to avoid data events wasting CPU/GC
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
    if (job._timer) { clearTimeout(job._timer); job._timer = null; }
    job.exitCode = code;
    job.status = code === 0 ? 'completed' : (job.status === 'timeout' ? 'timeout' : 'error');
    job._child = null;
    console.log('[fusion-trainer] job %s exitCode=%s', jobId, code);
  });

  return { jobId, status: 'running', args };
}

function getJobStatus(jobId) {
  const job = _jobs.get(jobId);
  if (!job) return null;
  // Do not expose the internal _child reference; truncate output to prevent information leaks
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

// Kill all still-running job subprocesses (called on graceful shutdown)
// R15 fix: after SIGTERM wait for exit (with timeout), SIGKILL as fallback on timeout, so MLX training subprocesses never become orphans holding the GPU.
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
    if (job._timer) { clearTimeout(job._timer); job._timer = null; }
    const child = job._child;
    let settled = false;
    const done = () => { if (!settled) { settled = true; resolve(); } };
    child.once('exit', done);
    child.once('error', done);
    try {
      child.kill('SIGTERM');
      console.log('[fusion-trainer] SIGTERM job %s, waiting for exit (SIGKILL after %dms timeout)', job.jobId, timeoutMs);
    } catch (_) { done(); return; }
    // Force-kill if not exited by the timeout
    const killer = setTimeout(() => {
      if (!settled) {
        console.warn('[fusion-trainer] job %s did not exit after SIGTERM timeout, falling back to SIGKILL', job.jobId);
        try { child.kill('SIGKILL'); } catch (_) { /* noop */ }
        // Give the OS a little time to reclaim after SIGKILL
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
    // E26 fix: the info() subprocess had no timeout, so a hang left the Promise pending forever. Add a 15s timeout + SIGKILL.
    const killer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill('SIGKILL'); } catch (_) { /* already gone */ }
      console.warn('[fusion-trainer] info timed out after 15s, sent SIGKILL');
      resolve({ error: 'fusion-trainer info timed out' });
    }, 15000);
    killer.unref();
    child.stdout.on('data', (d) => { out = _appendCapped(out, d.toString()); });
    child.stderr.on('data', (d) => { out = _appendCapped(out, d.toString()); });
    child.on('error', () => {
      if (settled) return;
      settled = true;
      clearTimeout(killer);
      resolve({ error: 'fusion-trainer info spawn failed' });
    });
    child.on('exit', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(killer);
      if (code === 0) {
        resolve({ ok: true, output: out.trim() });
      } else {
        resolve({ error: 'fusion-trainer info exit code ' + code, output: out.trim() });
      }
    });
  });
}

module.exports = { startSft, getJobStatus, info, stopAllJobs, DEFAULT_BIN };
