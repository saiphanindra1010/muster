import { useEffect, useState } from "react";
import { connectMcpServer, disconnectMcpServer, listMcp, slugify } from "./lib/bots";
import { installMcpServer, uninstallMcpServer } from "./lib/marketplace";
import { IconPlus, IconX } from "./icons";

function statusOf(s: any): { state: string; error?: string } {
  if (typeof s.status === "string") return { state: s.status };
  return { state: s.status?.status ?? "unknown", error: s.status?.error };
}

function statusColor(st: string): string {
  if (st === "connected") return "#3ddc84";
  if (st === "needs_auth" || st === "needs-auth" || st === "pending") return "#ffbd59";
  return "#ff7b72";
}

/**
 * Tools modal: connected MCP servers / plugins (Gmail-style connectors are
 * remote MCP servers), with connect / disconnect / remove and an add form.
 * Entries are written to the workspace opencode.jsonc so they persist.
 * Servers that need OAuth sign-in show a status — that flow runs in OpenCode
 * via /mcps for now.
 */
export function Tools({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const [servers, setServers] = useState<any[]>([]);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"local" | "remote">("remote");
  const [command, setCommand] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  const refresh = async () => {
    setServers(await listMcp());
  };

  useEffect(() => {
    refresh().catch((e) => setErr(`Could not load tools: ${(e as Error).message}`));
  }, []);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setErr("");
    try {
      await fn();
      await refresh();
      onChanged();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const add = () =>
    run(async () => {
      if (kind === "local") {
        const parts = command.trim().split(/\s+/).filter(Boolean);
        if (!name.trim() || parts.length === 0) throw new Error("Name and command are required.");
        await installMcpServer(slugify(name).replace(/\//g, "-"), { type: "local", command: parts });
      } else {
        if (!name.trim() || !url.trim()) throw new Error("Name and URL are required.");
        await installMcpServer(slugify(name).replace(/\//g, "-"), { type: "remote", url: url.trim() });
      }
      setName("");
      setCommand("");
      setUrl("");
    });

  return (
    <div className="modal-veil" onClick={onClose}>
      <div className="modal" style={{ width: "min(560px, 100%)" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <h3 style={{ margin: 0, flex: 1 }}>Tools</h3>
          <button className="icon-btn" onClick={onClose} title="Close"><IconX size={16} /></button>
        </div>
        <p>Connected servers and plugins. Servers that need sign-in show a status here — OAuth sign-in runs in OpenCode via <code>/mcps</code> for now.</p>
        {servers.length === 0 && <div className="hint">No tools connected yet — add one below.</div>}
        {servers.map((s: any) => {
          const { state: st, error } = statusOf(s);
          return (
            <div key={s.name} className="mcp-row" style={{ border: "1px solid var(--line-soft)", borderRadius: 12, padding: "9px 12px" }} title={error ? String(error).slice(0, 200) : undefined}>
              <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span className="pulse" style={{ background: statusColor(st) }} />
                <strong>{s.name}</strong>
                <span className="dim">{st === "needs_auth" || st === "needs-auth" ? "needs sign-in" : st}</span>
              </span>
              <span style={{ display: "flex", gap: 6 }}>
                {st !== "connected" && st !== "pending" && (
                  <button onClick={() => run(() => connectMcpServer(s.name))} disabled={busy}>Connect</button>
                )}
                {(st === "connected" || st === "pending") && (
                  <button onClick={() => run(() => disconnectMcpServer(s.name))} disabled={busy}>Stop</button>
                )}
                <button
                  onClick={() => {
                    if (confirmRemove !== s.name) {
                      setConfirmRemove(s.name);
                      return;
                    }
                    setConfirmRemove(null);
                    run(() => uninstallMcpServer(s.name));
                  }}
                  onBlur={() => setConfirmRemove(null)}
                  disabled={busy}
                >
                  {confirmRemove === s.name ? "Confirm remove" : "Remove"}
                </button>
              </span>
            </div>
          );
        })}
        <div className="bot-section">
          <strong>Add a tool</strong>
          <div style={{ display: "flex", gap: 6 }}>
            {(["remote", "local"] as const).map((k) => (
              <button
                key={k}
                onClick={() => setKind(k)}
                style={{
                  flex: 1, cursor: "pointer", borderRadius: 10, padding: "8px",
                  background: kind === k ? "var(--panel-2)" : "transparent",
                  color: kind === k ? "var(--txt)" : "var(--dim)",
                  border: `1px solid ${kind === k ? "var(--line)" : "var(--line-soft)"}`,
                }}
              >
                {k === "remote" ? "Remote URL" : "Local command"}
              </button>
            ))}
          </div>
          <label>Server name
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. gmail, github, context7" />
          </label>
          {kind === "remote" ? (
            <label>Server URL
              <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://mcp.example.com/mcp" />
            </label>
          ) : (
            <label>Command
              <input value={command} onChange={(e) => setCommand(e.target.value)} placeholder="npx -y @modelcontextprotocol/server-everything" />
            </label>
          )}
          <button className="btn-primary" onClick={add} disabled={busy} style={{ alignSelf: "flex-start" }}>
            <IconPlus size={14} /> {busy ? "Working…" : "Add tool"}
          </button>
        </div>
        {err && <div className="err">{err}</div>}
      </div>
    </div>
  );
}
