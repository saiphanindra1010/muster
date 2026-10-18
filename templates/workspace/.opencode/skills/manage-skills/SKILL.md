---
description: Create and update skills when the user asks - persistent bot knowledge
---

# Manage skills

When the user asks you to remember something permanently, or to create/update a
skill, do it with files. Do not just say you will remember it.

## Where skills live

`<project-root>/.opencode/skills/<skill-name>/SKILL.md` - project root is your
current working directory. Each skill is one folder with exactly that layout:

```md
---
description: One line saying what this skill is for
---

# Title

Short reusable knowledge or procedure. Keep it small and task-scoped.
```

## Rules

- `skill-name`: lowercase, dashes, e.g. `pdf-invoices`. Never nest deeper.
- `description` (frontmatter) is required - it is how skills get discovered.
- Body: the actual knowledge. Concrete steps and examples beat prose.
- To **update**: read the existing `SKILL.md` first with the read tool, then
  edit it. Never rewrite from memory.
- To **create**: write the new `SKILL.md` (parent folders are created as needed).
- After creating or updating, briefly confirm what changed and where the file is.
- Skills take effect when activated - no restart or reload needed.
- Never store secrets, tokens, or private keys inside a skill.
