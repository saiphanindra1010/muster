#!/usr/bin/env bash
# Muster one-command launcher: harness + web UI + open browser.
# Shares the desktop app's data folder by default (same bots + chat history).
# Usage: ./run.sh  (Ctrl+C stops everything)
set -euo pipefail
cd "$(dirname "$0")"

# Toolchain on PATH for anything spawned below (Rust for Tauri builds,
# bun/node for the web stack). Harmless if already present.
[ -f "$HOME/.cargo/env" ] && . "$HOME/.cargo/env"
command -v bun >/dev/null || { echo "[run] bun not found on PATH"; exit 1; }

# bun auto-loads .env when the launcher runs; mirror that here so both sides
# agree on MUSTER_DATA_DIR / MUSTER_PORT before anything starts.
if [ -f .env ]; then
  set -a
  . ./.env || { echo "[run] failed to load ./.env"; exit 1; }
  set +a
fi

PORT="${MUSTER_PORT:-4096}"
URL="${VITE_OPENCODE_URL:-http://127.0.0.1:$PORT}"
WEB_PORT=1420
# Same folder the desktop app uses — one set of bots + chat history in both.
# Override for a sandbox: MUSTER_DATA_DIR=./data ./run.sh
DATA_DIR="${MUSTER_DATA_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/com.muster.app/muster/data}"
case "$DATA_DIR" in /*) ;; *) DATA_DIR="$PWD/$DATA_DIR" ;; esac
export MUSTER_DATA_DIR="$DATA_DIR"
TOKEN_FILE="$DATA_DIR/state/harness-token-$PORT"

echo "[run] data folder: $DATA_DIR"
echo "[run] starting harness on :$PORT ..."
rm -f "$TOKEN_FILE" # stale passwords never work — each boot mints a new one
bun run start & HARNESS_PID=$!

echo "[run] waiting for harness token ..."
for i in $(seq 1 90); do
  [ -f "$TOKEN_FILE" ] && break
  sleep 1
  if ! kill -0 "$HARNESS_PID" 2>/dev/null; then
    echo "[run] harness died. Check output above."
    exit 1
  fi
done
[ -f "$TOKEN_FILE" ] || { echo "[run] timed out waiting for $TOKEN_FILE"; kill "$HARNESS_PID" 2>/dev/null; exit 1; }

export VITE_OPENCODE_TOKEN
VITE_OPENCODE_TOKEN="$(cat "$TOKEN_FILE")"
export VITE_WORKSPACE_DIR="$DATA_DIR/workspace"
export VITE_OPENCODE_URL="$URL"

echo "[run] starting web UI on :$WEB_PORT ..."
bun run dev:web & WEB_PID=$!

for i in $(seq 1 60); do
  curl -s -o /dev/null "http://127.0.0.1:$WEB_PORT/" && break
  sleep 1
done

echo "[run] opening http://127.0.0.1:$WEB_PORT/ ..."
(xdg-open "http://127.0.0.1:$WEB_PORT/" >/dev/null 2>&1 || true) &

cleanup() {
  echo; echo "[run] stopping ..."
  kill "$WEB_PID" "$HARNESS_PID" 2>/dev/null || true
}
trap cleanup INT TERM
wait
