import { createAvatar } from "@dicebear/core";
import { bottts } from "@dicebear/collection";

/**
 * Bot avatars: DiceBear "Bottts" robots on a solid jewel-tone squircle.
 * Same bot id -> same robot and tile, so a bot keeps its look across the
 * roster, chat header and message list.
 *
 * The style is curated on purpose: round heads, friendly eyes, smile mouths,
 * antenna or bulb tops, and no textures. Free Bottts can produce square heads,
 * grills, horns and camo, which made the roster feel noisy and cheap. The
 * jewel tiles give every bot a strong silhouette without a glow or pastel haze.
 *
 * Rendered as a data-URI <img> on purpose: every DiceBear SVG defines the same
 * `mask id="viewboxMask"`, so inlining several avatars straight into the page
 * would let their masks bleed into each other. An <img> keeps each avatar its
 * own isolated document.
 */

/** Deep tile colors. Reads as one crew, with enough range to tell bots apart. */
export const TILE_COLORS = [
  "#34347a", "#14505c", "#3f5220", "#6b4413",
  "#6b2440", "#432a72", "#154f47", "#6b3418",
];

/** Pale porcelain, ice and candy-metal bodies. Keeps every robot related. */
const BODY_COLORS = ["ffd5dc", "b6e3f4", "c0aede", "d1d4f9", "ffdfbf", "c1f0dc", "fef3c7", "dbeafe"];

const cache = new Map<string, string>();
/** Cap on cached avatars - any sane roster fits, so churn can't pin them. */
const CACHE_MAX = 500;

export type BotPresence = "working" | "needs-you" | "done";

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function avatarUri(seed: string): string {
  const key = seed || "?";
  let uri = cache.get(key);
  if (!uri) {
    uri = createAvatar(bottts, {
      seed: key,
      scale: 92,
      backgroundColor: ["transparent"],
      sides: ["round", "antenna01", "antenna02", "cables01", "cables02"],
      face: ["round01", "round02"],
      eyes: ["round", "happy", "sensor", "roundFrame01", "roundFrame02", "glow", "eva"],
      mouth: ["smile01", "smile02"],
      top: ["antenna", "antennaCrooked", "bulb01", "glowingBulb01", "glowingBulb02", "radar"],
      texture: [],
      baseColor: BODY_COLORS,
    }).toDataUri();
    if (cache.size > CACHE_MAX) cache.clear();
    cache.set(key, uri);
  }
  return uri;
}

/**
 * Darken a bright accent so it reads as the same jewel material as the
 * curated palette. Deep colors pass through untouched.
 */
function deepTile(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255;
  let g = (n >> 8) & 255;
  let b = n & 255;
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  if (lum <= 0.36) return hex;
  const k = 0.36 / lum;
  r = Math.round(r * k);
  g = Math.round(g * k);
  b = Math.round(b * k);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

function tileFor(seed: string, color?: string): string {
  if (color && /^#[0-9a-fA-F]{6}$/.test(color)) return deepTile(color);
  return TILE_COLORS[hash(seed || "?") % TILE_COLORS.length];
}

export function BotAvatar({ seed, color, size = 32, status }: {
  seed: string;
  color?: string;
  size?: number;
  status?: BotPresence;
}) {
  const tile = tileFor(seed, color);
  return (
    <span
      className={`bot-avatar${status ? ` st-${status}` : ""}`}
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.3),
        "--tile": tile,
      } as React.CSSProperties}
      aria-hidden
    >
      <img src={avatarUri(seed)} alt="" draggable={false} />
      {status && <span className={`presence ${status}`} />}
    </span>
  );
}
