<div align="center">
  <img src="./branding/logo.svg" width="120" alt="Fusion-Doc Logo" />
  <h1>Fusion-Doc V1.0</h1>
  <p><strong>AI-First Document OS for Apple Silicon</strong></p>
  <p>TipTap Editor · AI Copilot · Knowledge Graph · Office Format · Real-time Collab</p>
  <p>
    <a href="./README_CN.md">🇨🇳 中文</a> •
    <a href="./README.md">🇬🇧 English</a>
  </p>
</div>

---

## Architecture

```
Fusion-Doc Server (:11449) — AI-First Document Operating System
├── Client (React 18 + Vite + TipTap 2.x)
│   ├── Editor (TipTap + AI Ghost Text + BubbleMenu + Slash Commands)
│   ├── Knowledge Graph (D3.js Force-Directed Layout)
│   ├── AI Chat Panel (SSE Streaming)
│   ├── Office Import/Export
│   ├── Template System
│   ├── Workflow & Collaboration
│   └── Dark Theme (Tailwind CSS)
├── Server (Modular MVC)
│   ├── Controllers (25+ domain modules)
│   ├── Services (AI Copilot, RAG, Office, Workflow, Collaboration)
│   ├── Models (SQLite + JSON dual storage)
│   ├── Integrations (Fusion-MLX, OfficeCLI)
│   └── Plugins (extensible plugin system)
└── WebSocket (Real-time Collaboration — not released, route rejects 410)
```

**Zero external dependencies:** No PostgreSQL, Redis, NestJS, or reverse proxy required.

## Quick Start

```bash
# 1. Install
bash scripts/setup.sh

# 2. Start (Fusion-MLX recommended for AI features)
bash scripts/start.sh

# 3. Access
#    http://localhost:11449       → Document editor
#    http://localhost:11449/api/health → Health check
```

## AI-First Features

| Feature | Description | Shortcut |
|---------|-------------|----------|
| **AI Ghost Text** | Inline completion suggestion | `Cmd+J` trigger, `Tab` accept, `Esc` reject |
| **AI BubbleMenu** | Rewrite/translate/summarize/expand selection | Select text → floating toolbar |
| **AI Slash Command** | Command palette with AI actions | Type `/` in editor |
| **AI Chat Panel** | Side panel with streaming AI chat | 🤖 AI button |
| **Global Search** | Full-text search modal with FTS5 | `Cmd+K` |
| **RAG Enhancement** | Semantic search over document chunks | `/api/rag/query` |

## Integrated Features

| Source | Feature | API Endpoint | Status |
|--------|---------|-------------|--------|
| **TipTap 2.x** | Rich text editor with extensions | Built-in frontend | ✅ |
| **DocMost** | Workspace → Book → Chapter → Page | `/api/workspaces` | ✅ |
| **Wiki.js** | Modular routing + SQLite FTS5 | `server/controllers/` | ✅ |
| **BookStack** | Shelf → Chapter → Page 3-tier | `/api/books`, `/api/chapters` | ✅ |
| **Zettlr** | Bidirectional links + knowledge graph | `/api/graph`, `/api/graph/search` | ✅ |
| **D3.js** | Force-directed graph visualization | `/graph` page | ✅ |
| **OfficeCLI** | .docx/.xlsx/.pptx import/export | `/api/office/import`, `/api/office/export` | ✅ |
| **Fusion-MLX** | Local AI chat (SSE streaming) | `/api/ai/chat` | ✅ |
| **Fusion-MLX** | Local Embedding + RAG | `/api/ai/embeddings`, `/api/rag/query` | ✅ |
| **AI Copilot** | Inline AI (complete/rewrite/translate) | `/api/copilot/*` | ✅ |
| **Template** | Document templates + instantiation | `/api/templates` | ✅ |
| **Workflow** | Document state machine (draft→review→publish) | `/api/workflow/*` | ✅ |
| **Collaboration** | Real-time WebSocket + cursors (not released, route rejects 410) | `/ws/collab/:pageId` | ⏸ |

## Project Structure

