import { useEffect, useState } from "react";
import type { McpServer, SkillInfo } from "@opencode/client";
import {
  deleteBot,
  listMcp,
  listSkills,
  mcpStatusLabel,
  normServer,
  parseBotFile,
  readBotFile,
  renameBotHistory,
  saveBot,
  setBotDisabled,
  slugify,
  type BotDraft,
  type PermRule,
} from "./lib/bots";
import { IconBan, IconSave, IconTrash, IconX } from "./icons";
import { workspaceDir } from "./lib/opencode";
import { useEscape } from "./lib/useEscape";

/**
 * Bot settings drawer: edit one bot (system prompt, skills, MCP, advanced).
 * Rendered as a right-side overlay from the sidebar gear icon.
 */
export function BotSettings({ botId, models, onClose, onChanged, onDeleted, onRenamed }: {
  botId: string;
  models: string[];
  onClose: () => void;
  onChanged: () => void;
  onDeleted: (botId: string) => void;
  onRenamed?: (from: string, to: string) => void;
}) {
  const [draft, setDraft] = useState<BotDraft | null>(null);
  const [unknown, setUnknown] = useState<string[]>([]);
  const [rules, setRules] = useState<PermRule[]>([]);
  const [allSkills, setAllSkills] = useState<SkillInfo[]>([]);
  const [allMcp, setAllMcp] = useState<McpServer[]>([]);
  const [status, setStatus] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const ws = workspaceDir();

  useEscape(onClose);

  useEffect(() => {
    (async () => {
      setAllSkills(await listSkills());
      setAllMcp(await listMcp());
      const src = await readBotFile(botId);
      if (src == null) {
        setStatus(`Could not open settings for ${botId}.`);
        return;
      }
      const { known, unknownLines, system } = parseBotFile(src);
      setDraft({
        name: botId,
        description: known.description ?? "",
        mode: known.mode ?? "primary",
        model: known.model ?? "",
        color: known.color ?? "",
        system,
        disabled: known.disabled ?? false,
        skills: known.skills ?? [],
        mcp: known.mcp ?? {},
      });
      setUnknown(unknownLines);
      setRules(known.rules ?? []);
    })();
  }, [botId]);

  const save = async () => {
    if (!draft) return;
    const target = slugify(draft.name);
    if (!target) {
      setStatus("Enter a name — a single word such as “coach” works.");
      return;
    }
    if (target !== botId && (await readBotFile(target)) != null) {
      setStatus(`A bot named “${target}” already exists. Choose a different name.`);
      return;
    }
    try {
      setStatus("Saving…");
      await saveBot(draft, unknown, rules, botId);
      if (target !== botId) {
        await renameBotHistory(botId, target);
        onRenamed?.(botId, target);
      }
      setStatus("");
      onChanged();
      onClose();
    } catch (e) {
      setStatus(`Could not save: ${(e as Error).message}`);
    }
  };

  const toggleDisabled = async () => {
    if (!draft) return;
    try {
      setStatus(draft.disabled ? "Enabling…" : "Disabling…");
      await setBotDisabled(botId, !draft.disabled);
      onChanged();
      onClose();
    } catch (e) {
      setStatus(`Could not update this bot: ${(e as Error).message}`);
    }
  };

  const remove = async () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      setStatus("Click Delete again to confirm — this cannot be undone.");
      return;
    }
    try {
      setStatus("Deleting…");
      await deleteBot(botId);
      onChanged();
      onDeleted(botId);
      onClose();
    } catch (e) {
      setConfirmDelete(false);
      setStatus(`Could not delete: ${(e as Error).message}`);
    }
  };

  if (!ws) return null;

  return (
    <>
      <div className="drawer-veil" onClick={onClose} />
      <div className="drawer">
        <div className="drawer-head">
          <b>{botId} settings</b>
          <button className="icon-btn" onClick={onClose} title="Close"><IconX size={16} /></button>
        </div>
        <div className="drawer-body">
          {status && <div className="hint">{status}</div>}
          {draft && (
            <>
              <label>Name
                <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="coach" />
              </label>
              {draft.name !== botId && (
                <div className="hint">Renaming keeps this bot's chat history. You can also keep the current name.</div>
              )}
              <label>What this bot is for
                <input value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} placeholder="e.g. Reviews my code and explains it" />
              </label>
              <label>System prompt
                <textarea rows={7} value={draft.system} onChange={(e) => setDraft({ ...draft, system: e.target.value })} placeholder="You are an experienced coach. Keep answers short and practical." />
              </label>
              <div className="bot-section">
                <strong>Skills</strong>
                {draft.skills.length === 0 ? (
                  <div className="hint">All skills are enabled by default, including ones added later. Turn one off to manage the list manually.</div>
                ) : (
                  <div className="hint">
                    Manual selection. <button className="link-btn" onClick={() => setDraft({ ...draft, skills: [] })}>Restore default (all enabled)</button>
                  </div>
                )}
                {allSkills.length === 0 && <div className="hint">No skills installed yet.</div>}
                {allSkills.map((s) => {
                  const id = s.id;
                  const label = s.name;
                  const on = draft.skills.length === 0 || draft.skills.includes(id);
                  return (
                    <label key={id} className="check">
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => {
                          if (draft.skills.length === 0) {
                            // Leaving default mode: materialize "all minus this one".
                            const allIds = allSkills.map((x) => x.id);
                            setDraft({ ...draft, skills: allIds.filter((x) => x !== id) });
                          } else {
                            setDraft({
                              ...draft,
                              skills: on ? draft.skills.filter((x) => x !== id) : [...draft.skills, id],
                            });
                          }
                        }}
                      />
                      <span><strong>{label}</strong>{s.description ? ` — ${s.description}` : ""}</span>
                    </label>
                  );
                })}
              </div>
              <div className="bot-section">
                <strong>Tools (MCP)</strong>
                {Object.keys(draft.mcp).length === 0 && (
                  <div className="hint">All tools are allowed by default. Set a tool to Deny to block it.</div>
                )}
                {allMcp.length === 0 && <div className="hint">No tools connected yet. Add one from Tools in the sidebar first.</div>}
                {allMcp.map((m) => {
                  const name = m.name;
                  const st = m.status.status;
                  const cur = draft.mcp[name] ?? draft.mcp[normServer(name)];
                  const setAccess = (v: "allow" | "deny" | undefined) => {
                    const next = { ...draft.mcp };
                    delete next[name];
                    delete next[normServer(name)];
                    if (v) next[name] = v;
                    setDraft({ ...draft, mcp: next });
                  };
                  return (
                    <div key={name} className="mcp-row">
                      <span><strong>{name}</strong> <span className="dim">{mcpStatusLabel(st)}</span></span>
                      <span className="tri" role="group" aria-label={`${name} access`}>
                        {(["default", "allow", "deny"] as const).map((v) => {
                          const on = v === "default" ? cur === undefined : cur === v;
                          return (
                            <button
                              key={v}
                              className={`${v}${on ? " on" : ""}`}
                              aria-pressed={on}
                              title={v === "default" ? "Inherit the global setting" : v === "allow" ? "Always allow this tool" : "Always block this tool"}
                              onClick={() => setAccess(v === "default" ? undefined : v)}
                            >
                              {v === "default" ? "Default" : v === "allow" ? "Allow" : "Deny"}
                            </button>
                          );
                        })}
                      </span>
                    </div>
                  );
                })}
              </div>
              <details>
                <summary>Advanced</summary>
                <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 10 }}>
                  <label>Model
                    <select value={draft.model} onChange={(e) => setDraft({ ...draft, model: e.target.value })}>
                      <option value="">Automatic</option>
                      {models.map((mm) => <option key={mm} value={mm}>{mm}</option>)}
                    </select>
                  </label>
                  <label>Accent color
                    <input type="color" value={draft.color || "#5b8cff"} onChange={(e) => setDraft({ ...draft, color: e.target.value })} />
                  </label>
                  {unknown.length > 0 && <div className="hint">Kept unchanged: <code>{unknown.join(" · ")}</code></div>}
                </div>
              </details>
            </>
          )}
        </div>
        <div className="drawer-foot">
          <button className="btn-primary" onClick={save}><IconSave size={14} /> Save</button>
          <button className="btn-ghost" onClick={toggleDisabled}>
            <IconBan size={14} /> {draft?.disabled ? "Enable" : "Disable"}
          </button>
          <button
            className="btn-danger"
            onClick={remove}
            onBlur={() => setConfirmDelete(false)}
            title="Permanently delete this bot"
          >
            <IconTrash size={14} /> {confirmDelete ? "Confirm delete" : "Delete"}
          </button>
        </div>
      </div>
    </>
  );
}
