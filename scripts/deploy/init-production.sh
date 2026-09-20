#!/usr/bin/env bash
# 生产 MySQL 初始化：建库建表 + seed-prod（不含 dev 测试数据）
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ENV_FILE="${1:-}"

if [[ -z "$ENV_FILE" ]]; then
  for candidate in "$ROOT/.env" "$ROOT/backend/.env" "$ROOT/.env.production"; do
    if [[ -f "$candidate" ]]; then ENV_FILE="$candidate"; break; fi
  done
fi

echo "[init-production] project root: $ROOT"
if [[ -n "$ENV_FILE" && -f "$ENV_FILE" ]]; then
  echo "[init-production] env file: $ENV_FILE"
  cp -f "$ENV_FILE" "$ROOT/backend/.env"
fi

cd "$ROOT/backend"
npm run db:init
npm run db:seed-prod
echo "[init-production] done."
