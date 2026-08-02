# Fusion-Doc V1.0 重构实施计划

## 概述

基于 PRD (`fusion-doc-prd-ar.md`)，将 fusion-doc 从原始 contentEditable SPA 重构为 AI-First Document OS。6 个阶段，每个阶段独立可验证。

## 核心决策

| 决策 | 选择 | 原因 |
|------|------|------|
| 前端框架 | React 18 + Vite | TipTap 官方 React 绑定最成熟，Vite HMR 快 |
| 编辑器 | TipTap 2.x | ProseMirror 内核，扩展性强，AI 友好 |
| 协作 | Yjs + y-websocket | CRDT 无冲突，成熟方案 (Phase 6) |
| 图谱 | D3.js force layout | 力导向图，交互性强 |
| 状态管理 | Zustand | 轻量，与 TipTap 装饰器兼容 |
| 样式 | Tailwind CSS | 快速迭代，暗色主题一致 |
| OfficeCLI | @officecli/sdk Node.js SDK | 命名管道直连，无进程开销 |
| 现有 DocMost assets | 废弃，删除 | 无法重建，无源码，15MB 冗余 |

## 前置准备 (Phase 0)

### 0.1 项目结构重组

```
fusion-doc/
  client/                    # 新前端 (Vite + React)
    index.html
    src/
      main.jsx               # React 入口
      App.jsx                # 根组件 + 路由
      stores/                # Zustand stores
      components/            # UI 组件
        editor/              # TipTap 编辑器组件
        ai/                  # AI Copilot 组件
        sidebar/             # 侧栏组件
        graph/               # 知识图谱组件
        templates/           # 模板组件
        workflow/            # 工作流组件
      hooks/                 # 自定义 React hooks
      lib/                   # 工具函数
    vite.config.js
    tailwind.config.js
    package.json
  server/                    # 现有服务端 (扩展)
    controllers/             # 新增 6 个控制器
    services/                # 新增 6 个服务
    integrations/            # 新增 officecli.js
  gateway/public/            # Vite 构建输出目录
  scripts/
  data/
  tests/
```

### 0.2 前端脚手架搭建

- Vite + React 18 项目初始化
- Tailwind CSS 暗色主题配置
- React Router 配置
- API 客户端封装 (`/api/*` 代理)
- Zustand store 基础结构
- 删除 gateway/public/assets/ (15MB DocMost 孤儿文件)

### 0.3 服务端 API 增强

- 添加 CORS 配置支持 Vite dev server (`localhost:5173`)
- 添加 WebSocket 升级支持 (为 y-websocket 准备)
- package.json 添加前端相关 scripts

---

## Phase 1: 编辑器重构 (核心)

### 目标
替换 contentEditable → TipTap React 组件，恢复专业文档编辑体验。

### 后端变更

**无新控制器** — 使用现有 page CRUD API。

**db.js 新增迁移 `005_page_editor`**:
```sql
ALTER TABLE pages ADD COLUMN editor_schema TEXT DEFAULT '{}';
ALTER TABLE pages ADD COLUMN yjs_state BLOB;
```

### 前端变更

1. **TipTap 编辑器组件** (`client/src/components/editor/`)
   - `TiptapEditor.jsx` — 主编辑器，TipTap + 扩展注册
   - `extensions/AIExtension.js` — AI 续写/改写装饰器 (Phase 2)
   - `extensions/BiLinkExtension.js` — `[[` 双向链接 (Phase 4)
   - `extensions/SlashCommand.js` — `/` 命令菜单 (Phase 2)

2. **TipTap 扩展配置**:
   - StarterKit (heading, bold, italic, strike, code, codeBlock, bulletList, orderedList, blockquote, horizontalRule, history)
   - Table (@tiptap/extension-table)
   - Placeholder
   - CharacterCount
   - Image (拖拽上传)
   - Link
   - TaskList + TaskItem
   - Highlight
   - Typography
   - CodeBlockLowlight (语法高亮)

3. **编辑器工具栏** (`EditorToolbar.jsx`):
   - 格式: B / I / S / Code / Highlight
   - 块: H1-H3 / Quote / UL / OL / TaskList / CodeBlock
   - 插入: Image / Table / Link / HR
   - 操作: Undo / Redo