```
fusion-doc/
├── client/                      ← React 18 + Vite frontend
│   ├── src/
│   │   ├── components/
│   │   │   ├── editor/          ← TipTap editor + AI extensions
│   │   │   │   ├── EditorPage.jsx      (TipTap + auto-save + collab toggle)
│   │   │   │   ├── EditorToolbar.jsx   (formatting toolbar)
│   │   │   │   ├── AIGhostText.jsx     (Cmd+J inline completion)
│   │   │   │   ├── AIBubbleMenu.jsx    (selection AI menu)
│   │   │   │   ├── AISlashCommand.jsx  (/ command palette)
│   │   │   │   └── BiLinkExtension.jsx ([[ bidirectional links + auto-backlinks)
│   │   │   ├── ai/             ← AI chat panel
│   │   │   ├── graph/          ← D3.js knowledge graph
│   │   │   ├── sidebar/        ← Navigation sidebar
│   │   │   ├── common/         ← Layout, HomePage, StatusBar, SearchModal
│   │   │   ├── office/         ← Office import/export panel
│   │   │   ├── template/       ← Template picker
│   │   │   └── workflow/       ← Workflow status badge
│   │   ├── stores/             ← Zustand state (page, book, ui)
│   │   ├── hooks/              ← Editor context hook
│   │   ├── lib/                ← API client (fetch + SSE stream)
│   │   └── styles/             ← Tailwind + TipTap CSS
│   ├── package.json
│   ├── vite.config.js
│   └── tailwind.config.js
├── server/                      ← Core server (modular MVC)
│   ├── controllers/            ← 25+ domain modules
│   │   ├── ai-copilot.js       ← AI inline actions
│   │   ├── office.js           ← Office import/export
│   │   ├── template.js         ← Template CRUD + instantiate
│   │   ├── workflow.js         ← Document workflow state machine
│   │   ├── collaboration.js    ← WebSocket collab (not released, route rejects 410)
│   │   ├── graph.js            ← Knowledge graph (enhanced + semantic search)
│   │   └── ...                 ← (health, auth, page, book, ai, etc.)
│   ├── services/               ← Business logic
│   │   ├── ai-copilot.js       ← Context building + system prompts
│   │   ├── office.js           ← OfficeCLI SDK interaction
│   │   ├── rag.js              ← Document chunking + vector search
│   │   ├── rag-hybrid.js       ← Hybrid RAG (vector+FTS5+BM25 + RRF + rerank)
│   │   ├── workflow.js         ← State transitions + audit trail
│   │   ├── workflow-engine.js  ← YAML workflow engine + 5 presets
│   │   ├── template-engine.js  ← Variable extraction + fill + create
│   │   ├── seed-templates.js   ← 8 preset templates (auto-seed on first run)
│   │   └── rag-worker.js       ← vector-scan worker_thread (offloads event loop)
│   ├── integrations/           ← External service clients
│   │   ├── fusion-mlx.js       ← OpenAI-compatible (chat/embed/rerank/SSE)
│   │   └── officecli.js        ← OfficeCLI resident mode + preview + merge
│   └── ...
├── gateway/public/              ← Built frontend (from `npm run build`)
├── scripts/
│   ├── start.sh                ← One-click start
│   ├── setup.sh                ← Installation
│   └── test.sh                 ← Validation tests
└── .env                        ← Environment config
```

## API Overview

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Health check |
| POST | `/api/auth/login` | Login |
| GET/POST | `/api/books` | Book CRUD |
| GET/POST/PUT/DELETE | `/api/pages` | Page CRUD |
| GET | `/api/search?q=` | Full-text search |
| GET | `/api/graph` | Knowledge graph data |
| GET | `/api/graph/search?q=` | Semantic graph search |
| GET | `/api/graph/node/:id` | Node detail + neighbors |
| POST | `/api/ai/chat` | AI chat (SSE streaming) |
| POST | `/api/copilot/complete` | AI inline completion |
| POST | `/api/copilot/rewrite` | AI rewrite selection |
| POST | `/api/copilot/translate` | AI translate selection |
| POST | `/api/copilot/summarize` | AI summarize selection |
| POST | `/api/copilot/expand` | AI expand selection |
| POST | `/api/copilot/command` | AI custom command |
| GET | `/api/copilot/context/:id` | Page context for AI |
| GET | `/api/office/status` | OfficeCLI availability |
| POST | `/api/office/create` | Create Office document |
| POST | `/api/office/import` | Import .docx/.xlsx/.pptx |
| POST | `/api/office/export/:id` | Export page to Office format |
| POST | `/api/office/preview/:id` | Preview Office document |
| POST | `/api/office/merge` | Template merge |
| POST | `/api/office/command` | Raw OfficeCLI command |
| GET/POST | `/api/templates` | Template CRUD |
| POST | `/api/templates/:id/instantiate` | Create page from template |
| GET | `/api/templates/:id/variables` | Extract template variables |
| GET/POST | `/api/workflows` | Workflow CRUD |
| POST | `/api/workflows/:id/run` | Execute workflow |
| GET | `/api/workflows/:id/runs` | Execution history |
| POST | `/api/workflows/seed` | Seed 5 preset workflows |
| GET | `/api/workflow/:id` | Page workflow status |
| POST | `/api/workflow/:id/transition` | State transition |
| POST | `/api/rag/enhanced-query` | Hybrid RAG query |
| POST | `/api/rag/reindex/:id` | Reindex page chunks |
| GET | `/api/rag/chunks/:pageId` | Get page chunks |
| WS | `/ws/collab/:pageId` | Real-time collaboration (not released, rejects 410) |

