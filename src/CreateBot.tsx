import { useState } from "react";
import { FaceGraphic, FacePicker, randomFace, type Face } from "./avatar";
import { IconX } from "./icons";
import { useEscape } from "./lib/useEscape";

/**
 * Create asks for a name and a face, then stops.
 * Nothing is saved until Create, and Create stays off while the name is empty.
 */
export function CreateBotDialog({ busy, onClose, onCreate }: {
  busy: boolean;
  onClose: () => void;
  onCreate: (input: { name: string; face: Face }) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [face, setFace] = useState<Face>(() => randomFace());
  const [error, setError] = useState("");
  const ready = name.trim().length > 0 && !busy;

  useEscape(onClose);

  const submit = async () => {
    if (!ready) return;
    setError("");
    try {
      await onCreate({ name: name.trim(), face });
    } catch (e) {
      setError((e as Error).message || "Could not create this bot.");
    }
  };

  return (
    <div className="modal-veil" onClick={busy ? undefined : onClose}>
      <div
        className="modal create-bot"
        role="dialog"
        aria-labelledby="create-bot-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h3 id="create-bot-title">Create new bot</h3>
          <button className="icon-btn" onClick={onClose} disabled={busy} title="Close"><IconX size={16} /></button>
        </div>
        <div className="face-stage">
          <span className="bot-avatar" style={{ width: 96, height: 96 }}>
            <FaceGraphic shape={face.shape} color={face.color} />
          </span>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <input
            autoFocus
            value={name}
            maxLength={40}
            placeholder="Name your bot"
            aria-label="Name your bot"
            onChange={(e) => setName(e.target.value)}
          />
          <FacePicker value={face} onChange={setFace} />
          {error && <div className="err">{error}</div>}
          <div className="row">
            <button type="button" className="btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={!ready}>
              {busy ? "Creating…" : "Create"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
