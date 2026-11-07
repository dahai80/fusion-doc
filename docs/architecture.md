---
doc_id: fusion-doc/architecture
product: fusion-doc
class: platform
entry: service
doc_type: architecture
title: {zh: Fusion-Doc 架构, en: Fusion-Doc Architecture}
audience: engineer
status: draft
version: 1.0.17
updated: 2026-11-07
owner: "@dahai"
source_of_truth:
  - server/app.js
  - server/db.js
  - CLAUDE.md
  - README.md
---

# 架构 / Architecture

## 总览 / Overview

单端口双进程模型（默认 `11449`）：一个 Node HTTP 服务（原生 `http.Server`，无 Express）同时承载 REST API、静态 SPA 与 WebSocket 升级；前端是 React 18 + Vite + TipTap 2 + Yjs + Zustand + D3 的单页应用，构建产物落在 `gateway/public/`，由同一进程伺服。零外部依赖：无 PostgreSQL、Redis、NestJS、反向代理。

En: A one-port, two-process model (default `11449`): a single Node service on a raw `http.Server` serves the REST API, static SPA, and WebSocket upgrades; the client is a React 18 + Vite + TipTap 2 + Yjs + Zustand + D3 SPA built into `gateway/public/`. Zero external dependencies.

```
Client (React 18 + Vite + TipTap 2.x)
  editor/ (ghost text, bubble menu, slash commands, [[ bidi links)
  ai/ chat panel (SSE) · graph/ (D3) · office/ · template/ · workflow/
        │ fetch + SSE over /api/* and /ws/*
Server (modular MVC on http.Server)
  app.js FusionDocApp: init -> middleware -> _matchRoute -> handler
  controllers/ (30) -> services/ -> models/ (base.js SQLite/JSON dual mode)
  integrations/ (fusion-identity, fusion-mlx, officecli, fusion-trainer, ...)
  middleware/ (cors, logger, body-parser, rate-limit, auth, authz, error-handler)
  plugins/ (loader + registry, drop-in at init)
Storage: data/db/fusion-doc.db (SQLite WAL) + data/{storage,exports,versions,logs}
Siblings: fusion-mlx :11434 (via gateway :11432) · fusion-identity :11470 · fusion-gateway :11432
```

## 请求生命周期 / Request lifecycle（`server/app.js`）

1. `init()`：`initDB()`（better-sqlite3，JSON 回退）→ 种子模板 → 注册中间件 → `registerRoutes(this)` → 加载插件。
2. `_handleRequest`：构造 `req.ctx = { app, db, config, url }` → 中间件管线 → `_matchRoute`（先精确后 `:param`）→ `/api/` 未命中返回 API 404 → 静态资源 → SPA 回退。
3. WebSocket：`ws` 库 `noServer: true`，`server.on('upgrade')` 复用相同的 `:param` 匹配逻辑。

En: `init()` boots DB, seeds templates, registers middleware/routes/plugins. `_handleRequest` injects `req.ctx`, runs the middleware pipeline, matches routes (exact first, then `:param`), then falls through to static assets and the SPA fallback. WS routes share the matcher.

## 分层（严格，不得跨层）/ Layering (strict)

```
controllers/  路由注册 + 请求处理（调 services，经 utils/response 返回）
services/     业务逻辑（rag, rag-hybrid, office, workflow-engine, template-engine, seed-templates, ai-copilot, shell-register）
models/       数据访问（base.js SQLite/JSON 双模；index.js 注册表）
integrations/ 外部客户端（fusion-identity, fusion-mlx, officecli, libreoffice, fusion-trainer, http-retry）
middleware/   cors, logger, body-parser, rate-limit, auth, authz, require-admin, error-handler, pipeline
plugins/      loader.js + registry.js（即插即用扩展，init 时加载）
utils/        response(json/success/error/notFound/created/list), static, helpers
```

控制器导出 `register(app)` 并加入 `server/controllers/index.js` 数组；路由用 `app.registerRoute('METHOD', '/api/path/:id', handler)`，WS 用 `app.ws('/ws/path/:id', handler)`。响应必须经 `utils/response` 助手，控制器禁止手写 `res.writeHead`。

En: Each controller exports `register(app)` and joins the array in `server/controllers/index.js`; responses must go through the `utils/response` helpers.

## 数据层 / Data layer（`server/db.js`）

- SQLite 主库 `data/db/fusion-doc.db`：`journal_mode=WAL`、`foreign_keys=ON`、`busy_timeout=5000`，全部参数化查询（SQL 注入防护）；better-sqlite3 缺失时回退 JSON 文件。
- 迁移 `001`–`020` 内联于 `db.js`，`_migrations` 表跟踪、幂等；关键项：`014/015` FTS 解耦/触发器修复、`016` RAG 统一、`017` sqlite-vec `vec0` 索引（维度取 `AI_EMBEDDING_DIM`，默认 384）、`018` 租户隔离（`tenant_id` 列）、`020` 集合（collections）。
- 并发启动由 `BEGIN IMMEDIATE` + busy_retry（60 次，Atomics.wait 200ms）串行化，仅一个进程跑迁移，其余排队。
- 全文检索用 FTS5 表；RAG 分块存 `rag_chunks`（JSON 向量双写）+ `rag_chunks_vec`（vec0，整型 rowid）+ `rag_vec_map`（rowid 与 TEXT chunk_id 的桥接表），ANN 检索过采样 `topK*4` 补偿权限过滤；扩展缺失/维度不匹配自动回退线性扫描。

