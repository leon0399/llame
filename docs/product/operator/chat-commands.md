---
summary: "Operating owner chat commands: the data fix a downgrade below the /compact focus release needs"
read_when:
  - you are rolling back to a release that predates the `/compact` focus
behavior:
  - ../reference/chat-commands.md
---

# Chat commands

## Downgrading below the `/compact` focus

A checkpoint published by `/compact <focus>` stores payload version 2 with the
focus. Releases before the focus read only version 1 and fail the history read
of a Chat that holds a version-2 checkpoint. Before the rollback, drop the
focus and restore version 1 on every such checkpoint:

```sql
UPDATE messages SET parts = jsonb_set(parts, '{0,data,payload}', (parts->0->'data'->'payload') - 'focus' || '{"v":1}') WHERE role = 'checkpoint' AND parts->0->'data'->'payload'->>'v' = '2'
```

The summary stays; only the stored focus is lost.
