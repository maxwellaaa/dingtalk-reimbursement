#!/usr/bin/env bash
# MySQL 逻辑备份（mysqldump + gzip），按天数保留
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ENV_FILE=""
BACKUP_DIR=""
RETENTION_DAYS=""
DRY_RUN=0
NO_COMPRESS=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env) ENV_FILE="$2"; shift 2 ;;
    --dir) BACKUP_DIR="$2"; shift 2 ;;
    --retention) RETENTION_DAYS="$2"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    --no-compress) NO_COMPRESS=1; shift ;;
    *) echo "Unknown arg: $1" >&2; exit 1 ;;
  esac
done

if [[ -z "$ENV_FILE" ]]; then
  for c in "$ROOT/.env" "$ROOT/backend/.env"; do
    [[ -f "$c" ]] && ENV_FILE="$c" && break
  done
fi

load_env() {
  local key="$1" default="$2"
  if [[ -n "${!key:-}" ]]; then echo "${!key}"; return; fi
  if [[ -f "$ENV_FILE" ]]; then
    local val
    val="$(grep -E "^${key}=" "$ENV_FILE" | tail -1 | cut -d= -f2- | tr -d '\r' | sed 's/^"\(.*\)"$/\1/')"
    if [[ -n "$val" ]]; then echo "$val"; return; fi
  fi
  echo "$default"
}

DB_HOST="$(load_env DB_HOST 127.0.0.1)"
DB_PORT="$(load_env DB_PORT 3306)"
DB_USER="$(load_env DB_USER reimb)"
DB_PASS="$(load_env DB_PASSWORD '')"
DB_NAME="$(load_env DB_NAME reimbursement)"
BACKUP_DIR="${BACKUP_DIR:-$(load_env BACKUP_DIR "$ROOT/backups/mysql")}"
RETENTION_DAYS="${RETENTION_DAYS:-$(load_env BACKUP_RETENTION_DAYS 14)}"
DUMP_BIN="$(load_env MYSQLDUMP_BIN mysqldump)"

STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="$BACKUP_DIR/${DB_NAME}-${STAMP}.sql"
[[ $NO_COMPRESS -eq 0 ]] && OUT="${OUT}.gz"

echo "[mysql-backup] host=$DB_HOST port=$DB_PORT db=$DB_NAME user=$DB_USER"
echo "[mysql-backup] output=$OUT retention=${RETENTION_DAYS}d"

if [[ $DRY_RUN -eq 1 ]]; then
  echo "[mysql-backup] DRY RUN"
  exit 0
fi

mkdir -p "$BACKUP_DIR"
export MYSQL_PWD="$DB_PASS"
trap 'unset MYSQL_PWD' EXIT

if [[ $NO_COMPRESS -eq 1 ]]; then
  "$DUMP_BIN" -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" \
    --single-transaction --routines --triggers --set-gtid-purged=OFF --no-tablespaces \
    "$DB_NAME" > "$OUT"
else
  "$DUMP_BIN" -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" \
    --single-transaction --routines --triggers --set-gtid-purged=OFF --no-tablespaces \
    "$DB_NAME" | gzip -c > "$OUT"
fi

echo "[mysql-backup] done size=$(du -h "$OUT" | cut -f1)"

find "$BACKUP_DIR" -type f -name "${DB_NAME}-*" -mtime +"$RETENTION_DAYS" -print -delete
