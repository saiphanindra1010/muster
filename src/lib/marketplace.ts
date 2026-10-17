/**
 * Marketplace: one install path for connectors (MCP servers), plugins and
 * skills. Every install is a file edit in the workspace followed by
 * `location.reload()` — the same mechanism bots use — so installs persist
 * and the harness picks them up like any other project configuration.
 *
 * - Connectors + plugins land in the workspace `opencode.jsonc`
 *   (`mcp.servers.<name>`, `plugins: [...]`), edited surgically by ./jsonc.
 * - Skills land in `.opencode/skills/<id>/SKILL.md`.
 */
import catalogJson from "../marketplace.json";
import { client, workspaceDir } from "./opencode";
import { listMcp, listSkills } from "./bots";
import {
  parseLoose,
  removeArrayEntry,
  removeDeep,
  upsertArrayEntry,
  upsertDeep,
} from "./jsonc";
import releaseNotesSkill from "../marketplace-skills/release-notes/SKILL.md?raw";
import meetingNotesSkill from "../marketplace-skills/meeting-notes/SKILL.md?raw";
import researchBriefSkill from "../marketplace-skills/research-brief/SKILL.md?raw";
import browserCraftSkill from "../marketplace-skills/browser-craft/SKILL.md?raw";

export type MarketKind = "mcp" | "plugin" | "skill";

export interface McpTokenField {
  /** Header to write, e.g. "Authorization". */
  header: string;
  /** Value prefix, e.g. "Bearer ". */
  prefix?: string;
  label: string;
  placeholder?: string;
  help?: string;
}

export interface MarketItem {
  id: string;
  kind: MarketKind;
  name: string;
  description: string;
  tags?: string[];
  homepage?: string;
  requires?: string[];
  mcp?: { config: Record<string, any>; signin?: boolean; token?: McpTokenField };
  plugin?: { package: string };
}

const SKILL_BODIES: Record<string, string> = {
  "release-notes": releaseNotesSkill,
  "meeting-notes": meetingNotesSkill,
  "research-brief": researchBriefSkill,
  "browser-craft": browserCraftSkill,
};

export function catalog(): MarketItem[] {
  return (catalogJson as { items: MarketItem[] }).items;
}

/** Synthetic catalog entry for "add any npm plugin by name". */
export function customPluginItem(pkg: string): MarketItem {
  return {
    id: pkg,
    kind: "plugin",
    name: pkg,
    description: "Plugin added from npm.",
    tags: ["custom"],
    plugin: { package: pkg },
  };
}

function wsDir(): string {
  const w = workspaceDir();
  if (!w) throw new Error("Workspace is not ready yet. Try again in a moment.");
  return w;
}
function loc(): { directory: string } {
  return { directory: wsDir() };
}
const enc = new TextEncoder();
const dec = new TextDecoder();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------- config file ------------------------------- */

export interface ConfigView {
  mcpServers: string[];
  plugins: string[];
}

export async function readConfigText(): Promise<string> {
  try {
    const out: any = await (client as any).file.read({ location: loc(), path: "opencode.jsonc" });
    const bytes: Uint8Array = out instanceof Uint8Array ? out : new Uint8Array(out?.data ?? []);
    return dec.decode(bytes);
  } catch {
    return "";
  }
}

async function writeConfigText(text: string): Promise<void> {
  await (client as any).file.write({ location: loc(), path: "opencode.jsonc", payload: enc.encode(text) });
  await (client as any).location.reload();
}

/** What the workspace config currently declares. */
export async function configView(): Promise<ConfigView> {
  const raw = await readConfigText();
  let parsed: any = {};
  try {
    parsed = raw.trim() ? parseLoose(raw) : {};
  } catch {
    parsed = {};
  }
  const plugins = Array.isArray(parsed?.plugins)
    ? parsed.plugins.map((p: any) => (typeof p === "string" ? p : p?.package)).filter(Boolean)
    : [];
  return { mcpServers: Object.keys(parsed?.mcp?.servers ?? {}), plugins };
}

/* ---------------------------------- state ---------------------------------- */

export interface McpStatus {
  status: string;
  error?: string;
}
export interface PluginStatus {
  status: string;
  version?: string;
}
export interface MarketState {
  mcp: Map<string, McpStatus>;
  plugins: Map<string, PluginStatus>;
  skills: Set<string>;
}

async function pluginList(): Promise<any[]> {
  try {
    const r: any = await (client as any).plugin.list({ location: loc() });
    return r?.data ?? [];
  } catch {
    return [];
  }
}

