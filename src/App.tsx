import { useEffect, useRef, useState } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import type { McpServer, PermissionRequest, V2Event } from "@opencode/client";
import { authHeaders, baseUrl, client, resolveTauriHarness, sessionLocation } from "./lib/opencode";
import { chatHasStaleSkillMarker, createUntitledBot, deriveBotTitle, listBots, listDisabledBots, listMcp, mcpStatusLabel, prettyBotName, upgradeBotPersonas } from "./lib/bots";
import {
  IconActivity, IconArrowUp, IconCheck, IconChevronDown, IconCopy,
  IconGear, IconMark, IconPlus, IconStore, IconStop, IconThumbsDown, IconThumbsUp,
} from "./icons";
import { BotAvatar } from "./avatar";
import { BotSettings } from "./Bots";
import { ErrorBoundary } from "./ErrorBoundary";
import { applyAppearance, watchSystemAppearance } from "./theme";
import { Tools } from "./Tools";
import { Marketplace } from "./Marketplace";

type Session = { id: string; kind?: string; bot?: string };
type ChatMsg = {
  role: "user" | "assistant" | "tool"; text: string; key: string;
  time?: number; agent?: string; mcps?: string[]; rep?: number;
  /** Tool name for tool rows - powers the compact activity labels. */
  tool?: string;
  /** Tool row that ended in failure. */
  err?: boolean;
  /** Sent mid-turn - the harness runs it right after the current turn. */
  queued?: boolean;
  /** Harness inbox id - how the optimistic bubble folds into the stored thread. */
  inboxID?: string;
};
/** One stroke of the live turn feed: streamed text or a tool being run. */
type LiveEntry =
  | { kind: "text"; key: string; text: string }
  | { kind: "tool"; key: string; name: string; text: string; refs: string[]; state: "running" | "done" | "error" };
/** Unified tool row (stored or live) - consecutive ones group into one line. */
type ToolItem = { key: string; name: string; text: string; refs: string[]; state: "running" | "done" | "error"; rep?: number };
type DisplayRow =
  | { kind: "msg"; m: ChatMsg; tkey: string; streamed?: boolean }
  | { kind: "tools"; key: string; items: ToolItem[] };
type ModelOpt = { key: string; providerID: string; id: string };
type BotMeta = { id: string; color?: string; description?: string };

const STARTERS = [
  "Plan a weekend trip",
  "Find me a good movie tonight",
  "Research a topic for me",
  "Review a piece of code",
];

/** How long without ANY event before we assume a turn was dropped. */
const WATCHDOG_MS = 100_000;

/** Display names for bots whose handle is still "untitled" (local, private). */
const BOT_NAMES_KEY = "muster.botNames.v1";

function loadBotNames(): Record<string, string> {
  try {
    const raw = localStorage.getItem(BOT_NAMES_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed)) if (typeof v === "string" && v.trim()) out[k] = v.trim();
    return out;
  } catch {
    return {};
  }
}

function persistBotNames(names: Record<string, string>) {
  try {
    localStorage.setItem(BOT_NAMES_KEY, JSON.stringify(names));
  } catch {}
}

/** Roster order: newest bot first, so a fresh bot appears at the top. */
const BOT_ORDER_KEY = "muster.botOrder.v1";

function loadBotOrder(): string[] {
  try {
    const raw = localStorage.getItem(BOT_ORDER_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === "string" && !!x);
  } catch {
    return [];
  }
}

function persistBotOrder(ids: string[]) {
  try {
    localStorage.setItem(BOT_ORDER_KEY, JSON.stringify(ids));
  } catch {}
}

/** Events that mean "the bot is alive" - reset the per-session watchdog. */
const ACTIVITY_EVENTS = new Set([
  "session.text.started", "session.text.delta", "session.text.ended",
  "session.reasoning.started", "session.reasoning.delta", "session.reasoning.ended",
  "session.tool.input.started", "session.tool.input.delta", "session.tool.input.ended",
  "session.tool.called", "session.tool.progress", "session.tool.success", "session.tool.failed",
  "session.step.started", "session.step.streamed", "session.usage.updated",
  "session.execution.started", "session.retry.scheduled",
]);

/** Events that mean a catalog (bots/tools/models/skills) may have changed. */
const CATALOG_EVENTS = new Set([
  "agent.updated", "config.updated", "skill.updated",
  "mcp.status.changed", "mcp.resources.changed",
  "model.updated", "provider.updated", "worktree.resolved", "project.updated",
]);

/** Where a tool call actually goes: MCP calls bots make from execute code
 * (`tools["agent-browser"].agent_browser_open(...)`). Rendered as chips on the
 * tool line so it's visible which connector a call is routed to. */
