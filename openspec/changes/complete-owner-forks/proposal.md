## Why

Owner forks currently copy message rows only. Compactions, usage, timestamps, and the Chat row's frozen baselines do not travel, so a fork of a compacted chat starts uncompacted, rebuilds context from the full history, and renders a different early prefix than its source. [#154](https://github.com/leon0399/llame/issues/154) asks for a complete owner-side copy: the fork's model-facing context must equal the source's at the copied boundary, which is also what keeps the inherited prefix eligible for provider prompt caching.

## What Changes

- D1: Copy every durable message of the selected prefix; Run status does not gate a fork and a fork mid-Run is allowed.
- D2: Copy messages and compactions literally, including usage, timestamps, and compaction lineage, remapping only storage identities.
- D3: Copy the source Chat row's `createdAt` and frozen baselines (recency digest and skill catalog triples), remapping re-bake markers to the copied compactions.
- D4: The fork's first turn starts an ordinary disclosure epoch.
- D5: Shared/public forks remain text-only.

Removed relative to v4: per-turn acceptance evidence, continuation revisions, pinned boundary state, usage provenance columns, a message-keyed receipt endpoint, and fork conflict responses (design R1-R4, R6).

## Capabilities

### New Capabilities

- `owner-chat-forks`: Literal owner-only prefix copy with compaction lineage and the Chat row's frozen context, and unchanged shared-fork disclosure.

### Modified Capabilities

- `chat-recency-digest`: An owner fork that copied a baseline continues it rather than resolving a new one.

## Impact

`ChatsService.forkChat`, `ChatsRepository.create`, `MessagesRepository.createMany`, and `CompactionsRepository.create` inputs. No schema change, no migration, no API contract change; the copied fields already exist on message and compaction responses. Existing search reindex and embedding dispatch remain post-commit projections.

Threats are cross-owner reads and copying private state through the public route. Forced RLS, owner-scoped repository reads inside one transaction, and the existing not-found behavior cover them; the shared path is verified to stay text-only.
