<div align="center">
  <img src="./branding/logo.svg" width="120" alt="Fusion-Doc Logo" />
  <h1>Fusion-Doc V0.1</h1>
  <p><strong>Apple Silicon 原生离线智能文档知识库</strong></p>
  <p>整合 7 大开源优势 + Fusion-MLX AI，macOS 原生优化</p>
</div>

---

## 架构

```
Fusion-Doc Server (:11435) — 单进程，自包含
  ├── 前端静态文件（TipTap 编辑器 + Yjs 协作）
  ├── REST API（模块化路由）
  ├── SQLite 存储（零外部依赖）
  └── Fusion-MLX AI 调用（常驻内存）
```

**零外部依赖：** 无需 PostgreSQL、Redis、NestJS、反向代理

## 快速开始

```bash
# 1. 启动（需要 Fusion-MLX 已运行）
bash scripts/start.sh

# 2. 访问
#    http://localhost:11435    → 文档编辑器
#    http://localhost:11435/api/health → 健康检查
```

## 整合特性

| 来源 | 特性 | API 端点 |
|------|------|---------|
| **DocMost** | TipTap 编辑器 + Yjs 实时协作 | 前端内置 |
| **DocMost** | 空间 → 目录 → 页面 结构 | `/api/workspaces` |
| **DocMost** | 页面历史版本 + 评论 | `/api/pages/:id/versions` |
| **DocMost** | 收藏系统 | `/api/favorites` |
| **Wiki.js** | 模块化路由架构 | `server/routes/` |
| **Wiki.js** | SQLite FTS5 全文搜索 | `/api/search?q=` |
| **BookStack** | 书架→章节→页面 三层结构 | `/api/books`, `/api/chapters` |
| **BookStack** | PDF/HTML/Markdown 导出 | `/api/export/:format/:id` |
| **Teedy** | 标签系统 | `/api/tags` |
| **Teedy** | 文档分类 + 工作流 | 标签 + 结构化 |
| **Zettlr** | 双向链接 + 知识图谱 | `/api/pages/:id/links`, `/api/graph` |
| **MacDown** | macOS 原生体验优化 | 主题 + 暗黑模式 |
| **LibreOffice** | Office 格式转换 | 导出接口 |
| **Fusion-MLX** | 本地 AI 聊天 | `/api/ai/chat` |
| **Fusion-MLX** | 本地 Embedding | `/api/ai/embeddings` |

## 目录结构

```
fusion-doc/
├── server/                 ← 核心服务器（自包含）
│   ├── index.js            ← 入口
│   ├── db.js               ← 数据库（SQLite + JSON）
│   ├── routes/index.js     ← 路由（API 端点）
│   ├── middleware/common.js ← 中间件
│   └── utils/              ← 工具函数
├── gateway/                ← 网关 + 前端
│   ├── server.js           ← 备用入口
│   └── public/             ← 构建的前端文件
├── branding/               ← 品牌资源
│   ├── logo.svg
│   └── favicon.svg
├── scripts/
│   ├── start.sh            ← 一键启动
│   └── setup.sh            ← 安装
├── docs/                   ← 文档
│   └── ANALYSIS_REPORT.md  ← 开源分析报告
├── patches/                ← 开源补丁
├── data/                   ← 数据存储
├── .env                    ← 环境配置
└── README.md
```

## 技术栈

| 层 | 技术 | 说明 |
|----|------|------|
| **运行时** | Node.js | 单进程 HTTP 服务器 |
| **存储** | SQLite / JSON 文件 | 零外部依赖，即开即用 |
| **前端** | React SPA (DocMost 构建) | TipTap 编辑器 |
| **协作** | Yjs + Hocuspocus | 实时协同编辑 |
| **搜索** | SQLite FTS5 | 全文搜索引擎 |
| **AI** | Fusion-MLX | 本地 Apple Silicon 推理 |
| **导出** | 内置 + LibreOffice | PDF/Markdown/HTML/Office |

## API 概览

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/health` | 健康检查 |
| GET | `/api/system/setup` | 首次安装检测 |
| POST | `/api/auth/setup` | 注册管理员 |
| POST | `/api/auth/login` | 登录 |
| GET | `/api/workspaces` | 工作空间列表 |
| GET | `/api/books` | 书架列表 |
| GET/POST | `/api/chapters` | 章节操作 |
| GET/POST/PUT/DELETE | `/api/pages` | 页面 CRUD |
| GET/POST | `/api/pages/:id/versions` | 版本历史 |
| GET/POST | `/api/pages/:id/links` | 双向链接 |
| GET/POST | `/api/tags` | 标签管理 |
| GET | `/api/search?q=` | 全文搜索 |
| GET | `/api/graph` | 知识图谱 |
| POST | `/api/ai/chat` | AI 聊天 |
| POST | `/api/ai/embeddings` | 向量嵌入 |
| GET | `/api/export/:format/:id` | 文档导出 |
| GET/POST | `/api/favorites` | 收藏管理 |
| GET | `/api/branding` | 品牌信息 |

## 开发

```bash
# 验证代码
node -c server/index.js
node -c server/db.js
node -c server/routes/index.js
node -c server/middleware/common.js
node -c server/utils/helpers.js
node -c server/utils/static.js

# 启动开发模式
bash scripts/start.sh
```

## 许可证

- **Fusion-Doc 自有代码** — MIT
- **DocMost 前端** — AGPL-3.0
- **Fusion-MLX** — Apache-2.0