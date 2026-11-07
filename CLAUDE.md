---
doc_id: fusion-doc/repo-guide
product: fusion-doc
class: platform
entry: service
doc_type: guide
title: {zh: 代码库工作指南, en: Repository Working Guide}
audience: engineer
status: draft
version: 1.0.17
updated: 2026-11-07
owner: @dahai
source_of_truth:
  - CLAUDE.md
---

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Fusion-Doc — AI-first document OS for Apple Silicon. Zero external deps (no PostgreSQL/Redis/NestJS/proxy). Node HTTP server + React/Vite SPA + WebSocket collab. Part of the Fusion monorepo ("一核九端"); AI inference comes from the sibling `fusion-mlx` engine reached over HTTP. Version lives in `package.json` and is read everywhere (banner/health/branding/X-Fusion-Doc header) — never hardcode it.

## Commands

All commands run from repo root `/Users/dahai/fusion/fusion-doc`.

```bash
bash scripts/setup.sh          # Install deps, init data dirs, write .env if missing
bash start.sh start            # Start server (pid in .fusion-doc.pid, port 11449)
bash start.sh stop|status|restart

npm run dev:all                # Server + Vite client (concurrently, hot reload)
npm run dev:server             # Server only: node server/index.js
npm run dev                    # Client only: vite on :11477 (proxies /api + /ws to :11449)
npm run build                  # Build client → gateway/public/ (server serves this in prod)
npm run lint                   # eslint server/ --quiet  (eslint 9 flat config)
npm run lint:fix
npm test                       # bash scripts/test.sh — node -c syntax check of every server module + health/branding API if running
```

Node 18+ required. CI (`.github/workflows/ci.yml`) runs on Node 20: `lint`, `test`, `npm audit --audit-level=high --omit=dev`, client build. A high/critical vuln in server deps **fails** CI; client audit is non-blocking.

### Single test
`npm test` (`bash scripts/test.sh`) syntax-checks (`node -c`) each `server/**/*.js`, runs the node:test behavioral suite in `tests/unit/` (zero-dep unit tests: static sandbox, rate-limit, workflow DAG, db atomicity, migration lock, auth hardening, identity/tenant isolation, TLS config, sqlite-vec fallback), and pings `/api/health` + `/api/branding` if the server is up. Run the behavioral suite alone: `npm run test:unit` (i.e. `node --test tests/unit/*.js`). To exercise one endpoint: start the server, `curl -sf http://localhost:11449/api/health`. To check one file's syntax: `node -c server/controllers/office.js`. Add new behavioral tests as `tests/unit/test-*.js` using the built-in `node:test` + `node:assert` (no external test deps).

## Architecture

Two-process model behind one port (11449):
- **Server** (`server/`) — custom minimal MVC on raw `http.Server`. No Express. Handles API + static SPA + WebSocket upgrade all from `app.js` `_handleRequest`.
- **Client** (`client/`) — React 18 + Vite + TipTap 2 + Yjs + Zustand + D3. Built output lands in `gateway/public/` and is served as the SPA.

### Request lifecycle (`server/app.js` `FusionDocApp`)
1. `init()`: `initDB()` (SQLite via better-sqlite3, JSON-file fallback) → seed templates → register middleware → `registerRoutes(this)` → load plugins.
2. `_handleRequest`: build `req.ctx = { app, db, config, url }` → run middleware pipeline → `_matchRoute` (exact first, then `:param` patterns) → API 404 if `/api/` → static asset serve → SPA fallback.
3. WebSocket: `ws` npm lib with `noServer: true`; `server.on('upgrade')` matches `_wsRoutes` (same `:param` split logic).

### Layering (strict — do not skip layers)
```
controllers/  → route registration + req handling (call services, return via utils/response)
services/     → business logic (rag, office, workflow-engine, template-engine, seed-templates)
models/       → data access (base.js SQLite/JSON dual-mode; index.js registry)
integrations/ → external clients (fusion-identity, fusion-mlx, officecli, libreoffice, fusion-kb/cowork/model-hub/studio/trainer/coder, http-retry)
middleware/   → cors, logger, body-parser, rate-limit, auth, authz, require-admin, error-handler, pipeline
plugins/      → loader.js + registry.js (drop-in extensions, loaded at init)
utils/        → response (json/success/error/notFound/created/list), static, helpers
```