## Fusion Ecosystem

| Project | Description | Integration |
|---------|-------------|-------------|
| **Fusion-MLX** | Local MLX inference engine | AI chat, embeddings, RAG, copilot |
| **Fusion-Coder** | AI coding assistant | Code generation & review |
| **Fusion-KB** | Knowledge base | Document knowledge graph |
| **Fusion-Doc** | Document OS (this) | Central document platform |

## Development

```bash
# Client dev (hot reload)
cd client && npm run dev

# Build frontend
cd client && npm run build

# Validate all server modules
bash scripts/test.sh

# Start server
bash scripts/start.sh
```

## Production Deployment

Commercial deployment requires the env vars below and a reverse proxy + TLS up front; see [SECURITY.md](./SECURITY.md).

```bash
# Required
export JWT_SECRET="$(openssl rand -hex 32)"   # JWT signing secret (production fails fast if missing)
export FUSION_MLX_API_KEY="..."               # Fusion-MLX API key
export FUSION_IDENTITY_SERVICE_TOKEN="..."    # fusion-identity service token (required; fail-closed if missing)
export NODE_ENV="production"                  # production mode (binds 127.0.0.1 by default)

# Behind a reverse proxy
export FUSION_DOC_HOST="0.0.0.0"              # expose to proxy; TLS termination still needed
export CORS_ORIGINS="https://your-domain.com" # CORS allowlist

# Scheduled backup (crontab)
0 2 * * * cd /path/to/fusion-doc && bash scripts/backup.sh 30

# Built-in auto backup (in-process scheduler, env AUTO_BACKUP_HOURS, default 24h, <=0 disables)
export AUTO_BACKUP_HOURS="24"

# Structured logging (ELK ingestion)
export LOG_FORMAT="json"
```

### Built-in TLS (bare exposure)

Native Node `tls` implements HTTPS with zero new dependencies. Setting cert paths enables it, no reverse proxy needed to terminate TLS.

```bash
# Provide cert + private key to enable HTTPS (either missing or unreadable -> fails visibly, never silently falls back to HTTP)
export FUSION_DOC_TLS_CERT="/etc/letsencrypt/live/your-domain.com/fullchain.pem"
export FUSION_DOC_TLS_KEY="/etc/letsencrypt/live/your-domain.com/privkey.pem"
# Optional: client-cert CA (mTLS mutual auth)
export FUSION_DOC_TLS_CA="/etc/fusion-doc/ca.pem"
# HTTP->HTTPS redirect (default on; separate port FUSION_DOC_HTTP_PORT default 11448, set 0 to disable)
export FUSION_DOC_TLS_REDIRECT="1"
export FUSION_DOC_HTTP_PORT="11448"

# Quick self-signed cert (intranet/test)
openssl req -x509 -newkey rsa:2048 -nodes -keyout /tmp/key.pem -out /tmp/cert.pem -days 365 -subj "/CN=localhost"
```

Once enabled: HSTS header forces subsequent connections over TLS; `:11449` serves HTTPS, `:11448` returns HTTP 301 redirect. Without TLS but bound to `0.0.0.0`, a warning still requires a reverse proxy.

### Authentication & tenant isolation (fusion-identity)

Since v1.0.7, fusion-doc delegates JWT issuance and tenant registry to the sibling `fusion-identity` service (`:11470`), the sole identity provider for the Fusion ecosystem. fusion-doc no longer self-issues tokens or maintains its own user registry in production.

