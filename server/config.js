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

  // 绑定地址: 生产默认 127.0.0.1 (仅本机), 显式 0.0.0.0 才暴露 (商用须前置反代+TLS)
  host: process.env.FUSION_DOC_HOST || (process.env.NODE_ENV === 'production' ? '127.0.0.1' : '0.0.0.0'),

  // 数据目录
  dataDir: path.resolve(process.env.FUSION_DATA_DIR || path.join(__dirname, '..', 'data')),

  // 前端静态文件目录
  publicDir: path.resolve(process.env.FUSION_PUBLIC_DIR || path.join(__dirname, '..', 'gateway', 'public')),

  // Fusion-MLX 配置
  // 端口约定: 经 fusion-gateway 11432 调用 MLX (统一组网方案B; env 可覆盖回直连 11434)
  fusionMlx: {
    url: process.env.FUSION_MLX_URL || 'http://127.0.0.1:11432',
    apiKey: process.env.FUSION_MLX_API_KEY || '',
    chatModel: process.env.AI_CHAT_MODEL || 'Qwen3.5-9B-4bit',
    embeddingModel: process.env.AI_EMBEDDING_MODEL || 'bge-small-en-v1.5',
    rerankModel: process.env.AI_RERANK_MODEL || 'bge-reranker-v2-m3',
  },

  // Fusion-Trainer 微调
  // 子进程调用共享 .venv 的 fusion-trainer CLI。
  // E13 修复: 默认路径不写机器相关绝对路径, 改为相对仓库根解析 + PATH 兜底。
  // 优先级: env FUSION_TRAINER_BIN > <repo>/.venv/bin/fusion-trainer > PATH 中的 fusion-trainer
  fusionTrainer: {
    binPath: (function resolveTrainerBin() {
      if (process.env.FUSION_TRAINER_BIN) return process.env.FUSION_TRAINER_BIN;
      const repoVenv = path.join(__dirname, '..', '..', '.venv', 'bin', 'fusion-trainer');
      try {
        const fs = require('fs');
        if (fs.existsSync(repoVenv)) return repoVenv;
      } catch (_) { /* ignore, fall through to PATH */ }
      return 'fusion-trainer'; // 依赖 PATH 解析; 不存在时 trainer.info() 会以可见错误回显
    })(),
  },

  // Fusion-KB 知识库
  fusionKb: {
    url: process.env.FUSION_KB_URL || 'http://localhost:11436',
  },

  // Fusion-Cowork 协作引擎
  fusionCowork: {
    url: process.env.FUSION_COWORK_URL || 'http://localhost:11437',
  },

  // Fusion-Model-Hub 模型管理
  fusionModelHub: {
    url: process.env.FUSION_MODEL_HUB_URL || 'http://localhost:11444',
  },

  // Fusion-Studio JSON-RPC
  fusionStudio: {
    socketPath: process.env.FUSION_STUDIO_SOCKET || path.join(require('os').homedir(), '.fusion', 'studio.sock'),
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
    // 生产环境强制要求 JWT_SECRET (env 注入), 缺失则启动 fail-fast
    // 开发/测试环境可自动生成随机密钥 (重启失效, 仅本机使用)
    jwtSecret: process.env.JWT_SECRET || (() => {
      if (process.env.NODE_ENV === 'production') {
        console.error('  [✗] JWT_SECRET 未设置: 生产环境禁止自动生成随机密钥 (会话将随重启失效, 且无法跨实例共享)');
        console.error('      请在部署 env 注入 JWT_SECRET (建议 >=32 字节随机串, 例: openssl rand -hex 32)');
        process.exit(1);
      }
      const crypto = require('crypto');
      const generated = crypto.randomBytes(32).toString('hex');
      console.warn('  [⚠] JWT_SECRET 未设置，已自动生成随机密钥（仅开发环境, 服务重启后会话将失效）');
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

// §2.2: FUSION_MLX_API_KEY 未设置时启动 WARN, 调用时 fail visibly (禁止字面量/静默放行)
if (!config.fusionMlx.apiKey && !config.isTest) {
  console.warn('  [⚠] FUSION_MLX_API_KEY 未设置, MLX 调用将被拒绝 (请于部署 env 注入, 禁止字面量)');
}

module.exports = config;