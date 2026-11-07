---
doc_id: fusion-doc/shell-embedding
product: fusion-doc
class: platform
entry: service
doc_type: guide
title: {zh: 指南：嵌入 Union Web Shell, en: Guide: Embedding in the Union Web Shell}
audience: engineer
status: draft
version: 1.0.17
updated: 2026-11-07
owner: "@dahai"
source_of_truth:
  - server/services/shell-register.js
  - client/manifest.json
  - client/src/vendor/fusion-web-sdk.js
  - README.md
---

# 嵌入 Union Web Shell / Embedding in the Union Web Shell

fusion-doc 可独立运行（`http://localhost:11449`），也可作为 fusion-gateway（`:11432`）Union Web shell 的远程模块，挂载于 `/shell/fusion-doc/` 同源 iframe 代理之下。嵌入时认证归属 shell 宿主——调用方的 shell 会话永远不会直接到达 fusion-doc。

En: fusion-doc runs standalone or as a remote module of the Union Web shell at `/shell/fusion-doc/`. When embedded, auth belongs to the shell host; the caller's shell session never reaches fusion-doc directly.

## 注册 / Registration

主实例启动时 POST `client/manifest.json`（id `fusion-doc`，category `infra`）到 `FUSION_GATEWAY_URL`（默认 `http://127.0.0.1:11432`）并持续心跳（`server/services/shell-register.js`，fire-and-forget）。需要 `FUSION_ADMIN_KEY`；缺失仅告警，独立运行不受影响。

En: The primary instance registers its manifest with heartbeats at boot; `FUSION_ADMIN_KEY` is required, otherwise it only warns.

## 凭证 / Service credential

网关向 fusion-doc 上游注入模块服务凭证：`FUSION_DOC_SHELL_API_KEY` 环境变量，或首次自动生成并持久化到 `data/shell-api-key.json`（0600）。携带该凭证的请求以 `shell` 租户 `operator` 角色通过（`FUSION_DOC_SHELL_TENANT`/`FUSION_DOC_SHELL_ROLE` 可改）；admin 端点仍要求 `tenant_admin`。

En: The gateway injects the module credential upstream; it authenticates as a configurable shell tenant/role, and admin endpoints stay admin-only.

## 嵌入模式行为 / Embedded behavior

- 进入方式：`?embedded=1` 或 `/shell/` 路径挂载；侧边栏与状态栏 chrome 隐藏，本地登录门跳过（`client/src/lib/embedded.js`）。
- 宿主同步：主题与语言跟随宿主。桥接是 vendored `@fusion/web-sdk` v0.1.2（`client/src/vendor/fusion-web-sdk.js`，来自 fusion-web-shell tag v0.1.2）：`theme.subscribe()` 是唯一事实源，`lang` 事件经 `sdk.i18n`，心跳 ping 由 SDK 内部应答。
- 构建：vite 相对 base `./`，同一 bundle 服务根路径与子路径；改动 vite 配置后需重新 `npm run build`。

En: Embedded mode (`?embedded=1` or `/shell/` mount) hides chrome, skips the local login gate, and follows host theme/lang via the vendored web SDK. The build uses a relative base, so one bundle serves both paths.

## 本地开发 / Local development

```bash
cd client && npm run dev      # vite on :11477, proxies /api and /ws to :11449
```

让 shell 指向 dev server：`FUSION_DEV_MODULES=fusion-doc:11477`（11477 已注册于 port-registry；5173 是保留端口，勿用）。

En: Point the shell at the dev server with `FUSION_DEV_MODULES=fusion-doc:11477`.

## 限制 / Constraints

- 仅 primary 实例注册（replica 跳过），避免重复清单项。
- WebSocket 协作（`/ws/collab/:pageId`）未发布，嵌入模式下同样返回 410。
- 心跳与注册为 fire-and-forget：网关短暂不可用不影响独立文档功能，恢复后由下一次心跳收敛。

En: Only the primary registers; WS collab is unreleased (410); registration is fire-and-forget and converges on the next heartbeat.
