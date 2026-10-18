import { OpenCode } from "@opencode/client";

/**
 * Shared harness client. The UI talks HTTP to a locally running
 * `opencode serve` ("the harness") - see server/src/launcher.ts for the
 * browser-dev story, src-tauri/ for the desktop app.
 *
 * Auth: the harness guards every route with HTTP Basic, user `opencode`,
 * password = the per-boot `server password` value. In dev, `run.sh` exports
 * VITE_OPENCODE_URL / VITE_OPENCODE_TOKEN / VITE_WORKSPACE_DIR; the desktop
 * app gets the same values from the Rust shell via `resolveTauriHarness()`.
 *
 * NOTE: EventSource can't send Authorization headers, so App.tsx streams
 * /api/event with fetch + reader instead.
 */

let base = (import.meta.env.VITE_OPENCODE_URL as string | undefined) ?? "http://127.0.0.1:4096";
let token: string = import.meta.env.VITE_OPENCODE_TOKEN ?? "";
let workspace: string | null = import.meta.env.VITE_WORKSPACE_DIR || null;

export function baseUrl(): string {
  return base;
}

export function workspaceDir(): string | null {
  return workspace;
}

export function authHeaders(): Record<string, string> {
  if (!token) return {};
  try {
    return { authorization: `Basic ${btoa(`opencode:${token}`)}` };
  } catch {
    return {};
  }
}

/** Live binding - rebuilt by configureRuntime(); importers always see the new client. */
export let client = OpenCode.make({ baseUrl: base, headers: authHeaders() });

export function configureRuntime(o: { baseUrl?: string; token?: string; workspace?: string }) {
  if (o.baseUrl) base = o.baseUrl;
  if (o.token) token = o.token;
  if (o.workspace) workspace = o.workspace;
  client = OpenCode.make({ baseUrl: base, headers: authHeaders() });
}

/**
 * Desktop boot: ask the Rust shell for the harness URL, the per-boot password
 * and the datafolder workspace. Browsers / plain web dev skip this (dynamic
 * import + invoke reject) and keep the env values from run.sh.
 */
export async function resolveTauriHarness(): Promise<boolean> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const info = await invoke<{ baseUrl: string; workspace: string }>("harness_info");
    if (info?.baseUrl) configureRuntime({ baseUrl: info.baseUrl, workspace: info.workspace });
    const tok = await invoke<string>("harness_token");
    if (tok) {
      configureRuntime({ token: tok });
      return true;
    }
  } catch {}
  return false;
}

/** Location input for session create - pins sessions inside the datafolder workspace. */
export function sessionLocation(): { directory: string } | undefined {
  return workspace ? { directory: workspace } : undefined;
}
