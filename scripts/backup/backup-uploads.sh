#!/usr/bin/env bash
# 打包 backend/uploads 目录
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
UPLOADS_DIR="${UPLOADS_DIR:-$ROOT/backend/uploads}"
BACKUP_DIR="${BACKUP_DIR:-$ROOT/backups/uploads}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
DRY_RUN=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    --dir) BACKUP_DIR="$2"; shift 2 ;;
    *) echo "Unknown: $1" >&2; exit 1 ;;
  esac
done

STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="$BACKUP_DIR/uploads-$STAMP.tar.gz"

echo "[backup-uploads] source=$UPLOADS_DIR"
echo "[backup-uploads] output=$OUT"

if [[ $DRY_RUN -eq 1 ]]; then
  echo "[backup-uploads] DRY RUN"
  exit 0
fi

mkdir -p "$BACKUP_DIR"
if [[ ! -d "$UPLOADS_DIR" ]]; then
  touch "$BACKUP_DIR/uploads-$STAMP.empty"
  echo "[backup-uploads] no uploads dir"
  exit 0
fi

tar -czf "$OUT" -C "$(dirname "$UPLOADS_DIR")" "$(basename "$UPLOADS_DIR")"
echo "[backup-uploads] done"

find "$BACKUP_DIR" -type f -name 'uploads-*' -mtime +"$RETENTION_DAYS" -print -delete