### Controllers
Each controller exports `{ register(app) }` and is added to the array in `server/controllers/index.js`. Register routes with `app.registerRoute('METHOD', '/api/path/:id', handler)` and WS routes with `app.ws('/ws/path/:id', handler)`. 30 controllers, ~110 registered routes. Response helpers are mandatory — use `require('../utils/response')` (`json`/`success`/`error`/`notFound`/`created`/`list`), do not hand-write `res.writeHead` in controllers.

### Database (`server/db.js`)
- Primary: SQLite (`data/db/fusion-doc.db`), `journal_mode=WAL`, `foreign_keys=ON`, `busy_timeout=5000`. All queries **parameterized** (`prepare().run()`) — no string concat (SQL injection guard).
- Fallback: JSON files in `data/` when better-sqlite3 missing.
- Migrations: array `001`–`018` in `db.js` (`getInitialSchema` etc.), tracked in `_migrations` table, idempotent (`IF NOT EXISTS`). Notable: `014/015` FTS decouple/trigger fix, `016` RAG unify, `017` sqlite-vec `vec0` index (dimension locked from `AI_EMBEDDING_DIM`, default 384), `018` tenant isolation (`tenant_id` columns). Add new migrations as entries in the `migrations` array in `runMigrations()`; schema is inline in `db.js` (no `server/migrations/` dir on disk). Migration runner takes a lock (`test-migration-lock.js`).
- FTS5 full-text search tables for `/api/search`.

### Config (`server/config.js`)
Three-tier: env var > `.env` > hardcoded default. `.env` parser is hand-rolled (no dotenv dep). Reads version from `package.json`. Fusion sibling-service URLs default to localhost ports (Identity 11470, KB 11436, Cowork 11437, Model-Hub 11444, Studio UDS socket). `fusion-mlx` defaults to gateway `http://127.0.0.1:11432` (env `FUSION_MLX_URL` can override to direct 11434).

## Fusion-MLX integration (the AI layer)

All AI features call sibling `fusion-mlx` over HTTP (OpenAI-compatible API): `/v1/chat/completions` (incl. SSE streaming), `/v1/embeddings`, `/v1/rerank`, `/v1/models`. Client is `server/integrations/fusion-mlx.js`.

