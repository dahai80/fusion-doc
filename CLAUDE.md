# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What Is Fusion-Doc

Node.js offline intelligent document knowledge base for Apple Silicon. Modular MVC server with 20+ domain controllers, SQLite+JSON dual storage, FTS5 full-text search, and deep Fusion-MLX integration for local AI (chat/embedding/RAG). Zero external dependencies — no PostgreSQL, Redis, or reverse proxy.

Port: `11449` (configurable via `FUSION_DOC_PORT` in `.env`).

## Commands

```bash
# Setup
bash scripts/setup.sh

# Start (blocks until Ctrl+C)
bash scripts/start.sh

# Validate all JS modules (syntax check)
bash scripts/test.sh

# Single file syntax check
node -c server/controllers/page.js

# Python patch tests (requires fusion-doc .venv)
source .venv/bin/activate && pytest tests/test_patch.py -v
```

## Architecture

```
server/index.js          → Lightweight entry, creates FusionDocApp
server/app.js            → Lifecycle: init→middleware→routes→plugins→start
server/config.js         → .env → env vars → defaults (3-tier fallback)
server/db.js             → SQLite (better-sqlite3) with JSON file degradation
                           Inline migration system (_migrations table)
server/middleware/       → Priority-ordered pipeline (cors→logger→auth→error)
  pipeline.js            → MiddlewarePipeline class with priority sorting
server/controllers/      → 20 modules, each exports register(app)
  index.js               → Auto-imports all controllers, calls register()
server/services/         → Business logic (page, search, rag, export, auth, storage)
server/models/           → Model base class wraps SQLite queries + JSON fallback
  base.js                → CRUD query builder with automatic JSON degradation
server/integrations/     → External service clients
  fusion-mlx.js          → OpenAI-compatible client (chat, embeddings, rerank, SSE streaming)
server/plugins/          → Directory-scanned plugin system
  loader.js              → Discovers dir/js plugins, calls activate(), registers hooks
server/utils/            → uid(), now(), slugify(), static file serving
gateway/public/          → Built SPA frontend (DocMost-based)
patches/                 → Integration patches for external projects (maxkb, docmost)
```

### Key Design Patterns

- **Controller registration**: Each controller exports `register(app)` that calls `app.registerRoute(method, path, handler)`. Routes are auto-collected by `controllers/index.js`.
- **Dual storage**: All models use `this.db` (SQLite) with automatic JSON file fallback when `better-sqlite3` is unavailable. No code changes needed — `Model` base class handles both.
- **Middleware pipeline**: Priority-ordered (lower = earlier). Built-in: cors(0)→logger(10)→auth(20)→error(100). Plugins inject at priority 50.
- **Route matching**: Two-pass — exact match first, then parameterized (`:id` patterns). `req.params` populated for parameterized routes.
- **Config fallback**: `.env` file → environment variables → hardcoded defaults (in `config.js`).
- **Fusion-MLX integration**: All AI features route through `server/integrations/fusion-mlx.js` which calls `localhost:11434` OpenAI-compatible API. Streaming uses SSE via async generators.

### Database Schema

4 inline migrations in `db.js`: initial schema (users, workspaces, books, chapters, pages, tags, links, files, comments, favorites, FTS5), rag_index, activity+webhooks, metadata+vocabulary. FTS5 triggers auto-sync on page INSERT/UPDATE/DELETE.

## Environment

Key `.env` variables:

| Variable | Default | Purpose |
|---|---|---|
| `FUSION_DOC_PORT` | 11449 | Server port |
| `FUSION_MLX_URL` | http://localhost:11434 | Fusion-MLX inference engine |
| `AI_CHAT_MODEL` | Qwen3.5-9B-4bit | Chat model |
| `AI_EMBEDDING_MODEL` | bge-small-en-v1.5 | Embedding model |
| `JWT_SECRET` | auto-generated | Auth token secret |

## Adding a New Controller

1. Create `server/controllers/your-domain.js` with `register(app)` exporting route registrations
2. Add `require('./your-domain')` to the array in `server/controllers/index.js`
3. If it needs a data model, extend `Model` base class in a new file under `server/models/`

## Adding a Plugin

Place a directory or `.js` file in `server/plugins/`. Must export `activate(app)` returning an instance. Optional hooks: `routes(app)`, `middleware(app)`, `events(app)`, `shutdown()`.