4. **侧栏导航** (`Sidebar.jsx`):
   - 书架树形结构 (Book > Chapter > Page)
   - 页面搜索/筛选
   - 新建按钮 (页面/书籍/章节)

5. **页面自动保存**:
   - 编辑器 `onUpdate` debounce 2s → `PUT /api/pages/:id`
   - `Cmd+S` 手动保存 + 版本快照

6. **布局** (`App.jsx`):
   - 三栏布局: 侧栏(240px) | 编辑器(flex) | AI面板(320px, Phase 2)
   - 侧栏可折叠
   - 响应式

### 验证标准
- [ ] TipTap 编辑器加载，支持富文本编辑
- [ ] 所有格式扩展正常工作
- [ ] 侧栏显示书架树结构
- [ ] 自动保存到 SQLite
- [ ] `Cmd+S` 创建版本快照
- [ ] 现有页面数据兼容 (content 字段读取正常)

---

## Phase 2: AI Copilot

### 目标
AI 深度嵌入编辑流：内联续写、选中改写、命令面板、侧栏对话。

### 后端变更

**新控制器 `controllers/ai-copilot.js`**:
```
POST /api/copilot/complete      — 内联续写 (stream SSE)
POST /api/copilot/rewrite       — 改写 (stream SSE)
POST /api/copilot/translate     — 翻译 (stream SSE)
POST /api/copilot/summarize     — 摘要 (stream SSE)
POST /api/copilot/expand        — 扩展 (stream SSE)
POST /api/copilot/command       — 命令面板 (stream SSE)
GET  /api/copilot/context/:id   — 获取页面上下文
```

**新服务 `services/ai-copilot.js`**:
- `buildContext(pageId, selection)` — 组装 prompt 上下文 (页面标题 + 选中前文 + 选中内容 + 选中后文)
- `buildSystemPrompt(action)` — 每种 AI 操作的 system prompt
- `streamResponse(messages, res)` — SSE 流式输出封装

**关键实现**:
```js
const COMPLETE_SYSTEM = `你是文档续写助手。根据上下文自然续写，保持风格一致。只输出续写内容，不要解释。`;
const REWRITE_SYSTEM = `你是文档改写助手。改写选中文本，保持原意但优化表达。只输出改写结果。`;
const TRANSLATE_SYSTEM = `你是翻译助手。将选中文本翻译为{language}。只输出翻译结果。`;
```

### 前端变更

1. **AI 续写** (`components/editor/AIGhostText.jsx`):
   - TipTap Decoration API 渲染灰色建议文本
   - `Cmd+J` 触发，光标前内容作为上下文
   - `Tab` 接受 → 插入文本; `Esc` 拒绝 → 移除装饰

2. **选中改写工具栏** (`components/editor/AISelectionToolbar.jsx`):
   - TipTap BubbleMenu 扩展
   - 选中文字后浮现工具栏: 改写 / 翻译 / 摘要 / 扩展 / 缩写
   - 点击后弹出结果面板: [替换原文] [插入到下方] [复制]

3. **命令面板** (`components/editor/SlashCommand.jsx`):
   - TipTap Suggestion 扩展
   - `/` 触发下拉菜单
   - 命令列表: /generate /rewrite /translate /summarize /expand /compress /fix /tone /table /outline /explain

4. **AI 侧栏对话** (`components/ai/AIChatPanel.jsx`):
   - 右侧面板，多轮对话
   - 自动注入当前页面上下文
   - `?` 前缀触发 RAG 问答 (Phase 4)
   - 流式输出渲染
   - AI 回复中的代码块语法高亮

5. **Zustand Store** (`stores/aiStore.js`):
   - chatMessages 状态
   - currentAction 状态
   - streaming 状态

### 验证标准
- [ ] `Cmd+J` 触发 AI 续写，Tab 接受，Esc 拒绝
- [ ] 选中文字浮现 AI 工具栏，改写/翻译/摘要正常
- [ ] `/` 触发命令面板，选择命令后执行
- [ ] AI 侧栏对话流式输出
- [ ] SSE 流式传输正常工作
- [ ] Fusion-MLX 未连接时优雅降级 (提示用户启动)

---

## Phase 3: OfficeCLI 集成

### 目标
Fusion-Doc 原生操控 .docx/.xlsx/.pptx：创建、导入、导出、预览、模板合并。

