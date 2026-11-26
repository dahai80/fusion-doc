// =============================================================================
// Fusion-Doc — training controller
// Exports an SFT dataset from this document knowledge base and calls fusion-trainer to fine-tune
// Routes: POST /api/training/sft, GET /api/training/:jobId/status, GET /api/training/info
// =============================================================================

const fs = require('fs');
const path = require('path');
const { json, notFound, error } = require('../utils/response');
const { parseBody } = require('../middleware/body-parser');
const { requireAdmin } = require('../middleware/require-admin');
const trainer = require('../integrations/fusion-trainer');

const MAX_OUTPUT_DIR_LEN = 512;
// A13 fix: dataset export had no page cap → exporting a huge book produced an oversized .jsonl filling the disk + a full SELECT * loaded into memory.
// Cap pages per export, truncate the excess and report it back, so a single request cannot exhaust resources.
const MAX_EXPORT_PAGES = parseInt(process.env.TRAINING_EXPORT_MAX_PAGES || '5000', 10);

function _exportDataset(app, { bookId, pageIds }) {
  const { db } = app;
  let pages = [];
  if (db) {
    if (pageIds && pageIds.length) {
      const placeholders = pageIds.map(() => '?').join(',');
      pages = db.prepare(`SELECT * FROM pages WHERE id IN (${placeholders})`).all(...pageIds);
    } else if (bookId) {
      pages = db.prepare('SELECT * FROM pages WHERE book_id = ? ORDER BY sort_order LIMIT ?').all(bookId, MAX_EXPORT_PAGES);
    } else {
      return { error: 'bookId or pageIds is required' };
    }
  } else {
    const all = require('../db').listJSON('pages');
    if (pageIds && pageIds.length) pages = all.filter((p) => pageIds.includes(p.id));
    else if (bookId) pages = all.filter((p) => p.book_id === bookId);
    else return { error: 'bookId or pageIds is required' };
  }

  if (!pages.length) {
    return { error: 'No pages to export' };
  }

  // A13: truncate excess pages and report back (no truncation when pageIds is explicit; trust the admin's explicit list)
  let dropped = 0;
  if (!pageIds && pages.length > MAX_EXPORT_PAGES) {
    dropped = pages.length - MAX_EXPORT_PAGES;
    pages = pages.slice(0, MAX_EXPORT_PAGES);
    console.warn(`[training] export truncated: only the first ${MAX_EXPORT_PAGES}/${MAX_EXPORT_PAGES + dropped} pages taken (adjustable via env TRAINING_EXPORT_MAX_PAGES)`);
  }

  const dataDir = app.config.dataDir;
  const trainDir = path.join(dataDir, 'training');
  fs.mkdirSync(trainDir, { recursive: true });
  const outFile = path.join(trainDir, `sft_${Date.now()}.jsonl`);
  let count = 0;
  const stream = fs.createWriteStream(outFile);
  for (const p of pages) {
    const title = p.title || '未命名'; // i18n: user-facing
    const content = p.markdown || p.content || '';
    if (!content.trim()) continue;
    const sample = {
      messages: [
        { role: 'system', content: '你是文档知识助手, 基于以下文档内容回答问题' }, // i18n: user-facing
        { role: 'user', content: title },
        { role: 'assistant', content },
      ],
    };
    stream.write(JSON.stringify(sample) + '\n');
    count++;
  }
  stream.end();
  console.log('[training] exported %d pages -> %s (dropped %d)', count, outFile, dropped);
  return { dataset: outFile, count, dropped };
}

function register(app) {
  // ── SFT training: admin gate + output directory validation (P2-24) ───────
  app.registerRoute('POST', '/api/training/sft', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const body = await parseBody(req);
    const model = body.model;
    if (!model || typeof model !== 'string') {
      json(res, { error: 'model is required' }, 400);
      return;
    }
    const exportResult = _exportDataset(app, { bookId: body.bookId, pageIds: body.pageIds });
    if (exportResult.error) {
      json(res, { error: exportResult.error }, 400);
      return;
    }
    try {
      const binPath = app.config.fusionTrainer && app.config.fusionTrainer.binPath;
      // Output directory: only relative paths or dirs within config allowed, prevents arbitrary disk writes
      let outputDir = undefined;
      if (typeof body.outputDir === 'string' && body.outputDir.length > 0 && body.outputDir.length <= MAX_OUTPUT_DIR_LEN) {
        // Reject parent directory traversal
        if (body.outputDir.includes('..')) {
          json(res, { error: 'outputDir must not contain ..' }, 400);
          return;
        }
        outputDir = body.outputDir;
      }
      const result = trainer.startSft({
        dataset: exportResult.dataset,
        model,
        config: body.config,
        outputDir,
        binPath,
      });
      json(res, { ...result, dataset: exportResult.dataset, count: exportResult.count });
    } catch (err) {
      console.error('[training] startSft failed:', err.message);
      // R21 fix: go through error() for uniform 5xx masking; production does not echo err.message (contains bin path/command fragments)
      error(res, 'Failed to start training job', 500);
    }
  });

  // ── Training info: admin gate (P2-24, exposes bin path/environment) ─────
  app.registerRoute('GET', '/api/training/info', (req, res) => {
    if (!requireAdmin(req, res)) return;
    const binPath = app.config.fusionTrainer && app.config.fusionTrainer.binPath;
    trainer.info(binPath).then((infoResult) => json(res, infoResult)).catch((e) => {
      console.error('[training] info failed:', e.message);
      // R21 fix: go through error() for uniform 5xx masking; production does not echo e.message
      error(res, 'Failed to get training info', 500);
    });
  });

  app.registerRoute('GET', '/api/training/:jobId/status', (req, res) => {
    // R14 fix: exposes stdout/stderr with dataset paths/model IDs; admin gate like info to prevent IDOR reading others' logs.
    if (!requireAdmin(req, res)) return;
    const { jobId } = req.params;
    const status = trainer.getJobStatus(jobId);
    if (!status) {
      notFound(res, 'job not found: ' + jobId);
      return;
    }
    json(res, status);
  });
}

module.exports = { register };
