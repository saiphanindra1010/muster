---
description: Browse fast and accurately — batch flows, extract with scripts, wait on conditions, never loop
---

# Browser craft

Your browser is the `chrome-devtools` connector: a real Chrome the user can
watch, with one persistent profile, so logins carry over between tasks. In
`execute` code it is `tools["chrome-devtools"]`.

## Do the whole flow in one block

One `execute` block replaces five round trips — navigate, wait, extract,
return a small JSON summary:

```js
const b = tools["chrome-devtools"];
await b.navigate_page({ url: "https://example.com/jobs" });
await b.wait_for({ text: ["Jobs"] });
return await b.evaluate_script({
  function: "() => [...document.querySelectorAll('a.job')].slice(0, 5).map(a => ({ title: a.innerText.trim(), url: a.href }))",
});
```

## Rules

- The chrome-devtools connector is the only browser. Never cross-check with
  another browser tool — two browsers show two different worlds and waste
  minutes.
- Extract with `evaluate_script` — it returns JSON. Take a snapshot only to
  click something or when you're unsure where you are.
- `wait_for` takes an array of texts; use it instead of fixed sleeps.
- Fill forms in one call with `fill_form` instead of one `fill` per field.
- After acting, verify once with a targeted script, then report.
- Same call failing or returning the same thing twice in a row → stop, change
  approach (different selector, direct URL) or report the blocker. Never loop.
- Reuse the one open page; `close_page` extras when done. The last page can't
  be closed.
- Login wall? Ask the user to log in once in the bot's Chrome window — the
  profile remembers it from then on.