### 后端变更

**新依赖**: `@officecli/sdk`

**新集成 `integrations/officecli.js`**:
- `createDoc(filePath, type)` — 创建空白 Office 文档
- `importDoc(filePath)` — 导入为可编辑页面
- `exportDoc(pageId, format)` — 页面内容导出为 Office 格式
- `previewDoc(filePath, options)` — 渲染 HTML 预览
- `mergeTemplate(templatePath, data)` — 模板合并
- `executeCommand(file, command, args)` — 通用命令代理

**新控制器 `controllers/office-proxy.js`**:
```
POST /api/office/create         — 创建 Office 文档
POST /api/office/import         — 导入为可编辑页面
GET  /api/office/export/:id     — 导出为 Office 格式 (?format=docx|xlsx|pptx)
GET  /api/office/preview/:id    — 渲染预览 (HTML)
POST /api/office/merge          — 模板合并
POST /api/office/command        — OfficeCLI 命令代理
```

**新服务 `services/office-bridge.js`**:
- 文件路径管理 (上传目录 → OfficeCLI 工作目录)
- OfficeCLI 进程生命周期 (resident mode)
- 预览缓存 (HTML → 缓存 → 增量更新)
- 错误码映射 (OfficeCLI error codes → HTTP status)

**db.js 新增迁移 `006_office_files`**:
```sql
CREATE TABLE IF NOT EXISTS office_files (
    id TEXT PRIMARY KEY,
    page_id TEXT,
    file_path TEXT NOT NULL,
    file_type TEXT NOT NULL,
    preview_path TEXT,
    metadata TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (page_id) REFERENCES pages(id)
);

CREATE TABLE IF NOT EXISTS templates (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    content TEXT,
    variables TEXT,
    file_path TEXT,
    category TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);
```

### 前端变更

1. **Office 文档卡片** (`components/office/OfficeCard.jsx`):
   - 嵌入编辑器中，显示 Office 文档预览 (iframe)
   - 操作: [在 OfficeCLI 中编辑] [导入为页面] [下载]

2. **模板合并面板** (`components/templates/MergePanel.jsx`):
   - 选择模板 → 提取 `{{key}}` 变量 → 填充表单 → 生成文档
   - 支持从 JSON 文件批量导入数据

3. **新建对话框增强** (`components/templates/NewDocDialog.jsx`):
   - 新增 "从 Office 导入" 和 "AI 生成" 标签页
   - Office 导入: 拖拽上传 → OfficeCLI 解析 → 创建页面

4. **导出菜单增强**:
   - 现有: Markdown / HTML / PDF
   - 新增: .docx / .xlsx / .pptx

### 验证标准
- [ ] `POST /api/office/create` 创建空白 .docx
- [ ] 拖拽 .docx 文件导入为可编辑页面
- [ ] 页面内容导出为 .docx/.xlsx/.pptx
- [ ] Office 文档 HTML 预览正常渲染
- [ ] 模板合并: 选择模板 → 填充变量 → 生成文档
- [ ] OfficeCLI 未安装时优雅提示安装方法

---

## Phase 4: 知识图谱 + RAG 增强

### 目标
双向链接可视化、语义关联、混合检索、段落级索引。

### 后端变更

**新控制器 `controllers/graph.js`** (扩展现有):
```
GET  /api/graph/links           — 链接图谱数据
GET  /api/graph/semantic        — 语义关联图谱
GET  /api/graph/tags            — 标签聚类图谱
```

**新控制器 `controllers/rag-enhanced.js`**:
```
POST /api/rag/enhanced-query    — 混合检索 (向量+FTS5+BM25)
POST /api/rag/reindex/:id       — 增量索引单个页面
GET  /api/rag/chunks/:pageId    — 获取页面段落索引
```

**新服务 `services/rag-hybrid.js`**:
- `hybridSearch(query, options)` — 向量(0.5) + FTS5(0.3) + BM25(0.2) 加权融合
- `rerankResults(query, results)` — Fusion-MLX rerank 二次排序
- `chunkPage(pageId)` — 段落级切分 (按 H1/H2 标题 + 段落边界)
- `indexChunk(chunk)` — 单段落向量索引
- `buildBM25Index()` — BM25 倒排索引构建