function mcpRefs(rawInput: unknown): string[] {
  let code = "";
  if (typeof rawInput === "string") code = rawInput;
  else if (rawInput && typeof rawInput === "object") {
    const input = rawInput as { code?: unknown };
    if (typeof input.code === "string") code = input.code;
    else {
      try { code = JSON.stringify(rawInput) ?? ""; } catch {}
    }
  }
  const calls = new Set<string>();
  const servers = new Set<string>();
  for (const m of code.matchAll(/tools\s*\[\s*["'`]([^"'`\n]+)["'`]\s*\]\s*\.\s*([A-Za-z0-9_-]+)/g)) calls.add(`${m[1]}.${m[2]}`);
  for (const m of code.matchAll(/\btools\s*\.\s*([A-Za-z0-9_-]+)\s*\.\s*([A-Za-z0-9_-]+)/g)) calls.add(`${m[1]}.${m[2]}`);
  if (!calls.size) for (const m of code.matchAll(/tools\s*\[\s*["'`]([^"'`\n]+)["'`]\s*\]/g)) servers.add(m[1]);
  return [...(calls.size ? calls : servers)].slice(0, 6);
}

/** Plain-language label for what a running tool is doing. */
const TOOL_PHRASES: Record<string, string> = {
  bash: "running a command",
  webfetch: "reading a page",
  websearch: "searching the web",
  read: "checking files",
  glob: "finding files",
  grep: "searching files",
  write: "writing a file",
  edit: "editing a file",
  patch: "patching a file",
  skill: "consulting a skill",
  execute: "running a script",
};

function toolPhrase(name: string, refs: string[]): string {
  if (refs.some((r) => r.startsWith("agent-browser.")) || name.startsWith("agent_browser_")) return "browsing the web";
  if (refs.length) return `using ${refs[0].split(".")[0]}`;
  return TOOL_PHRASES[name] ?? `using ${name}`;
}

/** Short, human-readable hint for a tool's input - never dumps raw JSON.
 *  `execute`/`bash` scripts are the worst spam offenders, so they get a
 *  one-line hint (or nothing when the MCP chips already say enough). */
function toolDetail(name: string, input: unknown, refs: string[]): string {
  if (refs.length || input == null) return "";
  const rec = typeof input === "object" ? (input as Record<string, unknown>) : {};
  if (name === "write" || name === "edit" || name === "read" || name === "patch") {
    const p = rec.filePath ?? rec.path ?? rec.filename;
    if (typeof p === "string" && p) return ` ${p}`;
  }
  if (name === "bash") {
    const code = typeof input === "string" ? input : rec.command ?? "";
    const line = String(code).split("\n").map((l) => l.trim()).find((l) => l && !l.startsWith("#!"));
    if (!line) return "";
    const clean = line.replace(/^(\/\/|#)\s?/, "").replace(/\s+/g, " ");
    return ` ${clean.slice(0, 72)}${clean.length > 72 ? "…" : ""}`;
  }
  // `execute` scripts are internal glue (often one line of tool routing) and
  // add noise, not meaning - the MCP chips already say where the call goes.
  if (name === "execute") return "";
  let j = "";
  try { j = JSON.stringify(input) ?? ""; } catch {}
  if (!j || j === "{}") return "";
  return ` ${j.slice(0, 72)}${j.length > 72 ? "…" : ""}`;
}

marked.use({ gfm: true, breaks: true });

// Post-processing for sanitized chat HTML: links open outside the app, and
// tables get a scroll wrapper so wide job tables can't break the column.
DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if ((node as Element).tagName === "A") {
    (node as Element).setAttribute("target", "_blank");
    (node as Element).setAttribute("rel", "noreferrer noopener");
  }
});
DOMPurify.addHook("afterSanitizeElements", (node) => {
  const el = node as Element;
  if (el.tagName !== "TABLE") return;
  const parent = el.parentNode as HTMLElement | null;
  if (!parent || parent.classList?.contains("md-table")) return;
  const wrap = (el.ownerDocument ?? document).createElement("div");
  wrap.className = "md-table";
  parent.insertBefore(wrap, el);
  wrap.appendChild(el);
});

/** Parse cache - finalized messages re-render on theme flips, roster updates, … */
const mdCache = new Map<string, string>();
/** Cap on cached entries - keeps the cache from pinning many long messages. */
const MD_CACHE_MAX = 300;
/** Strings above this size render uncached (one long answer shouldn't hog it). */
const MD_CACHE_MAX_CHARS = 200_000;

/** Markdown → sanitized HTML (full GFM: tables, lists, links, quotes, code).
 *  Pass `cache: false` for streamed/partial text: every delta is a new string,
 *  so caching each one pins up to ~300 progressively-growing copies. */
export function renderMarkdown(src: string, cache = true): string {
  if (cache) {
    const hit = mdCache.get(src);
    if (hit !== undefined) return hit;
  }
  let html: string;
  try {
    html = DOMPurify.sanitize(marked.parse(src, { async: false }) as string);
  } catch {
    html = src.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br/>");
  }
  if (cache && src.length <= MD_CACHE_MAX_CHARS) {
    if (mdCache.size > MD_CACHE_MAX) mdCache.clear();
    mdCache.set(src, html);
  }
  return html;
}

function fmtTime(ts?: number): string {
  if (!ts) return "";
  return new Date(ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/** True when two stored threads would render the same - avoids flicker. */
function sameThread(a: ChatMsg[], b: ChatMsg[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i], y = b[i];
    if (x.role !== y.role || x.key !== y.key || x.text !== y.text) return false;
    if (x.err !== y.err || x.queued !== y.queued || x.agent !== y.agent) return false;
  }
  return true;
}

/** Elapsed clock for the working row - "0:42". */
function fmtClock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function dayLabel(ts?: number): string {
  if (!ts) return "";
  const d = new Date(ts);
  const now = new Date();
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (sameDay(d, now)) return "Today";
  const y = new Date(now);
  y.setDate(y.getDate() - 1);
  if (sameDay(d, y)) return "Yesterday";
  return d.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
}

/**
 * Just bots. Sidebar lists bots, click one to chat, plus-button makes one.
 * Each bot runs on the background OpenCode harness with its own skills + tools.
 */
export function App() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [bots, setBots] = useState<BotMeta[]>([]);
  const [disabledBots, setDisabledBots] = useState<Array<{ id: string; color?: string; description?: string }>>([]);
  const [tools, setTools] = useState<McpServer[]>([]);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [marketOpen, setMarketOpen] = useState(false);
  const [activeID, setActiveID] = useState<string | null>(null);
  const [activeBot, setActiveBot] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [models, setModels] = useState<ModelOpt[]>([]);
  const [modelsBySession, setModelsBySession] = useState<Record<string, string>>({});
  const [busySessions, setBusySessions] = useState<Record<string, boolean>>({});
  const [perms, setPerms] = useState<PermissionRequest[]>([]);
  const [votes, setVotes] = useState<Record<string, 1 | -1>>({});
  const [harnessOk, setHarnessOk] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");
  const [live, setLive] = useState<Record<string, LiveEntry[]>>({});
  const [pending, setPending] = useState<Record<string, ChatMsg[]>>({});
  const [openClusters, setOpenClusters] = useState<Set<string>>(() => new Set());
  const [now, setNow] = useState(() => Date.now());
  // Team status per session: who needs your approval, who has new replies.
  const [needsYou, setNeedsYou] = useState<Record<string, boolean>>({});
  const [unread, setUnread] = useState<Record<string, boolean>>({});
  const [botNames, setBotNames] = useState<Record<string, string>>(() => loadBotNames());
  const [botOrder, setBotOrder] = useState<string[]>(() => loadBotOrder());
  const [creating, setCreating] = useState(false);
  const [settingsBot, setSettingsBot] = useState<string | null>(null);
  const statusTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const watchdogs = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const busyRef = useRef<Record<string, boolean>>({});
  /** When each session's current turn started - powers the elapsed clock. */
  const turns = useRef<Record<string, number>>({});
  /** Mirror of `live` readable from event handlers without stale closures. */
  const liveRef = useRef<Record<string, LiveEntry[]>>({});
  /** rAF handle for coalescing stream deltas into one paint. */
  const liveRaf = useRef<number | null>(null);
  /** Mirror of `pending` - same reason. */
  const pendingRef = useRef<Record<string, ChatMsg[]>>({});
  /** Last stored thread per session - makes switching back instant. */
  const threadCache = useRef<Record<string, ChatMsg[]>>({});
  /** Per-session load sequence - old responses must never overwrite new ones. */
  const threadSeq = useRef<Record<string, number>>({});
  /** Inbox ids whose delivery event arrived before we knew the id (HTTP race). */
  const deliveredInbox = useRef<Set<string>>(new Set());
  const activeBotRef = useRef<string | null>(null);
  const activeIDRef = useRef<string | null>(null);
  /** Composer draft per chat (session id, or `bot:<id>` before the session exists). */
  const drafts = useRef<Record<string, string>>({});
  const inputRef = useRef("");
  const botNamesRef = useRef<Record<string, string>>(botNames);
  const botOrderRef = useRef<string[]>(botOrder);
  const threadRef = useRef<HTMLDivElement | null>(null);
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  const say = (msg: string) => {
    setStatusMsg(msg);
    clearTimeout(statusTimer.current);
    if (msg) statusTimer.current = setTimeout(() => setStatusMsg(""), 8000);
  };

  /** What the crew sees. Untitled bots get a friendly title from their task. */
  const botLabel = (id?: string | null) => {
    if (!id) return "";
    return botNamesRef.current[id] || prettyBotName(id);
  };

  const setBotDisplayName = (id: string, raw: string) => {
    const name = raw.trim();
    const next = { ...botNamesRef.current };
    if (name) next[id] = name;
    else delete next[id];
    botNamesRef.current = next;
    persistBotNames(next);
    setBotNames(next);
  };

  /** New bots belong at the top of the roster, not buried alphabetically. */
  const rememberBotAtTop = (id: string) => {
    const next = [id, ...botOrderRef.current.filter((x) => x !== id)];
    botOrderRef.current = next;
    persistBotOrder(next);
    setBotOrder(next);
  };

  /** Keep local roster state attached when a bot handle changes. */
  const migrateBotLocal = (from: string, to: string) => {
    const names = { ...botNamesRef.current };
    if (names[from]) {
      names[to] = names[from];
      delete names[from];
      botNamesRef.current = names;
      persistBotNames(names);
      setBotNames(names);
    }
    if (botOrderRef.current.includes(from)) {
      const order = botOrderRef.current.map((x) => (x === from ? to : x));
      botOrderRef.current = order;
      persistBotOrder(order);
      setBotOrder(order);
    }
  };

  /** Drop local roster state for a deleted bot. */
  const forgetBotLocal = (id: string) => {
    const names = { ...botNamesRef.current };
    if (names[id]) {
      delete names[id];
      botNamesRef.current = names;
      persistBotNames(names);
      setBotNames(names);
    }
    if (botOrderRef.current.includes(id)) {
      const order = botOrderRef.current.filter((x) => x !== id);
      botOrderRef.current = order;
      persistBotOrder(order);
      setBotOrder(order);
    }
  };

  const setActiveSession = (id: string | null, bot: string | null) => {
    const prevID = activeIDRef.current;
    const prevBot = activeBotRef.current;
    const prevKey = prevID ?? (prevBot ? `bot:${prevBot}` : "");
    if (prevKey) drafts.current[prevKey] = inputRef.current;
    // Each chat keeps its own draft - typing in one never leaks into another.
    if (prevID !== id || prevBot !== bot) {
      const nextKey = id ?? (bot ? `bot:${bot}` : "");
      let next = nextKey ? drafts.current[nextKey] ?? "" : "";
      if (!next && bot) next = drafts.current[`bot:${bot}`] ?? "";
      if (nextKey && next) drafts.current[nextKey] = next;
      inputRef.current = next;
      setInput(next);
    }
    activeIDRef.current = id;
    activeBotRef.current = bot;
    setActiveID(id);
    setActiveBot(bot);
    requestAnimationFrame(() => {
      autogrow();
      if (bot) taRef.current?.focus();
    });
  };

  const setSessionBusy = (sid: string, v: boolean) => {
    const m = { ...busyRef.current };
    if (v) m[sid] = true;
    else delete m[sid];
    busyRef.current = m;
    setBusySessions(m);
  };

  const syncNeedsYou = (sid: string, on: boolean) =>
    setNeedsYou((m) => {
      if (!!m[sid] === on) return m;
      const n = { ...m };
      if (on) n[sid] = true;
      else delete n[sid];
      return n;
    });

  /** A chat you just opened is "seen" - clears its roster dot. */
  const markSeen = (sid: string) =>
    setUnread((m) => {
      if (!m[sid]) return m;
      const n = { ...m };
      delete n[sid];
      return n;
    });

  const clearWatchdog = (sid: string) => {
    clearTimeout(watchdogs.current[sid]);
    delete watchdogs.current[sid];
  };

  const armWatchdog = (sid: string) => {
    clearWatchdog(sid);
    watchdogs.current[sid] = setTimeout(() => {
      delete watchdogs.current[sid];
      delete turns.current[sid];
      setSessionBusy(sid, false);
      if (sid === activeIDRef.current) {
        say("This turn went quiet. Reloading the thread to catch up.");
        loadThread(sid);
        loadPerms(sid);
      }
    }, WATCHDOG_MS);
  };

  /** Live-feed helpers - the feed is keyed per session and mirrored in a ref
   *  so event handlers can read/update it without stale closures. */
  const replaceLive = (fn: (prev: Record<string, LiveEntry[]>) => Record<string, LiveEntry[]>) => {
    const next = fn(liveRef.current);
    if (next === liveRef.current) return;
    liveRef.current = next;
    // Coalesce token deltas into one paint per frame - the stream can fire
    // dozens of events a second and each one would otherwise re-render the app.
    if (liveRaf.current == null) {
      liveRaf.current = requestAnimationFrame(() => {
        liveRaf.current = null;
        setLive(liveRef.current);
      });
    }
  };

  const replacePending = (fn: (prev: Record<string, ChatMsg[]>) => Record<string, ChatMsg[]>) => {
    const next = fn(pendingRef.current);
    if (next === pendingRef.current) return;
    pendingRef.current = next;
    setPending(next);
  };

  /** A delivered inbox message is now part of the conversation - move its
   *  optimistic bubble into the thread under the id the store will use (the
   *  harness keeps the inbox id as the user message id, verified live), so
   *  the later stored version replaces it seamlessly. */
  const foldDelivered = (sid: string, inboxID: string) => {
    const item = (pendingRef.current[sid] ?? []).find((x) => x.inboxID === inboxID);
    if (!item) return false;
    replacePending((p) => {
      const kept = (p[sid] ?? []).filter((x) => x.inboxID !== inboxID);
      const n = { ...p };
      if (kept.length) n[sid] = kept;
      else delete n[sid];
      return n;
    });
    const msg: ChatMsg = { ...item, key: inboxID, queued: false, time: item.time ?? Date.now() };
    const cached = threadCache.current[sid];
    if (cached && !cached.some((m) => m.key === inboxID)) threadCache.current[sid] = [...cached, msg];
    if (sid === activeIDRef.current) {
      setMsgs((prev) => (prev.some((m) => m.key === inboxID) ? prev : [...prev, msg]));
    }
    deliveredInbox.current.delete(inboxID);
    return true;
  };

  const mutFeed = (sid: string, fn: (list: LiveEntry[]) => LiveEntry[]) => {
    replaceLive((prev) => {
      const cur = prev[sid] ?? [];
      const next = fn(cur);
      if (next === cur) return prev;
      return { ...prev, [sid]: next };
    });
  };

  const dropFeed = (sid: string) =>
    replaceLive((prev) => {
      if (!(sid in prev)) return prev;
      const n = { ...prev };
      delete n[sid];
      return n;
    });

  const toggleCluster = (k: string) =>
    setOpenClusters((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  useEffect(() => {
    activeBotRef.current = activeBot;
  }, [activeBot]);

  // Adopt bots that predate the local order (or were created elsewhere) at
  // the end. The list itself stays stable, so rows never jump around.
  useEffect(() => {
    if (!bots.length) return;
    const known = new Set(botOrderRef.current);
    const missing = bots.filter((b) => !known.has(b.id)).map((b) => b.id);
    if (!missing.length) return;
    const next = [...botOrderRef.current, ...missing];
    botOrderRef.current = next;
    persistBotOrder(next);
    setBotOrder(next);
  }, [bots]);

  useEffect(() => () => {
    if (liveRaf.current != null) cancelAnimationFrame(liveRaf.current);
  }, []);

  // Appearance follows the OS. No app-level override: light/dark are twins,
  // and the OS setting is the only source of truth.
  useEffect(() => {
    applyAppearance();
    return watchSystemAppearance();
  }, []);

  const refreshSessions = async () => {
    try {
      const r = await client.session.list();
      setSessions(
        r.data.map((s) => ({
          id: s.id,
          kind: typeof s.metadata?.kind === "string" ? s.metadata.kind : undefined,
          bot: typeof s.metadata?.bot === "string" ? s.metadata.bot : undefined,
        })),
      );
      setHarnessOk(true);
    } catch (e) {
      setHarnessOk(false);
      console.warn("harness not ready (run ./run.sh)", e);
    }
  };

  const refreshCatalogs = async () => {
    try {
      const m = await client.model.list();
      setModels(
        m.data
          .filter((x) => x.providerID && x.modelID)
          .map((x) => ({ key: `${x.providerID}/${x.modelID}`, providerID: x.providerID, id: x.modelID })),
      );
    } catch {}
    try {
      const bl = await listBots();
      setBots(bl.map((b) => ({
        id: b.id, color: b.botColor || b.color, description: b.description,
      })));
    } catch {}
    try {
      setDisabledBots(await listDisabledBots());
    } catch {}
    try {
      setTools(await listMcp());
    } catch {}
  };

  // Boot task: fill in the colleague persona for bots created before it
  // existed. Retries while the harness is still discovering agents (the first
  // list right after boot can be empty), then latches.
  const personasUpgraded = useRef(false);
  useEffect(() => {
    if (!harnessOk || personasUpgraded.current) return;
    let cancelled = false;
    let tries = 0;
    const attempt = async () => {
      if (cancelled || personasUpgraded.current) return;
      tries++;
      try {
        const { checked, changed } = await upgradeBotPersonas();
        if (cancelled) return;
        if (changed) refreshCatalogs();
        if (checked > 0 || tries >= 8) {
          personasUpgraded.current = true;
          return;
        }
      } catch (e) {
        if (tries >= 8) {
          personasUpgraded.current = true;
          console.warn("persona upgrade failed:", e);
          return;
        }
      }
      setTimeout(attempt, 2500);
    };
    attempt();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [harnessOk]);

  const syncInbox = async (sid: string) => {
    try {
      const r = await client.session.inbox.list({ sessionID: sid });
      const stored = new Set(
        (threadCache.current[sid] ?? []).filter((m) => m.role === "user").map((m) => m.key),
      );
      const incoming: ChatMsg[] = [];
      for (const x of r) {
        if (x.type !== "user" || !x.payload.text) continue;
        if (stored.has(x.id)) continue;
        incoming.push({
          role: "user",
          text: x.payload.text,
          key: `inbox-${x.id}`,
          time: x.time.created,
          queued: true,
          inboxID: x.id,
        });
      }
      replacePending((prev) => {
        const current = prev[sid] ?? [];
        const serverIDs = new Set(incoming.map((x) => x.inboxID!));
        // Keep bubbles still in flight (no inbox id yet) and bubbles whose id
        // the server has not echoed back - a cancellation event removes those.
        const extra = current.filter((x) => x.inboxID == null || (!serverIDs.has(x.inboxID) && !stored.has(x.inboxID)));
        const next = [...incoming, ...extra];
        const same = current.length === next.length &&
          current.every((x, i) => x.key === next[i].key && x.text === next[i].text && x.queued === next[i].queued);
        if (same) return prev;
        const n = { ...prev };
        if (next.length) n[sid] = next;
        else delete n[sid];
        return n;
      });
    } catch {}
  };

  const loadThread = async (id: string) => {
    const seq = (threadSeq.current[id] ?? 0) + 1;
    threadSeq.current[id] = seq;
    try {
      const r = await client.message.list({ sessionID: id });
      // A slower request for a chat the user already left must never paint.
      if (threadSeq.current[id] !== seq) return;
      // The harness returns newest-first; chats read oldest-first.
      const ordered = r.data
        .map((m, i) => ({ m, t: m.time.created, i }))
        .sort((a, b) => a.t - b.t || a.i - b.i)
        .map((x) => x.m);
      const out: ChatMsg[] = [];
      for (const m of ordered) {
        if (m.type === "user" && m.text) {
          out.push({ role: "user", text: m.text, key: m.id ?? Math.random().toString(), time: m.time.created });
        } else if (m.type === "assistant") {
          // Narration before a tool call ("Let me check…") is process, not an
          // answer. Drop it so the thread reads like prose instead of a diary.
          const narrating = m.finish === "tool-calls";
          m.content.forEach((p, idx) => {
            if (p.type === "text" && p.text) {
              if (narrating) return;
              out.push({ role: "assistant", text: p.text, key: `${m.id}-t${idx}`, time: m.time.created, agent: m.agent });
            } else if (p.type === "tool") {
              const refs = mcpRefs(p.state.input);
              out.push({
                role: "tool",
                text: `${p.name}${toolDetail(p.name, p.state.input, refs)}`,
                key: p.id ?? `${m.id}-x${idx}`,
                time: m.time.created,
                agent: m.agent,
                mcps: refs,
                tool: p.name,
                err: p.state.status === "error",
              });
            }
            // NOTE: reasoning parts are the model's internal chain-of-thought -
            // deliberately not rendered. Only final text + tool activity show.
          });
        }
      }
      threadCache.current[id] = out;
      if (id === activeIDRef.current) setMsgs((prev) => sameThread(prev, out) ? prev : out);
      // Optimistic "you" bubbles fold into the stored thread once they land -
      // send() never waits for the echo, so this is the cleanup path. Only the
      // inbox id is authoritative for a queued bubble; a text+time fallback
      // would swallow a second identical "continue".
      replacePending((prev) => {
        const list = prev[id];
        if (!list?.length) return prev;
        const keep = list.filter((p) => {
          if (p.inboxID != null) return !out.some((m) => m.role === "user" && m.key === p.inboxID);
          return !out.some((m) =>
            m.role === "user" &&
            m.text === p.text &&
            (!p.time || !m.time || Math.abs((m.time ?? 0) - p.time) < 120_000));
        });
        if (keep.length === list.length) return prev;
        const n = { ...prev };
        if (keep.length) n[id] = keep;
        else delete n[id];
        return n;
      });
      // Drop live-stream strokes the stored thread now covers (mid-turn
      // resyncs only - turns otherwise paint from the feed until they end).
      const keys = new Set(out.map((mm) => mm.key));
      const storedTexts = new Set(out.filter((m) => m.role === "assistant").map((m) => m.text.trim()));
      replaceLive((prev) => {
        const list = prev[id];
        if (!list?.length) return prev;
        const kept = list.filter((x) => (x.kind === "tool" ? !keys.has(x.key) : !storedTexts.has(x.text.trim())));
        if (kept.length === list.length) return prev;
        const n = { ...prev };
        if (kept.length) n[id] = kept;
        else delete n[id];
        return n;
      });
      // Cluster keys describe tool rows in the rebuilt thread - drop the ones
      // whose row is gone so the set can't grow across reloads.
      const clusterKeys = new Set(out.filter((m) => m.role === "tool").map((m) => `tg-${m.key}`));
      for (const x of liveRef.current[id] ?? []) if (x.kind === "tool") clusterKeys.add(`tg-${x.key}`);
      setOpenClusters((s) => {
        if (!s.size) return s;
        const n = new Set<string>();
        for (const k of s) if (clusterKeys.has(k)) n.add(k);
        return n.size === s.size ? s : n;
      });
      void syncInbox(id);
    } catch {}
  };

  const loadPerms = async (id: string) => {
    try {
      const list = await client.permission.list({ sessionID: id });
      if (id === activeIDRef.current) setPerms(list);
      syncNeedsYou(id, list.length > 0);
    } catch {
      if (id === activeIDRef.current) setPerms([]);
    }
  };

  const replyPerm = async (requestID: string, decision: "once" | "always" | "reject") => {
    const id = activeIDRef.current;
    if (!id) return;
    try {
      await client.permission.reply({ sessionID: id, requestID, decision });
      loadPerms(id);
    } catch (e) {
      say(`Could not send your reply: ${(e as Error).message}`);
    }
  };

  const syncSessionModel = async (id: string) => {
    try {
      const s = await client.session.get({ sessionID: id });
      const mm = s.model;
      if (mm?.providerID && mm?.id) {
        setModelsBySession((prev) => ({ ...prev, [id]: `${mm.providerID}/${mm.id}` }));
      }
    } catch {}
  };

  /** Open a bot chat, creating its session on first contact. */
  const openSeq = useRef(0);
  const openBot = async (botID: string) => {
    const seq = ++openSeq.current;
    let existing = sessions.find((s) => s.kind === "dm" && s.bot === botID);
    if (existing && (await chatHasStaleSkillMarker(existing.id))) {
      // Chats from older builds got a skill's full text force-injected when
      // they were created (and the bot opened the conversation talking about
      // it). That's read-only history and can't be cleaned in place - archive
      // the chat (kept in the DB as dm-archived) and give the bot a fresh,
      // quiet one.
      try {
        await client.session.update({
          sessionID: existing.id,
          metadata: { kind: "dm-archived", bot: botID },
        });
      } catch {}
      existing = undefined;
      refreshSessions();
    }
    if (seq !== openSeq.current) return;
    if (existing) {
      setActiveSession(existing.id, botID);
      markSeen(existing.id);
      // Show the last known thread immediately, then refresh in the background.
      setMsgs(threadCache.current[existing.id] ?? []);
      setPerms([]);
      loadThread(existing.id);
      loadPerms(existing.id);
      syncSessionModel(existing.id);
      return;
    }
    try {
      const s = await client.session.create({
        location: sessionLocation(),
        agent: botID,
        title: botLabel(botID),
        metadata: { kind: "dm", bot: botID },
      });
      if (seq !== openSeq.current) return;
      setActiveSession(s.id, botID);
      setMsgs([]);
      setPerms([]);
      refreshSessions();
      requestAnimationFrame(() => taRef.current?.focus());
    } catch (e) {
      if (seq === openSeq.current) say(`Could not open ${botLabel(botID)}: ${(e as Error).message}`);
    }
  };

  /**
   * One click, one bot. No form: the bot opens as "Untitled", greets the user
   * in an empty chat, and takes its display name from the first real task.
   */
  const createQuickBot = async () => {
    if (creating) return;
    setCreating(true);
    try {
      const taken = new Set<string>(["build", "plan", "general", "explore", "compaction", "title", "summary"]);
      for (const b of bots) taken.add(b.id);
      for (const b of disabledBots) taken.add(b.id);
      const slug = await createUntitledBot(taken);
      rememberBotAtTop(slug);
      refreshCatalogs();
      await openBot(slug);
    } catch (e) {
      say(`Could not create a bot: ${(e as Error).message}`);
    } finally {
      setCreating(false);
    }
  };

  const send = async (text?: string) => {
    const t = (text ?? input).trim();
    const bot = activeBot;
    if (!t || !bot) return;
    let id = activeIDRef.current;
    if (!id) {
      try {
        const s = await client.session.create({
          location: sessionLocation(),
          agent: bot,
          title: botLabel(bot),
          metadata: { kind: "dm", bot },
        });
        id = s.id;
        setActiveSession(id, bot);
        refreshSessions();
      } catch (e) {
        say(`Could not start chat: ${(e as Error).message}`);
        return;
      }
    }
    // An Untitled bot names itself after the first real task. This is a display
    // title only - the handle stays stable, so no files move and no turn stops.
    if (/^untitled(?:-\d+)?$/.test(bot) && !botNamesRef.current[bot]) {
      const title = deriveBotTitle(t);
      if (title) {
        setBotDisplayName(bot, title);
        void client.session.update({ sessionID: id, title }).catch(() => {});
      }
    }
    const wasBusy = !!busyRef.current[id!];
    // The bubble is optimistic: it lives in `pending` until the stored thread
    // picks it up (inbox.delivered / next loadThread), so no reload-then-jump.
    const pk = `p-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    replacePending((p) => ({
      ...p,
      [id!]: [...(p[id!] ?? []), { role: "user", text: t, key: pk, time: Date.now(), queued: wasBusy }],
    }));
    if (text === undefined) {
      inputRef.current = "";
      drafts.current[id!] = "";
      setInput("");
      requestAnimationFrame(() => autogrow());
    }
    if (!wasBusy) {
      setSessionBusy(id!, true);
      turns.current[id!] = turns.current[id!] ?? Date.now();
    }
    armWatchdog(id!);
    try {
      // The harness queues prompts sent mid-turn (inbox), so sending while
      // busy is safe - it runs right after the current turn.
      const res = await client.session.prompt({ sessionID: id!, text: t });
      const inboxID = res.id;
      const queued = res.delivery === "queue" || wasBusy;
      if (inboxID) {
        replacePending((p) => {
          const list = p[id!];
          if (!list) return p;
          return { ...p, [id!]: list.map((x) => (x.key === pk ? { ...x, inboxID, queued: x.queued || queued } : x)) };
        });
        // Delivery can beat the HTTP response - fold it in that case too.
        if (deliveredInbox.current.has(inboxID)) foldDelivered(id!, inboxID);
      }
      if (queued) say("Queued. It runs right after the current step.");
    } catch (e) {
      clearWatchdog(id!);
      if (!wasBusy) setSessionBusy(id!, false);
      replacePending((p) => {
        const list = (p[id!] ?? []).filter((x) => x.key !== pk);
        const n = { ...p };
        if (list.length) n[id!] = list;
        else delete n[id!];
        return n;
      });
      // Never swallow what the user typed: put it back if the composer is
      // still empty, or keep it as that chat's draft if they moved on.
      if (activeIDRef.current === id) {
        if (!inputRef.current.trim()) {
          inputRef.current = t;
          drafts.current[id!] = t;
          setInput(t);
          requestAnimationFrame(() => autogrow());
        }
      } else if (!(drafts.current[id!] ?? "").trim()) {
        drafts.current[id!] = t;
      }
      say(`Could not send: ${(e as Error).message}`);
      return;
    }
  };

  const interrupt = async () => {
    const id = activeIDRef.current;
    if (!id) return;
    try {
      await client.session.interrupt({ sessionID: id });
    } finally {
      clearWatchdog(id);
      setSessionBusy(id, false);
      loadThread(id);
    }
  };

  /** Pull a queued message back out of the harness inbox. */
  const cancelQueued = async (p: ChatMsg) => {
    const id = activeIDRef.current;
    if (!id || !p.inboxID) return;
    const inboxID = p.inboxID;
    const before = pendingRef.current;
    replacePending((prev) => {
      const kept = (prev[id] ?? []).filter((x) => x.inboxID !== inboxID);
      const n = { ...prev };
      if (kept.length) n[id] = kept;
      else delete n[id];
      return n;
    });
    try {
      await client.session.inbox.cancel({ sessionID: id, inboxID });
    } catch (e) {
      replacePending(() => before);
      say(`Could not cancel that message: ${(e as Error).message}`);
    }
  };

  const copy = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setVotes((v) => ({ ...v, [`c:${key}`]: 1 }));
      setTimeout(() => setVotes((v) => {
        const n = { ...v };
        delete n[`c:${key}`];
        return n;
      }), 1200);
    } catch {}
  };

  const vote = (key: string, dir: 1 | -1) =>
    setVotes((v) => {
      const n = { ...v };
      if (n[key] === dir) delete n[key];
      else n[key] = dir;
      return n;
    });

  const switchModel = async (key: string) => {
    const id = activeIDRef.current;
    if (!id) return;
    setModelsBySession((prev) => ({ ...prev, [id]: key }));
    const m = models.find((x) => x.key === key);
    if (!m) return;
    try {
      await client.session.switchModel({ sessionID: id, model: { id: m.id, providerID: m.providerID } });
    } catch (e) {
      say(`Could not switch model: ${(e as Error).message}`);
    }
  };

  useEffect(() => {
    let stopped = false;
    const ctl = new AbortController();
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

    /** Fill chips/hint on a live tool line once its input is known. */
    const applyToolInput = (sid: string, id: string, raw: string | Record<string, unknown> | undefined) => {
      let input: unknown = raw;
      if (typeof raw === "string") {
        try { input = JSON.parse(raw); } catch { input = undefined; }
      }
      if (input === undefined) return;
      mutFeed(sid, (list) => {
        const i = list.findIndex((x) => x.kind === "tool" && x.key === id);
        if (i === -1) return list;
        const cur = list[i] as Extract<LiveEntry, { kind: "tool" }>;
        const refs = mcpRefs(input);
        const text = `${cur.name}${toolDetail(cur.name, input, refs)}`;
        if (refs.join(" ") === cur.refs.join(" ") && text === cur.text) return list;
        const n = list.slice();
        n[i] = { ...cur, refs, text };
        return n;
      });
    };

    /** sessionID of any wire event that carries one (some event families
     *  carry a different payload - those never arm the watchdog). */
    const eventSessionID = (e: V2Event): string => {
      if (!("data" in e)) return "";
      const d = e.data as { sessionID?: unknown };
      return typeof d.sessionID === "string" ? d.sessionID : "";
    };

    const handleEvent = (e: V2Event) => {
      const sid = eventSessionID(e);
      if (sid && ACTIVITY_EVENTS.has(e.type)) armWatchdog(sid);
      const isActive = () => sid === activeIDRef.current;
      switch (e.type) {
        case "session.execution.started": {
          if (!sid) break;
          turns.current[sid] = Date.now();
          setSessionBusy(sid, true);
          armWatchdog(sid);
          // A new turn invalidates the old feed for every chat, not just the
          // one on screen - otherwise background chats keep stale strokes.
          dropFeed(sid);
          if (isActive()) loadThread(sid);
          break;
        }
        case "session.execution.succeeded":
        case "session.execution.failed":
        case "session.execution.interrupted":
        case "session.idle": {
          if (!sid) break;
          if (e.type === "session.execution.failed" && isActive()) say("The turn did not complete. See the thread for details.");
          clearWatchdog(sid);
          delete turns.current[sid];
          setSessionBusy(sid, false);
          // The feed belongs to the finished turn - drop it for chats that
          // settled off-screen too, so live strokes can't linger forever.
          const feed = liveRef.current[sid] ?? [];
          dropFeed(sid);
          if (isActive()) {
            // Settle: fold the live feed into the thread first so nothing
            // blinks out while the harness finishes persisting, then reload
            // (the stored thread is authoritative from here).
            if (feed.length) {
              setMsgs((prev) => {
                const seenText = new Set(prev.filter((m) => m.role === "assistant").map((m) => m.text.trim()));
                const seenTools = new Set(prev.filter((m) => m.role === "tool").map((m) => m.key));
                const add: ChatMsg[] = [];
                for (const x of feed) {
                  if (x.kind === "text") {
                    if (!x.text.trim() || seenText.has(x.text.trim())) continue;
                    add.push({ role: "assistant", text: x.text, key: `live-${sid}-${x.key}`, time: Date.now(), agent: activeBotRef.current ?? undefined });
                  } else {
                    if (seenTools.has(x.key)) continue;
                    add.push({ role: "tool", text: x.text, key: `live-${sid}-${x.key}`, time: Date.now(), agent: activeBotRef.current ?? undefined, mcps: x.refs, tool: x.name, err: x.state === "error" });
                  }
                }
                return add.length ? [...prev, ...add] : prev;
              });
            }
            loadThread(sid);
            loadPerms(sid);
          } else {
            // Finished while you were elsewhere - show a roster dot.
            setUnread((m) => (m[sid] ? m : { ...m, [sid]: true }));
          }
          refreshSessions();
          break;
        }
        case "session.text.delta": {
          const d = e.data;
          if (!sid || !d.delta) break;
          const key = `${d.assistantMessageID}:${d.ordinal}`;
          mutFeed(sid, (list) => {
            const i = list.findIndex((x) => x.key === key);
            if (i === -1) return [...list, { kind: "text", key, text: d.delta }];
            const n = list.slice();
            n[i] = { kind: "text", key, text: (list[i] as Extract<LiveEntry, { kind: "text" }>).text + d.delta };
            return n;
          });
          break;
        }
        case "session.text.ended": {
          if (!sid) break;
          const d = e.data;
          const key = `${d.assistantMessageID}:${d.ordinal}`;
          mutFeed(sid, (list) => {
            const i = list.findIndex((x) => x.key === key);
            if (i === -1) return d.text ? [...list, { kind: "text", key, text: d.text }] : list;
            const n = list.slice();
            n[i] = { kind: "text", key, text: d.text || (list[i] as Extract<LiveEntry, { kind: "text" }>).text };
            return n;
          });
          break;
        }
        case "session.tool.input.started": {
          const d = e.data;
          if (!sid) break;
          const key = d.id;
          const name = d.name;
          mutFeed(sid, (list) =>
            list.some((x) => x.kind === "tool" && x.key === key)
              ? list
              : [...list, { kind: "tool", key, name, text: name, refs: [], state: "running" }],
          );
          break;
        }
        case "session.tool.input.ended": {
          const d = e.data;
          if (sid) applyToolInput(sid, d.id, d.text);
          break;
        }
        case "session.tool.called": {
          const d = e.data;
          if (sid) applyToolInput(sid, d.id, d.input);
          break;
        }
        case "session.tool.success":
        case "session.tool.failed": {
          const d = e.data;
          if (!sid) break;
          const key = d.id;
          const state: "done" | "error" = e.type === "session.tool.failed" ? "error" : "done";
          mutFeed(sid, (list) => {
            const i = list.findIndex((x) => x.kind === "tool" && x.key === key);
            if (i === -1) return list;
            const n = list.slice();
            n[i] = { ...(list[i] as Extract<LiveEntry, { kind: "tool" }>), state };
            return n;
          });
          break;
        }
        case "session.inbox.delivered": {
          // The prompt left the queue and joined the conversation - fold its
          // bubble in now (no reload: the in-flight assistant message would
          // race the live feed).
          const inboxID = e.data.inboxID;
          deliveredInbox.current.add(inboxID);
          if (!foldDelivered(sid, inboxID) && deliveredInbox.current.size > 500) deliveredInbox.current.clear();
          break;
        }
        case "session.inbox.cancelled": {
          const inboxID = e.data.inboxID;
          deliveredInbox.current.delete(inboxID);
          replacePending((p) => {
            let changed = false;
            const n: Record<string, ChatMsg[]> = { ...p };
            for (const k of Object.keys(n)) {
              const kept = n[k].filter((x) => x.inboxID !== inboxID);
              if (kept.length !== n[k].length) {
                changed = true;
                if (kept.length) n[k] = kept;
                else delete n[k];
              }
            }
            return changed ? n : p;
          });
          if (isActive()) say("Queued message cancelled.");
          break;
        }
        case "permission.asked":
        case "permission.replied":
          // Keep the whole team's "needs you" state accurate, not just the
          // chat on screen - that's what makes it feel like colleagues.
          if (sid) loadPerms(sid);
          break;
        case "session.created":
          refreshSessions();
          break;
        case "session.deleted": {
          // The chat is gone - prune everything keyed by it so deleted
          // sessions don't leave state behind for the app's lifetime.
          if (sid) {
            clearWatchdog(sid);
            delete turns.current[sid];
            setSessionBusy(sid, false);
            syncNeedsYou(sid, false);
            markSeen(sid);
            setModelsBySession((prev) => {
              if (!(sid in prev)) return prev;
              const n = { ...prev };
              delete n[sid];
              return n;
            });
            replacePending((prev) => {
              if (!(sid in prev)) return prev;
              const n = { ...prev };
              delete n[sid];
              return n;
            });
            replaceLive((prev) => {
              if (!(sid in prev)) return prev;
              const n = { ...prev };
              delete n[sid];
              return n;
            });
          }
          refreshSessions();
          break;
        }
        default:
          if (CATALOG_EVENTS.has(e.type)) refreshCatalogs();
      }
    };

    const connect = async () => {
      while (!stopped) {
        try {
          const res = await fetch(`${baseUrl()}/api/event`, {
            headers: { Accept: "text/event-stream", ...authHeaders() },
            signal: ctl.signal,
          });
          if (!res.ok || !res.body) throw new Error(`event stream ${res.status}`);
          const reader = res.body.getReader();
          const dec = new TextDecoder();
          let buf = "";
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += dec.decode(value, { stream: true });
            const frames = buf.split("\n\n");
            buf = frames.pop() ?? "";
            for (const f of frames) {
              const line = f.split("\n").find((l) => l.startsWith("data:"));
              if (!line) continue;
              try {
                // Wire boundary: SSE frames are JSON of the SDK's event union.
                handleEvent(JSON.parse(line.slice(5).trim()) as V2Event);
              } catch {}
            }
          }
        } catch (e) {
          if (stopped || (e as Error).name === "AbortError") return;
          console.warn("event stream ended:", (e as Error).message);
        }
        if (stopped) return;
        // Stream dropped (harness restarted?) - resync, then reconnect.
        refreshSessions();
        const sid = activeIDRef.current;
        if (sid) {
          dropFeed(sid);
          loadThread(sid);
          loadPerms(sid);
        }
        await sleep(1500);
      }
    };

    /** Boot: surface pre-existing "waiting on you" states across the team. */
    const seedStatuses = async () => {
      try {
        const r = await client.session.list();
        for (const s of r.data) {
          if (s.metadata?.kind !== "dm") continue;
          loadPerms(s.id);
          // Mid-turn heuristic: activity after the last idle marker means the
          // bot was working when the UI last went away.
          const t = s.time;
          if (t.idle && t.updated > t.idle) {
            setSessionBusy(s.id, true);
            armWatchdog(s.id);
          }
        }
      } catch {}
    };

    (async () => {
      // Desktop boot: Rust owns the harness URL + per-boot password. Browsers
      // skip this (invoke rejects) and use the env vars run.sh exported.
      await resolveTauriHarness();
      refreshSessions();
      refreshCatalogs();
      seedStatuses();
      connect();
    })();

    return () => {
      stopped = true;
      ctl.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Stick to the bottom while streaming - but only when already near it, so
  // reading back through history doesn't get yanked down by every update.
  const lastScrollSession = useRef<string | null>(null);
  useEffect(() => {
    const el = threadRef.current;
    if (!el) return;
    const switched = lastScrollSession.current !== activeID;
    lastScrollSession.current = activeID;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 140;
    if (switched || nearBottom) el.scrollTop = el.scrollHeight;
  }, [msgs, busySessions, activeID, live, pending]);

  const busy = !!(activeID && busySessions[activeID]);

  // Elapsed clock for the working row - ticks only while a bot is working.
  useEffect(() => {
    if (!busy) return;
    setNow(Date.now());
    const iv = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(iv);
  }, [busy]);

  const autogrow = () => {
    const ta = taRef.current;
    if (ta) {
      ta.style.height = "auto";
      ta.style.height = Math.min(ta.scrollHeight, 200) + "px";
    }
  };

  const botMeta = (id?: string | null): BotMeta | undefined => bots.find((b) => b.id === id);

  const meta = botMeta(activeBot);
  /** Roster order: locally remembered, newest first. Unknown bots trail. */
  const orderedBots = (() => {
    const byID = new Map(bots.map((b) => [b.id, b] as const));
    const out: BotMeta[] = [];
    for (const id of botOrder) {
      const b = byID.get(id);
      if (b) {
        out.push(b);
        byID.delete(id);
      }
    }
    for (const b of bots) if (byID.delete(b.id)) out.push(b);
    return out;
  })();
  /** A fresh bot with no name yet - it introduces itself and waits for a task. */
  const untitled = !!activeBot && /^untitled(?:-\d+)?$/.test(activeBot) && !botNames[activeBot];
  const model = activeID ? modelsBySession[activeID] ?? "" : "";

  const senderOf = (m: ChatMsg): { name: string; seed: string; user: boolean; col?: string } => {
    if (m.role === "user") return { name: "You", seed: "you", user: true };
    const id = m.agent ?? activeBot ?? "bot";
    const b = botMeta(m.agent ?? activeBot);
    return { name: botLabel(id), seed: id, user: false, col: b?.color };
  };

  const permVerb = (a: string): string =>
    ({
      shell: "run a command", edit: "change files", read: "read files",
      glob: "find files", grep: "search in files", websearch: "search the web",
      webfetch: "fetch a web page", skill: "load a skill", subagent: "start a helper bot",
      write: "write a file", patch: "patch files",
    }[a] ?? a);

  // Optimistic "you" bubbles still on their way into the stored thread.
  const pendList = (activeID && pending[activeID]) || [];
  const pendTop = pendList.filter((p) => !p.queued);
  const pendQueued = pendList.filter((p) => p.queued);

  // Live turn feed for the chat on screen, minus strokes the stored thread
  // already covers (mid-turn resyncs can leave both present).
  const liveKeys = new Set(msgs.map((m) => m.key));
  const storedTexts = new Set(msgs.filter((m) => m.role === "assistant").map((m) => m.text.trim()));
  const feed = ((activeID && live[activeID]) || []).filter((x) =>
    x.kind === "text" ? !!x.text.trim() && !storedTexts.has(x.text.trim()) : !liveKeys.has(x.key));

  // Group the conversation into display rows: messages stand alone, runs of
  // tool calls become one "N steps" line (a browser task can fire dozens).
  const rows: DisplayRow[] = [];
  const pushTool = (it: ToolItem) => {
    const last = rows[rows.length - 1];
    if (last?.kind === "tools") {
      const prev = last.items[last.items.length - 1];
      if (prev.text === it.text && prev.refs.join(" ") === it.refs.join(" ")) {
        last.items[last.items.length - 1] = { ...prev, rep: (prev.rep ?? 1) + 1 };
      } else last.items.push(it);
      return;
    }
    rows.push({ kind: "tools", key: `tg-${it.key}`, items: [it] });
  };
  for (const m of msgs) {
    if (m.role === "tool") {
      pushTool({
        key: m.key,
        name: m.tool ?? m.text.split(" ")[0] ?? "tool",
        text: m.text,
        refs: m.mcps ?? [],
        state: m.err ? "error" : "done",
        rep: m.rep,
      });
    } else rows.push({ kind: "msg", m, tkey: m.key });
  }
  for (const x of feed) {
    if (x.kind === "text") {
      rows.push({
        kind: "msg",
        m: { role: "assistant", text: x.text, key: `f-${x.key}`, agent: activeBot ?? undefined },
        tkey: `f-${x.key}`,
        streamed: true,
      });
    } else {
      pushTool({ key: x.key, name: x.name, text: x.text, refs: x.refs, state: x.state });
    }
  }

  let lastDay = "";
  let lastSender = "";
  const stream: React.ReactNode[] = [];
  rows.forEach((row) => {
    const day = row.kind === "msg" ? dayLabel(row.m.time) : "";
    if (day && day !== lastDay) {
      lastDay = day;
      lastSender = "";
      stream.push(<div key={`day-${row.kind === "msg" ? row.tkey : row.key}`} className="day-div"><span>{day}</span></div>);
    }
    if (row.kind === "tools") {
      const single = row.items.length === 1 ? row.items[0] : null;
      if (single) {
        stream.push(
          <div key={row.key} className="slack-msg compact tool-row">
            <div className="slack-body">
              <span className={`tool-line${single.state === "error" ? " err" : ""}`}>
                {single.state === "running" ? <span className="run-dot" /> : <IconActivity size={12} />} {single.text}
                {!!single.refs.length && (
                  <span className="mcp-refs">
                    {single.refs.map((r) => <span key={r} className="mcp-ref">{r}</span>)}
                  </span>
                )}
                {!!single.rep && single.rep > 1 && <span className="rep-badge">×{single.rep}</span>}
              </span>
            </div>
          </div>,
        );
        return;
      }
      const open = openClusters.has(row.key);
      const running = row.items.some((x) => x.state === "running");
      const anyErr = row.items.some((x) => x.state === "error");
      const lastIt = row.items[row.items.length - 1];
      stream.push(
        <div key={row.key} className="slack-msg compact tool-row">
          <div className="slack-body">
            <button
              className={`tool-cluster${open ? " open" : ""}${anyErr ? " err" : ""}`}
              onClick={() => toggleCluster(row.key)}
              title={open ? "Hide the steps" : "Show every step"}
            >
              {running ? <span className="run-dot" /> : <IconActivity size={12} />}
              <span>{row.items.length} steps</span>
              <span className="tc-hint">{toolPhrase(lastIt.name, lastIt.refs)}</span>
              <IconChevronDown size={12} className="chev" />
            </button>
            {open && (
              <div className="tool-steps">
                {row.items.map((x, i) => (
                  <span key={`${x.key}-${i}`} className={`tool-line${x.state === "error" ? " err" : ""}`}>
                    <IconActivity size={11} /> {x.text}
                    {!!x.refs.length && (
                      <span className="mcp-refs">
                        {x.refs.map((r) => <span key={r} className="mcp-ref">{r}</span>)}
                      </span>
                    )}
                    {!!x.rep && x.rep > 1 && <span className="rep-badge">×{x.rep}</span>}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>,
      );
      return;
    }
    const { m, streamed } = row;
    const s = senderOf(m);
    const skey = `${m.role}:${s.name}`;
    const compact = skey === lastSender;
    lastSender = skey;
    if (m.role === "user") {
      // Your side: a tinted bubble on the right, clock above it. No avatar -
      // in a solo human/machine thread it would only be noise.
      stream.push(
        <div key={row.tkey} className="slack-msg from-user">
          <div className="slack-body">
            <div className="slack-head user-head">
              {m.queued && <span className="queued-tag">queued</span>}
              <span className="time">{fmtTime(m.time)}</span>
            </div>
            <div className="slack-text plain bubble">{m.text}</div>
          </div>
        </div>,
      );
      return;
    }
    stream.push(
      <div key={row.tkey} className={`slack-msg ${compact ? "compact" : ""}${streamed ? " live" : ""}`}>
        {!compact ? (
          <div className="avatar">
            <BotAvatar seed={s.seed} color={s.col} size={36} />
          </div>
        ) : (
          <div className="avatar-ghost">{fmtTime(m.time)}</div>
        )}
        <div className="slack-body">
          {!compact && (
            <div className="slack-head">
              <strong>{s.name}</strong>
              <span className="time">{streamed ? "now" : fmtTime(m.time)}</span>
            </div>
          )}
          <div className="slack-text" dangerouslySetInnerHTML={{ __html: renderMarkdown(m.text, !streamed) }} />
          {!streamed && (
            <div className="msg-actions">
              <button onClick={() => copy(m.text, m.key)} title="Copy">{votes[`c:${m.key}`] ? <IconCheck size={14} /> : <IconCopy size={14} />}</button>
              <button className={votes[m.key] === 1 ? "lit" : ""} onClick={() => vote(m.key, 1)} title="Good response"><IconThumbsUp size={14} /></button>
              <button className={votes[m.key] === -1 ? "lit" : ""} onClick={() => vote(m.key, -1)} title="Bad response"><IconThumbsDown size={14} /></button>
            </div>
          )}
        </div>
      </div>,
    );
  });

  // The "working" row - current activity + elapsed time. Clusters stay
  // collapsed so long tool runs don't flood the chat; this row narrates
  // what's happening right now.
  let runningTool: ToolItem | undefined;
  for (const row of rows) {
    if (row.kind !== "tools") continue;
    for (const it of row.items) if (it.state === "running") runningTool = it;
  }
  const streamedText = feed.some((x) => x.kind === "text");
  const activity = runningTool ? toolPhrase(runningTool.name, runningTool.refs) : streamedText ? "writing" : "thinking";
  const startT = activeID ? turns.current[activeID] : undefined;
  const elapsed = busy && startT ? fmtClock(now - startT) : "";

  const renderPending = (p: ChatMsg) => (
    <div key={p.key} className="slack-msg from-user live">
      <div className="slack-body">
        <div className="slack-head user-head">
          {p.queued && <span className="queued-tag">queued</span>}
          <span className="time">{fmtTime(p.time)}</span>
          {p.queued && p.inboxID && (
            <button className="queued-cancel" onClick={() => cancelQueued(p)} title="Remove from the queue">
              Cancel
            </button>
          )}
        </div>
        <div className="slack-text plain bubble">{p.text}</div>
      </div>
    </div>
  );

  const composer = (
    <div className="composer">
      <textarea
        ref={taRef}
        rows={1}
        value={input}
        onChange={(e) => { setInput(e.target.value); autogrow(); }}
        placeholder={activeBot ? `Give ${botLabel(activeBot)} a task…` : "Pick a bot first"}
        disabled={!activeBot}
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
      />
      <div className="composer-bar">
        {busy && <span className="composer-hint">Working. Additional messages are queued.</span>}
        <span className="spacer" />
        {busy && <button className="send-btn stop" onClick={interrupt} title="Stop"><IconStop size={13} /></button>}
        <button
          className={`send-btn ${input.trim() ? "ready" : ""}`}
          onClick={() => send()}
          disabled={!input.trim() || !activeBot}
          title={busy ? "Queue this message" : "Send"}
        >
          <IconArrowUp size={16} />
        </button>
      </div>
    </div>
  );

  return (
    <div className="layout">
      <aside className="side">
        <div className="brand">
          <span className="brand-mark"><IconMark size={28} /></span>
          <b>Muster</b>
          <span className="status"><span className={`pulse ${harnessOk ? "" : "down"}`} />{harnessOk ? "online" : "offline"}</span>
        </div>
        <button className="newbot-btn" onClick={createQuickBot} disabled={creating}>
          <IconPlus size={15} /> {creating ? "Creating…" : "New bot"}
        </button>
        <nav>
          <div className="sec-label">Your team</div>
          <ul>
            {orderedBots.map((b) => {
              // Roster status: who's mid-task, who needs your OK, who replied.
              const sid = sessions.find((s) => s.kind === "dm" && s.bot === b.id)?.id;
              const st = sid
                ? busySessions[sid] ? "working" : needsYou[sid] ? "needs-you" : unread[sid] ? "done" : ""
                : "";
              const stText =
                st === "working" ? "working on a task" :
                st === "needs-you" ? "needs your approval" :
                st === "done" ? "new reply while you were away" : "";
              return (
                <li key={b.id}>
                  <div
                    className={`bot-row ${activeBot === b.id ? "active" : ""} ${st === "needs-you" ? "needs" : ""}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => openBot(b.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        openBot(b.id);
                      }
                    }}
                    title={[b.description ?? botLabel(b.id), stText].filter(Boolean).join(": ")}
                  >
                    <BotAvatar
                      seed={b.id}
                      color={b.color}
                      size={38}
                      status={st === "working" || st === "needs-you" || st === "done" ? st : undefined}
                    />
                    <span className="bot-copy">
                      <span className="nm">{botLabel(b.id)}</span>
                      <span className="bot-sub">{stText || b.description || "Ready for a task"}</span>
                    </span>
                    <button
                      className="gear" title={`${b.id} settings`} aria-label={`${b.id} settings`}
                      onClick={(e) => { e.stopPropagation(); setSettingsBot(b.id); }}
                    >
                      <IconGear size={14} />
                    </button>
                  </div>
                </li>
              );
            })}
            {bots.length === 0 && (
              <li><button className="bot-row" onClick={createQuickBot} disabled={creating}>Create your first bot</button></li>
            )}
          </ul>
          {disabledBots.length > 0 && (
            <>
              <div className="sec-label">Disabled</div>
              <ul>
                {disabledBots.map((b) => (
                  <li key={b.id}>
                    <button
                      className="bot-row off"
                      onClick={() => setSettingsBot(b.id)}
                      title={`${b.description ?? b.id} is disabled. Open settings to re-enable.`}
                    >
                      <BotAvatar seed={b.id} color={b.color} size={34} />
                      <span className="bot-copy">
                        <span className="nm">{botLabel(b.id)}</span>
                        <span className="bot-sub">Disabled</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
          <div className="sec-label" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span>Tools</span>
            <button className="mini-btn" title="Manage tools" aria-label="Manage tools" onClick={() => setToolsOpen(true)}>
              <IconPlus size={13} />
            </button>
          </div>
          <ul>
            {tools.map((t) => {
              const st = t.status.status;
              const col = st === "connected" ? "var(--green)" : st === "needs_auth" || st === "pending" ? "var(--amber)" : "var(--red)";
              return (
                <li key={t.name}>
                  <button className="bot-row" onClick={() => setToolsOpen(true)} title={`${t.name}: ${mcpStatusLabel(st)}`}>
                    <span className="pulse" style={{ background: col }} />
                    <span className="nm">{t.name}</span>
                  </button>
                </li>
              );
            })}
            {tools.length === 0 && (
              <li><button className="bot-row dim" onClick={() => setMarketOpen(true)}>Connect Gmail, GitHub…</button></li>
            )}
            <li>
              <button className="bot-row" onClick={() => setMarketOpen(true)} title="Connectors, plugins and skills">
                <IconStore size={15} />
                <span className="nm">Marketplace</span>
              </button>
            </li>
          </ul>
        </nav>
        <footer className="side-foot">
          <span className="side-status">{harnessOk ? "Ready. Bots keep working in the background" : "Starting up…"}</span>
        </footer>
      </aside>

      <div className="main">
        {!activeBot ? (
          <div className="hero">
            <div className="hero-inner">
              <span className="brand-mark" style={{ width: 52, height: 52 }}><IconMark size={52} /></span>
              <h1>Talk to your bots</h1>
              <div className="lede">
                {bots.length === 0
                  ? "Describe what you need. Your bot gets a name automatically and opens in chat."
                  : "Pick a bot and give it a task. It keeps working while you're away."}
              </div>
              {bots.length > 0 && (
                <div className="bot-grid">
                  {orderedBots.map((b) => (
                    <button key={b.id} className="bot-card-btn" onClick={() => openBot(b.id)}>
                      <BotAvatar seed={b.id} color={b.color} size={46} />
                      <span style={{ minWidth: 0 }}><b>{botLabel(b.id)}</b><span>{b.description || "Ready for a task"}</span></span>
                    </button>
                  ))}
                </div>
              )}
              <div className="create-row">
                <button className="btn-primary" onClick={createQuickBot} disabled={creating}>
                  <IconPlus size={15} /> {creating ? "Creating…" : bots.length === 0 ? "Create your first bot" : "New bot"}
                </button>
              </div>
              <div className="hint" style={{ marginTop: 6 }}>One click. It says hi, then takes its name from your first task.</div>
            </div>
          </div>
        ) : (
          <>
            <div className="topbar">
              <BotAvatar seed={activeBot} color={meta?.color} size={36} status={busy ? "working" : undefined} />
              <div className="who">
                <button className="name-btn" title="Rename / edit this bot" onClick={() => setSettingsBot(activeBot)}>
                  <strong>{botLabel(activeBot)}</strong>
                </button>
                {meta?.description && <span className="dim">{meta.description}</span>}
              </div>
              <span className="spacer" />
              <span className="model-mini" title="Model for this chat">
                <select value={model} onChange={(e) => switchModel(e.target.value)} aria-label="Model for this chat">
                  <option value="">Automatic</option>
                  {models.map((m) => <option key={m.key} value={m.key}>{m.key}</option>)}
                </select>
                <IconChevronDown size={12} />
              </span>
            </div>
            {perms.length > 0 && (
              <div className="perm">
                {perms.map((p) => (
                  <div key={p.id} className="perm-row">
                    <span><strong>{botLabel(activeBot)}</strong> wants to {permVerb(p.action)}{p.resources?.length ? `: ${p.resources.join(" ")}` : ""}{p.message ? `. ${p.message}` : ""}</span>
                    <span className="acts">
                      <button onClick={() => replyPerm(p.id, "once")}>Allow</button>
                      <button onClick={() => replyPerm(p.id, "always")}>Always</button>
                      <button className="deny" onClick={() => replyPerm(p.id, "reject")}>Deny</button>
                    </span>
                  </div>
                ))}
              </div>
            )}
            {msgs.length === 0 && !busy && pendList.length === 0 ? (
              <div className="hero">
                <div className="hero-inner">
                  <BotAvatar seed={activeBot} color={meta?.color} size={72} />
                  {untitled ? (
                    <>
                      <h1>Hi, I'm <strong>{botLabel(activeBot)}</strong></h1>
                      <div className="lede">What should we work on? Give me a task and I'll take my name from it.</div>
                    </>
                  ) : (
                    <>
                      <h1>Talk to <strong>{botLabel(activeBot)}</strong></h1>
                      {meta?.description && <div className="lede">{meta.description}</div>}
                    </>
                  )}
                  {composer}
                  {statusMsg && <div className="status-line">{statusMsg}</div>}
                  <div className="suggest">
                    {STARTERS.map((s) => <button key={s} onClick={() => send(s)}>{s}</button>)}
                  </div>
                </div>
              </div>
            ) : (
              <>
                <div className="thread" ref={threadRef}>
                  {stream}
                  {pendTop.map(renderPending)}
                  {busy && (
                    <div className="slack-msg compact live" key="working">
                      <div className="avatar-ghost" />
                      <div className="slack-body">
                        <span className="working-label">
                          <span className="run-dot" style={meta?.color ? { background: meta.color } : undefined} />
                          <span className="wl-bot">{botLabel(activeBot)}</span>
                          <span className="wl-act">is {activity}</span>
                          {elapsed && <span className="wl-clock">· {elapsed}</span>}
                        </span>
                      </div>
                    </div>
                  )}
                  {pendQueued.map(renderPending)}
                </div>
                <div className="composer-dock">
                  {composer}
                  {statusMsg && <div className="status-line">{statusMsg}</div>}
                </div>
                <div className="foot">{botLabel(activeBot)} keeps working while you're away</div>
              </>
            )}
          </>
        )}
      </div>

      {settingsBot && (
        <ErrorBoundary key={settingsBot} label="bot settings" onClose={() => setSettingsBot(null)}>
          <BotSettings
            botId={settingsBot}
            displayName={botNames[settingsBot] ?? ""}
            models={models.map((m) => m.key)}
            onDisplayNameChange={(name) => setBotDisplayName(settingsBot, name)}
            onClose={() => setSettingsBot(null)}
            onChanged={() => { refreshCatalogs(); refreshSessions(); }}
            onDeleted={(id) => {
              forgetBotLocal(id);
              if (activeBot === id) {
                setActiveSession(null, null);
                setMsgs([]);
                setPerms([]);
                replaceLive(() => ({}));
              }
            }}
            onRenamed={(from, to) => {
              migrateBotLocal(from, to);
              if (activeBot === from) setActiveBot(to);
              refreshSessions();
            }}
          />
        </ErrorBoundary>
      )}

      {toolsOpen && (
        <ErrorBoundary key="tools" label="tools" onClose={() => setToolsOpen(false)}>
          <Tools onClose={() => setToolsOpen(false)} onChanged={() => { refreshCatalogs(); }} />
        </ErrorBoundary>
      )}

      {marketOpen && (
        <ErrorBoundary key="market" label="marketplace" onClose={() => setMarketOpen(false)}>
          <Marketplace onClose={() => setMarketOpen(false)} onChanged={() => { refreshCatalogs(); }} />
        </ErrorBoundary>
      )}
    </div>
  );
}
