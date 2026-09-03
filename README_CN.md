<div align="center">
  <img src="./branding/logo.svg" width="120" alt="Fusion-Doc Logo" />
  <h1>Fusion-Doc V0.2</h1>
  <p><strong>Apple Silicon 原生离线智能文档知识库</strong></p>
  <p>模块化 MVC · 插件体系 · 融合生态</p>
  <p>
    <a href="./README_CN.md">🇨🇳 中文</a> •
    <a href="./README.md">🇬🇧 English</a>
  </p>
</div>

---

## 架构

```
Fusion-Doc Server (:11449) — 模块化 MVC，零外部依赖，可扩展
├── 中间件管道（CORS/认证/日志/限流/错误处理）
├── 控制器层（20+ 领域模块：auth/pages/books/search/ai/...）
├── 服务层（业务逻辑：RAG/导出/存储/搜索/页面）
├── 模型层（数据抽象：SQLite + JSON 降级）
├── 集成层（Fusion-MLX / Fusion-Coder / LibreOffice / OCR）
└── 插件系统（可扩展）
```

**零外部依赖：** 无需 PostgreSQL、Redis、NestJS、反向代理

## 快速开始

```bash
# 1. 安装
bash scripts/setup.sh

# 2. 启动（推荐先启动 Fusion-MLX 以使用 AI 功能）
bash scripts/start.sh

# 3. 访问
#    http://localhost:11449    → 文档编辑器
#    http://localhost:11449/api/health → 健康检查
```

## 整合特性

| 来源 | 特性 | API 端点 | 状态 |
|------|------|---------|------|
| **DocMost** | TipTap 编辑器 + Yjs 实时协作 | 前端内置 | ✅ |
| **DocMost** | 空间 → 目录 → 页面 结构 | `/api/workspaces` | ✅ |
| **DocMost** | 页面历史版本 + 评论 | `/api/pages/:id/versions` | ✅ |
| **DocMost** | 收藏系统 | `/api/favorites` | ✅ |
| **Wiki.js** | 模块化路由架构 | `server/controllers/` | ✅ |
| **Wiki.js** | SQLite FTS5 全文搜索 | `/api/search?q=` | ✅ |
| **Wiki.js** | 活动审计追踪 | `/api/activity` | ✅ |
| **BookStack** | 书架→章节→页面 三层结构 | `/api/books`, `/api/chapters` | ✅ |
| **BookStack** | PDF/HTML/Markdown 导出 | `/api/export/:format/:id` | ✅ |
| **BookStack** | 主题管理 | `/api/theme` | ✅ |
| **Teedy** | 标签系统 | `/api/tags` | ✅ |
| **Teedy** | 文档分类 + 元数据 | 标签 + `/api/metadata` | ✅ |
| **Zettlr** | 双向链接 + 知识图谱 | `/api/pages/:id/links`, `/api/graph` | ✅ |
| **MacDown** | macOS 原生体验优化 | 主题 + 暗黑模式 | ✅ |
| **LibreOffice** | Office 格式转换 | 导出接口 + Pandoc | ✅ |
| **Fusion-MLX** | 本地 AI 聊天（流式） | `/api/ai/chat` | ✅ |
| **Fusion-MLX** | 本地 Embedding | `/api/ai/embeddings` | ✅ |
| **Fusion-MLX** | RAG（检索增强生成） | `/api/rag/index`, `/api/rag/query` | ✅ |
| **Fusion-Coder** | AI 代码生成与审查 | 集成桥接 | ✅ |
| **插件系统** | 模块化插件架构 | `server/plugins/` | ✅ |
| **Webhook** | 事件驱动自动化 | `/api/webhooks` | ✅ |

## 项目结构

