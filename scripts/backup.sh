#!/usr/bin/env bash
# =============================================================================
# Fusion-Doc — 数据库备份脚本 (商用级运维工具, 可接入 cron 定时备份)
# 用法: bash scripts/backup.sh [保留份数, 默认 30]
# =============================================================================
set -euo pipefail
cd "$(dirname "$0")/.."

KEEP="${1:-30}"
DB_DIR="data/db"
BACKUP_DIR="${DB_DIR}/backups"
DB_FILE="${DB_DIR}/fusion-doc.db"

if [ ! -f "$DB_FILE" ]; then
  echo "[✗] 数据库不存在: $DB_FILE"
  exit 1
fi

mkdir -p "$BACKUP_DIR"
STAMP=$(date +"%Y%m%d-%H%M%S")
DEST="${BACKUP_DIR}/fusion-doc-${STAMP}.db"

# 使用 SQLite 在线备份 (按 WAL 一致性快照, 不阻塞服务)
if command -v sqlite3 >/dev/null 2>&1; then
  sqlite3 "$DB_FILE" ".backup '$DEST'" 2>/dev/null
elif [ -f node_modules/.bin/better-sqlite3 ] || true; then
  # 降级: 用 Node better-sqlite3 原生 .backup()
  node -e "const D=require('better-sqlite3');const d=new D('$DB_FILE');d.backup('$DEST');d.close();"
else
  cp "$DB_FILE" "$DEST"
fi

SIZE=$(du -h "$DEST" | cut -f1)
echo "[✓] 备份完成: $DEST ($SIZE)"

# 保留份数清理 (超量删除最旧)
COUNT=$(ls -1 "${BACKUP_DIR}"/fusion-doc-*.db 2>/dev/null | wc -l | tr -d ' ')
if [ "$COUNT" -gt "$KEEP" ]; then
  REMOVE=$((COUNT - KEEP))
  ls -1t "${BACKUP_DIR}"/fusion-doc-*.db | tail -n "$REMOVE" | while read -r old; do
    rm -f "$old"
    echo "[i] 清理旧备份: $(basename "$old")"
  done
fi
