## Context

See [proposal.md](proposal.md) for scope and issue ownership.

`ChatsService.forkChat` copies message rows with new IDs and dense sequence numbers. It drops timestamps and usage and copies no compactions or digest state. `buildContext` already replays a stored compaction's `replacementHistory` followed by its retained tail; that projector is shared with ordinary continuation and is unchanged here.

The fork exists to continue a conversation with the same model-facing context. Provider prompt caches key on an exact request prefix, so every inherited byte matters: the system prompt (digest, temporal anchor), the checkpoint replacement history, and the ordered retained messages. Anything that differs between source and fork at the copied boundary voids the cache from that point on and changes what the model believes.

The v2-v4 design tried to also preserve state at historical boundaries (which digest was live when message 15 was accepted) and source-independent receipts. That required per-turn evidence rows, a revision counter, and boundary selection logic; nothing in the product reads them (see R1-R6). v5 copies what is live on the source Chat now.

## Goals / Non-Goals

Copy the selected prefix and the source Chat's live context so the fork's next turn serializes the same inherited prefix the source's next turn would. Keep the copy one database transaction with the existing post-commit search projection dispatch. Add no per-turn writes anywhere else.

Not a provider-state archive, a Run clone, a message-revision graph, or a usage ledger. Do not copy Runs, queue jobs, Run event streams, cancellation state, worker assignments, native-file operation records, mutation fences, or external resources referenced by tool output. Historical tool results survive verbatim; future tool calls use current authorization.

## Decisions

### D1: The boundary is what is durable, not what is settled

A whole-chat fork copies every durable message in the source. An explicit `fromMessageId` copies through that message inclusively, user or assistant. Run status is not consulted: the assistant row is written only at Run settlement (`RunExecutionService.persistAssistantMessage`), so a mid-Run source holds its accepted user message and nothing partial, and copying that user message is correct for a fork taken during a Run. Later subagent forking depends on this: a child forks the parent's context mid-turn, exactly as a tool call would.

Unknown, cross-chat, and foreign-owner identifiers retain not-found behavior. No conflict response is introduced. Forking does not settle, cancel, retry, or otherwise mutate the source.

Read the source Chat, its messages, and its compactions under one `REPEATABLE READ` transaction (`TenantDbService.runAs` already accepts isolation options) and perform the destination inserts in the same transaction, so the copied compactions and messages come from one snapshot.

### D2: Copy content literally; remap only storage identity

Preassign destination message and compaction UUIDs. Sequences stay dense from 1 in copied order, as `conversation-reads` requires; source sequences are dense in practice, so `uptoSeq` maps through the same old-to-new sequence map. Remap exactly: Chat IDs, message IDs, `inReplyTo`, compaction `parentId`, compaction `uptoSeq`, and the digest re-bake marker (D3). A missing required mapping is an integrity failure, not permission to shorten history.

Copy message roles, parts, attachments, sender attribution, `createdAt`, and `usage` verbatim. Copy compaction `summary`, `replacementHistory`, `usage`, and `createdAt` verbatim. Never rewrite IDs inside parts or tool payloads; tool-call IDs, resource locators, quoted Chat IDs, and stored context text remain as stored.

Usage is copied because a message's usage is the price of producing that message, and the fork contains that message. The prior "do not copy usage to avoid double counting" rule assumed usage was a spend ledger; it is a per-conversation estimate. Cross-chat spend accounting is [#170](https://github.com/leon0399/llame/issues/170) and owns its own attribution.

Copied assistant messages keep their original Run ID in `usage`/metadata. The existing Run-keyed receipt endpoint therefore resolves an inherited turn's receipt while the source Run exists, under the same owner. After source deletion the receipt is gone; that is accepted.

The destination is a new private, unarchived, unpinned Chat outside any Project, with the existing title-copy convention.

### D3: Copy the live digest state

After inserting messages and compactions, copy `recencyDigestBaseline`, `recencyDigestTold`, and `recencyDigestRebakedFrom` from the source row through the existing `ChatsRepository.setRecencyDigest`. The re-bake marker maps through the compaction ID map and becomes null when its compaction was not copied; a null marker withholds the one-shot supersession notice, which is the existing fail-safe reading of that column.

The copied state is whatever the source renders now. For a whole-chat fork this is exact. For an anchor earlier than the latest turn, the fork may list a chat the source disclosed after that anchor; the digest is framed as untrusted data, so this changes wording only. Copying already-bound state is permitted after consent withdrawal, consistent with non-retroactive withdrawal; new baselines, appends, and re-bakes in the fork obey current consent.

A source with no digest yields a fork with none; the fork's first turn then initializes one under ordinary rules.

### D4: Copy the creation time

The fork's `chats.createdAt` is the source's `createdAt`. The temporal anchor already resolves as `latestCompaction?.createdAt ?? chat.createdAt`, so an uncompacted fork renders the same anchor as its source with no new column and no change to `turn-context.ts`; a compacted fork derives it from the copied compaction's timestamp. Fork-of-fork inherits the same value. Nothing else reads a Chat's creation time to order or gate behavior: the sidebar and the digest use `updatedAt`, which the fork sets to now. The API's `createdAt` for a fork therefore reports when its context began, not when the row was inserted; that is the value this feature exists to preserve.

### D5: First-turn disclosure is ordinary new-chat behavior

