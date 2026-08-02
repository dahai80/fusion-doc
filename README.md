<div align="center">
  <img src="./branding/logo.svg" width="120" alt="Fusion-Doc Logo" />
  <h1>Fusion-Doc V0.2</h1>
  <p><strong>Apple Silicon Native Offline Intelligent Document Knowledge Base</strong></p>
  <p>Modular MVC · Plugin Architecture · Fusion Ecosystem Integration</p>
  <p>
    <a href="./README_ZH.md">🇨🇳 中文</a> •
    <a href="./README.md">🇬🇧 English</a>
  </p>
</div>

---

## Architecture

```
Fusion-Doc Server (:11449) — Modular MVC, self-contained, plugin-extensible
├── Middleware Pipeline (CORS/Auth/Logger/RateLimit/Error)
├── Controllers (20+ domain modules: auth/pages/books/search/ai/...)
├── Services (business logic: RAG/Export/Storage/Search/Page)
├── Models (data abstraction: SQLite + JSON fallback)
├── Integrations (Fusion-MLX / Fusion-Coder / LibreOffice / OCR)
└── Plugins (extensible plugin system)
```

**Zero external dependencies:** No PostgreSQL, Redis, NestJS, or reverse proxy required.

## Quick Start

```bash
# 1. Install
bash scripts/setup.sh

# 2. Start (Fusion-MLX recommended for AI features)
bash scripts/start.sh

# 3. Access
#    http://localhost:11449    → Document editor
#    http://localhost:11449/api/health → Health check
```

## Integrated Features

| Source | Feature | API Endpoint | Status |
|--------|---------|-------------|--------|
| **DocMost** | TipTap editor + Yjs real-time collaboration | Built-in frontend | ✅ |
| **DocMost** | Workspace → Directory → Page structure | `/api/workspaces` | ✅ |
| **DocMost** | Page version history + comments | `/api/pages/:id/versions` | ✅ |
| **DocMost** | Favorites system | `/api/favorites` | ✅ |
| **Wiki.js** | Modular routing architecture | `server/controllers/` | ✅ |
| **Wiki.js** | SQLite FTS5 full-text search | `/api/search?q=` | ✅ |
| **Wiki.js** | Activity audit trail | `/api/activity` | ✅ |
| **BookStack** | Shelf → Chapter → Page 3-tier structure | `/api/books`, `/api/chapters` | ✅ |
| **BookStack** | PDF/HTML/Markdown export | `/api/export/:format/:id` | ✅ |
| **BookStack** | Theme management | `/api/theme` | ✅ |
| **Teedy** | Tag system | `/api/tags` | ✅ |
| **Teedy** | Document classification + metadata | Tags + `/api/metadata` | ✅ |
| **Zettlr** | Bidirectional links + knowledge graph | `/api/pages/:id/links`, `/api/graph` | ✅ |
| **MacDown** | macOS native experience optimization | Theme + dark mode | ✅ |
| **LibreOffice** | Office format conversion | Export interface + Pandoc | ✅ |
| **Fusion-MLX** | Local AI chat (streaming) | `/api/ai/chat` | ✅ |
| **Fusion-MLX** | Local Embedding | `/api/ai/embeddings` | ✅ |
| **Fusion-MLX** | RAG (Retrieval Augmented Generation) | `/api/rag/index`, `/api/rag/query` | ✅ |
| **Fusion-Coder** | AI code generation & review | Integration bridge | ✅ |
| **Plugin System** | Modular plugin architecture | `server/plugins/` | ✅ |
| **Webhook** | Event-driven automation | `/api/webhooks` | ✅ |

## Project Structure

