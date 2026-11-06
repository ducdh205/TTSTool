#!/usr/bin/env bash
# Start redis (if needed), tts-service and gateway for local development (WSL Ubuntu).
# Ctrl+C stops both services.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/env.sh"

command -v ffmpeg >/dev/null || { echo "ffmpeg missing: sudo apt install -y ffmpeg"; exit 1; }
command -v redis-cli >/dev/null || { echo "redis missing: sudo apt install -y redis-server"; exit 1; }
if ! redis-cli ping >/dev/null 2>&1; then
  echo "Starting redis-server..."
  sudo service redis-server start
fi

[ -f "$ROOT_DIR/tts-service/.env" ] || cp "$ROOT_DIR/tts-service/.env.example" "$ROOT_DIR/tts-service/.env"
[ -f "$ROOT_DIR/gateway/.env" ] || cp "$ROOT_DIR/gateway/.env.example" "$ROOT_DIR/gateway/.env"

pids=()
cleanup() { kill "${pids[@]}" 2>/dev/null || true; wait 2>/dev/null || true; }
trap cleanup EXIT INT TERM

(cd "$ROOT_DIR/tts-service" && uv run --no-sync uvicorn app.main:app --host 127.0.0.1 --port 8001) &
pids+=($!)
(cd "$ROOT_DIR/gateway" && npm run start:dev) &
pids+=($!)

echo "tts-service: http://127.0.0.1:8001/health   gateway + UI: http://localhost:3000"
wait -n
