// =============================================================================
// Fusion-Doc — configuration management
// Unified config entry point: .env, environment variables, then defaults (three-level fallback)
// =============================================================================

const path = require('path');

// Load .env
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
      // Do not override environment variables that are already set
      if (!process.env[key]) process.env[key] = value;
    }
  }
} catch (e) { /* No .env file; use environment variables / defaults throughout */ }

const config = {
  // Server port
  port: parseInt(process.env.FUSION_DOC_PORT || '11449', 10),

  // Bind address: production defaults to 127.0.0.1 (local only); only an explicit 0.0.0.0 exposes it (commercial deployments need a reverse proxy + TLS in front)
  host: process.env.FUSION_DOC_HOST || (process.env.NODE_ENV === 'production' ? '127.0.0.1' : '0.0.0.0'),

  // Data directory
  dataDir: path.resolve(process.env.FUSION_DATA_DIR || path.join(__dirname, '..', 'data')),

  // Frontend static files directory
  publicDir: path.resolve(process.env.FUSION_PUBLIC_DIR || path.join(__dirname, '..', 'gateway', 'public')),

  // Fusion-MLX config
  // Port convention: call MLX via fusion-gateway 11432 (unified networking plan B; env can override back to direct 11434)
  fusionMlx: {
    url: process.env.FUSION_MLX_URL || 'http://127.0.0.1:11432',
    apiKey: process.env.FUSION_CLIENT_KEY || '',
    chatModel: process.env.AI_CHAT_MODEL || 'Qwen3.5-9B-4bit',
    embeddingModel: process.env.AI_EMBEDDING_MODEL || 'bge-small-en-v1.5',
    rerankModel: process.env.AI_RERANK_MODEL || 'bge-reranker-v2-m3',
  },

  // Fusion-Trainer fine-tuning
  // Invokes the fusion-trainer CLI from the shared .venv as a subprocess.
  // E13 fix: the default path no longer hardcodes a machine-specific absolute path; resolve relative to the repo root with PATH as fallback.
  // Precedence: env FUSION_TRAINER_BIN > <repo>/.venv/bin/fusion-trainer > fusion-trainer on PATH
  fusionTrainer: {
    binPath: (function resolveTrainerBin() {
      if (process.env.FUSION_TRAINER_BIN) return process.env.FUSION_TRAINER_BIN;
      const repoVenv = path.join(__dirname, '..', '..', '.venv', 'bin', 'fusion-trainer');
      try {
        const fs = require('fs');
        if (fs.existsSync(repoVenv)) return repoVenv;
      } catch (_) { /* ignore, fall through to PATH */ }
      return 'fusion-trainer'; // Relies on PATH resolution; if missing, trainer.info() reports a visible error
    })(),
  },

  // Fusion-KB knowledge base (fusion-rag, single knowledge layer — issue #84)
  fusionKb: {
    url: process.env.FUSION_KB_URL || 'http://localhost:11436',
    // in-document QA delegates retrieval+answer to this KB (kb_ask equivalent)
    kbId: process.env.FUSION_RAG_KB_ID || '',
    apiKey: process.env.FUSION_RAG_API_KEY || '',
  },

  // Fusion-Cowork collaboration engine
  fusionCowork: {
    url: process.env.FUSION_COWORK_URL || 'http://localhost:11437',
  },

  // Fusion-Model-Hub model management
  fusionModelHub: {
    url: process.env.FUSION_MODEL_HUB_URL || 'http://localhost:11444',
  },

  // Fusion-Office office-api document service (issue #82, port 11492)
  fusionOfficeApi: {
    url: process.env.FUSION_OFFICE_API_URL || 'http://127.0.0.1:11492',
  },

  // Fusion-Identity (issue #45) — sole JWT issuer + tenant registry
  // fusion-doc only consumes verify (never self-signs); missing serviceToken outside local-auth mode → fail-fast at startup (fail-closed)
  fusionIdentity: {
    url: process.env.FUSION_IDENTITY_URL || 'http://127.0.0.1:11470',
    serviceToken: process.env.FUSION_IDENTITY_SERVICE_TOKEN || '',
  },

  // Local auth bypass (single-user development only; off by default = fail-closed, no default-tenant fallback)
  // When enabled, keeps the legacy JWT issuing + users table; must not be enabled in production
  localAuth: process.env.FUSION_DOC_LOCAL_AUTH === '1',

  // Union Web shell registration (issue #51, PRD R-6)
  // POSTs the manifest to fusion-gateway at startup; the gateway proxies and injects at /shell/fusion-doc/
  // apiKey serves as the service credential (caller session is not passed through; stripped at the gateway).
  // adminKey missing → skip registration (fail-visible warning, does not block startup).
  shellGateway: {
    url: process.env.FUSION_GATEWAY_URL || 'http://127.0.0.1:11432',
    adminKey: process.env.FUSION_ADMIN_KEY || '',
    // Module service credential: injected upstream by the gateway proxy; auto-generated and persisted to data/shell-api-key.json when missing
    apiKey: process.env.FUSION_DOC_SHELL_API_KEY || '',
    // Tenant/role bound to the service credential (shell session principal; admin endpoints still reject non-tenant_admin)
    tenant: process.env.FUSION_DOC_SHELL_TENANT || 'shell',
    role: process.env.FUSION_DOC_SHELL_ROLE || 'operator',
    heartbeatInterval: parseInt(process.env.FUSION_DOC_SHELL_HEARTBEAT_MS || '30000', 10),
  },

  // Fusion-Studio JSON-RPC
  fusionStudio: {
    socketPath: process.env.FUSION_STUDIO_SOCKET || path.join(require('os').homedir(), '.fusion', 'studio.sock'),
  },

  // Storage
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

  // Log level
  logLevel: process.env.LOG_LEVEL || 'info',

  // Authentication
  auth: {
    // Production requires JWT_SECRET (injected via env); fail-fast at startup if missing
    // Dev/test may auto-generate a random secret (invalidated on restart, local use only)
    jwtSecret: process.env.JWT_SECRET || (() => {
      if (process.env.NODE_ENV === 'production') {
        console.error('  [✗] JWT_SECRET is not set: auto-generating a random secret is not allowed in production (sessions would be lost on restart and could not be shared across instances)');
        console.error('      Inject JWT_SECRET via the deployment env (recommended: >=32 random bytes, e.g. openssl rand -hex 32)');
        process.exit(1);
      }
      const crypto = require('crypto');
      const generated = crypto.randomBytes(32).toString('hex');
      console.warn('  [⚠] JWT_SECRET is not set; generated a random secret (development only, sessions will be lost when the server restarts)');
      return generated;
    })(),
    sessionExpiry: parseInt(process.env.SESSION_EXPIRY || '86400', 10), // 24h
  },

  // TLS (built-in HTTPS to avoid bare exposure; native Node tls, zero new dependencies)
  // Configuring either cert path enables HTTPS; both must be provided. Use real certificates for commercial deployments (letsencrypt / self-signed CA).
  // Missing either one or a missing file → fail visibly at startup (no silent fallback to plaintext HTTP).
  tls: {
    certPath: process.env.FUSION_DOC_TLS_CERT || '',
    keyPath: process.env.FUSION_DOC_TLS_KEY || '',
    caPath: process.env.FUSION_DOC_TLS_CA || '',   // Optional: client certificate CA (mTLS)
    redirectHttp: process.env.FUSION_DOC_TLS_REDIRECT !== '0', // HTTP→HTTPS redirect (on by default)
  },

  // Plugins directory
  pluginsDir: path.resolve(process.env.FUSION_PLUGINS_DIR || path.join(__dirname, 'plugins')),

  // Environment
  isDev: process.env.NODE_ENV !== 'production',
  isTest: process.env.NODE_ENV === 'test',
};

