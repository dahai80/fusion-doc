<div align="center">
  <img src="./branding/logo.svg" width="120" alt="Fusion-Doc Logo" />
  <h1>Fusion-Doc V0.1</h1>
  <p><strong>Apple Silicon Native Offline Intelligent Document Knowledge Base</strong></p>
  <p>Integrates 7 open-source advantages + Fusion-MLX AI, macOS-native optimized</p>
  <p>
    <a href="./README_ZH.md">🇨🇳 中文</a> •
    <a href="./README.md">🇬🇧 English</a>
  </p>
</div>

---

## Architecture

```
Fusion-Doc Server (:11435) — Single process, self-contained
  ├── Static frontend (TipTap editor + Yjs collaboration)
  ├── REST API (modular routing)
  ├── SQLite storage (zero external dependencies)
  └── Fusion-MLX AI calls (resident in memory)
```

**Zero external dependencies:** No PostgreSQL, Redis, NestJS, or reverse proxy required.

## Quick Start

```bash
# 1. Start (requires Fusion-MLX already running)
bash scripts/start.sh

# 2. Access
#    http://localhost:11435    → Document editor
#    http://localhost:11435/api/health → Health check
```

## Integrated Features

| Source | Feature | API Endpoint |
|--------|---------|-------------|
| **DocMost** | TipTap editor + Yjs real-time collaboration | Built-in frontend |
| **DocMost** | Workspace → Directory → Page structure | `/api/workspaces` |
| **DocMost** | Page version history + comments | `/api/pages/:id/versions` |
| **DocMost** | Favorites system | `/api/favorites` |
| **Wiki.js** | Modular routing architecture | `server/routes/` |
| **Wiki.js** | SQLite FTS5 full-text search | `/api/search?q=` |
| **BookStack** | Shelf → Chapter → Page 3-tier structure | `/api/books`, `/api/chapters` |
| **BookStack** | PDF/HTML/Markdown export | `/api/export/:format/:id` |
| **Teedy** | Tag system | `/api/tags` |
| **Teedy** | Document classification + workflow | Tags + structure |
| **Zettlr** | Bidirectional links + knowledge graph | `/api/pages/:id/links`, `/api/graph` |
| **MacDown** | macOS native experience optimization | Theme + dark mode |
| **LibreOffice** | Office format conversion | Export interface |
| **Fusion-MLX** | Local AI chat | `/api/ai/chat` |
| **Fusion-MLX** | Local Embedding | `/api/ai/embeddings` |

## Directory Structure

```
fusion-doc/
├── server/                 ← Core server (self-contained)
│   ├── index.js            ← Entry point
│   ├── db.js               ← Database (SQLite + JSON)
│   ├── routes/index.js     ← Routes (API endpoints)
│   ├── middleware/common.js ← Middleware
│   └── utils/              ← Utilities
├── gateway/                ← Gateway + frontend
│   ├── server.js           ← Fallback entry
│   └── public/             ← Built frontend files
├── branding/               ← Brand assets
│   ├── logo.svg
│   └── favicon.svg
├── scripts/
│   ├── start.sh            ← One-click start
│   └── setup.sh            ← Installation
├── docs/                   ← Documentation
│   └── ANALYSIS_REPORT.md  ← Open-source analysis report
├── patches/                ← Open-source patches
├── data/                   ← Data storage
├── .env                    ← Environment config
├── README.md               ← Chinese documentation
├── README.md               ← English documentation
├── README_ZH.md            ← 中文文档
└── .gitignore
```

## API Overview

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Health check |
| GET | `/api/system/setup` | First-time setup detection |
| POST | `/api/auth/setup` | Register admin |
| POST | `/api/auth/login` | Login |
| GET | `/api/workspaces` | List workspaces |
| GET | `/api/books` | List books |
| GET/POST | `/api/chapters` | Chapter operations |
| GET/POST/PUT/DELETE | `/api/pages` | Page CRUD |
| GET/POST | `/api/pages/:id/versions` | Version history |
| GET/POST | `/api/pages/:id/links` | Bidirectional links |
| GET/POST | `/api/tags` | Tag management |
| GET | `/api/search?q=` | Full-text search |
| GET | `/api/graph` | Knowledge graph |
| POST | `/api/ai/chat` | AI chat |
| POST | `/api/ai/embeddings` | Vector embeddings |
| GET | `/api/export/:format/:id` | Document export |
| GET/POST | `/api/favorites` | Favorites management |
| GET | `/api/branding` | Branding info |

## Development

```bash
# Validate code
node -c server/index.js
node -c server/db.js
node -c server/routes/index.js
node -c server/middleware/common.js
node -c server/utils/helpers.js
node -c server/utils/static.js

# Start development mode
bash scripts/start.sh
```

## License

- **Fusion-Doc own code** — MIT
- **DocMost frontend** — AGPL-3.0
- **Fusion-MLX** — Apache-2.0