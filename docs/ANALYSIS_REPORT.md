# ~/mac-doc 开源文档软件分析报告

---

## 一、项目总览

| 项目 | 类型 | 技术栈 | 协议 | 大小 | Stars |
|------|------|--------|------|------|-------|
| **DocMost** | 协作文档 Wiki | NestJS + React + TipTap + Yjs | AGPL-3.0 | ~50MB | 高 |
| **Wiki.js** | 通用 Wiki | Node.js + Vue.js + Markdown | AGPL-3.0 | ~100MB | 高 |
| **BookStack** | 结构化文档 | PHP + Laravel + MySQL | MIT | ~30MB | 中 |
| **Teedy (docs)** | 文档管理系统 | Java + Spring + Hibernate | GPL-2.0 | ~20MB | 中 |
| **Zettlr** | Markdown 编辑器 | Electron + TypeScript + Vue | GPL-3.0 | ~50MB | 中 |
| **MacDown** | macOS Markdown 编辑器 | Objective-C + Cocoa | MIT | ~10MB | 中 |
| **LibreOffice Core** | Office 套件 | C++ (608MB) | MPL-2.0 | 608MB | 极高 |

---

## 二、逐项目深度分析

### 2.1 DocMost — 协作文档 Wiki

**仓库：** https://github.com/docmost/docmost
**版本：** v0.95.0
**技术栈：** NestJS + React + TypeScript + TipTap + Yjs + PostgreSQL + Redis

**架构：**
```
apps/
├── client/          ← React SPA (TipTap 编辑器 + Yjs 协作)
│   ├── src/
│   │   ├── components/  ← 通用 UI 组件
│   │   ├── features/    ← 功能模块（附件/共享/标签）
│   │   ├── hooks/       ← React Hooks
│   │   ├── lib/         ← 工具库（api-client/config/路由）
│   │   ├── pages/       ← 页面（auth/dashboard/space/settings）
│   │   └── ee/          ← 企业版（AI Chat/MFA/Billing）
│   └── dist/           ← 构建产物
└── server/          ← NestJS 后端 API
    ├── src/
    │   ├── core/         ← 核心模块（auth/attachment/page/space/user/search）
    │   ├── collaboration/← Yjs 协作引擎（Hocuspocus）
    │   ├── integrations/ ← 集成（environment/mail/storage/queue/export/import）
    │   ├── ws/           ← WebSocket 适配器
    │   └── common/       ← 公共（interceptors/logger/validators）
    └── dist/            ← 构建产物
```

**核心优势：**
- 实时协作基于 Yjs CRDT + Hocuspocus，多人同时编辑无冲突
- TipTap 编辑器（ProseMirror 封装）支持 Markdown、富文本、表格、图片、代码块
- 内置绘图（Mermaid、Excalidraw、Draw.io）
- 权限系统（CASL 能力模型）
- 空间 → 目录 → 页面 三级结构
- 模块化 NestJS 架构，依赖注入清晰
- 前端与后端通过 monorepo (NX) 管理

**可借鉴点：**
- TipTap + Yjs 协作方案可直接复用
- 前端组件库（Mantine UI）的组织方式
- API 路由设计（RESTful）
- 权限模型（CASL）

---

### 2.2 Wiki.js — 通用 Wiki

**仓库：** https://github.com/requarks/wiki
**版本：** v2.0.0
**技术栈：** Node.js + Vue.js + Markdown + Git + PostgreSQL

**架构：**
```
server/
├── controllers/     ← 路由控制器
├── core/            ← 核心引擎
├── db/              ← 数据库层
├── graph/           ← GraphQL API
├── helpers/         ← 工具函数
├── jobs/            ← 后台任务
├── middlewares/     ← 中间件
├── models/          ← 数据模型
├── modules/         ← 功能模块
├── templates/       ← 邮件模板
├── themes/          ← 主题系统
└── views/           ← 服务端渲染模板 (Pug)

client/
├── components/      ← Vue 组件
├── helpers/         ← 工具函数
├── modules/         ← 功能模块
├── store/           ← Vuex 状态管理
├── themes/          ← 主题
└── scss/            ← 样式
```

**核心优势：**
- Markdown 优于富文本，Git 作为版本管理后端
- 细粒度权限系统
- 多认证方式（LDAP、OAuth、SAML）
- 模块化插件架构
- 主题系统
- 搜索强大（基于数据库或 Typesense）
- 服务端渲染（Pug 模板引擎）

**可借鉴点：**
- Git 作为版本管理后端的思路
- 插件架构设计
- 多认证方式集成
- 搜索架构（数据库全文搜索 + Typesense）

---

### 2.3 BookStack — 结构化文档

