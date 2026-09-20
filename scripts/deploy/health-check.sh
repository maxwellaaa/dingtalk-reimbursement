#!/usr/bin/env bash
# 检查后端 /api/health 与可选前端 /healthz
set -euo pipefail

BACKEND_URL="${1:-http://localhost:3000}"
FRONTEND_URL="${2:-}"

check_json() {
  local name="$1" url="$2"
  if curl -sf "$url" | grep -q '"ok":true'; then
    echo "[health-check] OK $name -> $url"
  else
    echo "[health-check] FAIL $name -> $url" >&2
    exit 1
  fi
}

check_json "backend" "$BACKEND_URL/api/health"

if [[ -n "$FRONTEND_URL" ]]; then
  if curl -sf "$FRONTEND_URL/healthz" | grep -q 'ok'; then
    echo "[health-check] OK frontend -> $FRONTEND_URL/healthz"
  else
    echo "[health-check] FAIL frontend -> $FRONTEND_URL/healthz" >&2
    exit 1
  fi
fi

echo "[health-check] all passed"
