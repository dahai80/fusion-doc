// =============================================================================
// Fusion-Doc — AI 控制器（Fusion-MLX 深度集成）
// 支持聊天、嵌入、RAG、Streaming
// 商用级: SSE 客户端断开中止上游流, RAG 检索限量防 OOM
// =============================================================================
/* global AbortController */

const { parseBody } = require('../middleware/body-parser');
const { callFusionMLX, callFusionMLXStream } = require('../integrations/fusion-mlx');
const { json, error, notFound } = require('../utils/response');
// A8 修复: RAG 统一到 rag-hybrid 单存储 (rag_chunks), 不再内联写 rag_index 表。
const ragHybrid = require('../services/rag-hybrid');

const MAX_QUERY_LEN = 2000;

function register(app) {
  const { db } = app;

  // ── AI 聊天 ──────────────────────────────────────────────────────────
  app.registerRoute('POST', '/api/ai/chat', async (req, res) => {
    const body = await parseBody(req);
    const stream = body.stream === true;

    if (stream) {
      // SSE 流式响应
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });
      // 客户端断开时中止上游流, 防 KV/连接泄漏 (P2-22 + R7 修复: 真正 abort 上游)
      // E23 修复: 监听 res close (流式响应客户端断开优先触发 res close), 与 ai-copilot.js 统一
      let aborted = false;
      const abortController = new AbortController();
      const onClose = () => { aborted = true; abortController.abort(); };
      res.on('close', onClose);
      try {
        const streamIter = callFusionMLXStream({
          model: body.model || app.config.fusionMlx.chatModel,
          messages: body.messages || [],
          abortSignal: abortController.signal,
        });
        for await (const chunk of streamIter) {
          if (aborted) break;
          res.write('data: ' + JSON.stringify(chunk) + '\n\n');
        }
        if (!aborted) res.write('data: [DONE]\n\n');
        res.end();
      } catch (e) {
        if (!aborted) {
          res.write('data: ' + JSON.stringify({ error: e.message }) + '\n\n');
        }
        res.end();
      } finally {
        res.off('close', onClose);
      }
    } else {
      // 非流式响应
      try {
        const data = await callFusionMLX({
          method: 'POST',
          path: '/chat/completions',
          body: { model: body.model || app.config.fusionMlx.chatModel, messages: body.messages || [], stream: false },
          config: app.config.fusionMlx,
        });
        json(res, { choices: [{ message: { content: data.choices?.[0]?.message?.content || '' } }] });
      } catch (e) {
        error(res, `AI chat failed: ${e.message}`, 500);
      }
    }
  });

  // ── AI 嵌入 ──────────────────────────────────────────────────────────
  app.registerRoute('POST', '/api/ai/embeddings', async (req, res) => {
    const body = await parseBody(req);
    try {
      const data = await callFusionMLX({
        method: 'POST', path: '/embeddings',
        body: { model: app.config.fusionMlx.embeddingModel, input: body.input || [] },
        config: app.config.fusionMlx,
      });
      json(res, data);
    } catch (e) {
      error(res, `Embedding failed: ${e.message}`, 500);
    }
  });

  // ── RAG 文档索引 (A8 修复: 委托 rag-hybrid 统一存储 rag_chunks, 不再写 rag_index) ──
  app.registerRoute('POST', '/api/rag/index', async (req, res) => {
    const body = await parseBody(req);
    const pageId = body.page_id;
    let page = db ? db.prepare('SELECT * FROM pages WHERE id = ?').get(pageId) : null;
    if (!page) return notFound(res, 'Page not found');

    try {
      // 统一走 rag-hybrid.reindexPage: 段落切分 + embedding + 事务原子写 rag_chunks 单表
      const result = await ragHybrid.reindexPage(app, pageId);
      json(res, { indexed: true, chunks: result.chunks });
    } catch (e) {
      error(res, `Indexing failed: ${e.message}`, 500);
    }
  });

  // ── RAG 查询 (A8 修复: 委托 rag-hybrid.hybridSearch 统一检索, 向量+FTS+BM25 融合) ──
  app.registerRoute('POST', '/api/rag/query', async (req, res) => {
    const body = await parseBody(req);
    const question = (typeof body.question === 'string' ? body.question : '').slice(0, MAX_QUERY_LEN);
    if (!question) { json(res, { error: 'Question required' }, 400); return; }

    try {
      // 1. 混合检索 (向量 0.5 + FTS5 0.3 + BM25 0.2 + 可选 rerank), 单存储 rag_chunks
      const topK = Math.min(parseInt(body.top_k || '5', 10), 20);
      const results = await ragHybrid.hybridSearch(app, question, topK);
      const contexts = results.map(r => r.chunk_text);

      // 2. 构建增强提示
      const contextStr = contexts.length > 0 ? `\n\n相关上下文:\n${contexts.join('\n---\n')}` : '';
      const messages = [
        { role: 'system', content: 'You are a document assistant. Answer based on the provided context.' + contextStr },
        { role: 'user', content: question },
      ];

      const data = await callFusionMLX({
        method: 'POST', path: '/chat/completions',
        body: { model: body.model || app.config.fusionMlx.chatModel, messages, stream: false },
        config: app.config.fusionMlx,
      });
      json(res, { answer: data.choices?.[0]?.message?.content || '', sources: contexts });
    } catch (e) {
      error(res, `RAG query failed: ${e.message}`, 500);
    }
  });
}

module.exports = { register };