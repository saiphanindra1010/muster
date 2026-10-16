import { useEffect, useRef, useState } from "react";
import { authHeaders, baseUrl, client, resolveTauriHarness, sessionLocation } from "./lib/opencode";
import { activateBotSkills, createBotFromPrompt, listBots, listDisabledBots, listMcp, resolveBotSkills, upgradeBotPersonas } from "./lib/bots";
import {
  IconActivity, IconArrowUp, IconBot, IconCheck, IconChevronDown, IconCopy,
  IconGear, IconPlus, IconStore, IconStop, IconThumbsDown, IconThumbsUp,
  IconUser,
} from "./icons";
import { BotAvatar } from "./avatar";
import { BotSettings } from "./Bots";
import { ErrorBoundary } from "./ErrorBoundary";
import { Tools } from "./Tools";
import { Marketplace } from "./Marketplace";

type Session = { id: string; kind?: string; bot?: string };
type ChatMsg = {
  role: "user" | "assistant" | "tool"; text: string; key: string;
  time?: number; agent?: string;
};
type ModelOpt = { key: string; providerID: string; id: string };
type BotMeta = { id: string; color?: string; description?: string };

const STARTERS = [
  "Introduce yourself",
  "Remember that I like short answers",
  "What skills do you have?",
  "What can you do here?",
];

/** How long without ANY event before we assume a turn was dropped. */
const WATCHDOG_MS = 100_000;

/** Events that mean "the bot is alive" — reset the per-session watchdog. */
const ACTIVITY_EVENTS = new Set([
  "session.text.started", "session.text.delta", "session.text.ended",
  "session.tool.called", "session.tool.progress", "session.tool.success", "session.tool.failed",
  "session.step.started", "session.step.streamed", "session.usage.updated",
  "session.execution.started",
]);

/** Events that mean a catalog (bots/tools/models/skills) may have changed. */
const CATALOG_EVENTS = new Set([
  "agent.updated", "config.updated", "skill.updated",
  "mcp.status.changed", "mcp.resources.changed",
  "model.updated", "provider.updated", "worktree.resolved", "project.updated",
]);

