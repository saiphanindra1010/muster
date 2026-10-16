# openchat_bot — personal bot coworkers on a local OpenCode harness

Just bots. Sidebar lists your bots, click one to chat. Each bot is an OpenCode
agent (own system prompt, skills, MCP permissions) executed by a headless
`opencode serve` harness. Everything stateful lives inside one `data/` folder —
or, in the desktop app, inside the OS app-data dir.

```
openchat_bot/
├── run.sh                # one command: harness + UI + open browser
├── templates/workspace/  # starter workspace files, seeded on first boot
├── data/                 # PORTABLE DATAFOLDER (contents gitignored)
│   ├── workspace/        # session location; bots in .opencode/agents/
│   ├── share/            # XDG_DATA_HOME -> opencode.db, logs
│   ├── config/           # XDG_CONFIG_HOME
│   └── state/            # XDG_STATE_HOME + harness-token-<port>
├── opencode.jsonc        # base harness config (model, MCP, websearch, permissions)
├── server/src/launcher.ts# Bun launcher: sets env -> spawns `opencode serve`
├── src/                  # React/Vite UI (uses @opencode/client)
└── src-tauri/            # desktop shell (Rust): spawns a bundled harness
```

## 1. Prereqs

- Bun >= 1.2 (`bun --version` — you have 1.3.14)
- OpenCode >= 2.0 (`opencode --version` — you have 2.0.28)
- A model: local Ollama/LM Studio (no key), cloud keys (see `.env.example`),
  or the built-in free `opencode/*-free` models (work with no setup — the
  harness auto-picks one when the configured default has no models)
- Rust **only** for the desktop app. The toolchain is pinned to 1.98 in
  `src-tauri/rust-toolchain.toml` — rustc 1.99.0 has a reproducible ICE on
  `hashbrown` (`mir_for_ctfe`). Re-evaluate when 1.99.x ships a fix.

## 2. Run (browser, one command)

```sh
cd /media/phani/DriveE/openchat_bot
./run.sh
# -> starts headless harness (data/ isolation) + web UI, opens http://127.0.0.1:1420
# Ctrl+C stops everything.
```

`run.sh` waits for the harness token, exports `VITE_OPENCODE_TOKEN` /
`VITE_WORKSPACE_DIR`, waits for :1420, then `xdg-open`s the browser. Override
the harness port with `OPENCHAT_PORT=4099 ./run.sh`. Manual equivalent (two
terminals) is `bun run start` + the export line it prints, then `bun run dev:web`.

Auth note (verified against opencode v2.0.28): `opencode serve` guards every
route with HTTP Basic, user `opencode`, password = the `server password ...`
line it prints on boot (`www-authenticate: Basic`, Bearer does NOT work).
The launcher captures and stores it; the UI sends
`Authorization: Basic base64("opencode:<token>")` on all REST calls and on the
fetch-streamed `/api/event` SSE (EventSource can't set headers, so the UI
deliberately uses fetch + reader).

## 3. Desktop app (Tauri)

System deps are installed on this machine (libwebkit2gtk-4.1-dev, libgtk-3-dev,
libayatana-appindicator3-dev, librsvg2-dev, libssl-dev, ...). Build and run:

```sh
cd /media/phani/DriveE/openchat_bot
bun run tauri:dev    # desktop window, hot-reload UI, harness auto-started
bun run tauri:build  # .deb in src-tauri/target/release/bundle/deb/
```

How it works:

- Rust picks a **free loopback port** at startup (never clashes with a dev
  harness on 4096), spawns the bundled `opencode` sidecar with all state under
  `<appData>/com.openchat.bot/openchat/data`, and captures the per-boot password
  from its stdout.
- The UI asks the shell for the harness URL, password and workspace through the
  `harness_info` / `harness_token` commands at boot — no tokens baked into the
  build, no env vars, no manual `run.sh`.
- CORS is granted to the webview origins (`tauri://localhost`,
  `http(s)://tauri.localhost`) plus the vite dev server.
- `templates/workspace/` is seeded into the app's workspace on first launch
  (copy-if-missing, never overwrites).
- The sidecar is killed when the app exits, so no orphan harness is left behind.
- The 200MB+ `opencode` sidecar binary is gitignored; stage it before building:

```sh
cp "$(which opencode)" src-tauri/binaries/opencode-$(rustc -vV | sed -n 's/^host: //p')
```

## 4. How datafolder isolation works

`server/src/launcher.ts` resolves `OPENCHAT_DATA_DIR` (default `./data`) and
exports, **before** spawning `opencode serve`:

