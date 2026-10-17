# Muster — personal bot coworkers on a local OpenCode harness

Just bots. Sidebar lists your bots, click one to chat. Each bot is an OpenCode
agent (own system prompt, skills, MCP permissions) executed by a headless
`opencode serve` harness. Everything stateful lives inside one `data/` folder —
or, in the desktop app, inside the OS app-data dir.

```
muster/
├── run.sh                # one command: harness + UI + open browser
├── templates/workspace/  # starter workspace files, seeded on first boot
├── data/                 # PORTABLE DATAFOLDER (contents gitignored)
│   ├── workspace/        # session location; bots in .opencode/agents/
│   ├── share/            # XDG_DATA_HOME -> opencode.db, logs
│   ├── config/           # XDG_CONFIG_HOME
│   └── state/            # XDG_STATE_HOME + harness-token-<port>
├── opencode.jsonc        # base harness config (model, MCP, websearch, permissions)
├── server/src/launcher.ts# Bun launcher: sets env -> spawns `opencode serve`
├── docs/                 # architecture, development, design, bots
├── src/                  # React/Vite UI (uses @opencode/client)
└── src-tauri/            # desktop shell (Rust): spawns a bundled harness
```

## Docs

Deeper documentation lives in [`docs/`](docs/README.md):

- [architecture.md](docs/architecture.md) — processes, data flow, the harness protocol, storage, auth
- [development.md](docs/development.md) — setup, dev loop, sandboxing, verification, builds
- [design.md](docs/design.md) — design language, tokens, themes, chat anatomy
- [bots.md](docs/bots.md) — bot files, personas, skills, MCP rules, the marketplace

## 1. Prereqs

- Bun >= 1.2 (`bun --version` — you have 1.3.14)
- OpenCode >= 2.0 (`opencode --version` — you have 2.0.28)
- A model: local Ollama/LM Studio (no key), cloud keys (see `.env.example`),
  or the built-in free `opencode/*-free` models (work with no setup — the
  harness auto-picks one when the configured default has no models)
- Rust **only** for the desktop app. The toolchain is pinned to 1.98 in
  `src-tauri/rust-toolchain.toml` — rustc 1.99.0 has a reproducible ICE on
  `hashbrown` (`mir_for_ctfe`). Re-evaluate when 1.99.x ships a fix.
- Heads-up: rustc 1.98.x occasionally SIGSEGVs inside LLVM on this machine
  (random crates/passes, `error: rustc interrupted by SIGSEGV`) — it is flaky,
  not a code problem. Just rerun `bun run tauri:build`; it goes through.

## 2. Run (browser, one command)

```sh
cd path/to/muster
./run.sh
# -> headless harness + web UI over the desktop app's data folder,
#    opens http://127.0.0.1:1420. Ctrl+C stops everything.
```

