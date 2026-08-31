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
└── WebSocket (Real-time Collaboration — 未发布, 路由拒连 410)
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
| **Collaboration** | Real-time WebSocket + cursors (未发布, 路由拒连 410) | `/ws/collab/:pageId` | ⏸ |

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
│   │   ├── collaboration.js    ← WebSocket collab (未发布, 路由拒连 410)
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
│   │   └── rag-worker.js       ← 向量扫描 worker_thread (offload 事件循环)
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
| WS | `/ws/collab/:pageId` | Real-time collaboration (未发布, 拒连 410) |

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

商用部署须配置以下环境变量并前置反向代理 + TLS，详见 [SECURITY.md](./SECURITY.md)。

```bash
# 必需
export JWT_SECRET="$(openssl rand -hex 32)"   # JWT 签名密钥 (生产缺失则启动 fail-fast)
export FUSION_MLX_API_KEY="..."               # Fusion-MLX 调用密钥
export NODE_ENV="production"                  # 生产模式 (默认绑 127.0.0.1)

# 前置反代时
export FUSION_DOC_HOST="0.0.0.0"              # 暴露到反代; 仍需 TLS 终结
export CORS_ORIGINS="https://your-domain.com" # CORS 白名单

# 定时备份 (crontab)
0 2 * * * cd /path/to/fusion-doc && bash scripts/backup.sh 30

# 内置自动备份 (进程内调度, env AUTO_BACKUP_HOURS, 默认 24h, <=0 关闭)
export AUTO_BACKUP_HOURS="24"

# 结构化日志 (ELK 采集)
export LOG_FORMAT="json"
```

### 内置 TLS (解裸暴露)

Node 原生 `tls` 实现 HTTPS, 零新依赖。配置证书路径即启用, 无需前置反代终结 TLS 即可直接对外。

```bash
# 提供证书 + 私钥 → 启用 HTTPS (任一缺失/文件不可读 → 启动 fail visibly, 不静默降级回 HTTP)
export FUSION_DOC_TLS_CERT="/etc/letsencrypt/live/your-domain.com/fullchain.pem"
export FUSION_DOC_TLS_KEY="/etc/letsencrypt/live/your-domain.com/privkey.pem"
# 可选: 客户端证书 CA (mTLS 双向认证)
export FUSION_DOC_TLS_CA="/etc/fusion-doc/ca.pem"
# HTTP→HTTPS 跳转 (默认开; 独立端口 FUSION_DOC_HTTP_PORT 默认 11448, 关闭设 0)
export FUSION_DOC_TLS_REDIRECT="1"
export FUSION_DOC_HTTP_PORT="11448"

# 自签证书快速生成 (内网/测试)
openssl req -x509 -newkey rsa:2048 -nodes -keyout /tmp/key.pem -out /tmp/cert.pem -days 365 -subj "/CN=localhost"
```

启用后: HSTS 头强制后续连接走 TLS; `:11449` 走 HTTPS, `:11448` 收 HTTP 301 跳转。未启用 TLS 且绑 `0.0.0.0` 仍告警须前置反代。

### 多实例水平扩展 (同机多进程)

SQLite WAL 模式支持多进程并发读写同库 (单机内水平扩展)。`FUSION_DOC_ROLE` 区分职责, 避免多进程重复执行运维单点 (惊群):

```bash
# primary (默认): 担 E8 僵尸工作流清扫 + 自动备份
FUSION_DOC_ROLE="primary" FUSION_DOC_PORT="11449" bash start.sh start

# replica: 只接请求, 跳过单实例职责 (防多进程并发 UPDATE 同行 / 抢同一备份文件)
FUSION_DOC_ROLE="replica" FUSION_DOC_PORT="11450" bash start.sh start
```

迁移系统用 `BEGIN IMMEDIATE` + busy_retry 串行化并发启动 (多进程同时 boot 仅一个跑迁移, 其余排队), `busy_timeout=10000ms` 兜底。跨机/云规模扩展需引入外部队列与共享存储, 不在本机范围。

### 海量知识库 (sqlite-vec ANN)

向量检索默认线性扫 (零依赖兼容)。规模超万级 chunk 时启用 sqlite-vec 扩展走 ANN KNN (`O(logN)`):

```bash
npm install sqlite-vec         # 已列入依赖 (v1.0.6+)

# 向量维度须与 embedding 模型一致 (默认 384 = bge-small-en-v1.5)
export AI_EMBEDDING_DIM="384"
```

设计: `rag_chunks_vec` (vec0, 整数 rowid) + `rag_vec_map` (rowid↔chunk_id TEXT) 双表桥接 TEXT 主键; 写入双写 (rag_chunks.vector JSON 兜底 + vec 表 ANN)。扩展缺失/维度不符 → 自动降级线性扫 (零回归)。检索过采样 `topK×4` 补偿权限过滤淘汰。

### 容器/进程托管

```bash
# Docker (多阶段构建, 零外部依赖)
docker build -f deploy/Dockerfile -t fusion-doc .
docker run -d -p 11449:11449 \
    -e JWT_SECRET="$(openssl rand -hex 32)" \
    -e FUSION_MLX_API_KEY="..." \
    -v fusion-doc-data:/app/data fusion-doc

# systemd (进程自动拉起 + 日志接管)
sudo cp deploy/fusion-doc.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now fusion-doc
```

### 运维端点

- `GET /api/health/live` — liveness (进程存活, 永返 200)
- `GET /api/health` — readiness (DB + MLX + 磁盘占用, DB down 返 503)
- `GET /api/metrics` — Prometheus 文本指标 (uptime/内存/请求计数/业务计数/负载)
- `POST /api/system/backup` — 触发备份 (admin)
- `GET /api/system/backups` — 备份列表 (admin)
- `POST /api/system/restore` — 从备份恢复 (admin, 文件名白名单 + 路径穿越拦截)
- `GET /api/system/backup-schedule` — 自动备份调度状态 (admin)
- `/settings` · `/admin` — SPA 设置页与管理后台 (备份/恢复 UI)

安全特性: scrypt 密码哈希 · 认证端点限流 · JWT 强制密钥 · 默认本机绑定 · 在线热备 · SQL 参数化 · 请求体大小上限 · Webhook SSRF 防护 · 数据端点所有权校验 · 文件路径穿越防护 · MIME 白名单 · CORS 来源白名单 · 日志脱敏 · 内置 TLS · HSTS · HTTP→HTTPS 跳转。
变更历史见 [CHANGELOG.md](./CHANGELOG.md)。完整对抗性安全审计见 [../audit/fusion-doc-audit-0830.md](../audit/fusion-doc-audit-0830.md)。

## License

Apache-2.0