**db.js 新增迁移 `007_rag_chunks`**:
```sql
CREATE TABLE IF NOT EXISTS rag_chunks (
    id TEXT PRIMARY KEY,
    page_id TEXT NOT NULL,
    chunk_index INTEGER NOT NULL,
    chunk_text TEXT NOT NULL,
    chunk_type TEXT DEFAULT 'paragraph',
    heading TEXT,
    vector TEXT,
    bm25_tokens TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (page_id) REFERENCES pages(id)
);

CREATE INDEX IF NOT EXISTS idx_rag_chunks_page ON rag_chunks(page_id);
```

### 前端变更

1. **知识图谱视图** (`components/graph/KnowledgeGraph.jsx`):
   - D3.js force-directed layout
   - 三种模式: 链接图谱 / 语义图谱 / 标签聚类
   - 节点拖拽、缩放、搜索高亮
   - 点击节点 → 打开文档
   - 双击节点 → 展开邻居

2. **双向链接** (`components/editor/BiLinkExtension.js`):
   - TipTap 扩展: 输入 `[[` 触发页面搜索下拉
   - 选择页面 → 插入链接 → 自动创建反向链接
   - 链接悬停显示页面预览

3. **RAG 问答增强** (在 AI Chat Panel 中):
   - `?` 前缀触发 RAG 模式
   - 显示来源追溯 (页面名 + 段落位置)
   - 点击来源跳转到对应段落

4. **图谱路由** (`App.jsx` 路由):
   - `/graph` 知识图谱页面

### 验证标准
- [ ] 双向链接 `[[` 输入触发页面搜索
- [ ] 反向链接自动创建
- [ ] 知识图谱力导向图正常渲染
- [ ] 三种图谱模式切换
- [ ] 混合检索返回融合排序结果
- [ ] RAG 问答显示来源追溯
- [ ] 段落级索引正确切分

---

## Phase 5: 工作流 + 模板

### 目标
可编排 Agent 工作流引擎、预置 5 个工作流、模板系统。

### 后端变更

**新控制器 `controllers/workflow.js`**:
```
GET    /api/workflows            — 列出工作流
POST   /api/workflows            — 创建工作流
GET    /api/workflows/:id        — 详情
POST   /api/workflows/:id/run    — 执行
GET    /api/workflows/:id/runs   — 执行历史
DELETE /api/workflows/:id        — 删除
```

**新控制器 `controllers/template.js`**:
```
GET    /api/templates            — 列出模板
POST   /api/templates            — 创建模板
GET    /api/templates/:id        — 详情
POST   /api/templates/:id/apply  — 从模板创建文档
DELETE /api/templates/:id        — 删除
```

**新服务 `services/workflow-engine.js`**:
- `parseYAML(yamlStr)` — YAML 工作流定义解析
- `validateWorkflow(def)` — 校验步骤依赖、循环检测
- `executeWorkflow(workflowId, input)` — 逐步执行
- `executeStep(step, context)` — 单步骤执行 (ai.generate / officecli.import / officecli.merge / page.create)
- `buildStepContext(step, previousResults)` — 步骤间数据传递

**新服务 `services/template-engine.js`**:
- `extractVariables(content)` — 正则提取 `{{key}}` 变量
- `fillVariables(content, data)` — 变量替换
- `createFromTemplate(templateId, data)` — 创建文档 + 填充

**db.js 新增迁移 `008_workflow`**:
```sql
CREATE TABLE IF NOT EXISTS workflows (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    yaml_def TEXT NOT NULL,
    status TEXT DEFAULT 'idle',
    last_run_at TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS workflow_runs (
    id TEXT PRIMARY KEY,
    workflow_id TEXT NOT NULL,
    status TEXT DEFAULT 'running',
    input TEXT,
    output TEXT,
    steps TEXT,
    error TEXT,
    started_at TEXT,
    completed_at TEXT,
    FOREIGN KEY (workflow_id) REFERENCES workflows(id)
);
```

### 前端变更

1. **工作流面板** (`components/workflow/WorkflowPanel.jsx`):
   - 工作流列表 + 创建
   - 执行进度实时显示 (SSE)
   - 步骤状态: 完成 / 进行中 / 等待 / 失败
   - 暂停/跳过/取消操作