`run.sh` waits for the harness token, exports `VITE_OPENCODE_TOKEN` /
`VITE_WORKSPACE_DIR`, waits for :1420, then `xdg-open`s the browser. Same bots
and chat history as the desktop app (see §4). Override the harness port with
`MUSTER_PORT=4099 ./run.sh`, or use a throwaway sandbox with
`MUSTER_DATA_DIR=./data ./run.sh`. Manual equivalent (two terminals) is
`bun run start` + the export line it prints, then `bun run dev:web`.

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
cd path/to/muster
bun run tauri:dev    # desktop window, hot-reload UI, harness auto-started
bun run tauri:build  # .deb in src-tauri/target/release/bundle/deb/
```

How it works:

- Rust picks a **free loopback port** at startup (never clashes with a dev
  harness on 4096), spawns the bundled `opencode` sidecar with all state under
  `<appData>/com.muster.app/muster/data`, and captures the per-boot password
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

Browser mode and the desktop app share **one data folder** by default, so the
same bots and chat history show up in both:

| Mode | Data root |
| --- | --- |
| `./run.sh` (browser) | `~/.local/share/com.muster.app/muster/data` |
| Desktop app | `~/.local/share/com.muster.app/muster/data` |
| Sandbox | `MUSTER_DATA_DIR=./data ./run.sh` (repo-local, throwaway) |

`server/src/launcher.ts` resolves `MUSTER_DATA_DIR` (default: the folder
above; `$XDG_DATA_HOME` is honored) and exports, **before** spawning
`opencode serve`:

```sh
MUSTER_DATA_DIR=<XDG_DATA_HOME>/com.muster.app/muster/data
XDG_DATA_HOME=$MUSTER_DATA_DIR/share
XDG_CONFIG_HOME=$MUSTER_DATA_DIR/config
XDG_STATE_HOME=$MUSTER_DATA_DIR/state
OPENCODE_DB=$XDG_DATA_HOME/opencode/opencode.db
# optional: OPENCODE_DISABLE_PRUNE=1  # keep all sessions (OpenCode prunes by default)
```

Everything the harness knows lives inside that root: bots are markdown files
in `workspace/.opencode/agents/`, sessions are SQLite rows in
`share/opencode/opencode.db` (back up that one file and you have backed up all
chats), the per-boot password is in `state/harness-token-<port>`. The launcher
seeds `templates/workspace/` into the workspace on first boot
(copy-if-missing); the desktop shell does the same under its app-data root.

One caveat when both modes point at the same root: run them **one at a time**
— two harnesses sharing one SQLite DB would fight over session state.

## 5. Connectors (MCP + websearch + providers)

All defined in `opencode.jsonc` — **not** in UI code, so desktop and browser
share them:

- **Providers (OpenAI alternative / local):** `providers.ollama` (no key),
  `lmstudio`, plus cloud via env keys. See https://opencode.ai/v2/docs/providers/
- **MCP:** `mcp.servers` — local stdio + remote Streamable HTTP + OAuth.
  Install from the **Marketplace** (§6) or manually via the sidebar Tools panel;
  both write the workspace `opencode.jsonc`, so installs persist. Remote servers
  needing sign-in show as `needs_auth`.
  See https://opencode.ai/v2/docs/mcp-servers/
- **Websearch:** `websearch.provider: "random"` + `EXA/TAVILY/FIRECRAWL/PARALLEL`
  keys. Permission-gated. See https://opencode.ai/v2/docs/websearch/

## 6. Marketplace (one-click connectors, plugins, skills)

Sidebar → **Marketplace**: browse, click Install, done. Same mechanics as
creating a bot — the app writes your workspace config and calls
`location.reload()` — so installs persist across restarts, no terminal steps.

- **Connectors (MCP)** → `mcp.servers.<name>` in `<workspace>/opencode.jsonc`.
  Cards show live status (connected / needs sign-in). GitHub-style connectors
  take a token inline (written as an `Authorization: Bearer` header); OAuth-only
  connectors install immediately and honestly show "Needs sign-in" — finish that
  from OpenCode with `/mcps`.
- **Plugins (npm)** → `plugins: [...]` in the workspace config; the harness
  installs the package in the background (~40–60 s — the modal keeps polling
  until it turns active). Any npm package can be added by name.
- **Skills** → `.opencode/skills/<id>/SKILL.md` (bodies bundled with the app).
- Remove = config entry removed + reload. Everything round-trips through
  `src/lib/jsonc.ts`, a comment/format-preserving JSONC editor, so hand-written
  comments and unknown keys survive edits.

The catalog lives in `src/marketplace.json` (ids, npm refs, commands, help).

## 7. Bots (custom agents with skills + MCP)

Sidebar ＋ (or the field on the home screen) — just say what the bot should
do, one click to create and start chatting. No name form: the name is derived
from your words ("help me plan trips" → `plan-trips`) and stored; click the
bot's name in the chat header (or edit it in settings) to rename it later —
its chat history follows the rename. An empty prompt creates a general-purpose
`helper`. A bot is stored as
`<workspace>/.opencode/agents/<name>.md` (frontmatter + system prompt body):

- **Skills**: checkbox list from the harness skill catalog. Default = all skills
  on (file stays empty, so future skills apply automatically); unchecking one
  materializes the explicit list. Bots load a skill only when it's relevant to
  the request — nothing is force-injected when a chat is created. The harness's
  built-in skills (`opencode`, `report` — OpenCode's own docs and issue-reporting
  know-how) are excluded: they're for developing OpenCode, not for your bots.
  Chats from older builds that got a skill's text injected when they were opened
  are archived (`dm-archived` in the DB, transcript kept) and replaced with a
  fresh chat the first time that bot is opened.
- **Tools (MCP)**: per-server Default / Allow / Deny, saved as `<server>_*`
  permission rules the harness enforces.
- **Disable / Enable**: `disabled: true` removes the agent from the harness
  listing; disabled bots appear in the sidebar's "Disabled" section and can be
  re-enabled from their settings. **Delete** permanently removes the file
  (via the harness shell API — no fs-delete route exists) with a two-click
  confirm.
- Hand-written permission rules and unknown frontmatter keys round-trip untouched.

Every bot carries a **colleague persona** in its system-prompt body: it speaks
as one of your bots and never as "OpenCode" — the engine stays invisible
background plumbing. Bots created before this existed are upgraded once at
first boot; only empty or legacy app-generated bodies are touched, hand-written
prompts are never overwritten.

Bots can also **manage skills themselves**: the workspace ships
`.opencode/skills/manage-skills/SKILL.md` (seeded from `templates/`), which
teaches any bot to create/update skill files when asked ("remember this",
"update the X skill").

## 8. The team view

Bots behave like background colleagues, not request/response toys:

- Each bot's turn runs on the harness independently — switch chats, keep
  talking to someone else, the work continues. Closing the chat doesn't stop it.
- **Roster dots** in the sidebar: green pulse = working on a task, amber =
  waiting for your approval, violet = replied while you were away (opening the
  chat clears it). All driven by the global event stream, so it's live even for
  chats you're not looking at.
- Messages sent mid-turn are queued by the harness inbox, so you can pile work
  on without waiting.
- Pending approvals are seeded at boot (`permission.list` per session) and kept
  live from `permission.asked` / `permission.replied` events — a bot stuck on a
  permission prompt is visible from the roster.
- Sessions that were mid-turn when the UI went away are re-marked "working" at
  boot (`time.updated > time.idle` heuristic) and re-verified by the stream.

## 9. Reliability notes (verified live against v2.0.28)

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

## 10. Scripts

| cmd | what |
|---|---|
| `./run.sh` | harness + UI + open browser (Ctrl+C stops all) |
| `bun run start` | only the headless harness with data/ isolation |
| `bun run dev:web` | only the vite UI (needs exported token vars — `run.sh` does this) |
| `bun run build:web` | typecheck + vite build |
| `bun run tauri:dev` | desktop window in dev mode |
| `bun run tauri:build` | .deb bundle (needs cargo + system webkit deps) |

## 11. UI ↔ harness mapping

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
| Bot avatars | DiceBear **Bottts** robots (style by Pablo Stanley — free for personal and commercial use) on pastel backdrops, seeded by bot id, generated locally as isolated data-URI SVGs — no network, no keys |
| Rename bot | `session.update` (title + metadata) so the DM chat follows the new name |
| Team roster dots | `permission.list` per session (boot) + global events: `permission.asked/replied`, `session.execution.*`, `session.idle` |
| Skills / MCP catalogs | `skill.list`, `mcp.list`; skills auto-activated with `session.skill` |
| Marketplace install/remove | `file.write` on workspace `opencode.jsonc` + `location.reload`; live status from `mcp.list` / `plugin.list` / `skill.list` |

Keep UI dumb: all agent/tool reasoning stays in OpenCode.
