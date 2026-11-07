---
doc_id: fusion-doc/get-started
product: fusion-doc
class: platform
entry: service
doc_type: get-started
title: {zh: Fusion-Doc 快速开始, en: Fusion-Doc Get Started}
audience: engineer
status: draft
version: 1.0.17
updated: 2026-11-07
owner: @dahai
source_of_truth:
  - README.md
  - scripts/setup.sh
  - start.sh
  - package.json
---

# 快速开始 / Get Started

前置要求 / Prerequisites: Node 18+（CI 使用 Node 20），macOS 或 Linux。

## 1. 安装 / Install

```bash
cd ~/fusion/fusion-doc
bash scripts/setup.sh
```

安装依赖、初始化 `data/{db,storage,exports,versions,logs}` 目录，并在缺失时写入 `.env`。

En: Installs dependencies, initializes the `data/` subdirectories, and writes `.env` if missing.

## 2. 启动 / Start

```bash
bash start.sh start     # PID 文件 .fusion-doc.pid；日志 logs/stdout.log、logs/stderr.log
bash start.sh status    # 退出码 0 = 运行中
```

访问 / Access:

- `http://localhost:11449` — 文档编辑器 / document editor
- `http://localhost:11449/api/health` — 健康检查（DB + MLX + 磁盘）/ health check

## 3. AI 功能（可选）/ AI features (optional)

AI 对话、内联补全、embedding/RAG 依赖兄弟服务 fusion-mlx（默认经网关 `http://127.0.0.1:11432`，可用 `FUSION_MLX_URL` 覆盖为直连 `:11434`）。密钥缺失时集成层直接抛错（fail visibly），不会静默降级。

En: AI chat, inline completion, and embedding/RAG call the sibling fusion-mlx engine. A missing key throws visibly; there is no silent fallback.

```bash
~/fusion/fusion-mlx/start.sh start
export FUSION_CLIENT_KEY="<your fusion-mlx key>"   # set in .env or shell
```

## 4. 认证模式 / Auth mode

生产模式（默认）要求 fusion-identity（`:11470`）签发 JWT，且启动时必须提供 `FUSION_IDENTITY_SERVICE_TOKEN`（缺失则启动失败）。本地单用户开发可临时开启旁路：

En: Production mode requires fusion-identity-issued JWTs and `FUSION_IDENTITY_SERVICE_TOKEN` at startup (missing = startup fails). For local single-user dev only:

```bash
export FUSION_DOC_LOCAL_AUTH=1    # dev only, forbidden in production
```

## 5. 开发与构建 / Develop and build

```bash
npm run dev:all      # server + vite client (hot reload, client on :11477)
npm run build        # client build -> gateway/public/ (prod static)
npm test             # bash scripts/test.sh: syntax check + node:test suite + health ping
npm run lint         # eslint server/ --quiet
```

## 6. 停止 / Stop

```bash
bash start.sh stop   # graceful stop; logs rotate at 10MB (FUSION_DOC_LOG_MAX_BYTES)
```

## 下一步 / Next steps

- 全部环境变量 / all env vars: `docs/config-reference.md`
- API 契约 / API contract: `docs/api-reference.md`
- 故障排查 / troubleshooting: `docs/troubleshooting.md`
