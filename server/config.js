// =============================================================================
// Fusion-Doc — 配置管理
// 统一配置入口，支持 .env、环境变量、默认值三级降级
// =============================================================================

const path = require('path');

// 加载 .env
try {
  const fs = require('fs');
  const envPath = path.join(__dirname, '..', '.env');
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const value = trimmed.slice(eqIdx + 1).trim();
      // 不覆盖已经设置的环境变量
      if (!process.env[key]) process.env[key] = value;
    }
  }
} catch (e) { /* .env 文件不存在，全部使用环境变量默认值 */ }

const config = {
  // 服务端口
  port: parseInt(process.env.FUSION_DOC_PORT || '11449', 10),

  // 数据目录
  dataDir: path.resolve(process.env.FUSION_DATA_DIR || path.join(__dirname, '..', 'data')),

  // 前端静态文件目录
  publicDir: path.resolve(process.env.FUSION_PUBLIC_DIR || path.join(__dirname, '..', 'gateway', 'public')),

  // Fusion-MLX 配置
  fusionMlx: {
    url: process.env.FUSION_MLX_URL || 'http://localhost:11434',
    apiKey: process.env.FUSION_MLX_API_KEY || '',
    chatModel: process.env.AI_CHAT_MODEL || 'Qwen3.5-9B-4bit',
    embeddingModel: process.env.AI_EMBEDDING_MODEL || 'bge-small-en-v1.5',
    rerankModel: process.env.AI_RERANK_MODEL || 'bge-reranker-v2-m3',
  },

  // 存储
  storage: {
    dir: process.env.STORAGE_DIR || path.join(__dirname, '..', 'data', 'storage'),
    maxUploadSize: parseInt(process.env.MAX_UPLOAD_SIZE || '104857600', 10), // 100MB
  },

  // CORS
  cors: {
    origins: process.env.CORS_ORIGINS
      ? process.env.CORS_ORIGINS.split(',').map(s => s.trim())
      : (process.env.NODE_ENV === 'production' ? [] : ['*']),
  },

  // 日志级别
  logLevel: process.env.LOG_LEVEL || 'info',

  // 认证
  auth: {
    jwtSecret: process.env.JWT_SECRET || (() => {
      const crypto = require('crypto');
      const generated = crypto.randomBytes(32).toString('hex');
      console.warn('  [⚠] JWT_SECRET 未设置，已自动生成随机密钥（服务重启后会话将失效）');
      return generated;
    })(),
    sessionExpiry: parseInt(process.env.SESSION_EXPIRY || '86400', 10), // 24h
  },

  // 插件目录
  pluginsDir: path.resolve(process.env.FUSION_PLUGINS_DIR || path.join(__dirname, 'plugins')),

  // 环境
  isDev: process.env.NODE_ENV !== 'production',
  isTest: process.env.NODE_ENV === 'test',
};

module.exports = config;