```
fusion-doc/
├── server/                     ← 核心服务器（模块化 MVC）
│   ├── index.js                ← 入口（轻量级）
│   ├── app.js                  ← 应用核心（生命周期）
│   ├── config.js               ← 配置管理
│   ├── db.js                   ← 数据库层（SQLite + JSON）
│   ├── controllers/            ← 控制器层（20 个模块）
│   │   ├── index.js            ← 路由注册中心
│   │   ├── health.js           ← 健康检查
│   │   ├── auth.js             ← 认证
│   │   ├── page.js             ← 页面 CRUD
│   │   ├── book.js             ← 书架
│   │   ├── chapter.js          ← 章节
│   │   ├── search.js           ← 全文搜索
│   │   ├── ai.js               ← AI（聊天/嵌入/RAG）
│   │   ├── file.js             ← 文件管理
│   │   ├── tag.js              ← 标签
│   │   ├── comment.js          ← 评论
│   │   ├── export.js           ← 文档导出
│   │   ├── graph.js            ← 知识图谱
│   │   ├── favorite.js         ← 收藏
│   │   ├── activity.js         ← 活动日志
│   │   ├── user.js             ← 用户管理
│   │   ├── theme.js            ← 主题设置
│   │   ├── webhook.js          ← Webhook 系统
│   │   ├── metadata.js         ← 元数据/词汇表
│   │   ├── workspace.js        ← 工作空间
│   │   └── branding.js         ← 品牌信息
│   ├── services/               ← 服务层（业务逻辑）
│   │   ├── auth.js             ← 认证服务（密码哈希）
│   │   ├── page.js             ← 页面服务（CRUD + 版本）
│   │   ├── search.js           ← 搜索服务
│   │   ├── rag.js              ← RAG 服务（嵌入 + 检索）
│   │   ├── export.js           ← 导出服务
│   │   └── storage.js          ← 存储服务
│   ├── models/                 ← 模型层（数据抽象）
│   │   ├── index.js            ← 模型注册
│   │   └── base.js             ← 基类（查询构建器）
│   ├── middleware/              ← 中间件栈
│   │   ├── pipeline.js         ← 中间件管道引擎
│   │   ├── cors.js             ← CORS
│   │   ├── auth.js             ← 认证（JWT）
│   │   ├── logger.js           ← 请求日志
│   │   ├── rate-limit.js       ← 限流
│   │   ├── error-handler.js    ← 错误处理
│   │   └── body-parser.js      ← 请求体解析
│   ├── integrations/           ← 集成层
│   │   ├── fusion-mlx.js       ← Fusion-MLX AI 引擎
│   │   ├── fusion-coder.js     ← Fusion-Coder 桥接
│   │   ├── ocr.js              ← OCR（Tesseract + MLX Vision）
│   │   └── libreoffice.js      ← LibreOffice 转换
│   ├── plugins/                ← 插件系统
│   │   ├── loader.js           ← 插件加载器
│   │   └── registry.js         ← 插件注册表
│   └── utils/                  ← 工具函数
│       ├── helpers.js          ← uid, now, slugify
│       └── static.js           ← 静态文件服务
├── gateway/                    ← 网关 + 前端
│   └── public/                 ← 构建的前端文件（DocMost）
├── branding/                   ← 品牌资源
├── scripts/
│   ├── start.sh                ← 一键启动
│   ├── setup.sh                ← 安装
│   └── test.sh                 ← 验证测试
├── docs/
│   └── ANALYSIS_REPORT.md      ← 开源分析报告
├── patches/                    ← 开源补丁
├── data/                       ← 数据存储
├── .env                        ← 环境配置
├── README.md                   ← English documentation
└── README_ZH.md                ← 中文文档
```

