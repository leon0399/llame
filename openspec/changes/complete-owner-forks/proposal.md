## Why

Owner forks currently copy message rows only. Compactions, usage, timestamps, and the frozen digest do not travel, so a fork of a compacted chat starts uncompacted, rebuilds context from the full history, and renders a different early prefix than its source. [#154](https://github.com/leon0399/llame/issues/154) asks for a complete owner-side copy: the fork's model-facing context must equal the source's at the copied boundary, which is also what keeps the inherited prefix eligible for provider prompt caching.

## What Changes

- D1: Copy the selected message prefix literally: parts, attachments, usage, timestamps, and reply links, remapping only storage identities.
- D2: Copy every compaction whose coverage fits the copied prefix, including its parent lineage, summary, replacement history, usage, and original timestamp.
- D3: Copy the source Chat's current digest baseline, told-set, and re-bake marker, so the fork's system prompt renders identically to the source's.
- D4: Copy the source Chat's creation time so an uncompacted fork keeps the source's temporal anchor.
- D5: Keep the current boundary semantics: a whole-chat fork copies every durable message and an explicit anchor copies through that message. Run status does not gate a fork, no conflict response is added, and a fork mid-Run is allowed.
- D6: Shared/public forks remain text-only and receive no compaction, digest, usage, or creation time.

Removed from the previous revision of this change: per-turn acceptance evidence, continuation revisions, pinned boundary state, usage provenance columns, a message-keyed receipt endpoint, and fork conflict responses. See design R1-R6.

## Capabilities

### New Capabilities

- `owner-chat-forks`: Literal owner-only prefix copy with compaction lineage, digest state, and creation time, and unchanged shared-fork disclosure.

### Modified Capabilities

- `chat-recency-digest`: An owner fork continues the source's current digest state rather than resolving a new baseline.
- `durable-runs`: Copying history is not submission; a fork creates no Run.

## Impact

API Chat/message copying and compaction persistence. No schema change. No API contract change other than the copied fields already present on message and compaction responses; no OpenAPI regeneration is expected. Existing search reindex and embedding dispatch remain post-commit projections.

Threats are cross-owner reads, copying private state through the public route, and referencing another Chat's compaction from the copied digest marker. Forced RLS, owner-scoped repository reads inside one transaction, and negative datastore/API tests are required. No production chat reset or backfill is authorized.
