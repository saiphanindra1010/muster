import { useEffect, useMemo, useRef, useState } from "react";
import {
  catalog,
  customPluginItem,
  installItem,
  isInstalled,
  loadMarket,
  uninstallItem,
  type ConfigView,
  type MarketItem,
  type MarketKind,
  type MarketState,
} from "./lib/marketplace";
import { IconBook, IconPackage, IconSearch, IconWrench, IconX } from "./icons";
import {
  beginMcpSignIn,
  completeMcpSignIn,
  connectMcpServer,
  holdSignInTab,
  waitForMcpSignIn,
} from "./lib/bots";
import { AppLogo } from "./logos";
import { useEscape } from "./lib/useEscape";

/** The apps a person recognizes. Everything else stays under More. */
const APP_IDS = ["agent-browser", "github", "slack", "gmail", "google-chat", "teams", "discord", "sentry"];

const APP_NAME: Record<string, string> = { "agent-browser": "Browser" };

const APP_BLURB: Record<string, string> = {
  "agent-browser": "Opens a real Chrome window. Sign in once, and it remembers.",
  github: "Issues, pull requests, and code.",
  slack: "Read channels and reply.",
  gmail: "Read mail and draft replies.",
  "google-chat": "Read spaces and send messages.",
  teams: "Read chats and send messages.",
  discord: "Read channels and send messages.",
  sentry: "Look up errors and stack traces.",
};

/** Stop the install poll after this many tries (~10 min at 4s per tick). */
const INSTALL_POLL_MAX = 150;

function KindIcon({ kind, size = 15 }: { kind: MarketKind; size?: number }) {
  if (kind === "mcp") return <IconWrench size={size} />;
  if (kind === "plugin") return <IconPackage size={size} />;
  return <IconBook size={size} />;
}

function McpChip({ st }: { st?: { status: string; error?: string } }) {
  if (!st) return <span className="mkt-chip warn">Starting…</span>;
  const map: Record<string, { cls: string; label: string }> = {
    connected: { cls: "ok", label: "Connected" },
    needs_auth: { cls: "warn", label: "Sign-in needed" },
    needs_auth_manual: { cls: "warn", label: "Sign-in needed" },
    pending: { cls: "warn", label: "Starting…" },
    error: { cls: "err", label: "Error" },
  };
  const m = map[st.status] ?? { cls: "warn", label: st.status };
  return (
    <span className={`mkt-chip ${m.cls}`} title={st.error ? String(st.error).slice(0, 300) : undefined}>
      {m.label}
    </span>
  );
}

/**
 * Marketplace modal: connectors (MCP), plugins and skills in one store.
 * Everything installs the same way: a workspace file/config edit plus a
 * location reload, so entries persist and survive restarts.
 */
