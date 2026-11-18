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
of a Chat that holds a version-2 checkpoint. Convert those checkpoints before
the rollback:

1. Stop the API and the workers of the current release, so no compaction
   publishes another version-2 checkpoint after the conversion. Keep them
   stopped until the earlier release runs.
2. Connect as a role that bypasses row-level security, such as the database
   superuser. `messages` forces row-level security, so the application role
   with no tenant identity matches no row and the update reports `UPDATE 0`.
3. Drop the focus and restore version 1 on every such checkpoint. `parts` is a
   `json` column, so the update converts it to `jsonb` and back:

   ```sql
   UPDATE messages SET parts = (jsonb_set(parts::jsonb, '{0,data,payload}', (((parts::jsonb)->0->'data'->'payload') - 'focus') || '{"v":1}'))::json WHERE role = 'checkpoint' AND parts->0->'data'->'payload'->>'v' = '2';
   ```

4. Check that none is left; the count must be `0`:

   ```sql
   SELECT count(*) FROM messages WHERE role = 'checkpoint' AND parts->0->'data'->'payload'->>'v' = '2';
   ```

The summary stays; only the stored focus is lost. The conversion rewrites each
converted `parts` value in `jsonb` key order, which no reader depends on.
