#!/usr/bin/env bash
# Stage the real OpenCode harness binary at the Tauri sidecar path.
# The file is gitignored (~250MB). Run this on each OS before `tauri build`.
#
# `command -v opencode` is not enough: on Windows the global install is a small
# shim, while the real binary lives in the installed @opencode/cli package.
set -euo pipefail
cd "$(dirname "$0")/.."

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

case "$triple" in
  *windows*) os=windows; exe=.exe ;;
  *apple-darwin*) os=darwin; exe= ;;
  *linux*) os=linux; exe= ;;
  *) echo "Unsupported target: $triple" >&2; exit 1 ;;
esac
case "$triple" in
  x86_64*) arch=x64 ;;
  aarch64*|arm64*) arch=arm64 ;;
  *) echo "Unsupported architecture: $triple" >&2; exit 1 ;;
esac

# The postinstall step replaces @opencode/cli/bin/opencode.exe with the real
# platform binary. The platform package keeps the same file. Prefer those over
# the global launcher, which is a small shim on Windows.
global="${BUN_INSTALL:-$HOME/.bun}/install/global/node_modules"
candidates=(
  "$global/@opencode/cli/bin/opencode.exe"
  "$global/@opencode/cli/bin/opencode"
  "$global/@opencode/cli-${os}-${arch}/bin/opencode${exe}"
  "$global/@opencode/cli-${os}-${arch}-baseline/bin/opencode${exe}"
)

src=""
for cand in "${candidates[@]}"; do
  [ -f "$cand" ] || continue
  size="$(wc -c < "$cand" | tr -d ' ')"
  if [ "$size" -gt 50000000 ]; then src="$cand"; break; fi
done

# Local installs may only have opencode on PATH (e.g. ~/.opencode/bin).
if [ -z "$src" ]; then
  fallback="$(command -v opencode || true)"
  if [ -n "$fallback" ]; then
    resolved="$(python3 -c 'import os,sys; print(os.path.realpath(sys.argv[1]))' "$fallback" 2>/dev/null || echo "$fallback")"
    size="$(wc -c < "$resolved" | tr -d ' ')"
    if [ "$size" -gt 50000000 ]; then src="$resolved"; fi
  fi
fi

if [ -z "$src" ]; then
  echo "Could not find the real OpenCode binary (looked in $global and on PATH)." >&2
  echo "Install it with: bun install -g --trust \"@opencode/cli@<version>\"" >&2
  exit 1
fi

mkdir -p src-tauri/binaries
dest="src-tauri/binaries/opencode-${triple}${exe}"
cp "$src" "$dest"
chmod +x "$dest"
echo "staged $dest from $src ($(wc -c < "$dest" | tr -d ' ') bytes)"
