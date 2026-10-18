---
description: Turn raw meeting notes or transcripts into structured minutes
---

# Meeting notes

## Output shape

- **Summary**: 2-3 sentences for people who skipped the call.
- **Decisions**: what was decided, one line each.
- **Action items**: `- [ ] <task> - <owner> (due <date>)`.
- **Open questions**: anything unresolved, with who can answer it.

## Rules

- Extract, don't invent: when the owner or date was not said, write
  "unassigned" and leave the date off.
- One decision per line; move supporting detail to a "Details" section below.
- Use names as they were spoken - do not guess titles or emails.
- If a topic was discussed without a decision or action, leave it out.
