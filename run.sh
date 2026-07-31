#!/usr/bin/env bash
# Start both halves and wait. Ctrl-C stops both.
#
# The frontend proxies /api to the backend (see frontend/vite.config.js), so the
# browser only ever talks to one origin and no CORS negotiation is involved.
set -euo pipefail
cd "$(dirname "$0")"

BACKEND_PORT="${BACKEND_PORT:-8000}"
FRONTEND_PORT="${PORT:-5173}"
export OFFLINE_MODE="${OFFLINE_MODE:-1}"

cleanup() { kill 0 2>/dev/null || true; }
trap cleanup EXIT INT TERM

echo "backend  → http://127.0.0.1:${BACKEND_PORT}   (OFFLINE_MODE=${OFFLINE_MODE})"
( cd backend && python -m uvicorn main:app --host 127.0.0.1 --port "${BACKEND_PORT}" ) &

# Wait for the backend before starting Vite, so the first proxied request lands.
for _ in $(seq 1 40); do
  if python -c "import urllib.request,sys; urllib.request.urlopen('http://127.0.0.1:${BACKEND_PORT}/api/health',timeout=1)" 2>/dev/null; then break; fi
  sleep 0.5
done

echo "frontend → http://localhost:${FRONTEND_PORT}"
( cd frontend && BACKEND_URL="http://127.0.0.1:${BACKEND_PORT}" PORT="${FRONTEND_PORT}" npm run dev ) &

wait