export async function loadMarket(): Promise<{ cfg: ConfigView; state: MarketState }> {
  const [cfg, mcpList, skillList, plugins] = await Promise.all([
    configView(),
    listMcp(),
    listSkills(),
    pluginList(),
  ]);
  const mcp = new Map<string, McpStatus>();
  for (const s of mcpList) {
    const st = typeof s.status === "string" ? s.status : (s.status?.status ?? "unknown");
    mcp.set(s.name, { status: st, error: s.status?.error });
  }
  const pmap = new Map<string, PluginStatus>();
  for (const p of plugins) {
    const target = p.source?.type === "package" ? p.source.target : null;
    if (target) pmap.set(target, { status: p.state?.status ?? "unknown", version: p.source?.version });
  }
  const skills = new Set<string>(skillList.map((s: any) => s.id ?? s.name).filter(Boolean));
  return { cfg, state: { mcp, plugins: pmap, skills } };
}

export function isInstalled(cfg: ConfigView, state: MarketState, item: MarketItem): boolean {
  if (item.kind === "mcp") return cfg.mcpServers.includes(item.id);
  if (item.kind === "plugin") return !!item.plugin && cfg.plugins.includes(item.plugin.package);
  return state.skills.has(item.id);
}

/* --------------------------------- install --------------------------------- */

export async function installMcpServer(name: string, config: Record<string, any>): Promise<void> {
  if (!name.trim()) throw new Error("Enter a server name.");
  const conf: Record<string, any> = JSON.parse(JSON.stringify(config));
  await writeConfigText(upsertDeep(await readConfigText(), ["mcp", "servers"], name, conf));
  await waitForMcp(name, 15000);
}

export async function uninstallMcpServer(name: string): Promise<void> {
  await writeConfigText(removeDeep(await readConfigText(), ["mcp", "servers"], name));
  try {
    await (client as any).mcp.remove({ server: name, location: loc() }); // drop any in-memory instance
  } catch {}
}

async function waitForMcp(name: string, ms: number): Promise<void> {
  const until = Date.now() + ms;
  for (;;) {
    const list = await listMcp();
    if (list.some((s: any) => s.name === name)) return;
    if (Date.now() > until) throw new Error(`“${name}” did not start — check the URL or command`);
    await sleep(1200);
  }
}

export async function installPluginPackage(pkg: string): Promise<void> {
  if (!/^(@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*(@[\w.-]+)?$/i.test(pkg)) {
    throw new Error(`“${pkg}” is not a valid npm package name`);
  }
  await writeConfigText(upsertArrayEntry(await readConfigText(), "plugins", pkg));
}

export async function uninstallPluginPackage(pkg: string): Promise<void> {
  await writeConfigText(removeArrayEntry(await readConfigText(), "plugins", pkg));
}

export async function installSkill(id: string): Promise<void> {
  const body = SKILL_BODIES[id];
  if (!body) throw new Error(`Skill “${id}” has no installable content.`);
  await (client as any).file.write({
    location: loc(),
    path: `.opencode/skills/${id}/SKILL.md`,
    payload: enc.encode(body),
  });
  await (client as any).location.reload();
  // Discovery is best-effort — the file write is the success condition.
  const until = Date.now() + 8000;
  while (Date.now() < until) {
    const list = await listSkills();
    if (list.some((s: any) => (s.id ?? s.name) === id)) return;
    await sleep(800);
  }
}

export async function uninstallSkill(id: string): Promise<void> {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) throw new Error("Enter a valid skill name (lowercase letters, digits, dashes).");
  const dir = `${wsDir().replace(/\/$/, "")}/.opencode/skills/${id}`;
  await (client as any).shell.create({ location: loc(), command: `rm -rf '${dir.replace(/'/g, `'\\''`)}'` });
  await (client as any).location.reload();
}

/* ------------------------------- entry points ------------------------------ */

export async function installItem(item: MarketItem, token?: string): Promise<void> {
  if (item.kind === "mcp") {
    const conf: Record<string, any> = JSON.parse(JSON.stringify(item.mcp?.config ?? {}));
    const tok = item.mcp?.token;
    if (tok) {
      const value = token?.trim() ?? "";
      if (!value) throw new Error(`${tok.label} is required to connect.`);
      conf.headers = { ...(conf.headers ?? {}), [tok.header]: `${tok.prefix ?? ""}${value}` };
    }
    return installMcpServer(item.id, conf);
  }
  if (item.kind === "plugin") {
    if (!item.plugin) throw new Error("Plugin item is missing its package name");
    return installPluginPackage(item.plugin.package);
  }
  return installSkill(item.id);
}

export async function uninstallItem(item: MarketItem): Promise<void> {
  if (item.kind === "mcp") return uninstallMcpServer(item.id);
  if (item.kind === "plugin") {
    if (item.plugin) await uninstallPluginPackage(item.plugin.package);
    return;
  }
  return uninstallSkill(item.id);
}
