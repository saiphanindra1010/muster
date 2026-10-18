# Bots

A bot is an OpenCode agent with a colleague persona, plus a DM session that
acts as its chat. Everything about a bot is a plain file in the workspace
(`.opencode/agents/<id>.md`), editable by hand - the app just makes it
point-and-click.

## File format

```md
-- -
description: Plans trips end to end
mode: primary
color: "#8b8cf8"
skills: [research-brief]
disabled: false
permissions:
  - action: github_*
    resource: "*"
    effect: allow
-- -
You are one of the user's bots - a colleague, not an assistant...
```

| Field | Notes |
| --- | --- |
| `description` | one-liner shown in listings; new bots get the creation prompt (capped at 120 chars) |
| `mode` | `primary` \| `subagent` \| `all`; the app creates `primary` |
| `model` | optional per-bot model override |
| `color` | optional hex; overrides the pastel avatar backdrop |
| `skills` | explicit skill ids; **empty means "all skills"** (see below) |
| `disabled` | `true` removes the agent from the harness listing; sidebar shows it under "Disabled" |
| `permissions` | rule list; the MCP picker generates `<server>_*` rules with resource `*` |
| unknown keys | preserved verbatim, including hand-written permission rules |

The body after the frontmatter is the system prompt. The parser
(`src/lib/bots.ts`) is a minimal round-trip: known keys and structured rules
are understood, everything else rides through byte-identical.

## The colleague persona

Every app-created bot gets a persona that speaks as one of the user's bots -
never as "OpenCode". Bots created by older builds are upgraded once at first
boot; only empty bodies or the exact legacy template ("You are `<name>`.") are
touched. Hand-written prompts are never overwritten. The persona carries
markers so migrations stay idempotent.

## Lifecycle

- **Create**: type what the bot should do ("help me plan trips") in the
  sidebar ＋; the name is derived from the words (`plan-trips`), de-duplicated
  against existing bots, and an empty prompt creates a general-purpose
  `helper`.
- **Rename**: from the chat header or settings; the DM session's title and
  metadata are updated so history follows (`renameBotHistory`).
- **Disable / Enable**: `disabled: true` in the file; disabled bots disappear
  from the harness agent listing and move to the sidebar's "Disabled" section.
- **Delete**: removes the file via the harness shell API (no fs-delete route
  exists) with a two-click confirm.

## Skills

- The catalog comes from `skill.list`; the harness's own development skills
  (`opencode`, `report`) are excluded - they're for building OpenCode, not for
  user bots.
- **Default = all skills on.** The file stays empty (`skills:` absent), so
  skills added later apply automatically. Unchecking one materializes the
  explicit list ("all minus this one" semantics).
- Bots load a skill only when it's relevant to the request - nothing is
  force-injected when a chat is created.
- Chats from older builds that got skill text injected at open are archived
  once (`dm-archived`; transcript kept) and replaced with a fresh chat the
  first time the bot is opened.
- The workspace seeds a `manage-skills` skill: bots can create and update
  their own skill files when asked ("remember this", "update the X skill").

## MCP access rules

Per-server **Default / Allow / Deny** in the bot settings drawer. Allow/Deny
serialize as permission rules `<server>_*` (resource `*`) that the harness
enforces; hand-written rules with other shapes round-trip untouched. The Tools
modal manages the connectors themselves (connect / disconnect / remove plus an
add form), writing to the workspace `opencode.jsonc`.

## Marketplace

Catalog: `src/marketplace.json` (ids, npm refs, commands, help) plus bundled
skill bodies in `src/marketplace-skills/<id>/SKILL.md`. Three kinds:

- **Connectors (MCP)**: `mcp.servers.<name>` in the workspace config. Cards
  show live status (Connected / Sign-in needed). Token connectors (GitHub,
  Discord) collect their token once in the card; OAuth connectors (Slack,
  Sentry, Gmail, Google Chat) install with one click and sign in from the
  card's **Sign in** button. Google connectors use a one-time Google Cloud
  OAuth client from `.env` (`GOOGLE_MCP_CLIENT_ID` /
  `GOOGLE_MCP_CLIENT_SECRET`); README section 6 has the walkthrough.
- **Plugins (npm)**: `plugins: [...]`; the harness installs in the
  background (~40-60 s) and the modal polls until active.
- **Skills**: `.opencode/skills/<id>/SKILL.md`.

Install and remove are config edits through `src/lib/jsonc.ts` +
`location.reload()` - persistent across restarts, no terminal steps. Browser
connectors (Playwright, Chrome DevTools, Agent Browser) are
install-one-at-a-time by design; the Agent Browser entry is pinned to a
verified version, runs headed, and keeps logins in a persistent profile at
`~/.muster-bots/browser-profile`.

## The team view

- Each bot's turn runs on the harness independently - switch chats, keep
  working with someone else, close the window; the work continues.
- Messages sent mid-turn are queued by the harness inbox and run right after
  the current step.
- Approval waits are visible from the roster (amber) even for chats you
  aren't looking at.
