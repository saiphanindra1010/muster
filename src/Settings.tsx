import type { ReactNode } from "react";
import { IconMonitor, IconMoon, IconSun, IconX } from "./icons";
import { useEscape } from "./lib/useEscape";
import type { Appearance } from "./theme";

const OPTIONS: Array<{
  id: Appearance;
  label: string;
  hint: string;
  Icon: (p: { size?: number }) => ReactNode;
}> = [
  { id: "system", label: "System", hint: "Follow your desktop's setting", Icon: IconMonitor },
  { id: "light", label: "Light", hint: "Always light", Icon: IconSun },
  { id: "dark", label: "Dark", hint: "Always dark", Icon: IconMoon },
];

/**
 * App settings. Appearance is the first section — System follows the
 * desktop, Light and Dark pin it. Saved locally; painted pre-boot so the
 * app never flashes the wrong theme.
 */
export function Settings({
  appearance,
  onChange,
  onClose,
}: {
  appearance: Appearance;
  onChange: (a: Appearance) => void;
  onClose: () => void;
}) {
  useEscape(onClose);
  return (
    <div className="modal-veil" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>Settings</h3>
          <button className="icon-btn" onClick={onClose} title="Close" aria-label="Close">
            <IconX size={16} />
          </button>
        </div>
        <div className="bot-section">
          <strong>Appearance</strong>
          <div className="seg" role="radiogroup" aria-label="Appearance">
            {OPTIONS.map(({ id, label, hint, Icon }) => (
              <button
                key={id}
                role="radio"
                aria-checked={appearance === id}
                className={`seg-btn${appearance === id ? " on" : ""}`}
                onClick={() => onChange(id)}
                title={hint}
              >
                <Icon size={16} />
                <span>{label}</span>
              </button>
            ))}
          </div>
          <div className="hint">System follows your desktop's light or dark preference.</div>
        </div>
      </div>
    </div>
  );
}
