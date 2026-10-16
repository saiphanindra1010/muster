import { client, workspaceDir } from "./opencode";

export const BUILTIN_AGENT_IDS = new Set(["build", "plan", "general", "explore"]);

export type BotDraft = {
  /** filename slug, also the agent id (nested paths allowed, e.g. team/coach) */
  name: string;
  description: string;
  mode: "primary" | "subagent" | "all";
  model: string; // provider/model, empty = inherit session model
  color: string; // #rrggbb, empty = default
  system: string; // body = system prompt
  disabled: boolean;
  skills: string[]; // skill ids, auto-activated when chatting with the bot
  mcp: Record<string, "allow" | "deny">; // MCP server name -> effect (permission rules)
};

export type PermRule = { action: string; resource: string; effect: string; extra: string[] };

/** Project agents dir, relative to the workspace location (server creates parents on write). */
export const BOTS_REL_DIR = ".opencode/agents";

export function botsDir(): string | null {
  const ws = workspaceDir();
  return ws ? `${ws.replace(/\/$/, "")}/${BOTS_REL_DIR}` : null;
}

export function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\\/g, "/")
    .split("/")
    .map((s) => s.replace(/[^a-z0-9-_]+/g, "-").replace(/^-+|-+$/g, ""))
    .filter(Boolean)
    .join("/");
}

/** MCP server name normalization (matches harness `<server>_<tool>` naming). */
export function normServer(name: string): string {
  return name.replace(/[^A-Za-z0-9_-]/g, "_");
}

/** A permission rule generated from the MCP picker (vs hand-written ones). */
export function mcpRuleServer(rule: PermRule): string | null {
  const m = rule.action.match(/^(.+)_\*$/);
  if (m && rule.resource === "*" && (rule.effect === "allow" || rule.effect === "deny") && rule.extra.length === 0) {
    return m[1];
  }
  return null;
}

/** Minimal frontmatter round-trip: known keys + structured permissions, rest verbatim. */
export function parseBotFile(src: string): {
  known: Partial<BotDraft> & { rules?: PermRule[] };
  unknownLines: string[];
  system: string;
} {
  const m = src.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  const known: Partial<BotDraft> & { rules?: PermRule[] } = {};
  const unknownLines: string[] = [];
  let system = src;
  if (m) {
    system = m[2];
    const rules: PermRule[] = [];
    let cur: PermRule | null = null;
    const flush = () => {
      if (cur) {
        if (cur.action && cur.resource && cur.effect) rules.push(cur);
        else unknownLines.push(`  - action: ${cur.action}`, ...cur.extra);
        cur = null;
      }
    };
    for (const line of m[1].split(/\r?\n/)) {
      const item = line.match(/^\s*-\s*(.*)$/);
      if (item) {
        flush();
        cur = { action: "", resource: "", effect: "", extra: [] };
        const kv = item[1].match(/^([A-Za-z_]+)\s*:\s*(.*)$/);
        if (kv) setRuleKey(cur, kv[1], kv[2]);
        else if (item[1].trim()) cur.extra.push(line);
        continue;
      }
      if (cur && /^\s{2,}\S/.test(line)) {
        const kv = line.match(/^\s*([A-Za-z_]+)\s*:\s*(.*)$/);
        if (kv && !setRuleKey(cur, kv[1], kv[2])) cur.extra.push(line);
        continue;
      }
      flush();
      const kv = line.match(/^([A-Za-z_]+)\s*:\s*(.*)$/);
      if (!kv) {
        if (line.trim()) unknownLines.push(line);
        continue;
      }
      const [, k, raw] = kv;
      const v = raw.trim().replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
      if (k === "description") known.description = v;
      else if (k === "mode" && (v === "primary" || v === "subagent" || v === "all")) known.mode = v;
      else if (k === "model") known.model = v;
      else if (k === "color") known.color = v;
      else if (k === "disabled") known.disabled = v === "true";
      else if (k === "skills") known.skills = v.replace(/^\[(.*)\]$/, "$1").split(",").map((s) => s.trim()).filter(Boolean);
      else if (k === "permissions" && v === "") { /* block follows, items handled above */ }
      else unknownLines.push(line);
    }
    flush();
    if (rules.length) known.rules = rules;
    // Collapse picker-generated MCP rules back into the mcp selection.
    const mcp: Record<string, "allow" | "deny"> = {};
    const rest: PermRule[] = [];
    for (const r of rules) {
      const srv = mcpRuleServer(r);
      if (srv && (r.effect === "allow" || r.effect === "deny")) mcp[srv] = r.effect;
      else rest.push(r);
    }
    if (Object.keys(mcp).length) known.mcp = mcp;
    if (rest.length) known.rules = rest;
    else delete known.rules;
  }
  return { known, unknownLines, system };
}

