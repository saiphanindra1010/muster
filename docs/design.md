# Design

## Principles

- **Bots are colleagues.** Copy, roster and statuses treat bots as coworkers,
  not tools. Nothing user-visible mentions the engine, terminals or CLIs.
- **Calm surfaces, honest signals.** Light and dark twins; color is
  reserved for meaning (working, waiting, danger). Actions, selection, and
  focus use black and white, not a brand hue.
- **No emojis.** Iconography is Lucide only, through the size-first wrappers
  in `src/icons.tsx`.
- **Dumb UI.** The UI renders what the harness reports; it never simulates
  state it can't see.

## Appearance & theming

Appearance is System, Light, or Dark. System is the default and follows the
OS. The choice is `localStorage["muster.appearance"]`.

- `index.html` reads that key before first paint (no flash of the wrong theme).
- `src/theme.ts` owns it after that: `applyAppearance()` paints
  `<html data-theme="dark|light">` and crossfades for 260 ms via the
  `theme-anim` class (skipped under `prefers-reduced-motion`).
- `watchSystemAppearance()` repaints when the OS flips and the choice is System.
- The sidebar control calls `setAppearance()`.

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

## Surfaces

The shell is opaque. Sidebar, top bar, composer, modal, and drawer do not use
backdrop blur, so scrolling and theme switches stay smooth.

- Message bubbles, markdown, tables, and code sit on the same stable surfaces.
- Controls inside a surface use `--fill`, not another layer.
- A faint ambient wash sits behind the shell. Content never depends on it
  for contrast.

Fallbacks:

- `prefers-reduced-transparency: reduce` and webviews without
  `backdrop-filter` get fully opaque sidebar, toolbar, composer, modal, and
  drawer surfaces.
- `prefers-contrast: more` strengthens text, edges, and the bubble surface.
- `prefers-reduced-motion: reduce` disables the theme crossfade, message entry,
  and status pulses.

## Chat anatomy

- **Header**: bot avatar and name (click to open its settings). The model is
  chosen per message from the task, and there is no model picker. Renaming
  happens in the bot settings drawer.
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

The app mark is the four pastel crew dots (`IconMark`, `src/icons.tsx`), used
for the sidebar brand, hero, and favicon. A bot is a face: one of twelve
shapes in a chosen color (`src/avatar.tsx`). The face bobs, blinks, and
glances, and stays still when the system asks for reduced motion. The choice
is saved in `localStorage["muster.faces.v1"]`. A bot with no saved face gets
a stable one from its id.

New bots are not created on click. **New bot** opens a dialog that asks for
a name and a face. **Create** stays off until the name is filled in.

## Modals & drawers

- Bot settings renders as a right-side drawer; Tools and Marketplace as
  centered modals. All use the opaque surface tokens and close on Escape
  (`src/lib/useEscape.ts`).
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