**仓库：** https://github.com/BookStackApp/BookStack
**技术栈：** PHP + Laravel + MySQL

**架构：**
```
app/
├── Access/          ← 认证/授权
├── Activity/        ← 活动日志
├── Api/             ← REST API
├── Config/          ← 配置
├── Console/         ← 命令
├── Entities/        ← 实体（Models/Controllers/Repos）
│   ├── Models/      ← 数据模型
│   ├── Repos/       ← 数据仓库
│   └── Controllers/ ← 控制器
├── Exceptions/      ← 异常
├── Exports/         ← 导出
├── Http/            ← HTTP 中间件
├── Permissions/     ← 权限
├── References/      ← 引用
├── Search/          ← 搜索
├── Settings/        ← 设置
├── Sorting/         ← 排序
├── Theming/         ← 主题
├── Translation/     ← 翻译
├── Uploads/         ← 上传
├── Users/           ← 用户
└── Util/            ← 工具

routes/
├── web.php          ← Web 路由
└── api.php          ← API 路由
```

**核心优势：**
- 书 → 章节 → 页面 三层结构，天然适合产品文档/教程
- 清晰的 MVC 架构，Laravel 最佳实践
- 权限系统（角色 + 用户 + 权限）
- 导出（PDF、HTML、Markdown）
- 搜索（MySQL 全文搜索）
- 多语言
- REST API

**可借鉴点：**
- 三层文档结构（书 → 章节 → 页面）
- 清晰的 MVC 分层
- 导出功能设计
- 翻译系统设计

---

### 2.4 Teedy (Sismics Docs) — 文档管理系统

**仓库：** https://github.com/sismics/docs
**版本：** v1.12-SNAPSHOT
**技术栈：** Java + Spring + Hibernate + PostgreSQL + Lucene

**核心优势：**
- 文档扫描 + OCR
- 全文搜索（Lucene）
- 标签系统
- 工作流审批
- 文件版本管理
- 256 位 AES 文件加密
- 支持 PDF、ODT、DOCX、PPTX、图片
- REST API

**可借鉴点：**
- OCR 文档识别
- 文件加密存储
- 工作流设计
- 标签系统
- 版本管理

---

### 2.5 Zettlr — Markdown 编辑器

**仓库：** https://github.com/Zettlr/Zettlr
**版本：** v4.6.0
**技术栈：** Electron + TypeScript + Vue 3 + Pinia

**架构：**
```
source/
├── app/
│   ├── app-service-container.ts  ← 依赖注入容器
│   ├── lifecycle.ts              ← 应用生命周期
│   └── service-providers/        ← 服务提供者
├── common/                       ← 通用工具
├── main.ts                       ← 入口
├── pinia/                        ← 状态管理
└── types/                        ← 类型定义
```

**核心优势：**
- Zettelkasten 笔记法支持
- 文献管理（Zotero 集成）
- 跨平台（Electron）
- 标签管理
- 全文搜索
- 内置 PDF 导出
- 自定义主题

**可借鉴点：**
- Electron 架构设计
- 依赖注入容器模式
- 笔记法支持（双向链接、标签）
- 文献管理集成

---

### 2.6 MacDown — macOS Markdown 编辑器

**仓库：** https://github.com/MacDownApp/macdown
**技术栈：** Objective-C + Cocoa + WebKit

**核心优势：**
- macOS 原生体验
- 实时预览
- 语法高亮
- 主题自定义
- 轻量、快速

**可借鉴点：**
- macOS 原生集成设计
- 实时预览机制
- 主题系统

---

### 2.7 LibreOffice Core — Office 套件

**仓库：** https://github.com/LibreOffice/core
**大小：** 608MB
**技术栈：** C++

**核心优势：**
- 完整 Office 格式支持（docx/xlsx/pptx/odt/ods/odp）
- 全平台
- 可编程（UNO API）
- LibreOffice Online 版本

**可借鉴点：**
- 文档格式转换引擎
- 在线编辑架构

---

## 三、横向对比

### 3.1 文档结构

| 项目 | 结构层级 | 编辑器 | 协作 |
|------|---------|--------|------|
| DocMost | 空间 → 目录 → 页面 | Markdown + 富文本 | ✅ 实时 (Yjs) |
| Wiki.js | 文件夹 → 页面 | Markdown | ❌ |
| BookStack | 书 → 章节 → 页面 | Markdown + WYSIWYG | ❌ |
| Teedy | 文档 → 标签 | 文件上传 | ❌ |
| Zettlr | 文件夹 → 文件 | Markdown | ❌ |

### 3.2 存储方式

