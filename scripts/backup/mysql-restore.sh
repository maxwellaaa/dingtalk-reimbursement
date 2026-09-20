#!/usr/bin/env bash
# 从 mysqldump 备份恢复（.sql / .sql.gz）
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <backup.sql|backup.sql.gz> [--env path] [--force]" >&2
  exit 1
fi

BACKUP_FILE="$1"
shift
ENV_FILE=""
FORCE=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env) ENV_FILE="$2"; shift 2 ;;
    --force) FORCE=1; shift ;;
    *) echo "Unknown: $1" >&2; exit 1 ;;
  esac
done

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
[[ -f "$BACKUP_FILE" ]] || { echo "Not found: $BACKUP_FILE" >&2; exit 1; }

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
    val="$(grep -E "^${key}=" "$ENV_FILE" | tail -1 | cut -d= -f2- | tr -d '\r')"
    [[ -n "$val" ]] && echo "$val" && return
  fi
  echo "$default"
}

DB_HOST="$(load_env DB_HOST 127.0.0.1)"
DB_PORT="$(load_env DB_PORT 3306)"
DB_USER="$(load_env DB_USER reimb)"
DB_PASS="$(load_env DB_PASSWORD '')"
DB_NAME="$(load_env DB_NAME reimbursement)"
MYSQL_BIN="$(load_env MYSQL_BIN mysql)"

echo "[mysql-restore] target=$DB_HOST:$DB_PORT/$DB_NAME from=$BACKUP_FILE"
if [[ $FORCE -ne 1 ]]; then
  read -r -p "Overwrite database [$DB_NAME]? Type YES: " ans
  [[ "$ans" == "YES" ]] || { echo "aborted"; exit 1; }
fi

export MYSQL_PWD="$DB_PASS"
trap 'unset MYSQL_PWD' EXIT

if [[ "$BACKUP_FILE" == *.gz ]]; then
  gunzip -c "$BACKUP_FILE" | "$MYSQL_BIN" -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" "$DB_NAME"
else
  "$MYSQL_BIN" -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" "$DB_NAME" < "$BACKUP_FILE"
fi

echo "[mysql-restore] done"