/** Tiny dependency-free markdown-lite: code fences, inline code, bold, paragraphs. */
export function mdLite(src: string): string {
  const esc = src.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const blocks: string[] = [];
  const fenced = esc.replace(/```(\w*)\n([\s\S]*?)(```|$)/g, (_, lang, code) => {
    blocks.push(`<pre><code>${code.replace(/^\n|\n$/g, "")}</code></pre>`);
    return `\u0000${blocks.length - 1}\u0000`;
  });
  return fenced
    .split(/\n{2,}/)
    .map((para) =>
      para
        .replace(/`([^`\n]+)`/g, "<code>$1</code>")
        .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
        .replace(/\n/g, "<br/>"),
    )
    .join("<br/><br/>")
    .replace(/\u0000(\d+)\u0000/g, (_, i) => blocks[Number(i)] ?? "");
}

function fmtTime(ts?: number): string {
  if (!ts) return "";
  return new Date(ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
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
  const [tools, setTools] = useState<any[]>([]);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [marketOpen, setMarketOpen] = useState(false);
  const [activeID, setActiveID] = useState<string | null>(null);
  const [activeBot, setActiveBot] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [models, setModels] = useState<ModelOpt[]>([]);
  const [modelsBySession, setModelsBySession] = useState<Record<string, string>>({});
  const [busySessions, setBusySessions] = useState<Record<string, boolean>>({});
  const [perms, setPerms] = useState<any[]>([]);
  const [votes, setVotes] = useState<Record<string, 1 | -1>>({});
  const [harnessOk, setHarnessOk] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");
  const [live, setLive] = useState<Record<string, string>>({});
  // Team status per session: who needs your approval, who has new replies.
  const [needsYou, setNeedsYou] = useState<Record<string, boolean>>({});
  const [unread, setUnread] = useState<Record<string, boolean>>({});
  const [modal, setModal] = useState<{ text: string; err: string } | null>(null);
  const [newBotText, setNewBotText] = useState("");
  const [creating, setCreating] = useState(false);
  const [settingsBot, setSettingsBot] = useState<string | null>(null);
  const statusTimer = useRef<any>(null);
  const watchdogs = useRef<Record<string, any>>({});
  const busyRef = useRef<Record<string, boolean>>({});
  const activeIDRef = useRef<string | null>(null);
  const threadRef = useRef<HTMLDivElement | null>(null);
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  const say = (msg: string) => {
    setStatusMsg(msg);
    clearTimeout(statusTimer.current);
    if (msg) statusTimer.current = setTimeout(() => setStatusMsg(""), 8000);
  };

  const setActiveSession = (id: string | null, bot: string | null) => {
    activeIDRef.current = id;
    setActiveID(id);
    setActiveBot(bot);
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

  /** A chat you just opened is "seen" — clears its roster dot. */
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
      setSessionBusy(sid, false);
      if (sid === activeIDRef.current) {
        say("No activity for a while — reloading the thread. The harness may have dropped this turn.");
        loadThread(sid);
        loadPerms(sid);
      }
    }, WATCHDOG_MS);
  };

  const refreshSessions = async () => {
    try {
      const r: any = await client.session.list();
      const list: any[] = r?.data ?? r?.sessions ?? r ?? [];
      setSessions(
        list.map((s: any) => ({
          id: s.id ?? s.ID,
          kind: s.metadata?.kind,
          bot: s.metadata?.bot,
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
      const m: any = await client.model.list();
      const data: any[] = m?.data ?? m?.models ?? m ?? [];
      setModels(
        data
          .filter((x) => x?.providerID && (x?.modelID ?? x?.id))
          .map((x) => ({ key: `${x.providerID}/${x.modelID ?? x.id}`, providerID: x.providerID, id: x.modelID ?? x.id })),
      );
    } catch {}
    try {
      const bl: any[] = await listBots();
      setBots(bl.map((b: any) => ({
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

  // One-time: fill in the colleague persona for bots created before it existed.
  const personasUpgraded = useRef(false);
  useEffect(() => {
    if (!harnessOk || personasUpgraded.current) return;
    personasUpgraded.current = true;
    upgradeBotPersonas()
      .then((n) => {
        if (n) refreshCatalogs();
      })
      .catch((e) => console.warn("persona upgrade failed:", e));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [harnessOk]);

  const loadThread = async (id: string) => {
    try {
      const r: any = await client.message.list({ sessionID: id });
      const all: any[] = r?.data ?? r?.messages ?? r ?? [];
      // The harness returns newest-first; chats read oldest-first.
      const ordered = all
        .map((m, i) => ({ m, t: m?.time?.created ?? 0, i }))
        .sort((a, b) => a.t - b.t || a.i - b.i)
        .map((x) => x.m);
      const out: ChatMsg[] = [];
      for (const m of ordered) {
        if (m.type === "user" && m.text) {
          out.push({ role: "user", text: m.text, key: m.id ?? Math.random().toString(), time: m.time?.created });
        } else if (m.type === "assistant") {
          for (const p of m.content ?? []) {
            if (p.type === "text" && p.text) out.push({ role: "assistant", text: p.text, key: p.id ?? `${m.id}-${out.length}`, time: m.time?.created ?? m.time?.streamed, agent: m.agent });
            // NOTE: reasoning parts are the model's internal chain-of-thought —
            // deliberately not rendered. Only final text + tool activity show.
            else if (p.type === "tool") out.push({ role: "tool", text: `${p.name ?? p.tool ?? "tool"} ${((p.input ?? p.args ?? "") && JSON.stringify(p.input ?? p.args).slice(0, 200)) || ""}`, key: p.id ?? `${m.id}-${out.length}`, time: m.time?.created, agent: m.agent });
          }
        }
      }
      setMsgs(out);
      // Drop live-stream buffers superseded by stored messages.
      const keys = new Set(out.map((mm) => mm.key));
      setLive((prev) => {
        const n = { ...prev };
        for (const k of Object.keys(n)) if (keys.has(k)) delete n[k];
        return n;
      });
    } catch {}
  };

  const loadPerms = async (id: string) => {
    try {
      const r: any = await (client as any).permission.list({ sessionID: id });
      const list: any[] = r?.data ?? r ?? [];
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
      await (client as any).permission.reply({ sessionID: id, requestID, decision });
      loadPerms(id);
    } catch (e) {
      say(`Permission reply failed: ${(e as Error).message}`);
    }
  };

  const syncSessionModel = async (id: string) => {
    try {
      const s: any = await client.session.get({ sessionID: id });
      const mm = s?.model ?? s?.data?.model;
      if (mm?.providerID && mm?.id) {
        setModelsBySession((prev) => ({ ...prev, [id]: `${mm.providerID}/${mm.id}` }));
      }
    } catch {}
  };

  /** Open a bot chat, creating its session on first contact. */
  const openBot = async (botID: string) => {
    const existing = sessions.find((s) => s.kind === "dm" && s.bot === botID);
    if (existing) {
      setActiveSession(existing.id, botID);
      markSeen(existing.id);
      setMsgs([]);
      setPerms([]);
      setLive({});
      loadThread(existing.id);
      loadPerms(existing.id);
      syncSessionModel(existing.id);
      return;
    }
    try {
      const s: any = await client.session.create({
        location: sessionLocation(),
        agent: botID,
        title: botID,
        metadata: { kind: "dm", bot: botID },
      } as any);
      try {
        await activateBotSkills(s.id, await resolveBotSkills(botID));
      } catch {}
      setActiveSession(s.id, botID);
      setMsgs([]);
      setPerms([]);
      setLive({});
      refreshSessions();
      setTimeout(() => taRef.current?.focus(), 50);
    } catch (e) {
      say(`Could not open ${botID}: ${(e as Error).message}`);
    }
  };

  /**
   * One-thought bot creation: whatever the user typed becomes the bot. Name is
   * derived from the text (or "helper" for an empty prompt) and stored — the
   * user can click the name in settings to change it later.
   */
  const createBot = async (raw: string) => {
    if (creating) return;
    setCreating(true);
    try {
      const slug = await createBotFromPrompt(raw);
      setModal(null);
      setNewBotText("");
      refreshCatalogs();
      await openBot(slug);
    } catch (e) {
      const msg = `Create failed: ${(e as Error).message}`;
      setModal((m) => (m ? { ...m, err: msg } : m));
      if (!modal) say(msg);
    } finally {
      setCreating(false);
    }
  };

  const send = async (text?: string) => {
    const t = (text ?? input).trim();
    if (!t || !activeBot) return;
    let id = activeIDRef.current;
    if (!id) {
      try {
        const s: any = await client.session.create({
          location: sessionLocation(),
          agent: activeBot,
          metadata: { kind: "dm", bot: activeBot },
        } as any);
        id = s.id;
        setActiveSession(id, activeBot);
        try {
          await activateBotSkills(id!, await resolveBotSkills(activeBot));
        } catch {}
        refreshSessions();
      } catch (e) {
        say(`Could not start chat: ${(e as Error).message}`);
        return;
      }
    }
    const wasBusy = !!busyRef.current[id!];
    setMsgs((m) => [...m, { role: "user", text: t, key: Date.now().toString(), time: Date.now() }]);
    setInput("");
    requestAnimationFrame(autogrow);
    if (!wasBusy) setSessionBusy(id!, true);
    armWatchdog(id!);
    try {
      // The harness queues prompts sent mid-turn (inbox), so sending while
      // busy is safe — it runs right after the current turn.
      await client.session.prompt({ sessionID: id!, text: t } as any);
      if (wasBusy) say("Queued — runs after the current turn finishes.");
      await loadThread(id!);
    } catch (e) {
      clearWatchdog(id!);
      if (!wasBusy) setSessionBusy(id!, false);
      say(`Send failed: ${(e as Error).message}`);
      if (id) loadThread(id);
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
      say(`Model switch failed: ${(e as Error).message}`);
    }
  };

  useEffect(() => {
    let stopped = false;
    const ctl = new AbortController();
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

    const handleEvent = (e: any) => {
      const t: string = e.type ?? "";
      const d: any = e.data ?? {};
      const sid: string = d.sessionID ?? "";
      if (sid && ACTIVITY_EVENTS.has(t)) armWatchdog(sid);
      switch (t) {
        case "session.execution.started":
          if (sid) {
            setSessionBusy(sid, true);
            armWatchdog(sid);
          }
          break;
        case "session.execution.succeeded":
        case "session.execution.failed":
        case "session.execution.interrupted":
        case "session.idle":
          if (sid) {
            clearWatchdog(sid);
            setSessionBusy(sid, false);
            if (sid === activeIDRef.current) {
              loadThread(sid);
              loadPerms(sid);
            } else {
              // Finished while you were elsewhere — show a roster dot.
              setUnread((m) => (m[sid] ? m : { ...m, [sid]: true }));
            }
          }
          refreshSessions();
          break;
        case "session.text.delta":
          if (sid === activeIDRef.current && d.assistantMessageID && d.delta) {
            const id = d.assistantMessageID as string;
            const chunk = d.delta as string;
            setLive((prev) => ({ ...prev, [id]: (prev[id] ?? "") + chunk }));
          }
          break;
        case "session.text.ended":
          if (sid === activeIDRef.current) loadThread(sid);
          break;
        case "permission.asked":
        case "permission.replied":
          // Keep the whole team's "needs you" state accurate, not just the
          // chat on screen — that's what makes it feel like colleagues.
          if (sid) loadPerms(sid);
          break;
        case "session.created":
        case "session.deleted":
          refreshSessions();
          break;
        default:
          if (CATALOG_EVENTS.has(t)) refreshCatalogs();
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
                handleEvent(JSON.parse(line.slice(5).trim()));
              } catch {}
            }
          }
        } catch (e) {
          if (stopped || (e as Error).name === "AbortError") return;
          console.warn("event stream ended:", (e as Error).message);
        }
        if (stopped) return;
        // Stream dropped (harness restarted?) — resync, then reconnect.
        refreshSessions();
        const sid = activeIDRef.current;
        if (sid) {
          loadThread(sid);
          loadPerms(sid);
        }
        await sleep(1500);
      }
    };

    /** Boot: surface pre-existing "waiting on you" states across the team. */
    const seedStatuses = async () => {
      try {
        const r: any = await client.session.list();
        const list: any[] = r?.data ?? [];
        for (const s of list) {
          if (s?.metadata?.kind !== "dm") continue;
          loadPerms(s.id);
          // Mid-turn heuristic: activity after the last idle marker means the
          // bot was working when the UI last went away.
          const t = s.time ?? {};
          if (t.updated && t.idle && t.updated > t.idle) {
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

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight });
  }, [msgs, busySessions, activeID]);

  const busy = !!(activeID && busySessions[activeID]);

  // Polling fallback while the active bot works: guarantees replies appear
  // even if a stream event is missed.
  useEffect(() => {
    if (!busy || !activeID) return;
    const iv = setInterval(() => {
      loadThread(activeID);
      loadPerms(activeID);
    }, 3000);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, activeID]);

  const autogrow = () => {
    const ta = taRef.current;
    if (ta) {
      ta.style.height = "auto";
      ta.style.height = Math.min(ta.scrollHeight, 200) + "px";
    }
  };

  const botMeta = (id?: string | null): BotMeta | undefined => bots.find((b) => b.id === id);

  const meta = botMeta(activeBot);
  const model = activeID ? modelsBySession[activeID] ?? "" : "";

  const senderOf = (m: ChatMsg): { name: string; user: boolean; col?: string } => {
    if (m.role === "user") return { name: "You", user: true };
    const id = m.agent ?? activeBot ?? "bot";
    const b = botMeta(m.agent ?? activeBot);
    return { name: id, user: false, col: b?.color };
  };

  const permVerb = (a: string): string =>
    ({
      shell: "run a command", edit: "change files", read: "read files",
      glob: "find files", grep: "search in files", websearch: "search the web",
      webfetch: "fetch a web page", skill: "load a skill", subagent: "start a helper bot",
      write: "write a file", patch: "patch files",
    }[a] ?? a);

  const liveKeys = new Set(msgs.map((m) => m.key));
  const liveEntries = Object.entries(live).filter(([k, v]) => v && !liveKeys.has(k));
  const liveSender = senderOf({ role: "assistant", text: "", key: "live", agent: activeBot ?? undefined });

  let lastDay = "";
  let lastSender = "";
  const stream: React.ReactNode[] = [];
  msgs.forEach((m) => {
    const day = dayLabel(m.time);
    if (day && day !== lastDay) {
      lastDay = day;
      lastSender = "";
      stream.push(<div key={`day-${m.key}`} className="day-div"><span>{day}</span></div>);
    }
    if (m.role === "tool") {
      stream.push(
        <div key={m.key} className="slack-msg compact">
          <div className="slack-body"><span className="tool-line"><IconActivity size={12} /> {m.text}</span></div>
        </div>,
      );
      return;
    }
    const s = senderOf(m);
    const skey = `${m.role}:${s.name}`;
    const compact = skey === lastSender;
    lastSender = skey;
    stream.push(
      <div key={m.key} className={`slack-msg ${compact ? "compact" : ""}`}>
        {!compact ? (
          <div className="avatar">
            {s.user ? <IconUser size={22} /> : <BotAvatar seed={s.name} color={s.col} size={32} />}
          </div>
        ) : (
          <div className="avatar-ghost">{fmtTime(m.time)}</div>
        )}
        <div className="slack-body">
          {!compact && (
            <div className="slack-head">
              <strong>{s.name}</strong>
              <span className="time">{fmtTime(m.time)}</span>
            </div>
          )}
          {m.role === "user"
            ? <div className="slack-text">{m.text}</div>
            : <div className="slack-text" dangerouslySetInnerHTML={{ __html: mdLite(m.text) }} />}
          {m.role === "assistant" && (
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

  const composer = (
    <div className="composer">
      <textarea
        ref={taRef}
        rows={1}
        value={input}
        onChange={(e) => { setInput(e.target.value); autogrow(); }}
        placeholder={activeBot ? `Give ${activeBot} a task…` : "Pick a bot first"}
        disabled={!activeBot}
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
      />
      <div className="composer-bar">
        <span className="dim" style={{ paddingLeft: 8 }}>
          {busy ? "Working — your next message queues up" : "Replies stream live · bot remembers skills you teach it"}
        </span>
        <span className="spacer" />
        {busy
          ? <button className="send-btn ready" onClick={interrupt} title="Stop"><IconStop size={13} /></button>
          : <button className={`send-btn ${input.trim() ? "ready" : ""}`} onClick={() => send()} disabled={!input.trim() || !activeBot} title="Send"><IconArrowUp size={16} /></button>}
      </div>
    </div>
  );

  return (
    <div className="layout">
      <aside className="side">
        <div className="brand">
          <span className="brand-mark"><IconBot size={17} /></span>
          <b>openchat</b>
          <span className="status"><span className={`pulse ${harnessOk ? "" : "down"}`} />{harnessOk ? "online" : "offline"}</span>
        </div>
        <button className="newbot-btn" onClick={() => setModal({ text: "", err: "" })}>
          <IconPlus size={15} /> New bot
        </button>
        <nav>
          <div className="sec-label">Your team</div>
          <ul>
            {bots.map((b) => {
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
                  <button
                    className={`bot-row ${activeBot === b.id ? "active" : ""} ${st === "needs-you" ? "needs" : ""}`}
                    onClick={() => openBot(b.id)}
                    title={[b.description ?? b.id, stText].filter(Boolean).join(" — ")}
                  >
                    <span className="avatar small">
                      <BotAvatar seed={b.id} color={b.color} size={24} />
                    </span>
                    <span className="nm">{b.id}</span>
                    {st && <span className={`status-dot ${st}`} title={stText} />}
                    <span
                      className="gear" role="button" title={`${b.id} settings`}
                      onClick={(e) => { e.stopPropagation(); setSettingsBot(b.id); }}
                    >
                      <IconGear size={14} />
                    </span>
                  </button>
                </li>
              );
            })}
            {bots.length === 0 && (
              <li><button className="bot-row" onClick={() => setModal({ text: "", err: "" })}>Make your first bot</button></li>
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
                      title={`${b.description ?? b.id} — disabled. Open settings to re-enable.`}
                    >
                      <span className="avatar small">
                        <BotAvatar seed={b.id} color={b.color} size={24} />
                      </span>
                      <span className="nm">{b.id}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
          <div className="sec-label" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span>Tools</span>
            <button
              title="Manage tools"
              onClick={() => setToolsOpen(true)}
              style={{ background: "transparent", border: "none", color: "var(--faint)", cursor: "pointer", fontSize: 14, padding: "0 6px", borderRadius: 6 }}
            >
              <IconPlus size={13} />
            </button>
          </div>
          <ul>
            {tools.map((t: any) => {
              const st = typeof t.status === "string" ? t.status : t.status?.status ?? "?";
              const col = st === "connected" ? "#3ddc84" : st === "needs_auth" || st === "needs-auth" || st === "pending" ? "#ffbd59" : "#ff7b72";
              return (
                <li key={t.name}>
                  <button className="bot-row" onClick={() => setToolsOpen(true)} title={`${t.name} — ${st}`}>
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
        <footer>{harnessOk ? "Engine ready — bots run in the background" : "Waking up the team…"}</footer>
      </aside>

      <div className="main">
        {!activeBot ? (
          <div className="hero">
            <div className="hero-inner">
              <span className="brand-mark" style={{ width: 52, height: 52, borderRadius: 16 }}><IconBot size={28} /></span>
              <h1>Talk to your bots</h1>
              <div className="lede">
                {bots.length === 0
                  ? "Describe a bot below — it gets a name automatically and opens in chat."
                  : "Pick a bot and give it a task — they keep working while you're elsewhere."}
              </div>
              {bots.length > 0 && (
                <div className="bot-grid">
                  {bots.map((b) => (
                    <button key={b.id} className="bot-card-btn" onClick={() => openBot(b.id)}>
                      <BotAvatar seed={b.id} color={b.color} size={36} />
                      <span style={{ minWidth: 0 }}><b>{b.id}</b><span>{b.description || "No description yet"}</span></span>
                    </button>
                  ))}
                </div>
              )}
              <div className="create-row">
                <input
                  value={newBotText}
                  onChange={(e) => setNewBotText(e.target.value)}
                  placeholder={bots.length === 0 ? "e.g. help me plan trips" : "Describe a new bot…"}
                  autoFocus={bots.length === 0}
                  disabled={creating}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); createBot(newBotText); } }}
                />
                <button className="btn-primary" onClick={() => createBot(newBotText)} disabled={creating}>
                  <IconPlus size={15} /> {creating ? "Creating…" : "Create"}
                </button>
              </div>
              <div className="hint" style={{ marginTop: 6 }}>The name is picked for you — rename anytime by clicking it in the chat header.</div>
            </div>
          </div>
        ) : (
          <>
            <div className="topbar">
              <span className="avatar small">
                <BotAvatar seed={activeBot ?? "?"} color={meta?.color} size={24} />
              </span>
              <div className="who">
                <button className="name-btn" title="Rename / edit this bot" onClick={() => setSettingsBot(activeBot)}>
                  <strong>{activeBot}</strong>
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
                {perms.map((p: any) => (
                  <div key={p.id} className="perm-row">
                    <span><strong>{activeBot}</strong> wants to {permVerb(p.action)}{p.resources?.length ? `: ${p.resources.join(" ")}` : ""}{p.message ? ` — ${p.message}` : ""}</span>
                    <span className="acts">
                      <button onClick={() => replyPerm(p.id, "once")}>Allow</button>
                      <button onClick={() => replyPerm(p.id, "always")}>Always</button>
                      <button onClick={() => replyPerm(p.id, "reject")}>Deny</button>
                    </span>
                  </div>
                ))}
              </div>
            )}
            {msgs.length === 0 && !busy ? (
              <div className="hero">
                <div className="hero-inner">
                  <BotAvatar seed={activeBot ?? "?"} color={meta?.color} size={56} />
                  <h1>Talk to <strong>{activeBot}</strong></h1>
                  {meta?.description && <div className="lede">{meta.description}</div>}
                  {composer}
                  {statusMsg && <div className="status-line">{statusMsg}</div>}
                  <div className="suggest">
                    {STARTERS.map((s) => <button key={s} onClick={() => send(s)}>{s}</button>)}
                  </div>
                </div>
              </div>
            ) : (
              <>
                <div className="thread" ref={threadRef}>{stream}
                  {liveEntries.map(([k, text]) => (
                    <div key={k} className="slack-msg">
                      <div className="avatar" >
                        {liveSender.user ? <IconUser size={22} /> : <BotAvatar seed={liveSender.name} color={liveSender.col} size={32} />}
                      </div>
                      <div className="slack-body">
                        <div className="slack-head">
                          <strong>{liveSender.name}</strong>
                          <span className="time">now</span>
                        </div>
                        <div className="slack-text" dangerouslySetInnerHTML={{ __html: mdLite(text) }} />
                      </div>
                    </div>
                  ))}
                  {busy && msgs[msgs.length - 1]?.role === "user" && liveEntries.length === 0 && (
                    <div className="slack-msg">
                      <div className="avatar"><span className="spinner" /></div>
                      <div className="slack-body"><span className="dots"><i /><i /><i /></span></div>
                    </div>
                  )}
                </div>
                <div style={{ width: "min(760px, 100%)", margin: "0 auto", padding: "0 24px 10px" }}>
                  {composer}
                  {statusMsg && <div className="status-line">{statusMsg}</div>}
                </div>
                <div className="foot">{activeBot} runs on the background harness</div>
              </>
            )}
          </>
        )}
      </div>

      {modal && (
        <div className="modal-veil" onClick={() => !creating && setModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>New bot</h3>
            <p>Say what it should do — the name is picked for you and can be changed later.</p>
            <label>What should it do?
              <textarea
                autoFocus
                rows={3}
                value={modal.text}
                onChange={(e) => setModal({ ...modal, text: e.target.value })}
                placeholder="e.g. Review my code and explain things simply"
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); createBot(modal.text); } }}
              />
            </label>
            <div className="hint">Leave it empty for a general-purpose helper.</div>
            {modal.err && <div className="err">{modal.err}</div>}
            <div className="row">
              <button className="btn-ghost" onClick={() => setModal(null)} disabled={creating}>Cancel</button>
              <button className="btn-primary" onClick={() => createBot(modal.text)} disabled={creating}>
                {creating ? "Creating…" : "Create + chat"}
              </button>
            </div>
          </div>
        </div>
      )}

      {settingsBot && (
        <ErrorBoundary key={settingsBot} label="bot settings" onClose={() => setSettingsBot(null)}>
          <BotSettings
            botId={settingsBot}
            models={models.map((m) => m.key)}
            onClose={() => setSettingsBot(null)}
            onChanged={() => { refreshCatalogs(); refreshSessions(); }}
            onDeleted={(id) => {
              if (activeBot === id) {
                setActiveSession(null, null);
                setMsgs([]);
                setPerms([]);
                setLive({});
              }
            }}
            onRenamed={(from, to) => {
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
