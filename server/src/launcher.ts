/**
 * Launcher — the ONLY process that knows about the datafolder.
 *
 * Resolves OPENCHAT_DATA_DIR (default ./data next to repo root), exports
 * XDG_* + OPENCODE_DB so `opencode serve` (the harness) stores EVERYTHING
 * inside it, then spawns the server. The web UI / Tauri shell never touch
 * OpenCode storage directly — they talk HTTP to this harness.
 *
 * Auth: `opencode serve` prints a per-boot `server password <pw>` and guards
 * the API with HTTP Basic (`www-authenticate: Basic`), user `opencode`.
 * This launcher captures the password from stdout, stores it at
 * `$DATA/state/harness-token-<port>` (0600, localhost-only secret; per-port
 * so two launchers never clobber each other's token), and the UI sends
 * `Authorization: Basic base64("opencode:<pw>")` on every request including
 * the SSE stream (see src/lib/opencode.ts — EventSource can't set headers,
 * so the UI streams via fetch).
 *
 * Env in (see ../../.env.example):
 *   OPENCHAT_DATA_DIR  default ./data
 *   OPENCHAT_PORT/HOST default 127.0.0.1:4096
 *   OPENCODE_DISABLE_PRUNE forwarded (default 1 = keep history)
 *
 * Docs: https://opencode.ai/v2/docs/troubleshooting#service-files (DB path,
 * OPENCODE_DB override), https://opencode.ai/v2/docs/api/,
 * https://opencode.ai/v2/docs/cli/web/ (serve auth + pairing model)
 */
import { existsSync, mkdirSync, writeFileSync, chmodSync, readdirSync, copyFileSync, statSync } from "node:fs";
import { resolve, join, dirname } from "node:path";

const ROOT = resolve(import.meta.dir, "..", "..");
const DATA = resolve(process.env.OPENCHAT_DATA_DIR ?? join(ROOT, "data"));
const SHARE = join(DATA, "share");
const CONFIG = join(DATA, "config");
const STATE = join(DATA, "state");
const WORKSPACE = join(DATA, "workspace");

const HOST = process.env.OPENCHAT_HOST ?? "127.0.0.1";
const PORT = process.env.OPENCHAT_PORT ?? "4096";
const TOKEN_FILE = join(STATE, `harness-token-${PORT}`);

for (const d of [DATA, SHARE, CONFIG, STATE, WORKSPACE, join(SHARE, "opencode")]) {
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
}

/**
 * Seed starter workspace files (skills etc.) from ./templates. Never
 * overwrites — the workspace belongs to the user once it exists.
 */
function seedTemplates() {
  const root = join(ROOT, "templates", "workspace");
  if (!existsSync(root)) return;
  const walk = (srcDir: string) => {
    for (const name of readdirSync(srcDir)) {
      const src = join(srcDir, name);
      if (statSync(src).isDirectory()) {
        walk(src);
        continue;
      }
      const rel = src.slice(root.length + 1);
      const dst = join(WORKSPACE, rel);
      if (existsSync(dst)) continue;
      mkdirSync(dirname(dst), { recursive: true });
      copyFileSync(src, dst);
      console.log(`[openchat] seeded ${rel}`);
    }
  };
  walk(root);
}
seedTemplates();

// Isolate harness storage. Must be set BEFORE spawning `opencode serve`.
process.env.XDG_DATA_HOME = SHARE;
process.env.XDG_CONFIG_HOME = CONFIG;
process.env.XDG_STATE_HOME = STATE;
process.env.OPENCODE_DB ??= join(SHARE, "opencode", "opencode.db");
process.env.OPENCODE_DISABLE_PRUNE ??= "1";

// UI origin for CORS (vite dev + tauri webview). Add prod origins here.
const CORS =
  process.env.OPENCHAT_CORS ??
  "http://127.0.0.1:1420,http://localhost:1420,tauri://localhost,http://tauri.localhost,https://tauri.localhost";

console.log(`[openchat] data      : ${DATA}`);
console.log(`[openchat] db        : ${process.env.OPENCODE_DB}`);
console.log(`[openchat] workspace : ${WORKSPACE}`);
console.log(`[openchat] harness   : http://${HOST}:${PORT}`);

// Fail fast with a clear message when the port is already taken
// (e.g. a previous launcher is still running).
try {
  const probe = Bun.listen({ hostname: HOST, port: Number(PORT), socket: { data() {} } });
  probe.stop();
} catch {
  console.error(`[openchat] port ${PORT} is already in use — another harness/launcher is running. Stop it first (or set OPENCHAT_PORT).`);
  process.exit(1);
}

const proc = Bun.spawn(
  ["opencode", "serve", "--hostname", HOST, "--port", PORT, ...CORS.split(",").flatMap((o) => ["--cors", o.trim()])],
  {
    cwd: ROOT, // picks up ./opencode.jsonc as base harness config
    env: process.env,
    stdout: "pipe", // piped so we can capture the per-boot server password
    stderr: "inherit",
    stdin: "inherit",
  },
);

const basicAuth = (pw: string) =>
  `Basic ${Buffer.from(`opencode:${pw}`).toString("base64")}`;

// Capture `server password <pw>` from serve stdout, persist for UI/Tauri.
let password = "";
const reader = (proc.stdout as ReadableStream<Uint8Array>).getReader();
const decoder = new TextDecoder();
const passwordCaptured = (async () => {
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    const chunk = decoder.decode(value ?? new Uint8Array(), { stream: !done });
    process.stdout.write(chunk); // keep serve logs visible
    buf += chunk;
    const m = buf.match(/server password (\S+)/);
    if (m) {
      password = m[1];
      writeFileSync(TOKEN_FILE, password + "\n", { mode: 0o600 });
      try { chmodSync(TOKEN_FILE, 0o600); } catch {}
      console.log(`[openchat] token saved : ${TOKEN_FILE}`);
      reader.cancel().catch(() => {});
      return password;
    }
    if (done) throw new Error("serve exited before printing server password");
  }
})();

await passwordCaptured;

// Authenticated health-check: wait until /api/info answers 200.
const base = `http://${HOST}:${PORT}`;
let ready = false;
for (let i = 0; i < 60; i++) {
  try {
    const r = await fetch(`${base}/api/info`, {
      headers: { authorization: basicAuth(password) },
    });
    if (r.ok) {
      ready = true;
      console.log(`[openchat] ready — UI targets ${base} with token from ${TOKEN_FILE}`);
      console.log(`[openchat] dev hint: VITE_OPENCODE_TOKEN=$(cat ${TOKEN_FILE}) VITE_WORKSPACE_DIR=${WORKSPACE} bun run dev:web`);
      break;
    }
  } catch {}
  await Bun.sleep(1000);
}
if (!ready) console.error(`[openchat] harness did not answer ${base}/api/info within 60s — check serve output above.`);

const onSignal = () => proc.kill();
process.on("SIGINT", onSignal);
process.on("SIGTERM", onSignal);
await proc.exited;
process.exit(proc.exitCode ?? 0);