```sh
OPENCHAT_DATA_DIR=/media/phani/DriveE/openchat_bot/data
XDG_DATA_HOME=$OPENCHAT_DATA_DIR/share
XDG_CONFIG_HOME=$OPENCHAT_DATA_DIR/config
XDG_STATE_HOME=$OPENCHAT_DATA_DIR/state
OPENCODE_DB=$XDG_DATA_HOME/opencode/opencode.db
# optional: OPENCODE_DISABLE_PRUNE=1  # keep all sessions (OpenCode prunes by default)
```

Sessions are SQLite rows in `data/share/opencode/opencode.db` (back that file
up and you have backed up all chats). The launcher also seeds
`templates/workspace/` into `data/workspace/` on first boot (copy-if-missing).

## 5. Connectors (MCP + websearch + providers)

All defined in `opencode.jsonc` — **not** in UI code, so desktop and browser
share them:

- **Providers (OpenAI alternative / local):** `providers.ollama` (no key),
  `lmstudio`, plus cloud via env keys. See https://opencode.ai/v2/docs/providers/
- **MCP:** `mcp.servers` — local stdio + remote Streamable HTTP + OAuth.
  Manage live from the UI sidebar (Tools → Add): remote URL or local command,
  Connect / Stop / Remove. Remote servers needing sign-in show `needs-auth`.
  See https://opencode.ai/v2/docs/mcp-servers/
- **Websearch:** `websearch.provider: "random"` + `EXA/TAVILY/FIRECRAWL/PARALLEL`
  keys. Permission-gated. See https://opencode.ai/v2/docs/websearch/

## 6. Bots (custom agents with skills + MCP)

Sidebar ＋ (or the hero button) opens the builder: name + what it should do,
one click to create and start chatting. A bot is stored as
`<workspace>/.opencode/agents/<name>.md` (frontmatter + system prompt body):

- **Skills**: checkbox list from the harness skill catalog. Default = all skills
  on (file stays empty, so future skills apply automatically); unchecking one
  materializes the explicit list. Activated on each new chat via `session.skill`.
- **Tools (MCP)**: per-server Default / Allow / Deny, saved as `<server>_*`
  permission rules the harness enforces.
- **Disable / Enable**: `disabled: true` removes the agent from the harness
  listing; disabled bots appear in the sidebar's "Disabled" section and can be
  re-enabled from their settings. **Delete** permanently removes the file
  (via the harness shell API — no fs-delete route exists) with a two-click
  confirm.
- Hand-written permission rules and unknown frontmatter keys round-trip untouched.

Bots can also **manage skills themselves**: the workspace ships
`.opencode/skills/manage-skills/SKILL.md` (seeded from `templates/`), which
teaches any bot to create/update skill files when asked ("remember this",
"update the X skill").

## 7. Reliability notes (verified live against v2.0.28)

- **Prompts sent while a bot is mid-turn are queued, not swallowed** (the
  harness enqueues them in the session inbox). The UI composer keeps working
  during a turn; the queued message runs right after.
- The UI streams `/api/event` over fetch (auth header required) and
  **reconnects automatically** if the stream drops (e.g. harness restart).
- Busy state is tracked **per session**, so a working bot doesn't freeze the
  others. A 100s activity watchdog clears stuck "working" states.
- `location.reload()` discovery is async (~1s): the UI retries catalog reads
  and polls after writes, so panels and bot lists appear without manual refresh.
- Reasoning parts (`session.reasoning.*`) are intentionally hidden — the UI
  renders final text + tool activity only.

## 8. Scripts

| cmd | what |
|---|---|
| `./run.sh` | harness + UI + open browser (Ctrl+C stops all) |
| `bun run start` | only the headless harness with data/ isolation |
| `bun run dev:web` | only the vite UI (needs exported token vars — `run.sh` does this) |
| `bun run build:web` | typecheck + vite build |
| `bun run tauri:dev` | desktop window in dev mode |
| `bun run tauri:build` | .deb bundle (needs cargo + system webkit deps) |

## 9. UI ↔ harness mapping

| UI element | Harness call |
|---|---|
| Bots sidebar | `GET /api/agent` (custom agents; built-ins and hidden ones filtered) |
| Disabled section | `file.list` on `.opencode/agents` minus the visible agents |
| Bot chat | `POST /api/session` (agent + `metadata: {kind: dm, bot}`), `POST /prompt` |
| Streaming + status | `GET /api/event` SSE (fetch + reader, auto-reconnect) |
| Model picker | `GET /api/model` + `session.get` (per-chat) + `session.switchModel` |
| Stop | `session.interrupt` |
| Permission prompt | `permission.list` + Allow / Always / Deny (`permission.reply`) |
| Bot files | `file.read` / `file.write` / `file.list` under `<workspace>/.opencode/agents/`, applied via `location.reload` |
| Skills / MCP catalogs | `skill.list`, `mcp.list`; skills auto-activated with `session.skill` |

Keep UI dumb: all agent/tool reasoning stays in OpenCode.
