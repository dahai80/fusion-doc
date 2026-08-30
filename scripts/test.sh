#!/usr/bin/env bash
# =============================================================================
# Fusion-Doc — 测试脚本
# 验证服务器启动、API 响应、核心功能
# =============================================================================
set -euo pipefail
cd "$(dirname "$0")/.."

PORT="${FUSION_DOC_PORT:-11449}"
BASE="http://localhost:${PORT}"
PASS=0
FAIL=0

green() { echo -e "\033[32m$1\033[0m"; }
red() { echo -e "\033[31m$1\033[0m"; }
test_pass() { PASS=$((PASS+1)); green "  [✓] $1"; }
test_fail() { FAIL=$((FAIL+1)); red "  [✗] $1"; }

echo "=========================================="
echo "  Fusion-Doc V0.2 测试"
echo "=========================================="
echo ""

# 1. 代码验证
echo "[代码验证]"
for f in server/index.js server/app.js server/config.js server/db.js server/utils/helpers.js server/utils/static.js; do
  node -c "$f" 2>/dev/null && test_pass "$f" || test_fail "$f"
done
echo ""

# 2. 控制器验证
echo "[控制器验证]"
for f in server/controllers/*.js; do
  node -c "$f" 2>/dev/null && test_pass "$(basename $f)" || test_fail "$(basename $f)"
done
echo ""

# 3. 中间件验证
echo "[中间件验证]"
for f in server/middleware/*.js; do
  node -c "$f" 2>/dev/null && test_pass "$(basename $f)" || test_fail "$(basename $f)"
done
echo ""

# 4. 服务层验证
echo "[服务层验证]"
for f in server/services/*.js; do
  node -c "$f" 2>/dev/null && test_pass "$(basename $f)" || test_fail "$(basename $f)"
done
echo ""

# 5. 模型层验证
echo "[模型层验证]"
for f in server/models/*.js; do
  node -c "$f" 2>/dev/null && test_pass "$(basename $f)" || test_fail "$(basename $f)"
done
echo ""

# 6. 集成层验证
echo "[集成层验证]"
for f in server/integrations/*.js; do
  node -c "$f" 2>/dev/null && test_pass "$(basename $f)" || test_fail "$(basename $f)"
done
echo ""

# 7. 插件层验证
echo "[插件层验证]"
for f in server/plugins/*.js; do
  node -c "$f" 2>/dev/null && test_pass "$(basename $f)" || test_fail "$(basename $f)"
done
echo ""

# 汇总
echo "=========================================="
echo "  结果: ${PASS} 通过, ${FAIL} 失败"
echo "=========================================="

# 7.5. 行为测试 (E8 修复: node:test 单元测试, 零外部依赖)
echo ""
echo "[行为测试 node:test]"
# node --test 需显式文件 glob; 传 "tests/unit/" (带斜杠) 会被当模块路径解析报 MODULE_NOT_FOUND。
if node --test tests/unit/*.js > /tmp/fd-unittest.log 2>&1; then
  # node --test 报告行: TAP "ok <n>" 或 reporter "✔"; 两者都计。
  PASS_CNT=$(grep -cE '^(ok |✔)' /tmp/fd-unittest.log || echo 0)
  test_pass "行为测试 ${PASS_CNT} 条全部通过"
else
  test_fail "行为测试存在失败用例"
  cat /tmp/fd-unittest.log
fi
echo ""
echo "  结果: ${PASS} 通过, ${FAIL} 失败"

# 只有在服务器运行时才测试 API
if curl -sf "${BASE}/api/health" > /dev/null 2>&1; then
  echo ""
  echo "[API 测试]"
  HEALTH=$(curl -sf "${BASE}/api/health")
  if echo "$HEALTH" | grep -q '"status":"ok"'; then
    test_pass "/api/health"
  else
    test_fail "/api/health"
  fi

  BRANDING=$(curl -sf "${BASE}/api/branding")
  if echo "$BRANDING" | grep -q 'Fusion-Doc'; then
    test_pass "/api/branding"
  else
    test_fail "/api/branding"
  fi
  echo ""
  echo "  提示: 更多 API 测试请启动服务器后运行"
fi

exit $([ $FAIL -eq 0 ] && echo 0 || echo 1)