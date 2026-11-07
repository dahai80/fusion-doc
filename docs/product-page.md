---
doc_id: fusion-doc/product-page
product: fusion-doc
class: platform
entry: service
doc_type: product-page
title: {zh: Fusion-Doc 产品页, en: Fusion-Doc Product Page}
audience: engineer
status: draft
version: 1.0.17
updated: 2026-11-07
owner: @dahai
source_of_truth:
  - README.md
  - CLAUDE.md
  - package.json
  - client/manifest.json
---

# Fusion-Doc 产品页 / Product Page

## 定位 / Positioning

Fusion-Doc 是 Fusion 生态（"一核九端"）的文档平台层：一个 AI 优先的文档 OS，运行在 Apple Silicon 本机栈上。它以单个 Node 服务（默认 `127.0.0.1:11449`）提供 TipTap 富文本编辑器、知识图谱、Office 格式往返、混合 RAG 与文档工作流，零外部依赖（无 PostgreSQL / Redis / NestJS / 反向代理）。

En: Fusion-Doc is the document platform layer of the Fusion ecosystem ("one core, nine ends"): an AI-first document OS on the local Apple Silicon stack. A single Node service (default `127.0.0.1:11449`) serves a TipTap rich-text editor, knowledge graph, Office format round-trip, hybrid RAG, and document workflows — with zero external dependencies (no PostgreSQL / Redis / NestJS / reverse proxy).

```yaml
platform:
  serves:              # 消费者不再需要自己写的东西 / what consumers no longer write
    - document editing UI (TipTap editor, AI ghost text, bubble menu, slash commands, bidirectional links)
    - document/page/book/workspace storage with SQLite WAL + tenant-scoped queries
    - full-text search (SQLite FTS5) and hybrid RAG retrieval (vector + FTS5 + BM25 + RRF + rerank)
    - knowledge graph API and D3 force-directed visualization
    - Office import/export/preview/merge via OfficeCLI (execFile arg arrays, no shell)
    - document workflow state machine (draft/review/publish) with audit trail
    - authentication, tenant isolation, roles, and admin gates (delegated to fusion-identity)
  builds_on:
    - fusion-mlx (:11434 via gateway :11432) — chat / embeddings / rerank, OpenAI-compatible HTTP
    - fusion-identity (:11470) — sole JWT issuer, tenant registry, usage reporting
    - officecli — resident-mode Office conversion subprocess
  hosts:
    - the document SPA (React 18 + Vite build output in gateway/public/, served by the same Node process)
    - the Union Web shell module fusion-doc (registered to fusion-gateway :11432, mounted at /shell/fusion-doc/)
    - plugin extensions loaded from server/plugins/ at init
  integration_surface:
    - REST API under /api/* (~110 routes, 30 controllers, server/controllers/index.js)
    - WebSocket routes under /ws/* (ws library, noServer upgrade)
    - shell module manifest client/manifest.json + heartbeat (services/shell-register.js)
    - usage reporting to fusion-identity POST /api/v1/tenants/{tid}/usage (fire-and-forget)
    - SFT dataset export + fusion-trainer CLI subprocess (server/controllers/training.js, FUSION_TRAINER_BIN)
  extension_points:
    - drop-in plugins in server/plugins/ (loader.js + registry.js, loaded at init)
    - new controllers appended to the array in server/controllers/index.js (register(app) contract)
    - workflow YAML presets (server/services/workflow-engine.js, 5 presets, /api/workflows/seed)
    - document templates with variable extraction (server/services/template-engine.js, 8 seeded presets)
```

## 能力与边界 / Capabilities and Constraints

| 能力 / Capability | 消费者不再编写 / Consumer no longer writes | 约束 / Constraint |
|---|---|---|
| 富文本编辑 / Rich text | Editor UI, auto-save, AI ghost text (`Cmd+J`), bubble menu, `/` slash commands | TipTap 2.x; AI actions require fusion-mlx and `FUSION_CLIENT_KEY` (fails visibly when missing) |
| 知识图谱 / Knowledge graph | `[[` bidirectional links, backlink inference, D3 graph page | Graph search quality depends on indexed chunks; semantic path needs embeddings |
| 检索 / Retrieval | FTS5 full-text modal (`Cmd+K`) + hybrid RAG (`/api/rag/enhanced-query`) | Vector scan is linear by default; sqlite-vec ANN needs `AI_EMBEDDING_DIM` match (default 384) and degrades to linear scan without the extension |
| Office 往返 / Office round-trip | .docx/.xlsx/.pptx import, export, preview, template merge | Requires OfficeCLI; office ops are subprocess `execFile` only — no arbitrary shell commands |
| 工作流 / Workflow | draft→review→publish state machine + audit trail + YAML workflow presets | Workflow runs are in-process; no external queue (single-machine scaling only) |
| 多租户 / Multi-tenant | JWT verification, `tenant_id` scoping, 4 roles, admin gates | fusion-identity is mandatory in production (`FUSION_IDENTITY_SERVICE_TOKEN`, fail-closed); `FUSION_DOC_LOCAL_AUTH=1` bypass is dev-only |
| Shell 集成 / Shell integration | manifest registration, heartbeat, embedded chrome-less mode, host theme/lang sync | Registration needs `FUSION_ADMIN_KEY` (warn-only if missing); WebSocket collab route is not released (responds 410) |
| 运维 / Ops | `/api/health`, `/api/metrics` (Prometheus), backup/restore endpoints + UI, auto-backup scheduler, built-in TLS + HSTS | Memory-based rate limiting is single-instance; multi-process scaling uses `FUSION_DOC_ROLE=primary\|replica` on one machine |

## 用户与入口 / Audience and Entry Points

- 工程师 / Engineers: `docs/get-started.md`（本地起步）、`docs/api-reference.md`（API 契约）、`docs/architecture.md`（分层与请求生命周期）。
- 运维 / Operators: `docs/config-reference.md`（全部环境变量）、`docs/troubleshooting.md`（故障排查）、`SECURITY.md`（安全策略）。
- 独立模式 / Standalone: `http://localhost:11449`；嵌入模式 / Embedded: fusion-gateway `:11432` 下的 `/shell/fusion-doc/`。

## 版本 / Version

当前版本 `1.0.17`（`package.json`，运行时被 banner/health/branding/`X-Fusion-Doc` 头读取，代码中禁止硬编码）。变更历史见 `CHANGELOG.md`。

En: Current version `1.0.17` (from `package.json`, read at runtime by banner/health/branding/`X-Fusion-Doc` header — never hardcode). History in `CHANGELOG.md`.
