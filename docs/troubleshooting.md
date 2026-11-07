---
doc_id: fusion-doc/troubleshooting
product: fusion-doc
class: platform
entry: service
doc_type: troubleshooting
title: {zh: Fusion-Doc 故障排查, en: Fusion-Doc Troubleshooting}
audience: engineer
status: draft
version: 1.0.17
updated: 2026-11-07
owner: @dahai
source_of_truth:
  - start.sh
  - server/config.js
  - server/middleware/auth.js
  - server/services/rag-hybrid.js
  - SECURITY.md
---

# 故障排查 / Troubleshooting

先看日志 / Check logs first:

```bash
bash start.sh status                 # PID + 运行状态（退出码 0 = 运行中）
tail -100 logs/stderr.log            # 启动失败通常在这里
tail -100 logs/stdout.log
curl -s http://localhost:11449/api/health   # readiness: DB + MLX + 磁盘
curl -s http://localhost:11449/api/metrics  # Prometheus 指标
```

## 启动失败 / Startup failures

**端口被占用 / Port already in use**

`FUSION_DOC_PORT`（默认 11449）被其他进程占用。`lsof -i :11449` 找到占用者；端口分配以 `/Users/dahai/fusion/architecture/port-registry.yaml` 为唯一事实源，不得私改端口。

En: Find the occupier with `lsof -i :11449`; port allocation is governed by the port registry.

**生产模式启动即退出：缺 `FUSION_IDENTITY_SERVICE_TOKEN` / Exits at boot in production**

fusion-identity service token 缺失时 `server/config.js` fail-closed 直接失败。设置 `FUSION_IDENTITY_SERVICE_TOKEN`，或本地开发临时用 `FUSION_DOC_LOCAL_AUTH=1`（生产禁用）。

En: The service token is mandatory in production (fail-closed). Set it, or use the local bypass for dev only.

**TLS 证书不可读 / TLS cert unreadable**

`FUSION_DOC_TLS_CERT`/`FUSION_DOC_TLS_KEY` 任一缺失或不可读时启动失败，不会静默回退 HTTP。自签快速验证：

```bash
openssl req -x509 -newkey rsa:2048 -nodes -keyout /tmp/key.pem -out /tmp/cert.pem -days 365 -subj "/CN=localhost"
```

## AI 功能异常 / AI features failing

**"MLX key missing" 类错误 / visible key error**

集成层在 `FUSION_CLIENT_KEY` 缺失时故意抛错（设计为 fail visibly，非 bug）。将 key 写入 `.env` 并重启。

En: The integration throws when the key is missing by design. Set `FUSION_CLIENT_KEY` and restart.

**AI 对话无响应 / chat not responding**

确认 fusion-mlx 在线：默认走网关 `http://127.0.0.1:11432`（`FUSION_MLX_URL` 可覆盖为直连 `:11434`）。`/api/health` readiness 包含 MLX 状态；模型未加载时先 `~/fusion/fusion-mlx/start.sh start` 再测试。

En: Verify the fusion-mlx engine is up; readiness includes its status.

## 检索问题 / Retrieval issues

**向量检索慢 / vector search slow**

默认线性扫描是兼容性回退。chunk 数超过约 1 万时启用 sqlite-vec ANN：确认扩展可用、`AI_EMBEDDING_DIM` 与 embedding 模型一致（默认 384 = bge-small-en-v1.5）。扩展缺失或维度不匹配会自动回退线性扫描（日志有记录），不会阻断启动。

En: ANN requires the sqlite-vec extension and a matching `AI_EMBEDDING_DIM`; otherwise search degrades to linear scan.

**检索结果缺文档 / results missing documents**

混合 RAG 对权限过滤做了 `KNN_OVERSAMPLE=4` 过采样补偿；若页面刚改过，先 `POST /api/rag/reindex/:id` 重建该页分块，再查询。

En: Reindex the page (`POST /api/rag/reindex/:id`) before querying.

## 认证与租户 / Auth and tenant

**401/403（`AUTH_` 错误码）/ unauthorized**

- Token 必须由 fusion-identity 签发，`X-Tenant-Id` 必须与 token 租户一致，否则拒绝（fail-closed）。
- Shell 场景：凭证是 `FUSION_DOC_SHELL_API_KEY`（或 `data/shell-api-key.json`），以 `shell` 租户 `operator` 角色（`FUSION_DOC_SHELL_TENANT`/`FUSION_DOC_SHELL_ROLE` 可调）通过；admin 端点仍需 `tenant_admin`。
- 429：限流为内存实现（`/api/auth/*` 10/min，其余 120/min），重启进程即清零；多实例各自独立计数。

En: Tokens must come from fusion-identity with a matching tenant header; shell credentials map to a configurable tenant/role; 429s come from in-memory per-instance rate limits.

**跨租户看到 404 / cross-tenant 404**

设计行为：查询按 `req.user.tid` 过滤，跨租户访问返回 404，不泄露资源存在性。

En: By design — cross-tenant access returns 404 to avoid existence leakage.

## Shell 集成 / Shell integration

**模块未注册到网关 / module not registered**

注册需要 `FUSION_ADMIN_KEY`；缺失仅告警、独立运行不受影响。确认 `FUSION_GATEWAY_URL`（默认 `http://127.0.0.1:11432`）可达，且 fusion-doc 是 primary 实例（replica 不注册）。

En: Registration needs `FUSION_ADMIN_KEY` and runs on the primary instance only; a missing key only warns.

**嵌入模式样式/登录异常 / embedded mode issues**

嵌入模式（`?embedded=1` 或 `/shell/` 挂载）隐藏 chrome 并跳过本地登录门，主题/语言跟随宿主。前端构建使用相对 base，改过 vite 配置后需重新 `npm run build`。本地调试 HMR 用 client dev 端口 11477（`FUSION_DEV_MODULES=fusion-doc:11477` 指向网关）。

En: Embedded mode hides chrome and skips the local login gate; rebuild after vite config changes.

## 协作返回 410 / collab returns 410

`/ws/collab/:pageId` 实时协作未发布，路由固定返回 410。这不是故障；不要围绕它建 issue。

En: The real-time collaboration route is intentionally not released and responds 410.

## 数据与备份 / Data and backup

**数据库锁冲突 / database locked**

多进程并发启动由迁移锁串行化（busy_timeout 10000ms 兜底）；单进程内 SQLite WAL 支持同机多进程读写。若频繁 BUSY，检查是否有多个 primary 角色实例在同时跑单实例职责——replica 必须设 `FUSION_DOC_ROLE=replica`。

En: Concurrent startups serialize on the migration lock; make sure only one primary instance runs single-instance duties.

**备份/恢复 / backup and restore**

手动 `bash scripts/backup.sh 30`（cron 可配）；进程内调度 `AUTO_BACKUP_HOURS`（`<=0` 关闭）；API `POST /api/system/backup`、`POST /api/system/restore`（admin，文件名白名单 + 路径穿越防护）。恢复前停止写入。

En: Use the backup script, the in-process scheduler, or the admin endpoints; stop writes before restore.

**JSON 回退模式 / JSON fallback mode**

better-sqlite3 不可用时自动回退 `data/` JSON 文件存储（日志可见）。行为可用但性能与事务性下降，生产应修复原生模块安装。

En: Without better-sqlite3 the server falls back to JSON storage; fix the native module for production.