// §2.2: warn at startup when FUSION_CLIENT_KEY is not set; fail visibly on call (no literal keys / silent pass-through)
// O9 fix: in production, escalate to error-level log + set mlxKeyMissing so the /api/health readiness probe reports degraded (no false positive).
// No fail-fast exit: AI is optional, a missing key should not block boot (unlike the mandatory JWT_SECRET).
if (!config.fusionMlx.apiKey && !config.isTest) {
  config.fusionMlx.mlxKeyMissing = true;
  const log = process.env.NODE_ENV === 'production' ? console.error : console.warn;
  log(process.env.NODE_ENV === 'production'
    ? '  [✗] FUSION_CLIENT_KEY is not set (production): AI features unavailable, /api/health will report degraded. Inject it via the deployment env (no literal keys)'
    : '  [⚠] FUSION_CLIENT_KEY is not set; MLX calls will be rejected (inject it via the deployment env, no literal keys)');
}

// issue #45: missing identity serviceToken outside local-auth mode → production refuses to start (fail-closed)
// (identity is the sole JWT issuer; without the credential no token can be verified and every request gets 401)
// Same level as JWT_SECRET: enforced only in production; dev/test only warns (FUSION_DOC_LOCAL_AUTH=1 enables the bypass)
if (!config.localAuth && !config.fusionIdentity.serviceToken) {
  if (process.env.NODE_ENV === 'production') {
    console.error('  [✗] FUSION_IDENTITY_SERVICE_TOKEN is not set: tokens cannot be verified outside local-auth mode (fail-closed)');
    console.error('      Inject it via the deployment env, or set FUSION_DOC_LOCAL_AUTH=1 to enable the single-user development bypass');
    process.exit(1);
  } else {
    console.warn('  [⚠] FUSION_IDENTITY_SERVICE_TOKEN is not set (development): token verification will fail closed; consider setting FUSION_DOC_LOCAL_AUTH=1 to use the local bypass');
  }
}

module.exports = config;