## API 概览

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/health` | 健康检查 |
| GET | `/api/system/setup` | 首次安装检测 |
| POST | `/api/auth/setup` | 注册管理员 |
| POST | `/api/auth/login` | 登录 |
| GET | `/api/workspaces` | 工作空间列表 |
| GET/POST | `/api/books` | 书架 CRUD |
| GET/POST/PUT/DELETE | `/api/chapters` | 章节 CRUD |
| GET/POST/PUT/DELETE | `/api/pages` | 页面 CRUD |
| GET/POST | `/api/pages/:id/versions` | 版本历史 |
| GET/POST | `/api/pages/:id/links` | 双向链接 |
| GET/POST | `/api/tags` | 标签管理 |
| GET | `/api/search?q=` | 全文搜索 |
| GET | `/api/search/advanced` | 高级搜索 |
| GET | `/api/graph` | 知识图谱 |
| POST | `/api/ai/chat` | AI 聊天（支持流式） |
| POST | `/api/ai/embeddings` | 向量嵌入 |
| POST | `/api/rag/index` | RAG 文档索引 |
| POST | `/api/rag/query` | RAG 问答 |
| GET | `/api/export/:format/:id` | 文档导出（md/html/pdf/docx） |
| GET/POST/DELETE | `/api/favorites` | 收藏管理 |
| GET/POST/DELETE | `/api/files` | 文件管理 |
| GET/POST/DELETE | `/api/comments` | 评论 |
| GET | `/api/activity` | 活动日志 |
| GET/POST | `/api/users` | 用户管理 |
| GET/POST | `/api/theme` | 主题设置 |
| GET/POST | `/api/webhooks` | Webhook 系统 |
| GET/POST | `/api/metadata` | 元数据管理 |
| GET/POST | `/api/vocabulary` | 词汇表管理 |
| GET | `/api/branding` | 品牌信息 |

## Fusion 生态

Fusion-Doc 是 **Fusion 生态** 的核心组成部分：

| 项目 | 说明 | 集成方式 |
|------|------|---------|
| **Fusion-MLX** | 本地 MLX 推理引擎 | AI 聊天、嵌入、RAG |
| **Fusion-Coder** | AI 编码助手 | 代码生成与审查 |
| **Fusion-KB** | 知识库管理 | 文档知识图谱 |
| **Fusion-Doc** | 文档知识库（本仓库） | 中央文档平台 |

## 开发

```bash
# 验证所有代码
bash scripts/test.sh

# 启动开发模式
bash scripts/start.sh

# 验证单个模块
node -c server/index.js
node -c server/app.js
node -c server/config.js
node -c server/db.js
```

## 生产部署

商用部署须配置环境变量并前置反向代理 + TLS，详见 [SECURITY.md](./SECURITY.md)。

```bash
# 必需
export JWT_SECRET="$(openssl rand -hex 32)"   # JWT 密钥 (生产缺失则启动 fail-fast)
export FUSION_MLX_API_KEY="..."               # Fusion-MLX 密钥
export FUSION_IDENTITY_SERVICE_TOKEN="..."    # fusion-identity 服务令牌 (必需; 缺失则 fail-closed)
export NODE_ENV="production"                  # 生产模式 (默认绑 127.0.0.1)

# 前置反代时
export FUSION_DOC_HOST="0.0.0.0"              # 暴露到反代; 仍需 TLS 终结
export CORS_ORIGINS="https://your-domain.com" # CORS 白名单

# 定时备份 (crontab)
0 2 * * * cd /path/to/fusion-doc && bash scripts/backup.sh 30
```

安全特性: scrypt 密码哈希 · 认证端点限流 · JWT 强制密钥 · 默认本机绑定 · 在线热备 · SQL 参数化。变更历史见 [CHANGELOG.md](./CHANGELOG.md)。

### 认证与租户隔离 (fusion-identity)

自 v1.0.7 起，fusion-doc 将 JWT 签发与租户注册委托给同级 `fusion-identity` 服务（`:11470`），其为 Fusion 生态唯一的身份提供方。生产环境不再自签 token、不再维护自有用户表。

- **token 校验**：所有非公开 API 请求须携带 `Authorization: Bearer <jwt>`（由 fusion-identity 签发）+ `X-Tenant-Id: <tid>` 头。认证中间件调 `POST /api/v1/auth/verify` 校验，不匹配即拒绝（fail-closed，无默认租户降级）。
- **租户数据隔离**：workspaces/pages/books/chapters 含 `tenant_id` 列，所有查询按上下文 tid 过滤；跨租户访问返 `404`（不泄露存在性）。
- **角色**：4 统一角色（`tenant_admin` / `operator` / `member` / `viewer`）；管理端点接受 `tenant_admin`。
- **AI 用量**：token 消耗 fire-and-forget 上报至 `POST /api/v1/tenants/{tid}/usage`。
- **本地单用户开发旁路**：设 `FUSION_DOC_LOCAL_AUTH=1` 可恢复内置 HS256 自签 + `users` 表（默认关闭，生产禁用）。存量数据回填 `tenant_id=local-tenant`，旁路模式下仍可访问。

```bash
export FUSION_IDENTITY_URL="http://127.0.0.1:11470"
export FUSION_IDENTITY_SERVICE_TOKEN="..."   # 生产必需 (缺失 fail-closed)
# FUSION_DOC_LOCAL_AUTH=1                    # 可选: 本地旁路 (仅开发)
```

## 许可证

Apache-2.0
