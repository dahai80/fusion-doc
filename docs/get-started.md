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
owner: "@dahai"
source_of_truth:
  - README.md
  - scripts/setup.sh
  - start.sh
  - package.json
---

# 快速开始 / Get Started

**前置要求：** macOS 或 Linux，推荐 Node.js 24 LTS（含 npm）。锁定的 `better-sqlite3` 依赖不支持 Node.js 18；CI 仍使用 Node.js 20。

**Prerequisites:** macOS or Linux. Node.js 24 LTS (with npm) is recommended. The locked `better-sqlite3` dependency does not support Node.js 18. CI still uses Node.js 20.

## 中文入门

### 1. 获取源码并安装

```bash
git clone https://github.com/dahai80/fusion-doc.git
cd fusion-doc
bash scripts/setup.sh
```

安装脚本安装服务端依赖、创建 `data/` 下的数据目录，并在缺失时生成 `.env`。仓库已包含构建好的前端，首次使用无需另行构建。

### 2. 启用本地认证并启动

```bash
NODE_ENV=development FUSION_DOC_HOST=127.0.0.1 FUSION_DOC_LOCAL_AUTH=1 bash start.sh start
bash start.sh status
```

`FUSION_DOC_LOCAL_AUTH=1` 启用内置账户，不需要 fusion-identity。此模式仅用于本机单用户开发；保持监听 `127.0.0.1`，不要对外暴露或用于生产。启动日志在 `logs/stdout.log` 和 `logs/stderr.log`。

### 3. 新建、保存并刷新

1. 打开 [http://127.0.0.1:11449](http://127.0.0.1:11449)。首次访问时，在 **初始化 Fusion-Doc 管理员** 中填写邮箱、显示名称（可选）和至少 8 字符的密码，点 **完成安装**。按钮恢复且没有报错后刷新；若看到登录界面，用刚创建的账户登录。
2. 在首页点 **新建文档**，在正文输入 `我的第一页`。
3. 停止输入后约 2 秒触发自动保存。等几秒再刷新当前页面，确认正文仍显示 `我的第一页`。

### 4. 配置 AI（可选）

保存文档不需要 AI。需要 AI 时，先运行可用的 fusion-mlx 服务，再在 `.env` 中填入 `FUSION_CLIENT_KEY`。`FUSION_MLX_URL` 默认经 `http://127.0.0.1:11432` 网关访问，也可改为直连 `http://127.0.0.1:11434`。修改后用 `bash start.sh stop` 停止服务，再用第 2 步的启动命令启动。

## English quick start

### 1. Clone and install

```bash
git clone https://github.com/dahai80/fusion-doc.git
cd fusion-doc
bash scripts/setup.sh
```

The script installs server dependencies, creates the `data/` subdirectories, and writes `.env` if missing. The repository includes the built frontend, so no separate build is needed for the first run.

### 2. Start with local authentication

```bash
NODE_ENV=development FUSION_DOC_HOST=127.0.0.1 FUSION_DOC_LOCAL_AUTH=1 bash start.sh start
bash start.sh status
```

`FUSION_DOC_LOCAL_AUTH=1` enables built-in accounts without fusion-identity. Use this mode only for single-user development on your machine. Keep it bound to `127.0.0.1`; do not expose it to the network or use it in production. Startup logs are in `logs/stdout.log` and `logs/stderr.log`.

### 3. Create, save, and refresh a page

1. Open [http://127.0.0.1:11449](http://127.0.0.1:11449). On the **Initialize Fusion-Doc admin** screen, enter an email, an optional display name, and a password of at least eight characters. Click **Finish setup**. When the button is enabled again and no error appears, refresh. If prompted to sign in, use the account you created.
2. On the home page, click **New Document** and type `My first page` in the editor body.
3. Auto-save starts about two seconds after you stop typing. Wait a few seconds before refreshing the current page, then check that `My first page` is still in the editor.

### 4. Configure AI (optional)

You do not need AI to save documents. To enable AI, run a fusion-mlx service and set `FUSION_CLIENT_KEY` in `.env`. `FUSION_MLX_URL` defaults to the gateway at `http://127.0.0.1:11432`; set it to `http://127.0.0.1:11434` to connect directly instead. After editing `.env`, run `bash start.sh stop`, then start the server with the command from step 2.

## 开发与构建 / Develop and build

```bash
npm run dev:all      # server + vite client (hot reload, client on :11477)
npm run build        # client build -> gateway/public/ (prod static)
npm test             # bash scripts/test.sh: syntax check + node:test suite + health ping
npm run lint         # eslint server/ --quiet
```

## 停止 / Stop

```bash
bash start.sh stop
```

## 下一步 / Next steps

- [全部环境变量 / Environment variables](./config-reference.md)
- [API 契约 / API contract](./api-reference.md)
- [故障排查 / Troubleshooting](./troubleshooting.md)