En: SQLite primary with WAL and parameterized queries; JSON-file fallback. Migrations 001-020 are inline and idempotent, serialized across processes by a `BEGIN IMMEDIATE` lock. FTS5 powers full-text search; RAG chunks dual-write into a vec0 ANN bridge, falling back to linear scan.

## AI 层 / AI layer

所有 AI 调用经 `server/integrations/fusion-mlx.js` 走 fusion-mlx 的 OpenAI 兼容 HTTP API：`/v1/chat/completions`（含 SSE）、`/v1/embeddings`、`/v1/rerank`、`/v1/models`。`FUSION_CLIENT_KEY` 缺失即抛错（fail visibly）。RAG 混合检索（`services/rag-hybrid.js`）融合向量 + FTS5 + BM25，RRF 合并后重排；向量扫描放 `services/rag-worker.js` 的 worker_thread，避免阻塞事件循环。

En: All AI calls go through `server/integrations/fusion-mlx.js` against fusion-mlx's OpenAI-compatible API; a missing key throws. Hybrid RAG merges vector + FTS5 + BM25 via RRF and reranks; vector scan runs in a worker thread.

## 身份与租户 / Identity and tenant

fusion-identity（`:11470`）是唯一 JWT 签发方；`middleware/auth.js` 经 `integrations/fusion-identity.js` 验证（fail-closed）并注入 `req.user.tid`，`X-Tenant-Id` 必须与 token 租户一致。角色 `tenant_admin`/`operator`/`member`/`viewer`；`authz.js` + `require-admin.js` 做门禁；控制器按 `req.user.tid` 过滤查询，跨租户访问返回 404（不泄露存在性）。AI 用量 fire-and-forget 上报 `POST /api/v1/tenants/{tid}/usage`。`FUSION_DOC_LOCAL_AUTH=1` 恢复本地 HS256 + `users` 表（仅开发）。

En: fusion-identity is the sole JWT issuer; the auth middleware verifies fail-closed and injects the tenant context. Controllers filter by `req.user.tid`; cross-tenant access returns 404.

## Shell 集成 / Shell integration

主实例启动时向 fusion-gateway（`:11432`）POST `client/manifest.json`（id `fusion-doc`，category `infra`）并心跳（`services/shell-register.js`，fire-and-forget）。网关以同源 iframe 代理挂载 `/shell/fusion-doc/` 并上游注入模块凭证 `FUSION_DOC_SHELL_API_KEY`（或自动生成的 `data/shell-api-key.json`，0600），以 `shell` 租户 `operator` 角色通过验证。嵌入模式（`?embedded=1` 或 `/shell/` 挂载）隐藏侧边栏/状态栏并跳过本地登录门；主题与语言跟随宿主（vendored `@fusion/web-sdk` v0.1.2，`client/src/vendor/fusion-web-sdk.js`）。构建用相对 base `./`，一份 bundle 同时服务根路径与子路径。需要 `FUSION_ADMIN_KEY`，缺失仅告警。

En: At boot the primary registers its manifest to the gateway with heartbeats. The gateway mounts `/shell/fusion-doc/` as a same-origin iframe proxy and injects the module credential upstream. Embedded mode hides chrome and syncs theme/lang with the host via the vendored web SDK.

## 安全设计 / Security design

scrypt 口令哈希（N=2^15, r=8, p=1）；auth 限流（`/api/auth/*` 10/min，其余 120/min，内存单实例）；强制 JWT 密钥；默认本机绑定；在线热备份；参数化 SQL；请求体大小上限；Webhook SSRF 防护；数据端点属主校验；文件路径穿越防护；MIME 白名单；CORS 白名单；日志脱敏；内置 TLS + HSTS + HTTP→HTTPS 跳转。Office 操作一律 `execFile` 参数数组（无 shell），路径经 `safePath` 类守卫。完整策略见 `SECURITY.md`。

En: scrypt hashing, per-route rate limiting, enforced secrets, localhost-by-default binding, hot online backup, parameterized SQL, request size caps, SSRF guards, path-traversal guards, MIME and CORS allowlists, log redaction, built-in TLS with HSTS. Office ops use `execFile` arg arrays only.

## 部署形态 / Deployment forms

- `start.sh`（start/stop/restart/status，PID 文件 `.fusion-doc.pid`，日志 `logs/stdout.log`、`logs/stderr.log`，自动重启 + 退避）。
- Docker：`deploy/Dockerfile`（node:20-slim 多阶段，工具链内编译 better-sqlite3）；systemd：`deploy/fusion-doc.service`。
- 同机多实例：`FUSION_DOC_ROLE=primary|replica` + 不同 `FUSION_DOC_PORT`；跨机扩展需外部队列 + 共享存储，超出单机范围。
- 备份：`scripts/backup.sh [保留份数]`（cron 用）+ 进程内调度（`AUTO_BACKUP_HOURS`）+ `/api/system/backup|restore`（admin）。
