# Tauri shell

The desktop app owns the harness. `src/main.rs`:

1. Picks a **free loopback port** (so a dev harness on 4096 never clashes).
2. Creates `<appData>/com.openchat.bot/openchat/data/{share,config,state,workspace}`
   and seeds `templates/workspace/` into the workspace (copy-if-missing).
3. Spawns the bundled `opencode` sidecar (`binaries/opencode-<target-triple>`,
   staged with `cp "$(which opencode)" src-tauri/binaries/opencode-$(rustc -vV |
   sed -n 's/^host: //p')` — gitignored, ~200MB) with XDG_* + OPENCODE_DB
   redirected into the datafolder and CORS for the webview origins.
4. Captures the per-boot `server password` from the sidecar's stdout and serves
   it to the web UI via the `harness_info` / `harness_token` commands.
5. Kills the sidecar on window close / app exit.

Build (Rust toolchain pinned to 1.98 in `rust-toolchain.toml` — rustc 1.99.0
ICEs on `hashbrown`):

```sh
bun run tauri:dev    # dev window (uses the repo opencode.jsonc + templates)
bun run tauri:build  # .deb at src-tauri/target/release/bundle/deb/
```

`capabilities/default.json` grants only `core:default`; the sidecar is spawned
from Rust, so no shell permissions are exposed to the webview.
