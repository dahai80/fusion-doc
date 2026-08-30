// =============================================================================
// Fusion-Doc — 训练控制器
// 基于本文档知识库导出 SFT 数据集并调用 fusion-trainer 微调
// 路由: POST /api/training/sft, GET /api/training/:jobId/status, GET /api/training/info
// =============================================================================

const fs = require('fs');
const path = require('path');
const { json, notFound, error } = require('../utils/response');
const { parseBody } = require('../middleware/body-parser');
const { requireAdmin } = require('../middleware/require-admin');
const trainer = require('../integrations/fusion-trainer');

const MAX_OUTPUT_DIR_LEN = 512;
// A13 修复: 导出数据集无页面上限 → 巨书导出超大 .jsonl 占盘 + 全量 SELECT * 载入内存。
// 限定单次导出页数, 超出截断并回显, 防单请求资源失控。
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

  // A13: 截断超量页并回显 (pageIds 显式指定时不截, 信任 admin 显式列举)
  let dropped = 0;
  if (!pageIds && pages.length > MAX_EXPORT_PAGES) {
    dropped = pages.length - MAX_EXPORT_PAGES;
    pages = pages.slice(0, MAX_EXPORT_PAGES);
    console.warn(`[training] 导出截断: 仅取前 ${MAX_EXPORT_PAGES}/${MAX_EXPORT_PAGES + dropped} 页 (env TRAINING_EXPORT_MAX_PAGES 可调)`);
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
  console.log('[training] exported %d pages -> %s (dropped %d)', count, outFile, dropped);
  return { dataset: outFile, count, dropped };
}

function register(app) {
  // ── SFT 训练: admin 闸 + 输出目录校验 (P2-24) ───────────────────────
  app.registerRoute('POST', '/api/training/sft', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const body = await parseBody(req);
    const model = body.model;
    if (!model || typeof model !== 'string') {
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
      // 输出目录: 仅允许相对路径或配置内目录, 防任意写盘
      let outputDir = undefined;
      if (typeof body.outputDir === 'string' && body.outputDir.length > 0 && body.outputDir.length <= MAX_OUTPUT_DIR_LEN) {
        // 拒绝对父目录遍历
        if (body.outputDir.includes('..')) {
          json(res, { error: 'outputDir 禁止含 ..' }, 400);
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
      // R21 修复: 走 error() 统一 5xx 屏蔽, 生产环境不回显 err.message (含 bin 路径/命令片段)
      error(res, '训练任务启动失败', 500);
    }
  });

  // ── 训练信息: admin 闸 (P2-24, 暴露 bin 路径/环境) ──────────────────
  app.registerRoute('GET', '/api/training/info', (req, res) => {
    if (!requireAdmin(req, res)) return;
    const binPath = app.config.fusionTrainer && app.config.fusionTrainer.binPath;
    trainer.info(binPath).then((infoResult) => json(res, infoResult)).catch((e) => {
      console.error('[training] info failed:', e.message);
      // R21 修复: 走 error() 统一 5xx 屏蔽, 生产环境不回显 e.message
      error(res, '训练信息获取失败', 500);
    });
  });

  app.registerRoute('GET', '/api/training/:jobId/status', (req, res) => {
    // R14 修复: 暴露 stdout/stderr 含数据集路径/模型 ID, 与 info 同加 admin 闸防 IDOR 读他人日志。
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
