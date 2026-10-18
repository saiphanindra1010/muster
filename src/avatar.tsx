import { createAvatar } from "@dicebear/core";
import { bottts } from "@dicebear/collection";

/**
 * Bot avatars: DiceBear "Bottts" robots (style by Pablo Stanley - free for
 * personal and commercial use) on pastel backdrops. Same bot id -> same face,
 * so a bot keeps its look across the roster, chat header and message list.
 *
 * Rendered as a data-URI <img> on purpose: every DiceBear SVG defines the same
 * `mask id="viewboxMask"`, so inlining several avatars straight into the page
 * would let their masks bleed into each other. An <img> keeps each avatar its
 * own isolated document.
 */
const PASTELS = ["b6e3f4", "c0aede", "d1d4f9", "ffd5dc", "ffdfbf"];
const cache = new Map<string, string>();
/** Cap on cached avatars - any sane roster fits, so churn can't pin them. */
const CACHE_MAX = 500;

function avatarUri(seed: string, color?: string): string {
  // A bot's explicit frontmatter color overrides the pastel palette.
  const custom = color && /^#[0-9a-fA-F]{6}$/.test(color) ? color.slice(1) : "";
  const key = `${seed || "?"}|${custom}`;
  let uri = cache.get(key);
  if (!uri) {
    uri = createAvatar(bottts, {
      seed: seed || "?",
      backgroundColor: custom ? [custom] : PASTELS,
    }).toDataUri();
    if (cache.size > CACHE_MAX) cache.clear();
    cache.set(key, uri);
  }
  return uri;
}

export function BotAvatar({ seed, color, size = 32 }: {
  seed: string;
  color?: string;
  size?: number;
}) {
  return (
    <img
      className="bot-avatar"
      src={avatarUri(seed, color)}
      width={size}
      height={size}
      alt=""
      draggable={false}
      aria-hidden
    />
  );
}
