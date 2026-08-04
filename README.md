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
└── WebSocket (Real-time Collaboration)
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
| **Collaboration** | Real-time WebSocket + cursors | `/ws/collab/:pageId` | ✅ |

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
│   │   │   │   └── BiLinkExtension.jsx ([[ 双向链接 + 自动反链)
│   │   │   ├── ai/             ← AI chat panel
│   │   │   ├── graph/          ← D3.js knowledge graph
│   │   │   ├── sidebar/        ← Navigation sidebar
│   │   │   ├── common/         ← Layout, HomePage, StatusBar, SearchModal
│   │   │   ├── office/         ← Office import/export panel
│   │   │   ├── template/       ← Template picker
│   │   │   ├── workflow/       ← Workflow status badge
│   │   │   └── collab/         ← Collaboration cursors
│   │   ├── stores/             ← Zustand state (page, book, ui)
│   │   ├── hooks/              ← Editor context hook
│   │   ├── lib/                ← API client (fetch + SSE stream) + Yjs provider
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
│   │   ├── collaboration.js    ← WebSocket real-time collab
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
│   │   └── collaboration.js    ← Yjs state persistence
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
| WS | `/ws/collab/:pageId` | Real-time collaboration |

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

## License

Apache-2.0