function setRuleKey(rule: PermRule, k: string, raw: string): boolean {
  const v = raw.trim().replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
  if (k === "action") { rule.action = v; return true; }
  if (k === "resource") { rule.resource = v; return true; }
  if (k === "effect") { rule.effect = v; return true; }
  return false;
}

function flowList(items: string[]): string {
  return `[${items.join(", ")}]`;
}

export function serializeBotFile(
  d: BotDraft,
  unknownLines: string[] = [],
  extraRules: PermRule[] = [],
): string {
  const fm: string[] = [];
  if (d.description) fm.push(`description: ${d.description}`);
  if (d.mode) fm.push(`mode: ${d.mode}`);
  if (d.model) fm.push(`model: ${d.model}`);
  if (d.color) fm.push(`color: "${d.color}"`);
  if (d.skills.length) fm.push(`skills: ${flowList(d.skills)}`);
  if (d.disabled) fm.push(`disabled: true`);
  const rules: PermRule[] = [...extraRules];
  for (const [srv, effect] of Object.entries(d.mcp)) {
    rules.push({ action: `${normServer(srv)}_*`, resource: "*", effect, extra: [] });
  }
  if (rules.length) {
    fm.push(`permissions:`);
    for (const r of rules) {
      fm.push(`  - action: ${r.action}`);
      fm.push(`    resource: "${r.resource}"`);
      fm.push(`    effect: ${r.effect}`);
      for (const l of r.extra) fm.push(l);
    }
  }
  for (const l of unknownLines) fm.push(l);
  return `---\n${fm.join("\n")}\n---\n\n${d.system.replace(/\s+$/, "")}\n`;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

/** Activate the workspace location (project discovery is async after load). */
export async function ensureLocation(): Promise<string | null> {
  const ws = workspaceDir();
  if (!ws) return null;
  try {
    await client.location.get({ location: { directory: ws } } as any);
  } catch {}
  return ws;
}

async function scopedAgents(ws: string): Promise<any[]> {
  const r: any = await client.agent.list({ location: { directory: ws } } as any);
  return r?.data ?? [];
}

/**
 * Catalog reads right after `location.reload` can come back empty for a
 * moment — discovery is async. Retry briefly so panels don't render "none".
 */
async function withDiscovery<T extends any[]>(fn: () => Promise<T>, attempts = 4): Promise<T> {
  for (let i = 0; ; i++) {
    const out = await fn();
    if (!Array.isArray(out) || out.length || i >= attempts - 1) return out;
    await new Promise((r) => setTimeout(r, 600));
  }
}

export async function listBots(): Promise<any[]> {
  const ws = await ensureLocation();
  if (!ws) return [];
  const all = await scopedAgents(ws);
  const bots = all.filter((a) => !BUILTIN_AGENT_IDS.has(a.id) && !a.hidden);
  // Enrich with skills/MCP from bot files (agent.list doesn't carry them).
  await Promise.all(
    bots.map(async (b) => {
      try {
        const src = await readBotFile(b.id);
        if (src != null) {
          const { known } = parseBotFile(src);
          b.skills = known.skills ?? [];
          b.mcp = known.mcp ?? {};
          b.botColor = known.color ?? "";
        }
      } catch {}
    }),
  );
  return bots;
}

/** Delete only the bot file (no reload/polling) — internal for rename. */
async function removeBotFile(slug: string): Promise<void> {
  const ws = workspaceDir();
  if (!ws) throw new Error("Workspace not connected — is the harness running?");
  if (!slug || slug.includes("..")) throw new Error("Invalid bot name.");
  const abs = `${ws.replace(/\/$/, "")}/${BOTS_REL_DIR}/${slug}.md`;
  if (!abs.startsWith(ws.replace(/\/$/, "") + "/")) throw new Error("Refusing to delete outside the bots dir.");
  const quoted = `'${abs.replace(/'/g, `'\\''`)}'`;
  await (client as any).shell.create({
    location: { directory: ws },
    command: `rm -f ${quoted}`,
  });
}

export async function readBotFile(name: string): Promise<string | null> {
  const ws = workspaceDir();
  if (!ws) return null;
  try {
    // NOTE: file.read takes a flat path string (path suffix), not the nested
    // object the .d.ts suggests — verified against the wire format.
    const out: any = await (client as any).file.read({
      location: { directory: ws },
      path: `${BOTS_REL_DIR}/${slugify(name)}.md`,
    });
    const bytes: Uint8Array = out instanceof Uint8Array ? out : new Uint8Array(out?.data ?? []);
    return dec.decode(bytes);
  } catch {
    return null;
  }
}

/**
 * Bot files that exist on disk but whose agent is not visible (its frontmatter
 * says `disabled: true`). The harness removes disabled agents from /api/agent,
 * so the file list is the only way to offer "re-enable" in the UI.
 */
export async function listDisabledBots(): Promise<Array<{ id: string; description?: string; color?: string }>> {
  const ws = await ensureLocation();
  if (!ws) return [];
  let agents: Set<string>;
  try {
    agents = new Set((await scopedAgents(ws)).filter((a) => !a.hidden).map((a: any) => a.id));
  } catch {
    return [];
  }
  let entries: any[] = [];
  try {
    const r: any = await (client as any).file.list({ location: { directory: ws }, path: BOTS_REL_DIR });
    entries = r?.data ?? r ?? [];
  } catch {
    return [];
  }
  const out: Array<{ id: string; description?: string; color?: string }> = [];
  for (const e of entries) {
    if (e.type !== "file" || !String(e.path).endsWith(".md")) continue;
    const id = String(e.path).slice(BOTS_REL_DIR.length + 1, -3);
    if (!id || agents.has(id)) continue;
    const src = await readBotFile(id);
    const known = src ? parseBotFile(src).known : {};
    out.push({ id, description: known.description, color: known.color });
  }
  return out;
}

/**
 * Create or overwrite a bot, reload, and wait until harness discovery picks
 * it up. Pass `prevName` when editing an existing bot so a changed name
 * becomes a rename (old file removed) instead of a leftover duplicate.
 */
export async function saveBot(
  d: BotDraft,
  unknownLines: string[] = [],
  extraRules: PermRule[] = [],
  prevName?: string,
): Promise<string> {
  const ws = workspaceDir();
  if (!ws) throw new Error("Workspace not connected — is the harness running?");
  await ensureLocation();
  const slug = slugify(d.name);
  if (!slug) throw new Error("Bot name is empty after slugify");
  await (client as any).file.write({
    location: { directory: ws },
    path: `${BOTS_REL_DIR}/${slug}.md`,
    payload: enc.encode(serializeBotFile({ ...d, name: slug }, unknownLines, extraRules)),
  });
  const prev = prevName ? slugify(prevName) : "";
  if (prev && prev !== slug) await removeBotFile(prev);
  await client.location.reload();
  // Project agent discovery runs async after load — poll until visible.
  // Disabled bots never appear in /api/agent; for them the write itself
  // (readable with disabled:true) is the success condition.
  for (let i = 0; i < 15; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    if (d.disabled) {
      const src = await readBotFile(slug);
      if (src != null && parseBotFile(src).known.disabled === true) return slug;
      continue;
    }
    try {
      const all = await scopedAgents(ws);
      if (all.some((a) => a.id === slug || a.id.endsWith(`/${slug}`))) return slug;
    } catch {}
  }
  throw new Error(`saved ${slug}.md but it did not appear in /api/agent after 15s`);
}

/** No fs-delete route in the harness API — delete via its shell API instead. */
export async function deleteBot(name: string): Promise<void> {
  const ws = workspaceDir();
  if (!ws) throw new Error("Workspace not connected — is the harness running?");
  const slug = slugify(name);
  if (!slug || slug.includes("..")) throw new Error("Invalid bot name.");
  await removeBotFile(slug);
  await client.location.reload();
  // Poll until the file is actually gone.
  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if ((await readBotFile(slug)) == null) return;
  }
  throw new Error("File still exists after delete — check harness shell permissions.");
}
export async function setBotDisabled(name: string, disabled: boolean): Promise<void> {
  const src = await readBotFile(name);
  if (src == null) throw new Error(`bot file not found: ${name}`);
  const { known, unknownLines, system } = parseBotFile(src);
  await saveBot(
    {
      name: slugify(name),
      description: known.description ?? "",
      mode: known.mode ?? "primary",
      model: known.model ?? "",
      color: known.color ?? "",
      system,
      disabled,
      skills: known.skills ?? [],
      mcp: known.mcp ?? {},
    },
    unknownLines,
    known.rules ?? [],
  );
}

/**
 * Words that carry no naming value — "help me plan trips" should become
 * `plan-trips`, not `help-plan-trips`.
 */
const NAME_STOPWORDS = new Set([
  "a", "an", "and", "the", "my", "me", "i", "you", "your", "it", "its",
  "that", "this", "for", "of", "to", "in", "on", "with", "at", "by", "from",
  "should", "shall", "make", "makes", "create", "creates", "build", "builds",
  "help", "helps", "want", "wants", "need", "needs", "can", "could", "will",
  "would", "do", "does", "please", "bot", "assistant", "always", "when",
  "then", "also", "about", "answer", "answers", "answering", "question",
  "questions", "things", "stuff", "just", "only", "some", "new", "really", "very",
]);

/**
 * Pick a short readable bot name from what the user typed. No forms, no
 * questions — the name is derived, stored, and editable later in settings.
 */
export function deriveBotName(text: string, taken: Set<string>): string {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/[\s-]+/)
    .filter(Boolean);
  const picked: string[] = [];
  for (const w of words) {
    if (NAME_STOPWORDS.has(w)) continue;
    picked.push(w);
    if (picked.length >= 2) break;
  }
  let base = picked.join("-").replace(/-+$/g, "").slice(0, 28).replace(/-+$/g, "");
  if (!base) base = "helper";
  if (/^\d/.test(base)) base = `bot-${base}`;
  let name = base;
  for (let n = 2; taken.has(name); n++) name = `${base}-${n}`;
  return name;
}

/** Marker identifying the built-in colleague persona (never upgrade twice). */
const PERSONA_MARKER = "one of the user's bots";

/**
 * The colleague persona every bot gets. A non-empty agent body replaces
 * OpenCode's base prompt — which is the point: bots introduce themselves as
 * teammates, and the engine stays invisible in the background.
 */
export function buildBotPersona(name: string, focus: string): string {
  return `You are ${name}, ${PERSONA_MARKER} — a digital colleague on their private team.

Your focus: ${focus.trim() || "general help — whatever the user needs next"}

How you work:
- You are a teammate, not software. Never describe yourself as an AI assistant, a model, or as OpenCode. OpenCode is the private engine that executes your operations in the background — the user never needs to hear about it. If asked who you are: you are ${name}, one of their bots.
- Do the work instead of describing it. Use your tools, complete the steps, then give a short, concrete update.
- Act on your own within your focus; ask before anything destructive or irreversible.
- Report like a colleague: "Done — …, next I can …". Brief and specific; never restate the request back.
- If the user asks you to remember something permanently, save it as a skill in your workspace.
- Match the user's language and tone.`;
}

/** Rewrite legacy/empty app-generated bodies to the persona; null means leave as-is. */
function upgradedSystem(name: string, body: string): string | null {
  if (body.includes(PERSONA_MARKER)) return null;
  const t = body.trim();
  if (!t) return buildBotPersona(name, "");
  const nl = t.indexOf("\n");
  const firstLine = (nl === -1 ? t : t.slice(0, nl)).trim();
  const rest = nl === -1 ? "" : t.slice(nl + 1).trim();
  // Only the exact openers older app versions generated count as legacy —
  // hand-written prompts (even if they start with "You are …") stay untouched.
  const esc = name.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  const legacyName = new RegExp(`^You are\\s+${esc}\\s*[.,!]?$`, "i");
  const legacyFriendly = new RegExp(`^You are\\s+${esc},\\s*a friendly,\\s*capable assistant\\.?$`, "i");
  if (!legacyName.test(firstLine) && !legacyFriendly.test(firstLine)) return null;
  return buildBotPersona(name, rest);
}

/**
 * One-thought bot creation: pass whatever the user typed ("review my code",
 * "help me plan trips", or nothing at all) and get a saved, discoverable bot.
 * Empty text creates a general-purpose helper.
 */
export async function createBotFromPrompt(text: string): Promise<string> {
  const raw = text.trim();
  const taken = new Set<string>([...BUILTIN_AGENT_IDS, "compaction", "title", "summary"]);
  try {
    for (const b of await listBots()) taken.add(b.id);
  } catch {}
  try {
    for (const b of await listDisabledBots()) taken.add(b.id);
  } catch {}
  const name = deriveBotName(raw, taken);
  const description = raw.length > 120 ? raw.slice(0, 117) + "..." : raw;
  const system = buildBotPersona(name, raw);
  return saveBot(
    {
      name,
      description,
      mode: "primary",
      model: "",
      color: "",
      system,
      disabled: false,
      skills: [],
      mcp: {},
    },
    [],
    [],
  );
}

/**
 * Boot migration: give existing bots the colleague persona. Only bodies that
 * are empty or still use the legacy "You are <name>." template are touched —
 * custom prompts are never overwritten. Returns how many bots were checked
 * and how many changed; callers retry while `checked` is 0 (agent discovery
 * is async, so the first list right after boot can still be empty).
 */
export async function upgradeBotPersonas(): Promise<{ checked: number; changed: number }> {
  const ws = await ensureLocation();
  if (!ws) return { checked: 0, changed: 0 };
  let bots: any[] = [];
  try {
    bots = await listBots();
  } catch {}
  try {
    bots = bots.concat(await listDisabledBots());
  } catch {}
  let checked = 0;
  let changed = 0;
  for (const b of bots) {
    if (!b?.id) continue;
    checked++;
    try {
      const src = await readBotFile(b.id);
      if (src == null) continue;
      const { known, unknownLines, system } = parseBotFile(src);
      const next = upgradedSystem(b.id, system);
      if (!next) continue;
      await (client as any).file.write({
        location: { directory: ws },
        path: `${BOTS_REL_DIR}/${b.id}.md`,
        payload: enc.encode(
          serializeBotFile(
            {
              name: b.id,
              description: known.description ?? "",
              mode: known.mode ?? "primary",
              model: known.model ?? "",
              color: known.color ?? "",
              system: next,
              disabled: known.disabled === true,
              skills: known.skills ?? [],
              mcp: known.mcp ?? {},
            },
            unknownLines,
            known.rules ?? [],
          ),
        ),
      });
      changed++;
    } catch (e) {
      console.warn(`persona upgrade failed for ${b.id}:`, (e as Error).message);
    }
  }
  // Reload even when nothing changed here: this also runs right after boot or
  // external file edits, and a fresh location guarantees the harness serves
  // the latest prompts.
  if (checked > 0) await client.location.reload();
  return { checked, changed };
}

/** Re-point this bot's DM session(s) at a new name after a rename (best-effort). */
export async function renameBotHistory(from: string, to: string): Promise<void> {
  try {
    const r: any = await client.session.list();
    const list: any[] = r?.data ?? [];
    for (const s of list) {
      if (s?.metadata?.kind === "dm" && s?.metadata?.bot === from) {
        await client.session.update({
          sessionID: s.id,
          title: to,
          metadata: { ...(s.metadata ?? {}), kind: "dm", bot: to },
        } as any);
      }
    }
  } catch (e) {
    console.warn("chat re-point after rename failed:", (e as Error).message);
  }
}

/** Skills a bot chats with: explicit file list, else every catalog skill (default). */
export async function resolveBotSkills(botID: string): Promise<string[]> {
  try {
    const src = await readBotFile(botID);
    if (src != null) {
      const { known } = parseBotFile(src);
      if (known.skills?.length) return known.skills;
    }
  } catch {}
  try {
    const all: any[] = await listSkills();
    const ids = all.map((s: any) => s.id ?? s.name).filter(Boolean);
    if (ids.length) return ids;
  } catch {}
  return ["manage-skills"];
}
export async function activateBotSkills(sessionID: string, skills: string[]): Promise<string[]> {
  const ok: string[] = [];
  for (const id of skills) {
    try {
      await (client as any).session.skill({ sessionID, id });
      ok.push(id);
    } catch (e) {
      console.warn(`skill activate failed (${id}):`, (e as Error).message);
    }
  }
  return ok;
}

/** Skills catalog (scoped to workspace location when set). */
export async function listSkills(): Promise<any[]> {
  const ws = workspaceDir();
  return withDiscovery(async () => {
    try {
      const r: any = await (client as any).skill.list(
        ws ? ({ location: { directory: ws } } as any) : undefined,
      );
      const data = r?.data ?? r ?? [];
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  });
}

/** MCP servers catalog (scoped to workspace location when set). */
export async function listMcp(): Promise<any[]> {
  const ws = workspaceDir();
  return withDiscovery(async () => {
    try {
      const r: any = await (client as any).mcp.list(
        ws ? ({ location: { directory: ws } } as any) : undefined,
      );
      const data = r?.data ?? r ?? [];
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  });
}

function mcpLoc() {
  const ws = workspaceDir();
  return ws ? { location: { directory: ws } } : undefined;
}

export async function connectMcpServer(name: string): Promise<void> {
  await (client as any).mcp.connect({ server: name, location: mcpLoc() } as any);
}

export async function disconnectMcpServer(name: string): Promise<void> {
  await (client as any).mcp.disconnect({ server: name, location: mcpLoc() } as any);
}
