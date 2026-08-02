#!/usr/bin/env bash
# =============================================================================
# Fusion-Doc V0.2 — 一键启动
# 架构: 模块化 MVC（Model-View-Controller）
# 生态: Fusion-MLX + Fusion-Coder + Fusion-KB
# =============================================================================
set -euo pipefail
cd "$(dirname "$0")/.."

# 加载环境变量
set -a; [ -f .env ] && source .env; set +a

echo "=========================================="
echo "  Fusion-Doc V0.2"
echo "  Apple Silicon 原生离线智能文档知识库"
echo "  模块化 MVC · 插件体系 · 融合生态"
echo "=========================================="

# ── 1. 检查依赖 ──────────────────────────────────────────────────────────
echo ""
echo "[1/3] 检查依赖..."

# Node.js
if command -v node &>/dev/null; then
  echo "  [✓] Node.js $(node -v)"
else
  echo "  [✗] Node.js 未安装"
  exit 1
fi

# better-sqlite3
if node -e "require('better-sqlite3')" 2>/dev/null; then
  echo "  [✓] better-sqlite3"
else
  echo "  [✗] better-sqlite3 未安装，运行: npm install"
  exit 1
fi

# Fusion-MLX
MLX_URL="${FUSION_MLX_URL:-http://localhost:11434}"
echo "  [~] 检查 Fusion-MLX ${MLX_URL}..."
if curl -sf "${MLX_URL}/v1/models" > /dev/null 2>&1; then
  echo "  [✓] Fusion-MLX"
else
  echo "  [✗] Fusion-MLX 未运行（AI 功能不可用，doc 基础功能仍可正常使用）"
fi

# ── 2. 数据目录 ──────────────────────────────────────────────────────────
echo ""
echo "[2/3] 数据目录..."
mkdir -p data/{db,storage,exports,versions,logs}
echo "  [✓] 数据目录已就绪"

# ── 3. 启动服务 ──────────────────────────────────────────────────────────
echo ""
echo "[3/3] 启动 Fusion-Doc..."

PORT="${FUSION_DOC_PORT:-11449}"
export NODE_ENV="${NODE_ENV:-development}"

node server/index.js &
PID=$!

echo ""
echo "  ╔══════════════════════════════════════════╗"
echo "  ║     Fusion-Doc 已启动                     ║"
echo "  ╠══════════════════════════════════════════╣"
echo "  ║  📍 http://localhost:${PORT}               ║"
echo "  ║  🧠 AI: ${MLX_URL}                         ║"
echo "  ║  💾 存储: SQLite + JSON                  ║"
echo "  ╚══════════════════════════════════════════╝"
echo ""
echo "  按 Ctrl+C 停止服务"

# 优雅关闭
trap "kill $PID 2>/dev/null; echo ''; echo 'Fusion-Doc 已安全关闭'; exit 0" EXIT INT TERM
wait