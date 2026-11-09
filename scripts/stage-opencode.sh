#!/usr/bin/env bash
# Copy the local `opencode` binary into the Tauri sidecar path.
# The file is gitignored (~200MB). Run this on each OS before `tauri build`.
set -euo pipefail
cd "$(dirname "$0")/.."

command -v opencode >/dev/null || { echo "opencode is not on PATH" >&2; exit 1; }

if command -v rustc >/dev/null; then
  triple="$(rustc -vV | sed -n 's/^host: //p')"
else
  case "$(uname -s)-$(uname -m)" in
    Darwin-arm64) triple=aarch64-apple-darwin ;;
    Darwin-x86_64) triple=x86_64-apple-darwin ;;
    Linux-x86_64) triple=x86_64-unknown-linux-gnu ;;
    Linux-aarch64|Linux-arm64) triple=aarch64-unknown-linux-gnu ;;
    MINGW*-x86_64|MSYS*-x86_64|CYGWIN*-x86_64) triple=x86_64-pc-windows-msvc ;;
    MINGW*-aarch64|MSYS*-aarch64) triple=aarch64-pc-windows-msvc ;;
    *) echo "Could not guess the target triple. Install rustc and rerun." >&2; exit 1 ;;
  esac
fi

mkdir -p src-tauri/binaries
dest="src-tauri/binaries/opencode-${triple}"
case "$triple" in
  *windows*) dest="${dest}.exe" ;;
esac
cp "$(command -v opencode)" "$dest"
chmod +x "$dest"
echo "staged $dest"
