---
doc_id: fusion-doc/office-roundtrip
product: fusion-doc
class: platform
entry: service
doc_type: guide
title: {zh: 指南：Office 文档往返, en: Guide: Office Round-Trip}
audience: engineer
status: draft
version: 1.0.17
updated: 2026-11-07
owner: "@dahai"
source_of_truth:
  - server/services/office.js
  - server/integrations/officecli.js
  - README.md
---

# Office 文档往返 / Office Round-Trip

fusion-doc 通过 OfficeCLI 集成（`server/integrations/officecli.js`，常驻模式）提供 .docx/.xlsx/.pptx 的导入、导出、预览与模板合并，消费者无需自行处理 Office 格式解析。

En: The OfficeCLI integration (resident mode) handles .docx/.xlsx/.pptx import, export, preview, and template merge, so consumers never write Office format parsing themselves.

## 前置 / Prerequisites

1. 确认 OfficeCLI 可用：`GET /api/office/status`。
2. 所有 Office 子进程使用 `execFile` 参数数组（无 shell）执行；文件路径经防穿越守卫，MIME 按白名单校验。

En: Check availability via `/api/office/status`. All subprocesses run through `execFile` arg arrays with path-traversal guards and a MIME allowlist.

## 导入 / Import

```bash
curl -X POST http://localhost:11449/api/office/import \
  -H "Authorization: Bearer $TOKEN" -H "X-Tenant-Id: $TID" \
  -F "file=@report.docx"
```

导入结果为页面内容 + 元数据抽取（文本、结构、引用），落库为普通 page。

En: An import becomes a regular page with extracted text, structure, and metadata.

## 导出与预览 / Export and preview

```bash
curl -X POST http://localhost:11449/api/office/export/:pageId ...   # page -> Office file
curl -X POST http://localhost:11449/api/office/preview/:pageId ...  # preview payload
```

导出产物写入 `data/exports/`，启动清理按 `FUSION_DOC_DATA_RETAIN_DAYS`（默认 30 天）滚动删除。

En: Exports land in `data/exports/` and are cleaned up after `FUSION_DOC_DATA_RETAIN_DAYS` (default 30).

## 模板合并 / Template merge

`POST /api/office/merge` 以模板 + 变量集生成文档；变量提取可先用 `GET /api/templates/:id/variables`。约束：合并走 OfficeCLI 命令面，仅支持 OfficeCLI 原生支持的格式与指令，超出自定义命令面时用 `POST /api/office/command`（仍受同一安全守卫约束）。

En: Template merge is limited to what OfficeCLI natively supports; raw commands go through `/api/office/command` under the same guards.

## 限制 / Constraints

- 需要 OfficeCLI 进程可用；不可用时 `/api/office/status` 如实报告，接口不降级伪造成功。
- 单实例内存限流 120 req/min 适用于所有 `/api/office/*`。
- WebSocket 协作路由与本功能无关（未发布，410）。

En: Availability is reported honestly by `/api/office/status` (no fake success); the shared 120 req/min rate limit applies.
