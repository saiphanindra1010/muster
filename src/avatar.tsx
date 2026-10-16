import { useId } from "react";

/** Deterministic PRNG + string hash so each bot always gets the same face. */
function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shade(hex: string, amt: number): string {
  const m = hex.replace("#", "");
  if (m.length !== 6) return hex;
  const n = (i: number) =>
    Math.max(0, Math.min(255, Math.round(parseInt(m.slice(i, i + 2), 16) + amt)));
  const h = (v: number) => v.toString(16).padStart(2, "0");
  return `#${h(n(0))}${h(n(2))}${h(n(4))}`;
}

/**
 * Generative kawaii-character avatar. Same seed always renders the same face;
 * pass the bot id as seed. Fully local SVG — no network, no keys, no emojis.
 *
 * Look: chubby cream face, oversized sparkly eyes, blush cheeks, tiny ears,
 * pastel duotone backdrops. Every combination is constrained to stay cute.
 */
export function BotAvatar({ seed, color, size = 32 }: {
  seed: string;
  color?: string;
  size?: number;
}) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const rnd = mulberry32(hashSeed(seed || "?"));
  const pick = <T,>(arr: T[]): T => arr[Math.floor(rnd() * arr.length)];

  const pastels: Array<[string, string]> = [
    ["#ffd6e8", "#c4b5fd"],
    ["#cdeffd", "#a7f3d0"],
    ["#ffe9c7", "#fda4af"],
    ["#e4d9fd", "#a5d8ff"],
    ["#d8f3dc", "#fef9c3"],
    ["#ffd9d0", "#c7d2fe"],
  ];
  const custom = color && /^#[0-9a-fA-F]{6}$/.test(color);
  const [bg1, bg2] = custom ? [color as string, shade(color as string, -34)] : pick(pastels);
  const face = pick(["#fff8f0", "#fff4e6", "#f2fbf5", "#f5f1ff"]);
  const ears = pick(["bear", "cat", "bunny"] as const);
  const mouth = pick(["cat", "smile", "open"] as const);
  const bow = rnd() > 0.68;
  const dark = "#33333d";
  const pink = "#f9a8c9";
  // Desynced blink rhythm per bot (deterministic from the same seed).
  const h2 = hashSeed(`${seed || "?"}:blink`);
  const blinkBegin = `-${((h2 % 40) / 10).toFixed(1)}s`;
  const blinkDur = `${(4.4 + (h2 % 18) / 10).toFixed(1)}s`;

  const blink = (
    <animateTransform
      attributeName="transform"
      type="scale"
      values="1 1; 1 1; 1 0.08; 1 1"
      keyTimes="0; 0.9; 0.94; 1"
      dur={blinkDur}
      begin={blinkBegin}
      repeatCount="indefinite"
    />
  );

  const eye = (cx: number, cy: number) => (
    <g style={{ transformBox: "fill-box", transformOrigin: "center" }}>
      {blink}
      <ellipse cx={cx} cy={cy} rx="5.2" ry="6.6" fill={dark} />
      <circle cx={cx - 1.7} cy={cy - 2.3} r="2.1" fill="#fff" />
      <circle cx={cx + 1.8} cy={cy + 1.9} r="0.95" fill="#fff" opacity="0.9" />
    </g>
  );

  return (
    <svg width={size} height={size} viewBox="0 0 64 64" style={{ borderRadius: 7, display: "block" }} aria-hidden>
      <defs>
        <linearGradient id={`bg${uid}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={bg1} />
          <stop offset="1" stopColor={bg2} />
        </linearGradient>
      </defs>
      <rect width="64" height="64" fill={`url(#bg${uid})`} />
      <circle cx="52" cy="12" r="9" fill="#ffffff" opacity="0.22" />
      <circle cx="10" cy="54" r="6" fill="#ffffff" opacity="0.16" />
      {ears === "bear" && (
        <g>
          <circle cx="18" cy="20" r="7" fill={face} />
          <circle cx="18" cy="20" r="3.4" fill={pink} opacity="0.65" />
          <circle cx="46" cy="20" r="7" fill={face} />
          <circle cx="46" cy="20" r="3.4" fill={pink} opacity="0.65" />
        </g>
      )}
      {ears === "cat" && (
        <g>
          <path d="M 15 26 L 14 13 L 26 19 Z" fill={face} />
          <path d="M 17.5 22 L 17 16.5 L 23 20 Z" fill={pink} opacity="0.7" />
          <path d="M 49 26 L 50 13 L 38 19 Z" fill={face} />
          <path d="M 46.5 22 L 47 16.5 L 41 20 Z" fill={pink} opacity="0.7" />
        </g>
      )}
      {ears === "bunny" && (
        <g>
          <ellipse cx="22" cy="13" rx="4.6" ry="9" fill={face} transform="rotate(-12 22 13)" />
          <ellipse cx="22" cy="14" rx="2.2" ry="5.4" fill={pink} opacity="0.7" transform="rotate(-12 22 14)" />
          <ellipse cx="42" cy="13" rx="4.6" ry="9" fill={face} transform="rotate(12 42 13)" />
          <ellipse cx="42" cy="14" rx="2.2" ry="5.4" fill={pink} opacity="0.7" transform="rotate(12 42 14)" />
        </g>
      )}
      <circle cx="32" cy="36" r="17.5" fill={face} />
      <clipPath id={`fc${uid}`}>
        <circle cx="32" cy="36" r="17.5" />
      </clipPath>
      <g clipPath={`url(#fc${uid})`}>
        <ellipse cx="24" cy="28" rx="13" ry="9" fill="#ffffff" opacity="0.35" />
      </g>
      {eye(24.5, 34)}
      {eye(39.5, 34)}
      <ellipse cx="18.5" cy="41" rx="3.6" ry="2.4" fill={pink} opacity="0.8" />
      <ellipse cx="45.5" cy="41" rx="3.6" ry="2.4" fill={pink} opacity="0.8" />
      {mouth === "cat" && (
        <path d="M 28.5 43 Q 30.2 45.2 32 44 Q 33.8 45.2 35.5 43" stroke={dark} strokeWidth="1.8" fill="none" strokeLinecap="round" />
      )}
      {mouth === "smile" && (
        <path d="M 27.5 42.5 Q 32 46.5 36.5 42.5" stroke={dark} strokeWidth="2" fill="none" strokeLinecap="round" />
      )}
      {mouth === "open" && (
        <g>
          <path d="M 27 42 Q 32 47.5 37 42 Q 32 44.5 27 42 Z" fill={dark} />
          <ellipse cx="32" cy="44.6" rx="2" ry="1.3" fill={pink} />
        </g>
      )}
      {bow && (
        <g transform="translate(47 19) rotate(18)">
          <path d="M 0 0 L -7 -4.5 L -7 4.5 Z" fill="#fb7185" />
          <path d="M 0 0 L 7 -4.5 L 7 4.5 Z" fill="#fb7185" />
          <circle cx="0" cy="0" r="2.2" fill="#e11d48" />
        </g>
      )}
    </svg>
  );
}