```
fusion-doc/
├── server/                     ← Core server (modular MVC)
│   ├── index.js                ← Entry point (lightweight)
│   ├── app.js                  ← Application core (lifecycle)
│   ├── config.js               ← Configuration management
│   ├── db.js                   ← Database layer (SQLite + JSON)
│   ├── controllers/            ← Controller layer (20 modules)
│   │   ├── index.js            ← Route registration hub
│   │   ├── health.js           ← Health check
│   │   ├── auth.js             ← Authentication
│   │   ├── page.js             ← Page CRUD
│   │   ├── book.js             ← Books
│   │   ├── chapter.js          ← Chapters
│   │   ├── search.js           ← Full-text search
│   │   ├── ai.js               ← AI (chat/embedding/RAG)
│   │   ├── file.js             ← File management
│   │   ├── tag.js              ← Tags
│   │   ├── comment.js          ← Comments
│   │   ├── export.js           ← Document export
│   │   ├── graph.js            ← Knowledge graph
│   │   ├── favorite.js         ← Favorites
│   │   ├── activity.js         ← Activity log
│   │   ├── user.js             ← User management
│   │   ├── theme.js            ← Theme settings
│   │   ├── webhook.js          ← Webhook system
│   │   ├── metadata.js         ← Metadata/Vocabulary
│   │   ├── workspace.js        ← Workspaces
│   │   └── branding.js         ← Branding info
│   ├── services/               ← Service layer (business logic)
│   │   ├── auth.js             ← Auth service (password hashing)
│   │   ├── page.js             ← Page service (CRUD + versions)
│   │   ├── search.js           ← Search service
│   │   ├── rag.js              ← RAG service (embedding + retrieval)
│   │   ├── export.js           ← Export service
│   │   └── storage.js          ← Storage service
│   ├── models/                 ← Model layer (data abstraction)
│   │   ├── index.js            ← Model registry
│   │   └── base.js             ← Base model (query builder)
│   ├── middleware/              ← Middleware stack
│   │   ├── pipeline.js         ← Middleware pipeline engine
│   │   ├── cors.js             ← CORS
│   │   ├── auth.js             ← Authentication (JWT)
│   │   ├── logger.js           ← Request logging
│   │   ├── rate-limit.js       ← Rate limiting
│   │   ├── error-handler.js    ← Error handling
│   │   └── body-parser.js      ← Request body parsing
│   ├── integrations/           ← Integration layer
│   │   ├── fusion-mlx.js       ← Fusion-MLX AI engine
│   │   ├── fusion-coder.js     ← Fusion-Coder bridge
│   │   ├── ocr.js              ← OCR (Tesseract + MLX Vision)
│   │   └── libreoffice.js      ← LibreOffice conversion
│   ├── plugins/                ← Plugin system
│   │   ├── loader.js           ← Plugin loader
│   │   └── registry.js         ← Plugin registry
│   └── utils/                  ← Utilities
│       ├── helpers.js          ← uid, now, slugify
│       └── static.js           ← Static file serving
├── gateway/                    ← Gateway + frontend
│   └── public/                 ← Built frontend files (DocMost)
├── branding/                   ← Brand assets
├── scripts/
│   ├── start.sh                ← One-click start
│   ├── setup.sh                ← Installation
│   └── test.sh                 ← Validation tests
├── docs/
│   └── ANALYSIS_REPORT.md      ← Open-source analysis report
├── patches/                    ← Open-source patches
├── data/                       ← Data storage
├── .env                        ← Environment config
├── README.md                   ← English documentation
└── README_ZH.md                ← 中文文档
```

## API Overview

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Health check |
| GET | `/api/system/setup` | First-time setup detection |
| POST | `/api/auth/setup` | Register admin |
| POST | `/api/auth/login` | Login |
| GET | `/api/workspaces` | List workspaces |
| GET/POST | `/api/books` | Book CRUD |
| GET/POST/PUT/DELETE | `/api/chapters` | Chapter CRUD |
| GET/POST/PUT/DELETE | `/api/pages` | Page CRUD |
| GET/POST | `/api/pages/:id/versions` | Version history |
| GET/POST | `/api/pages/:id/links` | Bidirectional links |
| GET/POST | `/api/tags` | Tag management |
| GET | `/api/search?q=` | Full-text search |
| GET | `/api/search/advanced` | Advanced search |
| GET | `/api/graph` | Knowledge graph |
| POST | `/api/ai/chat` | AI chat (supports streaming) |
| POST | `/api/ai/embeddings` | Vector embeddings |
| POST | `/api/rag/index` | RAG document indexing |
| POST | `/api/rag/query` | RAG question answering |
| GET | `/api/export/:format/:id` | Document export (md/html/pdf/docx) |
| GET/POST/DELETE | `/api/favorites` | Favorites management |
| GET/POST/DELETE | `/api/files` | File management |
| GET/POST/DELETE | `/api/comments` | Comments |
| GET | `/api/activity` | Activity log |
| GET/POST | `/api/users` | User management |
| GET/POST | `/api/theme` | Theme settings |
| GET/POST | `/api/webhooks` | Webhook system |
| GET/POST | `/api/metadata` | Metadata management |
| GET/POST | `/api/vocabulary` | Vocabulary management |
| GET | `/api/branding` | Branding info |

## Fusion Ecosystem

Fusion-Doc is part of the **Fusion Ecosystem** — a suite of Apple Silicon-optimized AI tools:

| Project | Description | Integration |
|---------|-------------|-------------|
| **Fusion-MLX** | Local MLX inference engine | AI chat, embeddings, RAG |
| **Fusion-Coder** | AI coding assistant | Code generation & review |
| **Fusion-KB** | Knowledge base | Document knowledge graph |
| **Fusion-Doc** | Document knowledge base (this) | Central document platform |

## Development

```bash
# Validate all code
bash scripts/test.sh

# Start development mode
bash scripts/start.sh

# Validate individual modules
node -c server/index.js
node -c server/app.js
node -c server/config.js
node -c server/db.js
```

## License

- **Fusion-Doc own code** — MIT
- **DocMost frontend** — AGPL-3.0
- **Fusion-MLX** — Apache-2.0
