<div align="center">
  <h1>Fusion-Doc V0.1</h1>
  <p><strong>Apple Silicon 原生离线智能文档知识库</strong></p>
  <p>DocMost + MaxKB + Fusion-MLX — 100% 本地离线，AI 文档问答</p>
</div>

---

## 架构

```
统一端口 :11435
    │
    ├── /doc/*      → DocMost（文档编辑器）
    ├── /kb/*       → MaxKB（知识库管理）
    └── /           → 重定向到 /doc
           │
           └── 所有 AI 推理 → Fusion-MLX :8000（常驻内存）
```

## 快速开始

```bash
# 1. 安装
bash scripts/setup.sh

# 2. 启动
bash scripts/start.sh

# 3. 访问
#    http://localhost:11435/doc  → 文档编辑器
#    http://localhost:11435/kb   → 知识库管理
```

## 组件

| 组件 | 来源 | 说明 |
|------|------|------|
| **DocMost** | `./docmost/` | 文档编辑器（Markdown/富文本/协作） |
| **MaxKB** | `./maxkb/` | RAG 知识库引擎 |
| **Fusion-MLX** | `~/claude-home/fusion-mlx` | 本地 AI 推理（常驻内存） |
| **Gateway** | `./gateway/` | 统一反向代理网关 |

## 核心能力

- 文档空间 → 目录 → 文档三级结构
- Markdown / 富文本双编辑器
- 本地 PDF/DOCX/MD/TXT 批量导入
- 本地 AI 问答 + 引用溯源
- 语义检索 + 相关性排序
- 知识库独立隔离
- 全离线运行，0 数据上传

## 目录结构

```
fusion-doc/
├── docmost/              ← 文档编辑器（Fork）
├── maxkb/                ← 知识库引擎（Fork）
├── gateway/              ← 统一网关
│   ├── server.js
│   └── package.json
├── patches/              ← 自定义补丁
│   ├── docmost/
│   └── maxkb/
├── scripts/              ← 启动/安装脚本
│   ├── start.sh
│   └── setup.sh
├── data/                 ← 数据存储
├── .env                  ← 环境配置
└── README.md
```

## 改造点

**DocMost:**
- 品牌替换（Logo/标题/主题色）
- 精简团队协作功能
- 对接 Fusion-MLX AI 聊天
- 新增知识库入口面板

**MaxKB:**
- 移除所有云端模型依赖
- 仅对接 Fusion-MLX 本地推理
- 适配 MLX Embedding
- 优化 Apple Silicon 性能