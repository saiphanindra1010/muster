/**
 * Bot faces: a small crew of shapes that blink and glance.
 *
 * The app mark stays the four-dot brand. A bot is a face. The shape and
 * color are chosen when the bot is created and stored on this machine
 * (`muster.faces.v1`). A bot with no saved face gets a stable one from its id.
 */

import { useSyncExternalStore } from "react";

export const FACE_SHAPES = [
  "round", "pebble", "square", "soft", "clover", "flower",
  "blob", "cloud", "tall", "drop", "gem", "star",
] as const;

export type FaceShape = (typeof FACE_SHAPES)[number];

/** The picker palette. White first, then the warm-to-cool row. */
export const FACE_COLORS = [
  "#f4f4f5", "#c4956a", "#ef4444", "#f97316", "#f5a524", "#22c55e",
  "#14b8a6", "#3b82f6", "#a855f7", "#ec4899", "#9ca3af",
] as const;

export type Face = { shape: FaceShape; color: string };

const STORAGE_KEY = "muster.faces.v1";

export type BotPresence = "working" | "needs-you" | "done";

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function validFace(value: unknown): value is Face {
  if (!value || typeof value !== "object") return false;
  const face = value as Face;
  return (FACE_SHAPES as readonly string[]).includes(face.shape)
    && /^#[0-9a-fA-F]{6}$/.test(face.color);
}

function loadFaces(): Record<string, Face> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const out: Record<string, Face> = {};
    for (const [id, face] of Object.entries(parsed)) {
      if (validFace(face)) out[id] = face;
    }
    return out;
  } catch {
    return {};
  }
}

let faces = loadFaces();
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(faces));
  } catch {
    /* a private window can refuse storage; the face still shows this session */
  }
  emit();
}

