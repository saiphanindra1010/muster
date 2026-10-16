import { useEffect, useMemo, useState } from "react";
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
import {
  IconBook,
  IconExternal,
  IconPackage,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconStore,
  IconWrench,
  IconX,
} from "./icons";

const KIND_LABEL: Record<MarketKind, string> = { mcp: "Connector", plugin: "Plugin", skill: "Skill" };

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
 * Marketplace modal — connectors (MCP), plugins and skills in one store.
 * Everything installs the same way: a workspace file/config edit plus a
 * location reload, so entries persist and survive restarts.
 */
export function Marketplace({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const items = useMemo(() => catalog(), []);
  const [cfg, setCfg] = useState<ConfigView | null>(null);
  const [state, setState] = useState<MarketState | null>(null);
  const [tab, setTab] = useState<"all" | MarketKind>("all");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [confirm, setConfirm] = useState<string | null>(null);
  const [tokens, setTokens] = useState<Record<string, string>>({});
  const [custom, setCustom] = useState("");

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
  useEffect(() => {
    if (!installing) return;
    const t = window.setInterval(() => {
      refresh().catch(() => {});
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
          extra.push({ id: name, kind: "mcp", name, description: "Connected outside the marketplace." });
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
            extra.push({ id: s, kind: "skill", name: s, description: "Skill in the workspace." });
          }
        }
      }
    }
    return [...items, ...extra];
  }, [items, cfg, state]);

  const visible = all.filter((i) => {
    if (tab !== "all" && i.kind !== tab) return false;
    const hay = `${i.name} ${i.description} ${(i.tags ?? []).join(" ")} ${i.id}`.toLowerCase();
    return !q.trim() || hay.includes(q.trim().toLowerCase());
  });

  const Card = ({ item }: { item: MarketItem }) => {
    const inst = !!cfg && !!state && isInstalled(cfg, state, item);
    const mcpSt = item.kind === "mcp" ? state?.mcp.get(item.id) : undefined;
    const pkg = item.plugin?.package;
    const pluginSt = pkg ? state?.plugins.get(pkg) : undefined;
    const isBusy = busy === item.id;
    const tok = item.mcp?.token;
    return (
      <div className="mkt-card">
        <div className="mkt-head">
          <span className={`mkt-ic ${item.kind}`}>
            <KindIcon kind={item.kind} />
          </span>
          <span className="mkt-title">
            <strong>{item.name}</strong>
            <span className="mkt-kind">{KIND_LABEL[item.kind]}</span>
            {item.homepage && (
              <a
                className="mkt-link"
                href={item.homepage}
                target="_blank"
                rel="noreferrer"
                title="Homepage"
                onClick={(e) => e.stopPropagation()}
              >
                <IconExternal size={12} />
              </a>
            )}
          </span>
          <span className="mkt-actions">
            {inst ? (
              <>
                {item.kind === "mcp" && <McpChip st={mcpSt} />}
                {item.kind === "plugin" && (
                  <span className={`mkt-chip ${pluginSt?.status === "active" ? "ok" : "warn"}`}>
                    {pluginSt?.status === "active"
                      ? `Active${pluginSt.version ? ` · ${pluginSt.version}` : ""}`
                      : "Installing…"}
                  </span>
                )}
                {item.kind === "skill" && <span className="mkt-chip ok">Installed</span>}
                <button
                  className="mkt-btn"
                  onClick={() => {
                    if (confirm !== item.id) {
                      setConfirm(item.id);
                      return;
                    }
                    setConfirm(null);
                    run(item.id, () => uninstallItem(item));
                  }}
                  onBlur={() => setConfirm(null)}
                  disabled={!!busy}
                >
                  {confirm === item.id ? "Confirm remove" : "Remove"}
                </button>
              </>
            ) : (
              <button
                className="mkt-btn primary"
                onClick={() => run(item.id, () => installItem(item, tokens[item.id]))}
                disabled={!!busy || (!!tok && !tokens[item.id]?.trim())}
                title={tok ? `${tok.label} required` : undefined}
              >
                {isBusy ? <IconRefresh size={13} className="spin" /> : <IconPlus size={13} />} Install
              </button>
            )}
          </span>
        </div>
        <p className="mkt-desc">{item.description}</p>
        {tok && !inst && (
          <label className="mkt-token">
            <span>{tok.label}</span>
            <input
              type="password"
              value={tokens[item.id] ?? ""}
              placeholder={tok.placeholder ?? ""}
              onChange={(e) => setTokens({ ...tokens, [item.id]: e.target.value })}
            />
          </label>
        )}
        {tok && !inst && tok.help && <div className="mkt-note">{tok.help}</div>}
        {item.mcp?.signin && inst && mcpSt?.status === "needs_auth" && (
          <div className="mkt-note">
            Finish OAuth sign-in from OpenCode: <code>/mcps</code> → {item.id} (or{" "}
            <code>opencode mcp auth {item.id}</code>).
          </div>
        )}
        {(item.requires?.length ?? 0) > 0 && !inst && <div className="mkt-note">Needs {item.requires!.join(", ")}</div>}
        {(item.tags?.length ?? 0) > 0 && (
          <div className="mkt-foot">
            {item.tags!.map((t) => (
              <span key={t} className="mkt-tag">
                {t}
              </span>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="modal-veil" onClick={onClose}>
      <div className="modal" style={{ width: "min(680px, 100%)" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span className="mkt-hero">
            <IconStore size={15} />
          </span>
          <h3 style={{ margin: 0, flex: 1 }}>Marketplace</h3>
          <button className="icon-btn" onClick={onClose} title="Close">
            <IconX size={16} />
          </button>
        </div>
        <p className="mkt-sub">
          Connectors, plugins and skills for your bots — one click to install, stored in your workspace.
        </p>
        <div className="mkt-bar">
          <span className="mkt-search">
            <IconSearch size={14} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" />
          </span>
          <span className="mkt-tabs">
            {(["all", "mcp", "plugin", "skill"] as const).map((k) => (
              <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>
                {k === "all" ? "All" : KIND_LABEL[k]}
              </button>
            ))}
          </span>
        </div>
        <div className="mkt-grid">
          {!cfg && <div className="hint">Loading…</div>}
          {cfg && visible.map((i) => <Card key={`${i.kind}:${i.id}`} item={i} />)}
          {cfg && visible.length === 0 && <div className="hint">Nothing matches.</div>}
          {cfg && tab !== "skill" && tab !== "mcp" && (
            <div className="mkt-custom">
              <span className="mkt-note" style={{ flex: 1 }}>
                Add any npm plugin by name
              </span>
              <input
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
                placeholder="opencode-plugin-name"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && custom.trim()) {
                    run(custom.trim(), () => installItem(customPluginItem(custom.trim())));
                    setCustom("");
                  }
                }}
              />
              <button
                className="mkt-btn"
                disabled={!!busy || !custom.trim()}
                onClick={() => {
                  run(custom.trim(), () => installItem(customPluginItem(custom.trim())));
                  setCustom("");
                }}
              >
                Add
              </button>
            </div>
          )}
        </div>
        {err && <div className="err">{err}</div>}
      </div>
    </div>
  );
}
