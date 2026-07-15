#!/usr/bin/env bash
# =============================================================================
# Fusion-Doc V0.1 — 安装脚本
# =============================================================================
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

echo "=========================================="
echo "  Fusion-Doc V0.1 安装"
echo "=========================================="

# ── 1. 系统依赖 ──────────────────────────────────────────────────────────
echo "[1/6] 系统依赖..."
for cmd in node pnpm python3 psql redis-cli git; do
  command -v $cmd >/dev/null 2>&1 || { echo "  [✗] $cmd 未安装"; exit 1; }
  echo "  [✓] $cmd"
done

# ── 2. 数据库 ────────────────────────────────────────────────────────────
echo "[2/6] 数据库..."
if ! pg_isready -q 2>/dev/null; then
  brew services start postgresql@18 2>/dev/null || true
  sleep 2
fi
for db in fusiondoc fusion_kb; do
  psql -U postgres -tc "SELECT 1 FROM pg_database WHERE datname='$db'" | grep -q 1 || \
    createdb -U postgres "$db" 2>/dev/null && echo "  [✓] 数据库 $db 已就绪" || true
done

# ── 3. 克隆 DocMost ─────────────────────────────────────────────────────
echo "[3/6] DocMost..."
if [ ! -d "$PROJECT_DIR/docmost" ]; then
  git clone --depth 1 https://github.com/docmost/docmost.git docmost
  cd docmost && pnpm install && cd "$PROJECT_DIR"
  echo "  [✓] DocMost 已安装"
else
  echo "  [✓] DocMost 已存在"
fi

# ── 4. 克隆 MaxKB ───────────────────────────────────────────────────────
echo "[4/6] MaxKB..."
if [ ! -d "$PROJECT_DIR/maxkb" ]; then
  git clone --depth 1 https://github.com/1Panel-dev/MaxKB.git maxkb
  cd maxkb && python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt
  cd "$PROJECT_DIR"
  echo "  [✓] MaxKB 已安装"
else
  echo "  [✓] MaxKB 已存在"
fi

# ── 5. 网关 ──────────────────────────────────────────────────────────────
echo "[5/6] 网关..."
cd "$PROJECT_DIR/gateway"
npm install --silent 2>/dev/null || true
cd "$PROJECT_DIR"
echo "  [✓] 网关依赖已安装"

# ── 6. 数据目录 ──────────────────────────────────────────────────────────
echo "[6/6] 数据目录..."
mkdir -p "$PROJECT_DIR/data"/{logs,storage,vectors}
echo "  [✓] 数据目录已创建"

echo ""
echo "=========================================="
echo "  安装完成！"
echo "=========================================="
echo "  启动: bash scripts/start.sh"
echo "  访问: http://localhost:3000"