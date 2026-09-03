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

  // Fusion-Identity (issue #45) — 唯一 JWT 签发方 + 租户注册中心
  // fusion-doc 消费 verify (不自签); 缺 serviceToken 且非 local-auth 模式 → 启动 fail-fast (fail-closed)
  fusionIdentity: {
    url: process.env.FUSION_IDENTITY_URL || 'http://127.0.0.1:11470',
    serviceToken: process.env.FUSION_IDENTITY_SERVICE_TOKEN || '',
  },

  // 本地认证旁路 (仅单用户开发; 默认关 = fail-closed, 无默认租户降级)
  // 开启后保留原 JWT 签发 + users 表; 生产禁止开启
  localAuth: process.env.FUSION_DOC_LOCAL_AUTH === '1',

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

  // TLS (内置 HTTPS, 解裸暴露; Node 原生 tls, 零新依赖)
  // 任一证书路径配置即启用 HTTPS; 两者须同时提供。商用建议真实证书 (letsencrypt/自签 CA)。
  // 缺其一或文件不存在 → 启动 fail visibly (不静默降级回 HTTP 暴露明文)。
  tls: {
    certPath: process.env.FUSION_DOC_TLS_CERT || '',
    keyPath: process.env.FUSION_DOC_TLS_KEY || '',
    caPath: process.env.FUSION_DOC_TLS_CA || '',   // 可选: 客户端证书 CA (mTLS)
    redirectHttp: process.env.FUSION_DOC_TLS_REDIRECT !== '0', // HTTP→HTTPS 跳转 (默认开)
  },

  // 插件目录
  pluginsDir: path.resolve(process.env.FUSION_PLUGINS_DIR || path.join(__dirname, 'plugins')),

  // 环境
  isDev: process.env.NODE_ENV !== 'production',
  isTest: process.env.NODE_ENV === 'test',
};

// §2.2: FUSION_MLX_API_KEY 未设置时启动告警, 调用时 fail visibly (禁止字面量/静默放行)
// O9 修复: 生产环境升级为 error 级日志 + 标 mlxKeyMissing, /api/health 读绪探针报 degraded (非假阳性)。
// 不 fail-fast 退出: AI 为可选特性, 缺密钥不应阻断 boot (与强制 JWT_SECRET 不同)。
if (!config.fusionMlx.apiKey && !config.isTest) {
  config.fusionMlx.mlxKeyMissing = true;
  const log = process.env.NODE_ENV === 'production' ? console.error : console.warn;
  log(process.env.NODE_ENV === 'production'
    ? '  [✗] FUSION_MLX_API_KEY 未设置 (生产): AI 特性不可用, /api/health 将报 degraded。请于部署 env 注入 (禁止字面量)'
    : '  [⚠] FUSION_MLX_API_KEY 未设置, MLX 调用将被拒绝 (请于部署 env 注入, 禁止字面量)');
}

// issue #45: 非本地认证模式缺 identity serviceToken → 生产环境 fail-closed 启动拒绝
// (identity 为唯一 JWT 签发方, 缺凭证则无法校验任何 token, 全站 401)
// 与 JWT_SECRET 同级: 仅生产强制; 开发/测试仅告警 (可用 FUSION_DOC_LOCAL_AUTH=1 走旁路)
if (!config.localAuth && !config.fusionIdentity.serviceToken) {
  if (process.env.NODE_ENV === 'production') {
    console.error('  [✗] FUSION_IDENTITY_SERVICE_TOKEN 未设置: 非本地认证模式无法校验 token (fail-closed)');
    console.error('      请于部署 env 注入, 或设置 FUSION_DOC_LOCAL_AUTH=1 启用单用户开发旁路');
    process.exit(1);
  } else {
    console.warn('  [⚠] FUSION_IDENTITY_SERVICE_TOKEN 未设置 (开发): token 校验将 fail-closed, 建议设 FUSION_DOC_LOCAL_AUTH=1 走本地旁路');
  }
}

module.exports = config;