**Hard rule:** `FUSION_CLIENT_KEY` must be set in env (canonical config-conventions name, issue #67; no legacy alias chain in this repo) — the integration **fails visibly** (throws) when the key is missing. Never hardcode the key as a literal. To run AI features locally, start the engine with `~/claude-home/fusion-mlx/start.sh start` and set the key.

`server/controllers/training.js` + `integrations/fusion-trainer.js` export doc pages to a SFT `.jsonl` dataset and shell out to the `fusion-trainer` CLI (subprocess of the shared monorepo `.venv`, path overridable via `FUSION_TRAINER_BIN`).

## Security hardening (must preserve)

This project went through a commercial-grade hardening pass (v1.0.5) plus multi-tenant identity integration (v1.0.6–v1.0.8, issue #45). Match these patterns when touching related code — see `SECURITY.md` for the full policy.

- **Auth model (issue #45)**: `fusion-identity` (`:11470`, `FUSION_IDENTITY_URL`) is the **sole JWT issuer**. `middleware/auth.js` verifies tokens via the identity service (`integrations/fusion-identity.js`, fail-closed) and injects tenant context (`req.user.tid`). `X-Tenant-Id` header must match the token's tenant or the request is rejected (`AUTH_` error codes). Roles: `tenant_admin`/`operator`/`member`/`viewer`. **Production requires `FUSION_IDENTITY_SERVICE_TOKEN` env** — missing it fails visibly at startup (`config.js`).
- **Local auth bypass**: `FUSION_DOC_LOCAL_AUTH=1` enables the legacy self-signed HS256 + `users` table path (single-user dev only; never in production). Under this bypass, dev-only `X-User-Id` header works when `NODE_ENV=development`.
- **Tenant isolation**: migration `018` added `tenant_id` columns; `middleware/authz.js` + `require-admin.js` guard controllers (admin gates accept `tenant_admin`). Controllers filter queries by `req.user.tid` — new endpoints must do the same.
- **Password hashing**: scrypt (N=2^15, r=8, p=1) in `services/auth.js`; malformed-hash guard rejects garbage hashes (issue #48), legacy HMAC-SHA256 hashes auto-upgrade on login.
- **TLS**: built-in HTTPS via Node native `tls` (no new deps) — `FUSION_DOC_TLS_CERT`/`FUSION_DOC_TLS_KEY`/`FUSION_DOC_TLS_CA` (optional mTLS) in `config.js`.
- **sqlite-vec**: RAG vector search uses a `vec0` ANN index (migration `017`) with linear-scan fallback when the extension is unavailable (`services/rag-hybrid.js`, `test-vec-fallback.js`).
- **Public paths** (`/api/health`, `/api/auth/login`, `/api/system/setup`, `/api/branding`, `/api/theme`) are allowlisted in `middleware/auth.js` `PUBLIC_PATHS`.
- **Union Web shell (issue #51)**: at boot the primary instance registers `client/manifest.json` (id `fusion-doc`, category `infra`) to `fusion-gateway` `:11432` (`services/shell-register.js`, fire-and-forget + heartbeat). The gateway `/shell/fusion-doc/` proxy injects the module service credential (`FUSION_DOC_SHELL_API_KEY` env or auto-generated `data/shell-api-key.json`, 0600); `middleware/auth.js` accepts it as a `shell`-tenant `operator` principal — new endpoints must keep tenant filtering. Embedded mode (`?embedded=1` or `/shell/` mount) hides chrome and skips the local login gate (`client/src/lib/embedded.js`); vite uses relative `base: './'`. Registration needs `FUSION_ADMIN_KEY` (canonical name, issue #67) — missing it only warns.
- **Rate limiting**: `middleware/rate-limit.js` — `/api/auth/*` 10/min, other API 120/min. Memory-based (single-instance only).
- **Command injection**: office ops use `execFile` with **arg arrays** (no shell) in `services/office.js` + `integrations/officecli.js`. Never reintroduce `exec()`/`execSync` with string concat.
- **Path traversal**: office file paths validated — use existing `safePath`-style guards, never trust raw input into fs paths.
- **Binding**: production defaults to `127.0.0.1`; `FUSION_DOC_HOST=0.0.0.0` exposes (must sit behind reverse proxy + TLS). No built-in HTTPS.
- **Admin gate**: backup/system endpoints enforce `req.user.role === 'admin'`.

## Conventions

- Server is CommonJS (`require`/`module.exports`); client is ESM (`"type": "module"`).
- Indentation: multiples of 4 spaces. **No docstrings.** Always log (the codebase logs at every layer via `console.log/error` with `[tag]` prefixes).
- Comments are dense Chinese block headers (`// ── section ──`) mirroring the monorepo style — match this when adding files.
- `req.ctx = { app, db, config, url }` is injected before handlers; `req.params` and `req.user` populated by matcher/auth.
- ESLint flat config (`eslint.config.js`, eslint 9): `no-unused-vars` is `warn` (unused args starting `_` ignored), `no-console` off, commonjs globals declared. Ignores `gateway/public`, `client/dist`, `node_modules`, `.venv`.
- Build output dir `gateway/public/` is committed-ignored and created by `npm run build` — the server's `publicDir` points here.

## Key paths

- `data/` — runtime storage (`db/`, `storage/`, `exports/`, `versions/`, `logs/`, `documents/`). `start.sh` creates these at start.
- `deploy/` — container/systemd deployment (`Dockerfile` multi-stage node:20-slim — better-sqlite3 compiled in-toolchain; `fusion-doc.service` systemd unit).
- `branding/` — logo + identity served statically.
- `patches/` — vendored patches (e.g. MaxKB integration).
- `.fusion-doc.pid` — server PID file (start.sh lifecycle).
- `logs/stdout.log` / `logs/stderr.log` — server output (start.sh nohup).
- `docs/ANALYSIS_REPORT.md` — architecture/PRD analysis.

## Monorepo context

Shares one `.venv/` at `/Users/dahai/fusion/.venv` with 26 sibling `fusion-*` projects. This is a JS project (own `node_modules`), but `fusion-trainer` calls go through that shared venv. For cross-project concerns follow the monorepo `/Users/dahai/fusion/CLAUDE.md`. Upstream issues in siblings (e.g. port conflicts, gateway routing) are filed as issues there, not patched here.
