---
doc_id: fusion-doc/api-reference
product: fusion-doc
class: platform
entry: service
doc_type: api-reference
title: {zh: Fusion-Doc API 参考, en: Fusion-Doc API Reference}
audience: engineer
status: draft
version: 1.0.17
updated: 2026-11-07
owner: @dahai
source_of_truth:
  - server/controllers/index.js
  - README.md
  - server/middleware/auth.js
---

# API 参考 / API Reference

基础地址 / Base URL: `http://localhost:11449`。路由由 30 个控制器注册（约 110 条路由），权威清单见 `server/controllers/index.js`；本文列出对外契约的主要分组。

En: Routes are registered by 30 controllers (~110 routes). The authoritative index is `server/controllers/index.js`; this page lists the main external contract groups.

## 认证 / Authentication

除公开路径（`/api/health`、`/api/auth/login`、`/api/system/setup`、`/api/branding`、`/api/theme`）外，所有请求需携带：

En: Except for the public paths above, every request carries:

```text
Authorization: Bearer <jwt issued by fusion-identity>
X-Tenant-Id: <tenant id, must match the token tenant>
```

- Token 由 fusion-identity（`POST /api/v1/auth/verify`）验证，fail-closed（`server/middleware/auth.js`）。不匹配返回 `AUTH_` 错误码。
- Shell 模块凭证 `FUSION_DOC_SHELL_API_KEY` 以 `shell` 租户 `operator` 角色通过验证；admin 端点仍需 `tenant_admin`。
- 限流 / Rate limit: `/api/auth/*` 10/min，其余 API 120/min（内存实现，单实例）。

## 主要端点 / Main Endpoints

### 内容 / Content

| Method | Path | 说明 / Description |
|---|---|---|
| POST | `/api/auth/login` | 登录（本地旁路模式）/ login (local bypass mode) |
| GET/POST | `/api/workspaces` | Workspace CRUD（DocMost 式四层：workspace→book→chapter→page） |
| GET/POST | `/api/books` | Book CRUD |
| GET/POST/PUT/DELETE | `/api/pages` | Page CRUD（自动保存、版本、租户过滤） |
| GET | `/api/search?q=` | FTS5 全文检索 / full-text search |
| GET/POST | `/api/collections` | 集合管理（v1.0.17，issue #73）/ collections management |

### 图谱 / Knowledge graph

| Method | Path | 说明 / Description |
|---|---|---|
| GET | `/api/graph` | 全图数据 / graph data |
| GET | `/api/graph/search?q=` | 语义图谱搜索 / semantic graph search |
| GET | `/api/graph/node/:id` | 节点详情 + 邻居 / node detail + neighbors |

### AI 与检索 / AI and retrieval

| Method | Path | 说明 / Description |
|---|---|---|
| POST | `/api/ai/chat` | AI 对话，SSE 流式（fusion-mlx）/ AI chat, SSE streaming |
| POST | `/api/ai/embeddings` | 本地 embedding / local embeddings |
| POST | `/api/copilot/complete` `/rewrite` `/translate` `/summarize` `/expand` `/command` | 选区内联 AI 动作 / inline AI actions |
| GET | `/api/copilot/context/:id` | 页面上下文组装 / page context for AI |
| POST | `/api/rag/query` | 向量检索 / vector retrieval |
| POST | `/api/rag/enhanced-query` | 混合 RAG（向量 + FTS5 + BM25 + RRF + 重排）/ hybrid RAG |
| POST | `/api/rag/reindex/:id` | 重建页面分块索引 / reindex page chunks |
| GET | `/api/rag/chunks/:pageId` | 页面分块 / page chunks |

### Office

| Method | Path | 说明 / Description |
|---|---|---|
| GET | `/api/office/status` | OfficeCLI 可用性 / OfficeCLI availability |
| POST | `/api/office/create` `/import` `/merge` `/command` | 创建 / 导入 / 模板合并 / 原生命令 |
| POST | `/api/office/export/:id` `/preview/:id` | 导出 / 预览（.docx/.xlsx/.pptx） |

### 模板与工作流 / Templates and workflow

| Method | Path | 说明 / Description |
|---|---|---|
| GET/POST | `/api/templates`；POST `/api/templates/:id/instantiate`；GET `/api/templates/:id/variables` | 模板 CRUD / 实例化 / 变量提取 |
| GET/POST | `/api/workflows`；POST `/api/workflows/:id/run`；GET `/api/workflows/:id/runs`；POST `/api/workflows/seed` | 工作流 CRUD / 执行 / 历史 / 5 个预设 |
| GET | `/api/workflow/:id`；POST `/api/workflow/:id/transition` | 页面工作流状态 / 状态迁移（draft→review→publish） |

### 运维 / Ops

| Method | Path | 说明 / Description |
|---|---|---|
| GET | `/api/health/live` | 存活探针（进程存活即 200）/ liveness |
| GET | `/api/health` | 就绪探针（DB + MLX + 磁盘；DB 不可用返回 503）/ readiness |
| GET | `/api/metrics` | Prometheus 文本指标 / Prometheus text metrics |
| POST | `/api/system/backup`；GET `/api/system/backups`；POST `/api/system/restore` | 备份 / 列表 / 恢复（admin，文件名白名单 + 路径穿越防护） |
| GET | `/api/system/backup-schedule` | 自动备份计划状态（admin） |

### WebSocket

`/ws/collab/:pageId` — 实时协作路由**未发布**，当前返回 410（`server/controllers/collaboration.js`）。

En: The real-time collaboration route is not released; it currently responds 410.

## 错误格式 / Error shape

错误响应统一 `{ "detail": "..." }` + HTTP 状态码；数据列 `batchingResults`/`detail` 类 JSON 字段在控制器返回前解析为对象。响应必须经 `utils/response` 助手（`json`/`success`/`error`/`notFound`/`created`/`list`），控制器内禁止手写 `res.writeHead`。

En: Error responses are `{ "detail": "..." }` with an HTTP status code. Handlers must return through the `utils/response` helpers.
