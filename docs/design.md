# Design

## Principles

- **Bots are colleagues.** Copy, roster and statuses treat bots as coworkers,
  not tools. Nothing user-visible mentions the engine, terminals or CLIs.
- **Calm surfaces, honest signals.** OS light and dark twins; color is
  reserved for meaning (working, waiting, unread, danger), and the brand
  violet is for actions, selection, and focus.
- **No emojis.** Iconography is Lucide only, through the size-first wrappers
  in `src/icons.tsx`.
- **Dumb UI.** The UI renders what the harness reports; it never simulates
  state it can't see.

## Appearance & theming

Muster follows the OS appearance. There is no in-app Light / Dark / System
setting: the desktop owns that choice, and an app-level override would make
people keep two settings in sync.

- `index.html` resolves `prefers-color-scheme` before first paint (no flash of
  the wrong theme).
- `src/theme.ts` owns it after that: `applyAppearance()` paints
  `<html data-theme="dark|light">` and crossfades for 260 ms via the
  `theme-anim` class (skipped under `prefers-reduced-motion`).
- `watchSystemAppearance()` repaints when the OS flips while the app is open.

Every color is a semantic token in `src/styles.css`; the light twin restates
the same roles under `:root[data-theme="light"]`. Your chat bubble is a
neutral surface in both themes, so the brand violet stays reserved for
primary actions, selection, and focus. The two hardest text pairs:

| Pair | Dark | Light |
| --- | --- | --- |
| `--txt` on `--bg` | 16.6:1 | 15.7:1 |
| `--faint` on `--bubble` | 4.9:1 | 4.8:1 |

| Token | Role |
| --- | --- |
| `--bg`, `--sidebar`, `--panel`, `--panel-2` | opaque surfaces |
| `--bubble`, `--bubble-line` | your messages |
| `--line`, `--line-soft` | separators |
| `--txt`, `--strong`, `--dim`, `--faint` | content hierarchy |
| `--accent`, `--accent-ring`, `--sel` | brand, focus, selection |
| `--green`, `--amber`, `--red` + soft `--ok/warn/danger` surfaces | status meaning |
| `--ambient-1`, `--ambient-2` | radial wash behind the shell |
| `--glass-bg`, `--glass-bg-strong`, `--glass-line`, `--glass-sheen`, `--glass-highlight` | Liquid Glass material |
| `--shadow-soft`, `--shadow-composer`, `--shadow-modal` | depth |

## Liquid Glass

The shell is one frosted material; content is not.

- **Glass:** sidebar, topbar, composer, modal, drawer, and the blurred modal
  veils.
- **Opaque:** message bubbles, markdown cards, tables, code blocks, the thread
  background, roster rows, permission cards. Text sits on stable surfaces.
- A glass surface is a translucent tint plus
  `backdrop-filter: blur(30px) saturate(150%)`, a 1 px inner top highlight,
  and a hairline edge. `--glass-bg` is the regular material for the topbar and
  composer; `--glass-bg-strong` is used where sustained reading matters
  (sidebar, modal, drawer).
- No glass on glass. Controls inside a glass surface use a solid `--fill`, not
  another blur.
- The violet/blue ambient wash behind the shell is what the material
  refracts. It stays subtle; content never depends on it for contrast.

Fallbacks:

- `prefers-reduced-transparency: reduce` and webviews without
  `backdrop-filter` get fully opaque sidebar, toolbar, composer, modal, and
  drawer surfaces.
- `prefers-contrast: more` strengthens text, edges, and the bubble surface,
  and makes the glass nearly opaque.
- `prefers-reduced-motion: reduce` disables the theme crossfade, message entry,
  and status pulses.

## Chat anatomy

- **Header**: bot avatar, name (click to open its settings), and the model
  picker. Renaming happens in the bot settings drawer.
- **Thread**: oldest-first. Your messages sit in the neutral bubble on the
  right; bot text renders as sanitized GFM (`marked` + `DOMPurify`) and links
  open outside the app. Reasoning parts are intentionally hidden - the UI
  shows final text plus tool activity.
- **Tool runs**: collapsed lines with a human phrase ("Searched the web",
  "Ran a command"); `execute`/`bash` scripts reduce to a one-line hint, never
  raw JSON. MCP calls render as chips naming the connector they route to.
- **Approvals**: Allow / Always / Deny cards, seeded at boot and kept live
  from events.
- **Composer**: autosize; Enter sends, Shift+Enter inserts a newline. While a
  bot works the send button becomes Stop and the hint reads "Working -
  additional messages are queued"; queued messages carry a `queued` tag until
  they run.

## Roster & status dots

The sidebar lists bots in a stable order. Status dots are the whole team view:

| Dot | Meaning |
| --- | --- |
| green, pulsing | working on a task |
| amber | waiting for your approval |
| violet | replied while you were away (clears when you open the chat) |

All three are driven by the global event stream plus the boot-time
`permission.list` sweep, so they're accurate even for chats you're not looking
at.

## Bot identity

Avatars are DiceBear **Thumbs** characters on a dark tinted tile, seeded by
bot id - same bot, same face everywhere. A bot's `color` frontmatter overrides
the per-bot glow tint. They render as isolated data-URI `<img>`s on purpose
(each DiceBear SVG defines the same `mask id`, which would bleed between
inline copies).

## Modals & drawers

- Bot settings renders as a right-side drawer; Tools and Marketplace as
  centered modals. All share the Liquid Glass material, veil, and shadow
  tokens, and close on Escape (`src/lib/useEscape.ts`).
- Focus is visible everywhere: a 2 px `--accent-ring` outline with offset;
  inputs and checkboxes show a soft ring instead.

## Copy rules

- One colleague to another: direct, professional, no exclamation inflation,
  no emojis.
- Name things in user terms ("Working", "Queued", "Sign-in needed"), never
  protocol terms ("SSE", "MCP handshake").
- Errors are specific, actionable, and never blame the user.
- The engine is invisible: no "OpenCode", no "terminal", no "CLI" in any
  string a user can see.