export function Marketplace({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const items = useMemo(() => catalog(), []);
  const [cfg, setCfg] = useState<ConfigView | null>(null);
  const [state, setState] = useState<MarketState | null>(null);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [confirm, setConfirm] = useState<string | null>(null);
  const [fieldVals, setFieldVals] = useState<Record<string, Record<string, string>>>({});
  const [custom, setCustom] = useState("");
  const [askId, setAskId] = useState<string | null>(null);
  const [codeAsk, setCodeAsk] = useState<{ itemId: string; integrationID: string; attemptID: string; hint: string } | null>(null);
  const [code, setCode] = useState("");

  useEscape(onClose);

  const refresh = async () => {
    const r = await loadMarket();
    setCfg(r.cfg);
    setState(r.state);
  };

  useEffect(() => {
    refresh().catch((e) => setErr((e as Error).message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // While npm packages are still installing in the background, poll quietly.
  const installing = useMemo(() => {
    if (!cfg || !state) return false;
    return cfg.plugins.some((p) => (state.plugins.get(p)?.status ?? "installing") !== "active");
  }, [cfg, state]);
  /** One refresh at a time - a slow call must not stack with the next tick. */
  const refreshing = useRef(false);
  useEffect(() => {
    if (!installing) return;
    let attempts = 0;
    const t = window.setInterval(() => {
      // Give up after ~10 minutes - a plugin that never turns active must
      // not keep this modal polling forever.
      if (++attempts > INSTALL_POLL_MAX) {
        window.clearInterval(t);
        return;
      }
      if (refreshing.current) return;
      refreshing.current = true;
      refresh()
        .catch(() => {})
        .finally(() => {
          refreshing.current = false;
        });
    }, 4000);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [installing]);

  const run = async (id: string, fn: () => Promise<void>) => {
    setBusy(id);
    setErr("");
    try {
      await fn();
      await refresh();
      onChanged();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy("");
    }
  };

  // Catalog plus anything installed outside the marketplace, so this modal
  // manages everything in one place.
  const all: MarketItem[] = useMemo(() => {
    const extra: MarketItem[] = [];
    if (cfg) {
      const catalogMcp = new Set(items.filter((i) => i.kind === "mcp").map((i) => i.id));
      for (const name of cfg.mcpServers) {
        if (!catalogMcp.has(name)) {
          extra.push({ id: name, kind: "mcp", name, description: "Connected from the workspace." });
        }
      }
      const catalogPkgs = new Set(items.filter((i) => i.plugin).map((i) => i.plugin!.package));
      for (const pkg of cfg.plugins) {
        if (!catalogPkgs.has(pkg)) extra.push(customPluginItem(pkg));
      }
      const catalogSkill = new Set(items.filter((i) => i.kind === "skill").map((i) => i.id));
      if (state) {
        for (const s of state.skills) {
          if (!catalogSkill.has(s)) {
            extra.push({ id: s, kind: "skill", name: s, description: "Workspace skill." });
          }
        }
      }
    }
    return [...items, ...extra];
  }, [items, cfg, state]);

  const matches = (i: MarketItem) => {
    const hay = `${APP_NAME[i.id] ?? i.name} ${APP_BLURB[i.id] ?? i.description} ${(i.tags ?? []).join(" ")}`.toLowerCase();
    return !q.trim() || hay.includes(q.trim().toLowerCase());
  };
  const byId = new Map(all.map((i) => [i.id, i]));
  const apps = APP_IDS.map((id) => byId.get(id)).filter((i): i is MarketItem => !!i && matches(i));
  const skills = all.filter((i) => i.kind === "skill" && matches(i));
  const more = all.filter((i) => i.kind !== "skill" && !APP_IDS.includes(i.id) && matches(i));

  const Tile = ({ item }: { item: MarketItem }) => {
    const inst = !!cfg && !!state && isInstalled(cfg, state, item);
    const mcpSt = item.kind === "mcp" ? state?.mcp.get(item.id) : undefined;
    const pluginSt = item.plugin ? state?.plugins.get(item.plugin.package) : undefined;
    const pluginBusy = item.kind === "plugin" && inst && pluginSt?.status !== "active";
    const isBusy = busy === item.id;
    const fields = item.mcp?.fields ?? [];
    const asking = askId === item.id;
    const missing = fields.some((_, i) => !(fieldVals[item.id]?.[String(i)] ?? "").trim());
    const needsSignIn = !!mcpSt?.integrationID && (mcpSt.status === "needs_auth" || mcpSt.status === "needs_auth_manual");
    const signIn = () => {
      const integrationID = mcpSt?.integrationID;
      if (!integrationID) return;
      const tab = holdSignInTab();
      run(item.id, async () => {
        let opened = false;
        try {
          const attempt = await beginMcpSignIn(integrationID);
          tab.go(attempt.url);
          opened = true;
          if (attempt.mode === "code") {
            setCodeAsk({
              itemId: item.id,
              integrationID,
              attemptID: attempt.attemptID,
              hint: attempt.instructions || "Paste the code from the sign-in page.",
            });
            setCode("");
            return;
          }
          await waitForMcpSignIn(integrationID, attempt.attemptID);
          await connectMcpServer(item.id);
        } catch (e) {
          if (!opened) tab.close();
          throw e;
        }
      });
    };
    const branded = APP_IDS.includes(item.id);
    const add = () => {
      if (fields.length && !asking) {
        setAskId(item.id);
        return;
      }
      if (missing) return;
      run(item.id, () => installItem(item, fieldVals[item.id]));
    };
    return (
      <div className="mkt-app">
        <span className="mkt-logo">{branded ? <AppLogo id={item.id} size={26} /> : <KindIcon kind={item.kind} size={18} />}</span>
        <span className="mkt-copy">
          <span className="mkt-name">
            <strong>{APP_NAME[item.id] ?? item.name}</strong>
            {inst ? (
              <span className="mkt-actions">
                {needsSignIn && (
                  <button className="mkt-btn primary" onClick={signIn} disabled={!!busy}>
                    {isBusy ? "Waiting…" : "Sign in"}
                  </button>
                )}
                <button
                  className={`mkt-btn${confirm === item.id || pluginBusy || needsSignIn ? "" : " done"}`}
                  onClick={() => {
                    if (confirm !== item.id) { setConfirm(item.id); return; }
                    setConfirm(null);
                    run(item.id, () => uninstallItem(item));
                  }}
                  onBlur={() => setConfirm(null)}
                  disabled={!!busy}
                >
                  {confirm === item.id ? "Remove?" : pluginBusy ? "Adding…" : needsSignIn ? "Remove" : "Added"}
                </button>
              </span>
            ) : (
              <button className="mkt-btn primary" onClick={add} disabled={!!busy || (asking && missing)}>
                {isBusy ? "Adding…" : asking ? "Connect" : "Add"}
              </button>
            )}
          </span>
          <span className="mkt-blurb">{APP_BLURB[item.id] ?? item.description}</span>
          {item.kind === "mcp" && mcpSt && mcpSt.status !== "connected" && <McpChip st={mcpSt} />}
        </span>
        {codeAsk?.itemId === item.id && (
          <label className="mkt-token">
            <span>{codeAsk.hint}</span>
            <input
              value={code}
              autoFocus
              placeholder="Paste the code"
              aria-label="Sign-in code"
              onChange={(e) => setCode(e.target.value)}
            />
            <button
              className="mkt-btn primary"
              disabled={!!busy || !code.trim()}
              onClick={() => run(item.id, async () => {
                await completeMcpSignIn(codeAsk.integrationID, codeAsk.attemptID, code);
                await connectMcpServer(item.id);
                setCodeAsk(null);
                setCode("");
              })}
            >
              Confirm
            </button>
          </label>
        )}
        {asking && !inst && fields.map((f, i) => (
          <label key={f.label} className="mkt-token">
            <span>{f.label}</span>
            <input
              type="password"
              autoFocus={i === 0}
              value={fieldVals[item.id]?.[String(i)] ?? ""}
              placeholder={f.placeholder ?? ""}
              aria-label={f.label}
              onChange={(e) => setFieldVals({
                ...fieldVals,
                [item.id]: { ...fieldVals[item.id], [String(i)]: e.target.value },
              })}
            />
          </label>
        ))}
      </div>
    );
  };

  return (
    <div className="modal-veil" onClick={onClose}>
      <div className="modal market" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <h3 style={{ margin: 0, flex: 1 }}>Apps</h3>
          <button className="icon-btn" onClick={onClose} title="Close">
            <IconX size={16} />
          </button>
        </div>
        <p className="mkt-sub">Add an app. Your bots can use it right away.</p>
        <div className="mkt-bar">
          <span className="mkt-search">
            <IconSearch size={14} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search apps" aria-label="Search apps" />
          </span>
        </div>
        <div className="mkt-scroll">
          {!cfg && <div className="hint">Loading…</div>}
          {cfg && apps.length > 0 && (
            <div className="mkt-apps">
              {apps.map((i) => <Tile key={i.id} item={i} />)}
            </div>
          )}
          {cfg && skills.length > 0 && (
            <div className="mkt-section">
              <h4>Skills</h4>
              <div className="mkt-apps">
                {skills.map((i) => <Tile key={i.id} item={i} />)}
              </div>
            </div>
          )}
          {cfg && apps.length === 0 && skills.length === 0 && more.length === 0 && <div className="hint">No matches.</div>}
          {cfg && (more.length > 0 || !q.trim()) && (
            <details className="mkt-more">
              <summary>More</summary>
              <div className="mkt-apps">
                {more.map((i) => <Tile key={`${i.kind}:${i.id}`} item={i} />)}
              </div>
              <div className="mkt-custom">
                <input
                  value={custom}
                  onChange={(e) => setCustom(e.target.value)}
                  placeholder="Add a package by name"
                  aria-label="Package name"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && custom.trim()) {
                      run(custom.trim(), () => installItem(customPluginItem(custom.trim())));
                      setCustom("");
                    }
                  }}
                />
                <button
                  className="mkt-btn primary"
                  disabled={!!busy || !custom.trim()}
                  onClick={() => {
                    run(custom.trim(), () => installItem(customPluginItem(custom.trim())));
                    setCustom("");
                  }}
                >
                  Add
                </button>
              </div>
            </details>
          )}
        </div>
        {err && <div className="err">{err}</div>}
      </div>
    </div>
  );
}
