---
doc_id: fusion-doc/office-roundtrip
product: fusion-doc
class: platform
entry: service
doc_type: guide
title: {zh: 指南：Office 文档往返, en: Guide: Office Round-Trip}
audience: engineer
status: draft
version: 1.0.21
updated: 2026-11-25
owner: "@dahai"
source_of_truth:
  - server/services/office.js
  - server/integrations/office-api.js
  - README.md
---

# Office 文档往返 / Office Round-Trip

fusion-doc 通过 fusion-office 的 office-api HTTP 服务（默认 `http://127.0.0.1:11492`，可用 `FUSION_OFFICE_API_URL` 覆盖）提供 Office 能力。当前上游端点：`/v1/xlsx/parse`（xlsx 导入）与 `/v1/docx/fill`（docx 模板填充合并）。

En: fusion-doc consumes the fusion-office office-api HTTP service (default `http://127.0.0.1:11492`, override with `FUSION_OFFICE_API_URL`). Upstream endpoints today: `/v1/xlsx/parse` (xlsx import) and `/v1/docx/fill` (docx template fill/merge).

## 前置 / Prerequisites

1. 启动 office-api：`cd fusion-office/services/office-api && ./start.sh start`；确认可用：`GET /api/office/status`（返回 `backend: "office-api"` 与能力矩阵）。
2. 文件路径仍经防穿越守卫（`safePath`）；multipart 上传有 50MB 上限。

En: Start office-api (`./start.sh start` in fusion-office) and check `GET /api/office/status` (returns `backend: "office-api"` plus a capability map). Path-traversal guards and the 50MB upload cap still apply.

## 导入 / Import

xlsx 上传导入会把每个 sheet 渲染为 HTML 表格并落库为普通 page；合并单元格由 office-api 预先展平。docx/pptx 导入在上游提供解析端点前返回 422 及可操作的错误信息（pptx 见 fusion-office#32）。

En: xlsx upload-import renders each sheet as an HTML table into a regular page; merged cells are pre-flattened by office-api. docx/pptx import returns 422 with an actionable message until upstream ships parse endpoints (pptx tracked in fusion-office#32).

```bash
curl -X POST http://localhost:11449/api/office/upload-import \
  -H "Authorization: Bearer $TOKEN" -H "X-Tenant-Id: $TID" \
  -F "file=@report.xlsx"
```

## 导出与预览 / Export and preview

上游暂无 html→docx/xlsx 写出与渲染端点：`/api/office/export/:id`、`/api/office/preview/:id`、`/api/office/create` 返回 422 并说明缺口（`/v1/docx/snapshot` 由 fusion-office v0.2 规划）。页面另可经 Manage 面板导出 md/html/pdf。

En: No upstream html→docx/xlsx write or render endpoint yet: export/preview/create return 422 describing the gap (`/v1/docx/snapshot` is planned for fusion-office v0.2). Pages can still be exported as md/html/pdf via the Manage panel.

## 模板合并 / Template merge

`POST /api/office/merge` 走 `/v1/docx/fill`：模板 docx + `{{name}}` 占位符（段落/表格/页眉页脚，含跨 run 拆分的标记）+ `values` JSON → 填充后的 docx。响应含 `unfilled` 列表；未提供的占位符填空串。

En: `POST /api/office/merge` calls `/v1/docx/fill`: a template docx with `{{name}}` placeholders (paragraphs/table cells/headers/footers, markers split across Word runs included) plus a `values` JSON yields the filled docx. The response carries an `unfilled` list; missing placeholders become empty strings.

## 限制 / Constraints

- office-api 不可用时 `/api/office/status` 如实报告 `available: false`，接口不降级伪造成功。
- 单实例内存限流 120 req/min 适用于所有 `/api/office/*`。
- WebSocket 协作路由与本功能无关（未发布，410）。

En: Availability is reported honestly by `/api/office/status` (`available: false` when down, no fake success); the shared 120 req/min rate limit applies.
