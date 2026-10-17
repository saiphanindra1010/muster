# Development

## Prereqs

- Bun >= 1.2
- OpenCode >= 2.0 on PATH (for browser mode; also the source of the desktop
  sidecar)
- A model: local Ollama / LM Studio (no key), a cloud key (see `.env.example`),
  or the built-in free `opencode/*-free` models
- Rust **only** for the desktop app; the toolchain is pinned to 1.98 in
  `src-tauri/rust-toolchain.toml` (rustc 1.99.0 has a reproducible ICE on
  `hashbrown`)

## Setup

```sh
bun install
cp .env.example .env   # optional: provider + websearch keys
```

## Run modes

| cmd | what |
| --- | --- |
| `./run.sh` | harness + UI + open browser (Ctrl+C stops all) |
| `bun run start` | only the headless harness with data/ isolation |
| `bun run dev:web` | only the Vite UI (needs exported token vars — `run.sh` does this) |
| `bun run build:web` | typecheck + production build of the UI |
| `bun run tauri:dev` | desktop window in dev mode |
| `bun run tauri:build` | .deb bundle (needs cargo + system webkit deps) |

Ports: harness `4096` in browser mode (override with `MUSTER_PORT`), Vite
`1420` (strict). The desktop app picks a **free loopback port** at startup, so
it never clashes with a dev harness on 4096.

## Environment

| var | meaning |
| --- | --- |
| `MUSTER_DATA_DIR` | data root (default `$XDG_DATA_HOME/com.muster.app/muster/data`) |
| `MUSTER_PORT` / `MUSTER_HOST` | harness bind address (browser mode) |
| `MUSTER_CORS` | extra allowed origins for the harness |
| `VITE_OPENCODE_URL` / `VITE_OPENCODE_TOKEN` / `VITE_WORKSPACE_DIR` | UI → harness coordinates (exported by `run.sh`; provided by the desktop shell at runtime) |
| `OPENCODE_DISABLE_PRUNE=1` | keep all sessions (forwarded default) |

`.env` at the repo root is loaded by Bun for the launcher. `VITE_*` vars do
**not** reach `vite dev` from there — `run.sh` exports them explicitly.

## Data folder & sandboxing

Browser mode and the desktop app share one root by default, so both see the
same bots and chats. For a throwaway sandbox:

```sh
MUSTER_DATA_DIR=./data ./run.sh
```

`./data/` is gitignored. Never point two harnesses at one root at the same
time.

## Verifying changes

Typecheck and build with real Node — bun's JSC crashes intermittently on tsc:

```sh
node node_modules/typescript/lib/tsc.js --noEmit -p src/tsconfig.json
cd src && node node_modules/vite/bin/vite.js build
```

UI smoke test against a sandbox, without touching real data:

```sh
# 1. copy a data folder to scratch
rsync -a ./data/ /tmp/muster-check/data/

# 2. harness on a scratch port, XDG redirected into the copy
XDG_DATA_HOME=/tmp/muster-check/data/share \
XDG_CONFIG_HOME=/tmp/muster-check/data/config \
XDG_STATE_HOME=/tmp/muster-check/data/state \
OPENCODE_DB=/tmp/muster-check/data/share/opencode/opencode.db \
opencode serve --hostname 127.0.0.1 --port 41111 --cors http://127.0.0.1:1430
# read the `server password <pw>` line it prints

# 3. scratch Vite on another port against it
cd src && VITE_OPENCODE_URL=http://127.0.0.1:41111 \
VITE_OPENCODE_TOKEN=<pw> \
VITE_WORKSPACE_DIR=/tmp/muster-check/data/workspace \
node node_modules/vite/bin/vite.js --port 1430 --strictPort
```

Drive it with `playwright-core` + system Chrome
(`executablePath: /usr/bin/google-chrome`). Wait for `domcontentloaded` —
**never `networkidle`**: the SSE stream keeps the network open by design.

## Desktop build

```sh
# stage the sidecar (gitignored, ~200MB)
cp "$(which opencode)" src-tauri/binaries/opencode-$(rustc -vV | sed -n 's/^host: //p')
bun run tauri:build   # .deb at src-tauri/target/release/bundle/deb/
```

## Toolchain notes for this machine

- rustc 1.98.x occasionally SIGSEGVs inside LLVM
  (`error: rustc interrupted by SIGSEGV`). It is flaky, not a code problem —
  rerun the build.
- bun-run `tsc` intermittently crashes in JSC
  (`bindParentToChildIgnoringJSDoc`); retry, or run TypeScript with Node as
  above.
- The ~200MB `opencode` sidecar binary is never committed
  (`src-tauri/binaries/` is gitignored).

## House rules

- The UI never touches OpenCode storage directly; reads and writes go through
  the harness API.
- Config edits go through `src/lib/jsonc.ts` so user comments and unknown keys
  survive.
- No user-visible engine references: bots speak as colleagues, never as
  "OpenCode". No emojis; icons come from Lucide via `src/icons.tsx`.
- Verify against a sandbox data folder; don't experiment on real bots.