- **Token verification**: every non-public API request must carry `Authorization: Bearer <jwt>` (issued by fusion-identity) + `X-Tenant-Id: <tid>` header. The auth middleware verifies the token against `POST /api/v1/auth/verify` and rejects on mismatch (fail-closed — no default-tenant degradation).
- **Tenant-scoped data**: workspaces/pages/books/chapters carry a `tenant_id` column; all queries filter by `tid` from the verified context. Cross-tenant access returns `404` (no existence leakage).
- **Roles**: 4 unified roles (`tenant_admin` / `operator` / `member` / `viewer`); admin-gated endpoints accept `tenant_admin`.
- **AI usage**: token consumption is reported fire-and-forget to `POST /api/v1/tenants/{tid}/usage`.
- **Local single-user dev bypass**: set `FUSION_DOC_LOCAL_AUTH=1` to restore the built-in HS256 issuer + `users` table (off by default; production-forbidden). Backfill defaults existing data to `tenant_id=local-tenant` so it stays accessible in bypass mode.

```bash
export FUSION_IDENTITY_URL="http://127.0.0.1:11470"
export FUSION_IDENTITY_SERVICE_TOKEN="..."   # required in production (fail-closed if missing)
# FUSION_DOC_LOCAL_AUTH=1                    # opt-in local bypass (dev only)
```

### Multi-instance horizontal scaling (same-machine multi-process)

SQLite WAL mode supports multi-process concurrent read/write on the same DB (horizontal scaling within one machine). `FUSION_DOC_ROLE` distinguishes roles, avoiding duplicate execution of ops singletons (thundering herd):

```bash
# primary (default): owns E8 zombie-workflow sweep + auto backup
FUSION_DOC_ROLE="primary" FUSION_DOC_PORT="11449" bash start.sh start

# replica: serves requests only, skips single-instance duties (prevents concurrent UPDATE on same row / backup-file contention)
FUSION_DOC_ROLE="replica" FUSION_DOC_PORT="11450" bash start.sh start
```

The migration system uses `BEGIN IMMEDIATE` + busy_retry to serialize concurrent startup (only one process runs migrations when several boot at once, the rest queue), with `busy_timeout=10000ms` as backstop. Cross-machine / cloud-scale expansion needs an external queue + shared storage, out of scope for single-machine.

### Large-scale knowledge base (sqlite-vec ANN)

Vector search defaults to linear scan (zero-dependency compatibility). When chunk count exceeds ~10k, enable the sqlite-vec extension for ANN KNN (`O(logN)`):

```bash
npm install sqlite-vec         # already a dependency (v1.0.6+)

# Vector dimension must match the embedding model (default 384 = bge-small-en-v1.5)
export AI_EMBEDDING_DIM="384"
```

Design: `rag_chunks_vec` (vec0, integer rowid) + `rag_vec_map` (rowid<->chunk_id TEXT) two-table bridge for TEXT primary keys; dual-write (rag_chunks.vector JSON fallback + vec table ANN). Missing extension / dimension mismatch -> auto fallback to linear scan (zero regression). Retrieval oversamples `topK*4` to compensate for permission-filter elimination.

### Container / process hosting

```bash
# Docker (multi-stage build, zero external deps)
docker build -f deploy/Dockerfile -t fusion-doc .
docker run -d -p 11449:11449 \
    -e JWT_SECRET="$(openssl rand -hex 32)" \
    -e FUSION_MLX_API_KEY="..." \
    -e FUSION_MLX_URL="http://host.docker.internal:11434" \
    --add-host=host.docker.internal:host-gateway \
    -v fusion-doc-data:/app/data fusion-doc

# systemd (auto-restart + log capture)
sudo cp deploy/fusion-doc.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now fusion-doc
```

### Ops endpoints

- `GET /api/health/live` — liveness (process alive, always 200)
- `GET /api/health` — readiness (DB + MLX + disk usage, returns 503 if DB down)
- `GET /api/metrics` — Prometheus text metrics (uptime/memory/request counts/business counts/load)
- `POST /api/system/backup` — trigger backup (admin)
- `GET /api/system/backups` — backup list (admin)
- `POST /api/system/restore` — restore from backup (admin, filename allowlist + path-traversal guard)
- `GET /api/system/backup-schedule` — auto-backup schedule status (admin)
- `/settings` / `/admin` — SPA settings page + admin console (backup/restore UI)

Security features: scrypt password hashing / auth endpoint rate-limit / enforced JWT secret / default localhost bind / online hot backup / parameterized SQL / request body size cap / Webhook SSRF guard / data-endpoint ownership check / file path-traversal guard / MIME allowlist / CORS origin allowlist / log redaction / built-in TLS / HSTS / HTTP->HTTPS redirect.
Changelog at [CHANGELOG.md](./CHANGELOG.md). Full adversarial security audit at [../audit/fusion-doc-audit-0830.md](../audit/fusion-doc-audit-0830.md).

## License

Apache-2.0