2. **模板选择器** (`components/templates/TemplateSelector.jsx`):
   - 网格布局展示模板
   - 分类筛选
   - 变量填充表单
   - "AI 生成" 输入框

3. **预置工作流** (服务端 seeds):
   - 报告生成 (outline → sections → content → charts → summary)
   - 文档翻译 (extract → segment → translate → proofread → format)
   - 知识提取 (parse → entity recognition → relation extraction → card generation)
   - 周报生成 (collect → classify → summarize → write → format)
   - 论文审阅 (parse → structure analysis → logic check → suggestions)

4. **预置模板** (服务端 seeds):
   - 空白文档 / 季度报告 / 会议纪要 / 技术方案 / 项目提案 / 产品PRD / 学术论文 / 周报

### 验证标准
- [ ] YAML 工作流定义解析正常
- [ ] 工作流逐步执行，进度实时更新
- [ ] 预置 5 个工作流可运行
- [ ] 模板变量提取 + 填充正常
- [ ] 从模板创建文档
- [ ] 模板合并生成 Office 文档

---

## Phase 6: 实时协作 + 打磨

### 目标
Yjs CRDT 实时协作、性能优化、端到端测试。

### 后端变更

**新服务 `services/collaboration.js`**:
- y-websocket 服务器 (基于 ws 库)
- 文档感知: 光标位置 + 用户颜色 + 在线状态
- Yjs 文档持久化 (SQLite 存储 Yjs update)

**db.js 新增迁移 `009_collaboration`**:
```sql
CREATE TABLE IF NOT EXISTS yjs_docs (
    id TEXT PRIMARY KEY,
    page_id TEXT UNIQUE NOT NULL,
    state BLOB,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (page_id) REFERENCES pages(id)
);
```

**app.js 变更**:
- HTTP server 升级 WebSocket
- `/ws/collab/:pageId` WebSocket 路由

### 前端变更

1. **Yjs Provider** (`lib/yjs-provider.js`):
   - y-websocket client 连接
   - TipTap Collaboration 扩展注册
   - 光标渲染 (其他用户光标 + 用户名)

2. **在线用户面板**:
   - 右上角头像列表
   - 点击头像定位到对方光标

3. **性能优化**:
   - 代码分割 (graph/workflow/template 懒加载)
   - 虚拟列表 (大文档页面列表)
   - 编辑器 Debounce 优化
   - 图片懒加载 + 压缩

4. **全局打磨**:
   - 搜索功能 (全局搜索框)
   - 键盘快捷键完善
   - 暗色/亮色主题切换
   - 移动端响应式适配
   - 错误边界 + 优雅降级

### 验证标准
- [ ] 两个浏览器标签页同时编辑同一页面
- [ ] 光标实时同步
- [ ] 冲突自动合并 (CRDT)
- [ ] 断网重连后数据一致
- [ ] Lighthouse 性能分数 > 80
- [ ] 全局搜索正常
- [ ] 暗色/亮色主题切换

---

## 实施顺序与依赖关系

```
Phase 0 (前置准备)
  ├── 0.1 项目结构重组
  ├── 0.2 前端脚手架
  └── 0.3 服务端 API 增强
        │
Phase 1 (编辑器) ← 核心基础，后续所有 Phase 依赖
  │
  ├── Phase 2 (AI Copilot) ← 依赖编辑器扩展机制
  │
  ├── Phase 3 (OfficeCLI) ← 独立，可与 Phase 2 并行
  │
  ├── Phase 4 (图谱+RAG) ← 依赖编辑器双向链接
  │
  ├── Phase 5 (工作流+模板) ← 依赖 Phase 2 + Phase 3
  │
  └── Phase 6 (协作+打磨) ← 依赖所有前置 Phase
```

## 技术风险与缓解

| 风险 | 缓解 |
|------|------|
| TipTap React 绑定问题 | 先做最小 POC 验证，再全面集成 |
| OfficeCLI SDK 安装 | 检测 SDK 可用性，不可用时禁用 Office 功能 |
| Yjs 协作复杂度 | Phase 6 独立，可延后 |
| 前端包体积 | Vite tree-shaking + 懒加载 |
| 数据迁移 | 每个 Phase 独立迁移脚本，向后兼容 |