export function subscribeFaces(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getFaceSnapshot(): Record<string, Face> {
  return faces;
}

/** Saved face, or a stable one derived from the bot id. */
export function faceFor(id: string, saved: Record<string, Face> = faces): Face {
  const known = saved[id];
  if (known) return known;
  const h = hash(id || "?");
  return {
    shape: FACE_SHAPES[h % FACE_SHAPES.length],
    color: FACE_COLORS[(h >>> 8) % FACE_COLORS.length],
  };
}

export function setFace(id: string, face: Face) {
  if (!validFace(face)) return;
  faces = { ...faces, [id]: face };
  persist();
}

export function renameFace(from: string, to: string) {
  if (!faces[from] || from === to) return;
  const next = { ...faces, [to]: faces[from] };
  delete next[from];
  faces = next;
  persist();
}

export function forgetFace(id: string) {
  if (!faces[id]) return;
  const next = { ...faces };
  delete next[id];
  faces = next;
  persist();
}

/** A random face for the create dialog, so a new bot doesn't always start the same. */
export function randomFace(): Face {
  return {
    shape: FACE_SHAPES[Math.floor(Math.random() * FACE_SHAPES.length)],
    color: FACE_COLORS[Math.floor(Math.random() * FACE_COLORS.length)],
  };
}

/** Eyes are a darker shade of the face. A near-white face gets dark eyes. */
function eyeColor(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  if ((0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.72) return "#2a2a2a";
  const ch = (v: number) => Math.round(v * 0.55).toString(16).padStart(2, "0");
  return `#${ch(r)}${ch(g)}${ch(b)}`;
}

function starPoints(points: number, outer: number, inner: number): string {
  const pts: string[] = [];
  for (let i = 0; i < points * 2; i++) {
    const radius = i % 2 === 0 ? outer : inner;
    const angle = (Math.PI / points) * i - Math.PI / 2;
    pts.push(`${60 + radius * Math.cos(angle)},${62 + radius * Math.sin(angle)}`);
  }
  return pts.join(" ");
}

function FaceBody({ shape, color }: { shape: FaceShape; color: string }) {
  switch (shape) {
    case "round":
      return <circle className="face-body" cx="60" cy="62" r="46" fill={color} />;
    case "pebble":
      return <ellipse className="face-body" cx="60" cy="64" rx="50" ry="36" fill={color} />;
    case "square":
      return <rect className="face-body" x="16" y="18" width="88" height="88" rx="22" fill={color} />;
    case "soft":
      return <rect className="face-body" x="14" y="16" width="92" height="92" rx="40" fill={color} />;
    case "clover":
      return (
        <g className="face-body" fill={color}>
          <circle cx="60" cy="32" r="26" />
          <circle cx="32" cy="62" r="26" />
          <circle cx="88" cy="62" r="26" />
          <circle cx="60" cy="90" r="26" />
        </g>
      );
    case "flower":
      return (
        <g className="face-body" fill={color}>
          {[0, 72, 144, 216, 288].map((deg) => {
            const a = ((deg - 90) * Math.PI) / 180;
            return <circle key={deg} cx={60 + Math.cos(a) * 22} cy={62 + Math.sin(a) * 22} r="22" />;
          })}
          <circle cx="60" cy="62" r="18" />
        </g>
      );
    case "blob":
      return (
        <path
          className="face-body"
          fill={color}
          d="M60 14C92 12 110 36 106 64C102 94 80 112 52 106C22 100 8 74 16 46C24 20 34 16 60 14Z"
        />
      );
    case "cloud":
      return (
        <path
          className="face-body"
          fill={color}
          d="M36 82C16 82 10 62 26 54C22 32 46 26 58 42C68 24 98 30 98 52C116 54 114 82 92 82Z"
        />
      );
    case "tall":
      return <ellipse className="face-body" cx="60" cy="62" rx="34" ry="48" fill={color} />;
    case "drop":
      return (
        <path
          className="face-body"
          fill={color}
          d="M60 12C60 12 104 56 104 78C104 102 84 112 60 112C36 112 16 102 16 78C16 56 60 12 60 12Z"
        />
      );
    case "gem":
      return <polygon className="face-body" fill={color} points="60,12 104,46 86,108 34,108 16,46" />;
    case "star":
      return <polygon className="face-body" fill={color} points={starPoints(5, 50, 26)} />;
    default:
      return <circle className="face-body" cx="60" cy="62" r="46" fill={color} />;
  }
}

export function FaceGraphic({ shape, color }: { shape: FaceShape; color: string }) {
  const eyes = eyeColor(color);
  return (
    <svg viewBox="0 0 120 120" aria-hidden="true">
      <FaceBody shape={shape} color={color} />
      <g className="face-eyes" fill={eyes}>
        <rect className="face-eye" x="42" y="50" width="12" height="26" rx="6" />
        <rect className="face-eye" x="66" y="50" width="12" height="26" rx="6" />
      </g>
    </svg>
  );
}

export function FacePicker({ value, onChange }: {
  value: Face;
  onChange: (face: Face) => void;
}) {
  return (
    <div className="face-picker">
      <div className="face-grid">
        {FACE_SHAPES.map((shape) => (
          <button
            key={shape}
            type="button"
            className={`face-pick${value.shape === shape ? " on" : ""}`}
            aria-pressed={value.shape === shape}
            aria-label={shape}
            onClick={() => onChange({ ...value, shape })}
          >
            <FaceGraphic shape={shape} color={value.color} />
          </button>
        ))}
      </div>
      <div className="color-row">
        {FACE_COLORS.map((color) => (
          <button
            key={color}
            type="button"
            className={`color-dot${value.color.toLowerCase() === color ? " on" : ""}`}
            style={{ background: color }}
            aria-pressed={value.color.toLowerCase() === color}
            aria-label={color}
            onClick={() => onChange({ ...value, color })}
          />
        ))}
      </div>
    </div>
  );
}

export function BotAvatar({ seed, size = 32, status }: {
  seed: string;
  name?: string;
  color?: string;
  size?: number;
  status?: BotPresence;
}) {
  const saved = useSyncExternalStore(subscribeFaces, getFaceSnapshot, getFaceSnapshot);
  const face = faceFor(seed, saved);
  const delay = `${(hash(seed || "?") % 28) / 10}s`;
  return (
    <span
      className={`bot-avatar${status ? ` st-${status}` : ""}`}
      style={{ width: size, height: size, ["--face-delay" as string]: delay }}
      aria-hidden
    >
      <FaceGraphic shape={face.shape} color={face.color} />
      {status && <span className={`presence ${status}`} />}
    </span>
  );
}
