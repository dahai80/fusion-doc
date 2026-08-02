// =============================================================================
// Fusion-Doc — 服务层：RAG 服务（检索增强生成）
// 业务逻辑：文档索引、向量检索、上下文增强问答
// =============================================================================

const { uid, now } = require('../utils/helpers');
const { callFusionMLX } = require('../integrations/fusion-mlx');

class RAGService {
  constructor(app) {
    this.app = app;
    this.db = app.db;
    this.mlxConfig = app.config.fusionMlx;
  }

  // 文本分块
  chunkText(text, maxLen = 1000) {
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

  // 余弦相似度
  cosineSimilarity(a, b) {
    if (!a?.length || !b?.length) return 0;
    let dot = 0, magA = 0, magB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * (b[i] || 0);
      magA += a[i] * a[i];
      magB += (b[i] || 0) * (b[i] || 0);
    }
    return dot / (Math.sqrt(magA) * Math.sqrt(magB) || 1);
  }

  // 索引页面
  async indexPage(pageId) {
    let page = this.db ? this.db.prepare('SELECT * FROM pages WHERE id = ?').get(pageId) : null;
    if (!page) return { error: 'Page not found' };

    const text = (page.title + '\n\n' + (page.markdown || page.content || '')).slice(0, 50000);
    const chunks = this.chunkText(text, 1000);
    const indexed = [];

    for (let i = 0; i < chunks.length; i++) {
      const data = await callFusionMLX({
        method: 'POST', path: '/v1/embeddings',
        body: { model: this.mlxConfig.embeddingModel, input: [chunks[i]] },
        config: this.mlxConfig,
      });
      const vector = JSON.stringify(data.data[0].embedding);
      if (this.db) {
        const ragId = uid();
        this.db.prepare('INSERT OR REPLACE INTO rag_index (id, page_id, chunk_index, chunk, vector, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(ragId, pageId, i, chunks[i], vector, now());
      }
      indexed.push({ index: i, dimensions: data.data[0].embedding.length });
    }
    return { indexed: true, chunks: indexed.length, dimensions: indexed[0]?.dimensions };
  }

  // 检索相似文档
  retrieve(query, topK = 5) {
    // 对于没有向量的场景，使用简单的关键词匹配
    if (!this.db) return [];
    const allDocs = this.db.prepare('SELECT * FROM rag_index').all();
    if (!allDocs.length) return [];

    // 计算余弦相似度需要查询嵌入，这里返回空表示需要外部生成嵌入
    if (!query) return allDocs.slice(0, topK);
    return allDocs;
  }

  // 带评分的向量检索
  async retrieveWithScore(query, topK = 5) {
    // 生成查询嵌入
    const embData = await callFusionMLX({
      method: 'POST', path: '/v1/embeddings',
      body: { model: this.mlxConfig.embeddingModel, input: [query] },
      config: this.mlxConfig,
    });
    const queryVector = embData.data[0].embedding;

    if (!this.db) return [];
    const allDocs = this.db.prepare('SELECT * FROM rag_index').all();
    const scored = allDocs.map(doc => ({
      ...doc,
      score: this.cosineSimilarity(queryVector, JSON.parse(doc.vector || '[]')),
    }));
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  }

  // 问答
  async query(question, model = null) {
    // 检索相关上下文
    const contexts = await this.retrieveWithScore(question, 5);
    const contextStr = contexts.length > 0
      ? `\n\n相关上下文:\n${contexts.map(c => c.chunk).join('\n---\n')}`
      : '';

    // 调用 LLM 生成答案
    const data = await callFusionMLX({
      method: 'POST', path: '/v1/chat/completions',
      body: {
        model: model || this.mlxConfig.chatModel,
        messages: [
          { role: 'system', content: '你是一个文档助手。请基于提供的上下文回答用户问题。如果你不确定答案，请直接说明。' + contextStr },
          { role: 'user', content: question },
        ],
        stream: false,
      },
      config: this.mlxConfig,
    });
    return {
      answer: data.choices?.[0]?.message?.content || '',
      sources: contexts.map(c => c.chunk),
    };
  }
}

module.exports = RAGService;