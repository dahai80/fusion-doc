#!/usr/bin/env bash
# =============================================================================
# Fusion-Doc V0.1 — 一键启动
# =============================================================================
# 整合 7 大开源优势 + Fusion-MLX AI，macOS 原生优化
# =============================================================================
set -euo pipefail
cd "$(dirname "$0")/.."

set -a; [ -f .env ] && source .env; set +a
echo "=========================================="
echo "  Fusion-Doc V0.1"
echo "  整合 7 大开源优势，macOS 原生优化"
echo "=========================================="

echo "[1/2] 检查 Fusion-MLX..."
if curl -sf "${FUSION_MLX_URL:-http://localhost:11434}/v1/models" > /dev/null 2>&1; then
  echo "  [✓] Fusion-MLX"
else
  echo "  [✗] Fusion-MLX 未运行"
  exit 1
fi

echo "[2/2] 启动 Fusion-Doc..."
mkdir -p data/{db,storage,exports,versions,logs}
export FUSION_DOC_PORT="${FUSION_DOC_PORT:-11435}"
export FUSION_MLX_URL="${FUSION_MLX_URL:-http://localhost:11434}"
node server/index.js &
PID=$!
echo "  [✓] PID: $PID"
echo ""
echo "  http://localhost:${FUSION_DOC_PORT}"
echo ""
trap "kill $PID 2>/dev/null; echo '已停止'" EXIT INT TERM
wait