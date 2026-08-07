// =============================================================================
// Fusion-Doc — 训练控制器
// 基于本文档知识库导出 SFT 数据集并调用 fusion-trainer 微调
// 路由: POST /api/training/sft, GET /api/training/:jobId/status, GET /api/training/info
// =============================================================================

const fs = require('fs');
const path = require('path');
const { json, notFound } = require('../utils/response');
const trainer = require('../integrations/fusion-trainer');

function _exportDataset(app, { bookId, pageIds }) {
  const { db } = app;
  let pages = [];
  if (db) {
    if (pageIds && pageIds.length) {
      const placeholders = pageIds.map(() => '?').join(',');
      pages = db.prepare(`SELECT * FROM pages WHERE id IN (${placeholders})`).all(...pageIds);
    } else if (bookId) {
      pages = db.prepare('SELECT * FROM pages WHERE book_id = ? ORDER BY sort_order').all(bookId);
    } else {
      return { error: '必须提供 bookId 或 pageIds' };
    }
  } else {
    const all = require('../db').listJSON('pages');
    if (pageIds && pageIds.length) pages = all.filter((p) => pageIds.includes(p.id));
    else if (bookId) pages = all.filter((p) => p.book_id === bookId);
    else return { error: '必须提供 bookId 或 pageIds' };
  }

  if (!pages.length) {
    return { error: '没有可导出的页面' };
  }

  const dataDir = app.config.dataDir;
  const trainDir = path.join(dataDir, 'training');
  fs.mkdirSync(trainDir, { recursive: true });
  const outFile = path.join(trainDir, `sft_${Date.now()}.jsonl`);
  let count = 0;
  const stream = fs.createWriteStream(outFile);
  for (const p of pages) {
    const title = p.title || '未命名';
    const content = p.markdown || p.content || '';
    if (!content.trim()) continue;
    const sample = {
      messages: [
        { role: 'system', content: '你是文档知识助手, 基于以下文档内容回答问题' },
        { role: 'user', content: title },
        { role: 'assistant', content },
      ],
    };
    stream.write(JSON.stringify(sample) + '\n');
    count++;
  }
  stream.end();
  console.log('[training] exported %d pages -> %s', count, outFile);
  return { dataset: outFile, count };
}

function register(app) {
  app.registerRoute('POST', '/api/training/sft', async (req, res) => {
    const { parseBody } = require('../middleware/body-parser');
    const body = await parseBody(req);
    const model = body.model;
    if (!model) {
      json(res, { error: 'model 必填' }, 400);
      return;
    }
    const exportResult = _exportDataset(app, { bookId: body.bookId, pageIds: body.pageIds });
    if (exportResult.error) {
      json(res, { error: exportResult.error }, 400);
      return;
    }
    try {
      const binPath = app.config.fusionTrainer && app.config.fusionTrainer.binPath;
      const result = trainer.startSft({
        dataset: exportResult.dataset,
        model,
        config: body.config,
        outputDir: body.outputDir,
        binPath,
      });
      json(res, { ...result, dataset: exportResult.dataset, count: exportResult.count });
    } catch (err) {
      console.error('[training] startSft failed:', err.message);
      json(res, { error: err.message }, 500);
    }
  });

  app.registerRoute('GET', '/api/training/info', (req, res) => {
    const binPath = app.config.fusionTrainer && app.config.fusionTrainer.binPath;
    trainer.info(binPath).then((infoResult) => json(res, infoResult));
  });

  app.registerRoute('GET', '/api/training/:jobId/status', (req, res) => {
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