The fork copies no Run, so its first turn has no previous Run: it starts a fresh disclosure epoch (full tool-availability listing, no model-switch notice), like a new Chat. These items live on the context rail inside the new user turn, after the inherited history, so they do not alter the cached inherited prefix. No fallback resolver over inherited evidence is added.

### D6: Public disclosure remains a separate copy contract

`forkSharedChat` keeps its public response allowlist and copies text parts only. It receives no compaction, digest, usage, timestamps, creation time, or source-owner identity. Public views of an owner fork, exports, search projections, and conversation locators keep their current disclosure rules.

## Rejected alternatives

- R1: Per-turn `message_turn_contexts` evidence with a Chat-local `contextRevision` and pinned continuation state on compactions and Chats (v2-v4 D3-D4). It required a write on every accepted turn and every execution, an adoption backfill, and boundary-selection logic; its only readers were the fork copy itself and an endpoint nothing called. Provider caches expire within hours, so a historical boundary's exact digest is never cache-hot when forked.
- R2: `messages.inheritedTurnComplete` and `409 fork_context_unavailable` / `fork_boundary_unsettled`. Completion proof only bounded R1's evidence copy; with D1 there is nothing to bound, and rejecting a mid-Run fork breaks the subagent use case.
- R3: Usage provenance columns (`usageOriginKind`, `usageOriginId`, `usageProvenance`) and a DTO field. No consumer; the ledger is #170.
- R4: A message-keyed context-receipt endpoint. Duplicates the Run-keyed endpoint for the source-deleted case only; the web client never called it.
- R5: Setting copied timestamps to fork time. Loses evidence and changes the temporal prefix.
- R6: A compaction staleness guard on `contextRevision`. It fixes a pre-existing race in which an accepted turn's told-set append is overwritten by a concurrent compaction re-bake. Real but unrelated to forks and narrow (a duplicate announcement). Not carried; revisit with the compaction storage refactor ([#806](https://github.com/leon0399/llame/issues/806)).

## Risks / Trade-offs

- R7: Historical anchors inherit today's digest, not the digest at that boundary. Accepted; see D3.
- R8: Inherited receipts depend on the source Run's existence. Accepted; see D2.
- R9: Large histories increase transaction duration. Keep chunked inserts and complete-copy semantics; no message cap or partial response.
- R10: Usage summed across an original and its forks counts one execution more than once. Intended; #170 owns dedup.

## Migration Plan

Single implementation layer after this proposal. No schema change and no migration.

## Verification

- V1: A real-DB owner fork of multi-generation compacted history produces the same inherited request prefix through the real context builder and provider serializer as the source at the same boundary, including checkpoint replacement history, ordered tool parts, timestamps, digest block, and temporal anchor. A deliberate timestamp reset, dropped checkpoint, or payload rewrite fails the comparison.
- V2: A fork taken while a source Run is in flight contains the accepted user message and no assistant row; the Run's later settlement writes only to the source.
- V3: Negative datastore and API checks: foreign source and anchor references are not found; the copied re-bake marker cannot reference another Chat's compaction; shared/public forks, public views, exports, and search contain no compaction, digest, usage, or copied creation time.
- V4: Fork survives source deletion: history, checkpoints, digest, and anchor remain; its Run-keyed receipts for inherited turns return not found.
- V5: Browser check: a copied checkpoint renders in the fork; inherited usage and timestamps display; continuing the fork emits no fork notice.

## Sources

- S1: `apps/api/src/chats/chats.service.ts` (`forkChat`, `forkSharedChat`, `copyMessagesIntoNewChat`), `messages-repository.ts` (`findByChatId`, `createMany`), `compactions-repository.ts` (`findLatestByChatId`, `create`), `chats-repository.ts` (`create`, `setRecencyDigest`), `turn-context.ts` (`resolveFrozenState`, `resolveDisclosureEpoch`).
- S2: `apps/api/src/runs/run-execution.service.ts` (`persistAssistantMessage` is called only from terminal paths).
- S3: `apps/api/src/db/schema/chats.ts`: `chats.recencyDigest*`, `compactions`, `runs`.
- S4: [OpenAI prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching) and [Anthropic prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching): matching request prefixes are relevant; application equality does not guarantee a hit.

## Revision history

- v1 (2026-09-12): Initial proposal from the agreed manual-fork contract, including Monday's pinned historical state, separate compactions, source-independent evidence, and explicit distinction between stale state and unrecorded state.
- v2 (2026-09-12): Two independent reviews led to explicit empty-fork initialization, immutable origin IDs without source foreign keys, a concrete initial-state home and adoption horizon, same-Chat checkpoint constraints, complete-owner-copy rollback requirements, owner-visible usage classification with server-only namespaced attribution, and typed conflict responses.
- v3 (2026-09-12): Reused the actual assistant completion predicate; moved the user completion fact onto user messages; specified `NO ACTION` constraints and deletion checks.
- v4 (2026-09-12): Removed the proposed mutable completion mirror; only copied user anchors retained an immutable inherited-completion fact.
- v5 (2026-09-15): Cut to the live-state copy after reviewing the v4 implementation (#816, #817): every evidence, revision, provenance, and conflict mechanism had no product reader. Boundary selection reverted to durable rows so mid-Run forks work for future subagents. Usage is copied as the conversation's price estimate; the ledger is #170. Kept: literal copy including the Chat's creation time, compaction lineage, live digest copy, and the unchanged shared-fork boundary. No schema change remains.
