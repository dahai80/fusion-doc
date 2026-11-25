// =============================================================================
// Fusion-Doc — AI 控制器（Fusion-MLX 深度集成）
// 支持聊天、嵌入、RAG、Streaming
// 商用级: SSE 客户端断开中止上游流, RAG 检索限量防 OOM
// =============================================================================
/* global AbortController */

const { parseBody } = require('../middleware/body-parser');
const { callFusionMLX, callFusionMLXStream } = require('../integrations/fusion-mlx');
const { askKb } = require('../integrations/fusion-kb');
const { json, error, notFound } = require('../utils/response');
// A8 修复: RAG 统一到 rag-hybrid 单存储 (rag_chunks), 不再内联写 rag_index 表。
// issue #84: in-document QA 检索改走 fusion-rag (单一知识层); rag-hybrid 仅剩
// 工作流 rag.search 步骤与非 UI API (/api/rag/*) 使用。
const ragHybrid = require('../services/rag-hybrid');
// S3 修复: 索引重建为重操作 (全页 embedding 调用), 仅 admin 可触发, 杜绝普通用户消耗算力
const { requireAdmin } = require('../middleware/require-admin');
// issue #45: AI token 用量上报 fusion-identity (fire-and-forget, 永不阻塞响应)
const identity = require('../integrations/fusion-identity');

// issue #45: 归一化 mlx usage → identity 上报体。mlx 返回 {prompt_tokens,completion_tokens,total_tokens}
function _normalizeUsage(u) {
  if (!u || typeof u !== 'object') return null;
  const tokens = Number(u.total_tokens) || 0;
  if (!tokens) return null;
  return { tokens, prompt_tokens: Number(u.prompt_tokens) || 0, completion_tokens: Number(u.completion_tokens) || 0 };
}

// fire-and-forget 上报 (tid 缺失静默跳过, local-auth 旁路不上报)
function _reportUsage(req, app, usage) {
  const tid = req.user?.tid;
  if (!tid || tid === 'local-tenant') return;
  const norm = _normalizeUsage(usage);
  if (!norm) return;
  identity.reportUsage({ tid, usage: norm, config: app.config.fusionIdentity }).catch(() => {});
}

// issue #84: 可见页过滤随内嵌 RAG QA 一起退役 — 检索权限由 fusion-rag KB ACL 承担。
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
      let lastUsage = null;
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
          if (chunk?.usage) lastUsage = chunk.usage;
          res.write('data: ' + JSON.stringify(chunk) + '\n\n');
        }
        if (!aborted) res.write('data: [DONE]\n\n');
        res.end();
        _reportUsage(req, app, lastUsage);
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
        _reportUsage(req, app, data?.usage);
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
      _reportUsage(req, app, data?.usage);
      json(res, data);
    } catch (e) {
      error(res, `Embedding failed: ${e.message}`, 500);
    }
  });

  // ── RAG 文档索引 (A8 修复: 委托 rag-hybrid 统一存储 rag_chunks, 不再写 rag_index) ──
  app.registerRoute('POST', '/api/rag/index', async (req, res) => {
    // S3 修复: 索引重建调 embedding 算力大, 仅 admin 可触发
    if (!requireAdmin(req, res)) return;
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

  // ── RAG 查询 (issue #84: 单一知识层 — QA 检索/作答委托 fusion-rag kb_ask) ──
  // 原 A8 实现在内嵌 rag_chunks 上检索 + 自行调 MLX 生成, 与 fusion-rag 重复。
  // 现直接调 /kb/bases/{kbId}/ask, 答案由 fusion-rag 生成 (可经其请求日志/指标验证)。
  app.registerRoute('POST', '/api/rag/query', async (req, res) => {
    const body = await parseBody(req);
    const question = (typeof body.question === 'string' ? body.question : '').slice(0, MAX_QUERY_LEN);
    if (!question) { json(res, { error: 'Question required' }, 400); return; }

    const kb = app.config.fusionKb;
    if (!kb.kbId) {
      console.warn('[AI] RAG query rejected: FUSION_RAG_KB_ID not configured');
      return error(res, 'in-document QA requires fusion-rag: set FUSION_RAG_KB_ID (and FUSION_RAG_API_KEY if auth is enabled) to the knowledge base that indexes this workspace', 503);
    }

    try {
      const topK = Math.min(parseInt(body.top_k || '5', 10), 20);
      const data = await askKb(kb, { kbId: kb.kbId, question, topK });
      // client renders sources via String(s) — normalize citations to readable strings
      const rawSources = Array.isArray(data.sources) && data.sources.length
          ? data.sources
          : (Array.isArray(data.citations) ? data.citations : []);
      const sources = rawSources.map((s) => {
        if (typeof s === 'string') return s;
        const name = s.doc_name || s.document_name || s.source || s.doc_id || 'chunk';
        const text = s.text || s.content || s.snippet || '';
        return text ? `${name}: ${String(text).slice(0, 160)}` : String(name);
      });
      json(res, { answer: data.answer || '', sources });
    } catch (e) {
      error(res, `RAG query failed: ${e.message}`, e.status || 502);
    }
  });
}

module.exports = { register };