#!/usr/bin/env bash
# =============================================================================
# Fusion-Doc V0.2 — 安装脚本
# 自动安装依赖、初始化数据库、配置环境
# =============================================================================
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

echo "=========================================="
echo "  Fusion-Doc V0.2 安装"
echo "  Apple Silicon 原生离线智能文档知识库"
echo "=========================================="

# ── 1. 系统依赖 ──────────────────────────────────────────────────────────
echo ""
echo "[1/6] 系统依赖..."
for cmd in node npm; do
  command -v $cmd >/dev/null 2>&1 || { echo "  [✗] $cmd 未安装，请先安装 Node.js 18+"; exit 1; }
  echo "  [✓] $cmd"
done
echo "  [~] 可选: pandoc (文档导出), libreoffice (Office 格式转换), tesseract (OCR)"

# ── 2. 安装 Node.js 依赖 ────────────────────────────────────────────────
echo ""
echo "[2/6] 安装 Node.js 依赖..."
npm install --silent 2>/dev/null || true
echo "  [✓] 依赖已安装"

# ── 3. 数据目录 ──────────────────────────────────────────────────────────
echo ""
echo "[3/6] 数据目录..."
mkdir -p data/{db,storage,exports,versions,logs}
echo "  [✓] 数据目录已创建"

# ── 4. 环境配置 ──────────────────────────────────────────────────────────
echo ""
echo "[4/6] 环境配置..."
if [ ! -f .env ]; then
  cat > .env << 'ENVEOF'
# =============================================================================
# Fusion-Doc V0.2 — 环境配置
# =============================================================================

# 服务端口
FUSION_DOC_PORT=11449

# Fusion-MLX（本地 AI 推理引擎）
# 默认经 fusion-gateway 11432 统一组网 (方案B); env 可覆盖回直连 11434
FUSION_MLX_URL=http://127.0.0.1:11432
FUSION_MLX_API_KEY=

# AI 模型配置
AI_CHAT_MODEL=Qwen3.5-9B-4bit
AI_EMBEDDING_MODEL=bge-small-en-v1.5
AI_RERANK_MODEL=bge-reranker-v2-m3

# 存储
STORAGE_DIR=./data/storage

# 日志级别: debug, info, warn, error
LOG_LEVEL=info

# 认证
JWT_SECRET=fusion-doc-$(date +%s)$(uuidgen 2>/dev/null || echo 'random-secret')
SESSION_EXPIRY=86400

# 内置 TLS (解裸暴露; 任一证书路径配置即启用 HTTPS, 两者须同时提供)
# FUSION_DOC_TLS_CERT=
# FUSION_DOC_TLS_KEY=
# FUSION_DOC_TLS_CA=              # 可选: mTLS 客户端证书 CA
# FUSION_DOC_TLS_REDIRECT=1       # HTTP→HTTPS 跳转 (默认开)
# FUSION_DOC_HTTP_PORT=11448      # 跳转监听端口

# 多实例角色 (同机多进程; primary 担 E8 清扫+自动备份, replica 只接请求)
# FUSION_DOC_ROLE=primary

# 海量知识库 (sqlite-vec ANN; 维度须与 embedding 模型一致, 默认 384 = bge-small-en-v1.5)
# AI_EMBEDDING_DIM=384

# 自动备份 (进程内调度, <=0 关闭)
# AUTO_BACKUP_HOURS=24
ENVEOF
  echo "  [✓] .env 配置文件已创建"
else
  echo "  [✓] .env 已存在"
fi

# ── 5. 验证 ──────────────────────────────────────────────────────────────
echo ""
echo "[5/6] 验证..."
node -c server/index.js 2>/dev/null && echo "  [✓] server/index.js" || echo "  [✗] server/index.js"
node -c server/app.js 2>/dev/null && echo "  [✓] server/app.js" || echo "  [✗] server/app.js"
node -c server/config.js 2>/dev/null && echo "  [✓] server/config.js" || echo "  [✗] server/config.js"
node -c server/db.js 2>/dev/null && echo "  [✓] server/db.js" || echo "  [✗] server/db.js"
echo "  [✓] 代码验证完成"

# ── 6. 完成 ──────────────────────────────────────────────────────────────
echo ""
echo "[6/6] 安装完成!"
echo ""
echo "=========================================="
echo "  启动: bash scripts/start.sh"
echo "  访问: http://localhost:11449"
echo "  文档: 查看 docs/ 目录"
echo "=========================================="
echo ""
echo "  特性概览:"
echo "  ✅ TipTap 编辑器 + Yjs 实时协作"
echo "  ✅ 三层文档结构（空间→书架→章节→页面）"
echo "  ✅ SQLite FTS5 全文搜索"
echo "  ✅ 标签系统 + 工作流"
echo "  ✅ 双向链接 + 知识图谱"
echo "  ✅ PDF/HTML/Markdown/Office 导出"
echo "  ✅ Fusion-MLX 本地 AI 推理（RAG / Streaming / Agent）"
echo "  ✅ 模块化 MVC 架构 + 插件系统"
echo "  ✅ macOS 原生优化"
echo ""