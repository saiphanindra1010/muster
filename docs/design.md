# Design

## Principles

- **Bots are colleagues.** Copy, roster and statuses treat bots as coworkers,
  not tools. Nothing user-visible mentions the engine, terminals or CLIs.
- **Calm surfaces, honest signals.** Dark default with a full light twin;
  color is reserved for meaning (working, waiting, unread, danger).
- **No emojis.** Iconography is Lucide only, through the size-first wrappers
  in `src/icons.tsx`.
- **Dumb UI.** The UI renders what the harness reports; it never simulates
  state it can't see.

## Appearance & theming

One setting — `system | light | dark` — stored under `muster:appearance`.

- `index.html` resolves it before first paint (no flash of the wrong theme).
- `src/theme.ts` owns it after that: `applyAppearance()` paints
  `<html data-theme="dark|light">` and crossfades for 260 ms via the
  `theme-anim` class (skipped under `prefers-reduced-motion`).
- `watchSystemAppearance()` repaints when the OS flips while the preference is
  "system".

Every color is a semantic token in `src/styles.css`; the light twin restates
the same roles under `:root[data-theme="light"]`. Contrast is annotated for
the surface each role sits on (e.g. your chat bubble holds 13.1:1 in dark and
13.4:1 in light; `--faint` is meta-text only at 5.4:1 / 4.9:1).

| Token | Role |
| --- | --- |
| `--bg`, `--sidebar`, `--panel`, `--panel-2` | surfaces |
| `--bubble`, `--bubble-line` | your messages |
| `--line`, `--line-soft` | separators |
| `--txt`, `--strong`, `--dim`, `--faint` | content hierarchy |
| `--accent`, `--accent-ring`, `--sel` | brand, focus, selection |
| `--green`, `--amber`, `--red` + soft `--ok/--warn/--danger` surfaces | status meaning |
| `--shadow-soft`, `--shadow-composer`, `--shadow-modal` | depth |

## Chat anatomy

- **Header** — bot avatar, name, model picker, settings gear. Renaming happens
  here or in the bot settings drawer.
- **Thread** — oldest-first. Your messages sit in the accent bubble on the
  right; bot text renders as sanitized GFM (`marked` + `DOMPurify`) and links
  open outside the app. Reasoning parts are intentionally hidden — the UI
  shows final text plus tool activity.
- **Tool runs** — collapsed lines with a human phrase ("Searched the web",
  "Ran a command"); `execute`/`bash` scripts reduce to a one-line hint, never
  raw JSON. MCP calls render as chips naming the connector they route to.
- **Approvals** — Allow / Always / Deny cards, seeded at boot and kept live
  from events.
- **Composer** — autosize; Enter sends, Shift+Enter inserts a newline. While a
  bot works the send button becomes Stop and the hint reads "Working —
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

Avatars are DiceBear **Bottts** robots on pastel backdrops, seeded by bot id —
same bot, same face everywhere. A bot's `color` frontmatter overrides the
pastel. They render as isolated data-URI `<img>`s on purpose (Bottts SVGs
share a mask id and would bleed into each other inline). Style by Pablo
Stanley, free for personal and commercial use.

## Modals & drawers

- Bot settings and Marketplace render as right-side overlays; Tools and
  Settings as centered modals. All share the veil/shadow tokens and close on
  Escape (`src/lib/useEscape.ts`).
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