| 项目 | 数据库 | 文件存储 | 版本管理 |
|------|--------|---------|---------|
| DocMost | PostgreSQL | 本地/S3/Azure | 页面历史 |
| Wiki.js | PostgreSQL | 本地/S3/Azure | Git |
| BookStack | MySQL | 本地/S3/Azure | 页面历史 |
| Teedy | PostgreSQL | 本地 | 文件版本 |
| Zettlr | 文件系统 | 本地文件 | Git |

### 3.3 AI 集成

| 项目 | AI 聊天 | RAG | 本地模型 |
|------|---------|-----|---------|
| DocMost | ✅ (企业版) | ❌ | ❌ |
| Wiki.js | ❌ | ❌ | ❌ |
| BookStack | ❌ | ❌ | ❌ |
| Teedy | ❌ | ❌ | ❌ |
| Zettlr | ❌ | ❌ | ❌ |

---

## 四、对 Fusion-Doc 的优化建议

### 4.1 架构层面

**借鉴 BookStack 的 MVC 分层：**
```
server/
├── routes/          ← 路由层（URL 分发）
├── controllers/     ← 控制器（请求处理）
├── models/          ← 数据模型
├── services/        ← 业务逻辑
├── middleware/      ← 中间件（认证/CORS/日志）
├── integrations/    ← 外部集成（Fusion-MLX/存储）
└── utils/           ← 工具函数
```

**借鉴 Wiki.js 的模块化架构：**
```
modules/
├── auth/            ← 认证模块
├── pages/           ← 页面模块
├── spaces/          ← 空间模块
├── search/          ← 搜索模块
├── ai/              ← AI 模块
├── files/           ← 文件模块
└── export/          ← 导出模块
```

### 4.2 功能层面

**来自 DocMost：**
- TipTap 编辑器 + Yjs 实时协作（核心能力）
- 空间 → 目录 → 页面 结构
- 权限系统（CASL）

**来自 Wiki.js：**
- Markdown 优先编辑体验
- Git 版本管理后端
- 插件架构

**来自 BookStack：**
- 书 → 章节 → 页面 三层结构（适合产品文档）
- 导出功能（PDF/HTML/Markdown）
- 清晰的 MVC 架构

**来自 Teedy：**
- OCR 文档识别
- 文件加密存储
- 标签 + 工作流

**来自 Zettlr：**
- 双向链接 / 图谱
- 文献管理
- 依赖注入容器

### 4.3 技术选型建议

| 功能 | 推荐方案 | 来源 |
|------|---------|------|
| 编辑器 | TipTap (ProseMirror) | DocMost |
| 实时协作 | Yjs + Hocuspocus | DocMost |
| 存储 | SQLite（轻量） / PostgreSQL（生产） | 自选 |
| 搜索 | SQLite FTS5 / 内存索引 | 自选 |
| API | RESTful | 通用 |
| 认证 | JWT | 通用 |
| 导出 | Pandoc / LibreOffice | LibreOffice |
| 版本管理 | 页面历史表 | DocMost |
| AI 集成 | Fusion-MLX | 自有 |

### 4.4 Fusion-Doc 当前架构评估

**当前状态：** 自包含一体化服务器（Node.js + SQLite/JSON 存储）

**优点：**
- 零外部依赖，一键启动
- 前端静态文件直接托管
- SQLite/JSON 双重存储保障
- Fusion-MLX 原生集成

**待优化：**
- 路由层需要模块化拆分（参考 BookStack MVC）
- 数据模型需要完善（参考 DocMost 的实体设计）
- API 需要覆盖 DocMost 前端的全部调用
- 需要引入 Yjs 实现实时协作
- 文件上传/存储需要实现
- 搜索功能需要完善（SQLite FTS5）

---

## 五、总结

| 维度 | 最适合 | 理由 |
|------|--------|------|
| 编辑器 | **DocMost** | TipTap + Yjs 实时协作，最成熟 |
| 架构 | **BookStack + Wiki.js** | 清晰 MVC + 模块化 |
| 存储 | **DocMost** | PostgreSQL 成熟稳定 |
| 协作 | **DocMost** | Yjs CRDT 行业标准 |
| 搜索 | **Wiki.js + Teedy** | 全文搜索 + Lucene |
| 导出 | **BookStack + LibreOffice** | PDF/HTML/Markdown + Office 格式 |
| 权限 | **DocMost + BookStack** | CASL + 角色权限 |
| AI | **Fusion-Doc 自研** | Fusion-MLX 原生集成 |

**结论：** Fusion-Doc 以 **DocMost** 为前端核心，**BookStack** 的架构为后端参考，**Wiki.js** 的模块化设计为组织方式，**Fusion-MLX** 为 AI 引擎，**LibreOffice** 为 Office 格式支撑，是最优组合。