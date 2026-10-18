---
description: Draft release notes or a changelog from git history
---

# Release notes

Turn the commits since the last release into notes users can read.

## Steps

1. Find the range: `git describe --tags --abbrev=0` for the last tag, then
   `git log --oneline --no-merges <tag>..HEAD`.
2. Group by kind: Features, Fixes, Performance, Docs, Internal. Conventional
   commit prefixes map straight over (`feat` → Features, `fix` → Fixes,
   `perf` → Performance, `docs` → Docs); everything else goes to Internal.
3. Rewrite each line for users, not for developers: say what changed and why
   it matters. Drop internal jargon, merge duplicate lines.
4. Put breaking changes in their own **Breaking** section at the top with a
   one-line migration note.
5. Output markdown headed `## <version> - <date>`. Skip empty groups.

## Rules

- One bullet per user-visible change; link the PR when a number is available.
- Never invent changes - if the history is empty, say so instead of padding.
- Keep it short: a long changelog is a changelog nobody reads.
