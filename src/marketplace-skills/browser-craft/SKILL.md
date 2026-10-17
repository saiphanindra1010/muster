---
description: Browse fast and accurately — one block per flow, extract with expressions, wait on conditions, never loop
---

# Browser craft

Your browser is the `agent-browser` connector: a real Chrome the user can
watch, with one persistent profile, so logins carry over between tasks. In
`execute` code it is `tools["agent-browser"]`.

## Do the whole flow in one block

One `execute` block replaces five round trips — open, wait, extract, return a
small JSON summary:

```js
const b = tools["agent-browser"];
await b.agent_browser_open({ url: "https://example.com/jobs" });
await b.agent_browser_wait_for_text({ text: "Jobs" });
return await b.agent_browser_eval({
  script:
    "JSON.stringify([...document.querySelectorAll('a.job')].slice(0, 5).map(a => ({ title: a.innerText.trim(), url: a.href })))",
});
```

## Rules

- The agent-browser connector is the only browser. Never cross-check with
  another browser tool — two browsers show two different worlds and waste minutes.
- `agent_browser_eval` takes a plain JavaScript expression and returns its
  value. Use `JSON.stringify(...)` when you want structured JSON back.
  Arrow-function strings like `"() => document.title"` just return `{}` — don't use them.
- No clicking needed? `agent_browser_read({ url })` returns readable markdown
  straight from a URL without driving the browser — the fast path for articles
  and docs.
- Extract with one `agent_browser_eval` script. Take a snapshot only when you
  must click something or you're unsure where you are; `{ interactive: true }`
  keeps snapshots small.
- Snapshot refs look like `[ref=e12]` — pass them to actions as `"@e12"`.
- Wait on conditions — `agent_browser_wait_for_text`, `agent_browser_wait_for_selector`,
  `agent_browser_wait_for_load`. Never a fixed sleep (`agent_browser_wait_ms`
  only when there is literally nothing observable to wait for).
- Fill forms with `agent_browser_fill` per field, then press
  `agent_browser_press({ key: "Enter" })` — or fill several fields in one
  `agent_browser_eval` script.
- If a click fails because something covers the target, agent-browser reports
  the covering element — dismiss it (often a consent banner), re-snapshot, retry once.
- After acting, verify once with a targeted script, then report.
- Same call failing or returning the same thing twice in a row → stop, change
  approach (different selector, direct URL) or report the blocker. Never loop.
- Reuse the one open page; `agent_browser_close` when done.
- Login wall? Ask the user to log in once in the bot's Chrome window — the
  profile remembers it from then on.
