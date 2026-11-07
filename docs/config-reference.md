---
doc_id: fusion-doc/config-reference
product: fusion-doc
class: platform
entry: service
doc_type: config-reference
title: {zh: Fusion-Doc 配置参考, en: Fusion-Doc Config Reference}
audience: engineer
status: draft
version: 1.0.17
updated: 2026-11-07
owner: "@dahai"
source_of_truth:
  - server/config.js
  - start.sh
  - README.md
  - CLAUDE.md
---

# 配置参考 / Config Reference

配置三级来源：环境变量 > `.env` > 代码默认值。`.env` 由 `server/config.js` 内置解析器读取（无 dotenv 依赖），版本号一律读 `package.json`。密钥真实值只写入 `.env`（该文件不进 git），文档与提交中不得出现。

En: Config resolution order is env var > `.env` > hardcoded default, parsed by a hand-rolled parser in `server/config.js`. Secret values live only in `.env` (not committed).

## 服务与生命周期 / Service and lifecycle

| 变量 / Var | 默认 / Default | 说明 / Description |
|---|---|---|
| `FUSION_DOC_PORT` | `11449` | HTTP(S) 监听端口（port-registry 注册） |
| `FUSION_DOC_HOST` | `127.0.0.1` | 生产默认本机回环；`0.0.0.0` 必须置于反向代理 + TLS 之后 |
| `NODE_ENV` | `development` | `production` 时绑定 127.0.0.1 并强制密钥检查 |
| `FUSION_DOC_ROLE` | `primary` | `primary` 独占单实例职责（僵尸工作流清扫 + 自动备份）；`replica` 仅服务请求，避免多进程惊群 |
| `FUSION_DOC_AUTORESTART` | `1` | start.sh 崩溃自动拉起；`0` 关闭（退回 nohup 一次性） |
| `FUSION_DOC_RESTART_BACKOFF_MAX` | `30` | 自动重启退避上限（秒） |
| `FUSION_DOC_LOG_MAX_BYTES` | `10485760` | 单日志文件滚动阈值（10MB，保留 `.1` 副本） |
| `FUSION_DOC_LOG_KEEP` | `3` | 日志保留副本数 |
| `FUSION_DOC_DATA_RETAIN_DAYS` | `30` | 启动时清理过期 `exports/`、`versions/`（天） |
| `STORAGE_DIR` | `data/` | 运行时数据根目录 |
| `LOG_FORMAT` | `text` | `json` 启用结构化日志（ELK 采集） |
| `LOG_LEVEL` | `info` | 日志级别 |
| `CORS_ORIGINS` | （空） | CORS 来源白名单 |
| `SESSION_EXPIRY` | （内置默认） | 会话过期时间 |

## 认证与租户 / Auth and tenant

| 变量 / Var | 默认 / Default | 说明 / Description |
|---|---|---|
| `FUSION_IDENTITY_URL` | `http://127.0.0.1:11470` | fusion-identity 地址（唯一 JWT 签发方） |
| `FUSION_IDENTITY_SERVICE_TOKEN` | （必填，生产） | 生产缺失则启动失败（fail-closed，`server/config.js`） |
| `FUSION_DOC_LOCAL_AUTH` | `0` | `1` 启用本地 HS256 + `users` 表旁路（仅开发，生产禁用） |
| `JWT_SECRET` | （本地旁路必填） | 本地旁路模式 HS256 签名密钥；生产用 `openssl rand -hex 32` |
| `FUSION_DOC_SHELL_API_KEY` | 自动生成 `data/shell-api-key.json`（0600） | Shell 模块服务凭证（fusion-gateway 注入上游） |
| `FUSION_DOC_SHELL_TENANT` | `shell` | Shell 凭证映射的租户 |
| `FUSION_DOC_SHELL_ROLE` | `operator` | Shell 凭证映射的角色（admin 端点不受影响） |

## Shell 注册 / Shell registration

| 变量 / Var | 默认 / Default | 说明 / Description |
|---|---|---|
| `FUSION_GATEWAY_URL` | `http://127.0.0.1:11432` | fusion-gateway 地址；启动时 POST `client/manifest.json` 注册 + 心跳 |
| `FUSION_ADMIN_KEY` | （空） | 注册所需管理员密钥；缺失仅告警，独立运行不受影响 |

## AI 与生态 / AI and ecosystem

| 变量 / Var | 默认 / Default | 说明 / Description |
|---|---|---|
| `FUSION_MLX_URL` | `http://127.0.0.1:11432` | fusion-mlx 地址（默认走网关，可覆盖为直连 `:11434`） |
| `FUSION_CLIENT_KEY` | （AI 功能必填） | fusion-mlx API key；缺失时集成层抛错（fail visibly），禁止硬编码 |
| `AI_CHAT_MODEL` / `AI_EMBEDDING_MODEL` / `AI_RERANK_MODEL` | （.env 配置） | chat / embedding / rerank 模型名 |
| `AI_EMBEDDING_DIM` | `384` | 向量维度（migration 017 锁定；须与 embedding 模型一致，默认 bge-small-en-v1.5） |
| `KNN_OVERSAMPLE` | `4` | ANN 过采样倍数，补偿权限过滤淘汰 |
| `FUSION_KB_URL` | `http://127.0.0.1:11436` | fusion-rag（原 fusion-kb）地址 |
| `FUSION_COWORK_URL` | `http://127.0.0.1:11437` | fusion-cowork 地址 |
| `FUSION_MODEL_HUB_URL` | `http://127.0.0.1:11444` | fusion-model-hub 地址 |
| `FUSION_TRAINER_BIN` | 共享 venv 内 CLI 路径 | fusion-trainer 可执行文件（SFT 数据集导出训练） |

## TLS / Built-in TLS

| 变量 / Var | 默认 / Default | 说明 / Description |
|---|---|---|
| `FUSION_DOC_TLS_CERT` / `FUSION_DOC_TLS_KEY` | （空） | 同时设置即启用内置 HTTPS（Node 原生 `tls`，零新依赖）；任一缺失或不可读则启动失败，绝不静默回退 HTTP |
| `FUSION_DOC_TLS_CA` | （空） | 客户端证书 CA（mTLS 双向认证） |
| `FUSION_DOC_TLS_REDIRECT` | `1` | HTTP→HTTPS 301 跳转开关 |
| `FUSION_DOC_HTTP_PORT` | `11448` | HTTP 跳转端口（`0` 关闭） |
| `AUTO_BACKUP_HOURS` | `24` | 进程内自动备份间隔；`<=0` 关闭 |

## 数据库 / Database

SQLite 主库 `data/db/fusion-doc.db`：`journal_mode=WAL`、`foreign_keys=ON`、`busy_timeout=5000`，查询全部参数化。better-sqlite3 缺失时回退 `data/` 下 JSON 文件存储。迁移 `001`–`020` 内联在 `server/db.js`（`_migrations` 表跟踪，`IF NOT EXISTS` 幂等），并发启动由 `BEGIN IMMEDIATE` + busy_retry 锁串行化。向量检索默认线性扫描；sqlite-vec 扩展可用且维度匹配时启用 `vec0` ANN，失败自动回退，零回归。

En: SQLite primary at `data/db/fusion-doc.db` (WAL, foreign keys, parameterized queries), JSON-file fallback without better-sqlite3. Migrations 001-020 are inline in `server/db.js`, serialized by a `BEGIN IMMEDIATE` lock. Vector search falls back from sqlite-vec ANN to linear scan automatically.
