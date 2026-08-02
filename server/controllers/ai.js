// =============================================================================
// Fusion-Doc — AI 控制器（Fusion-MLX 深度集成）
// 支持聊天、嵌入、RAG、Streaming
// =============================================================================

const { parseBody } = require('../middleware/body-parser');
const { callFusionMLX, callFusionMLXStream } = require('../integrations/fusion-mlx');
const { json, error, notFound } = require('../utils/response');
const { uid } = require('../utils/helpers');

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
      try {
        const streamIter = callFusionMLXStream({
          model: body.model || app.config.fusionMlx.chatModel,
          messages: body.messages || [],
        });
        for await (const chunk of streamIter) {
          res.write(`data: ${JSON.stringify(chunk)}\n\n`);
        }
        res.write(`data: [DONE]\n\n`);
        res.end();
      } catch (e) {
        res.write(`data: ${JSON.stringify({ error: e.message })}\n\n`);
        res.end();
      }
    } else {
      // 非流式响应
      try {
        const data = await callFusionMLX({
          method: 'POST',
          path: '/v1/chat/completions',
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
        method: 'POST', path: '/v1/embeddings',
        body: { model: app.config.fusionMlx.embeddingModel, input: body.input || [] },
        config: app.config.fusionMlx,
      });
      json(res, data);
    } catch (e) {
      error(res, `Embedding failed: ${e.message}`, 500);
    }
  });

  // ── RAG 文档索引 ─────────────────────────────────────────────────────
  app.registerRoute('POST', '/api/rag/index', async (req, res) => {
    const body = await parseBody(req);
    const pageId = body.page_id;
    let page = db ? db.prepare('SELECT * FROM pages WHERE id = ?').get(pageId) : null;
    if (!page) return notFound(res, 'Page not found');

    const text = (page.title + '\n\n' + (page.markdown || page.content || '')).slice(0, 50000);
    try {
      // 分块处理
      const chunks = chunkText(text, 1000);
      const indexed = [];

      for (let i = 0; i < chunks.length; i++) {
        const data = await callFusionMLX({
          method: 'POST', path: '/v1/embeddings',
          body: { model: app.config.fusionMlx.embeddingModel, input: [chunks[i]] },
          config: app.config.fusionMlx,
        });
        const vector = JSON.stringify(data.data[0].embedding);
        if (db) {
          if (i === 0) {
            db.exec(`CREATE TABLE IF NOT EXISTS rag_index (id TEXT PRIMARY KEY, page_id TEXT, chunk_index INTEGER, chunk TEXT, vector TEXT, created_at TEXT)`);
          }
          db.prepare('INSERT INTO rag_index (id, page_id, chunk_index, chunk, vector, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(uid(), pageId, i, chunks[i], vector, new Date().toISOString());
        }
        indexed.push({ index: i, dimensions: data.data[0].embedding.length });
      }
      json(res, { indexed: true, chunks: indexed.length, dimensions: indexed[0]?.dimensions });
    } catch (e) {
      error(res, `Indexing failed: ${e.message}`, 500);
    }
  });

  // ── RAG 查询 ─────────────────────────────────────────────────────────
  app.registerRoute('POST', '/api/rag/query', async (req, res) => {
    const body = await parseBody(req);
    const question = body.question || '';
    if (!question) { json(res, { error: 'Question required' }, 400); return; }

    try {
      // 1. 生成查询嵌入
      const embData = await callFusionMLX({
        method: 'POST', path: '/v1/embeddings',
        body: { model: app.config.fusionMlx.embeddingModel, input: [question] },
        config: app.config.fusionMlx,
      });
      const queryVector = embData.data[0].embedding;

      // 2. 检索相似文档（带有 LIMIT 的分页向量搜索）
      let contexts = [];
      if (db) {
        const topK = Math.min(parseInt(body.top_k || '5', 10), 20);
        const allDocs = db.prepare('SELECT * FROM rag_index LIMIT 1000').all();
        // 简单余弦相似度计算
        const scored = allDocs.map(doc => ({
          ...doc,
          score: cosineSimilarity(queryVector, JSON.parse(doc.vector || '[]')),
        }));
        scored.sort((a, b) => b.score - a.score);
        contexts = scored.slice(0, topK).map(s => s.chunk);
      }

      // 3. 构建增强提示
      const contextStr = contexts.length > 0 ? `\n\n相关上下文:\n${contexts.join('\n---\n')}` : '';
      const messages = [
        { role: 'system', content: 'You are a document assistant. Answer based on the provided context.' + contextStr },
        { role: 'user', content: question },
      ];

      const data = await callFusionMLX({
        method: 'POST', path: '/v1/chat/completions',
        body: { model: body.model || app.config.fusionMlx.chatModel, messages, stream: false },
        config: app.config.fusionMlx,
      });
      json(res, { answer: data.choices?.[0]?.message?.content || '', sources: contexts });
    } catch (e) {
      error(res, `RAG query failed: ${e.message}`, 500);
    }
  });
}

// ── 文本分块 ──────────────────────────────────────────────────────────────
function chunkText(text, maxLen) {
  const chunks = [];
  const paragraphs = text.split(/\n\n+/);
  let current = '';
  for (const p of paragraphs) {
    if ((current + '\n\n' + p).length > maxLen && current) {
      chunks.push(current.trim());
      current = p;
    } else {
      current = current ? current + '\n\n' + p : p;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.length ? chunks : [text];
}

// ── 余弦相似度 ────────────────────────────────────────────────────────────
function cosineSimilarity(a, b) {
  if (!a.length || !b.length) return 0;
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * (b[i] || 0);
    magA += a[i] * a[i];
    magB += (b[i] || 0) * (b[i] || 0);
  }
  return dot / (Math.sqrt(magA) * Math.sqrt(magB) || 1);
}

module.exports = { register };