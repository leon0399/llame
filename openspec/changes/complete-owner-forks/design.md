## Context

See [proposal.md](proposal.md) for scope and issue ownership.

`ChatsService.forkChat` copies message rows with new IDs and dense sequence numbers. It drops timestamps and usage and copies no compactions or Chat-row baselines. `buildContext` already replays a stored compaction's `replacementHistory` followed by its retained tail; that projector is shared with ordinary continuation and is unchanged here.

The fork exists to continue a conversation with the same model-facing context. Provider prompt caches key on an exact request prefix, so every inherited byte matters: the system prompt (temporal anchor, recency digest, skill catalog), the checkpoint replacement history, and the ordered retained messages. Anything that differs between source and fork at the copied boundary voids the cache from that point on and changes what the model believes.

The v2-v4 design also tried to preserve state at historical boundaries and source-independent receipts. That required per-turn evidence rows, a revision counter, and boundary selection; nothing in the product reads them (R1-R6). v5+ copies what is on the source rows now.

## Goals / Non-Goals

Copy the selected prefix and the source Chat row's frozen context so the fork's next turn serializes the same inherited prefix the source's next turn would. Keep the copy one database transaction with the existing post-commit search projection dispatch. Add no columns and no writes outside the fork.

Not a provider-state archive, a Run clone, a message-revision graph, or a usage ledger. Do not copy Runs, queue jobs, Run event streams, cancellation state, worker assignments, native-file operation records, mutation fences, or external resources referenced by tool output. Historical tool results survive verbatim; future tool calls use current authorization.

## Decisions

### D1: The boundary is what is durable

A whole-chat fork copies every durable message. An explicit `fromMessageId` copies through that message inclusively. Run status is not consulted: the fork takes what the source has committed, which for an in-flight first attempt is the accepted user message and for a retry is that message plus its retryable assistant row. Later subagent forking depends on this: a child forks the parent's context mid-turn. No conflict response is introduced; unknown, cross-chat, and foreign-owner identifiers keep not-found behavior.

Read the Chat, its messages, and its compactions under one `REPEATABLE READ` transaction (`TenantDbService.runAs` accepts isolation options) and insert the destination in the same transaction.

### D2: Copy messages and compactions literally; remap only storage identity

Messages: new IDs, dense sequences from 1 in copied order as `conversation-reads` requires, `inReplyTo` remapped, and `role`, `parts`, `attachments`, `senderUserId`, `createdAt`, `usage` verbatim. Source sequences are already dense from 1 (allocation is `max + 1` and rows are never deleted), so copied sequences equal source sequences and compaction `uptoSeq` copies verbatim.

Compactions: every row with `uptoSeq` within the copied prefix, new IDs, `parentId` remapped to the copied parent, everything else verbatim. The whole lineage is copied rather than only the latest because `computeAbsorbedMessageCount` (`chats.service.ts`) reads `parentId` and the previous checkpoint's `uptoSeq` for the checkpoint UI; one map lookup per row keeps that exact. `CompactionsRepository.create` already runs `assertCompactionWrite`, so a malformed row fails the transaction without new code.

Never rewrite values inside parts or usage. A copied assistant message keeps its original Run ID in `usage.runId`; the existing Run-keyed receipt endpoint is owner-scoped, so the receipt resolves while the source Run exists and is not found after source deletion. Usage is copied because it is the price of the copied message; cross-Chat attribution is [#170](https://github.com/leon0399/llame/issues/170).

### D3: Copy the Chat row's frozen context

Extend `ChatsRepository.create` to accept `createdAt`, `recencyDigestBaseline`, `recencyDigestTold`, `recencyDigestRebakedFrom`, `skillCatalogBaseline`, `skillCatalogTold`, and `skillCatalogRebakedFrom`, and insert the fork row once after the compaction ID map exists. Both `*RebakedFrom` markers map through that ID map; a marker whose compaction was not copied (an anchor before that checkpoint) takes the copied active compaction's ID, or null when none was copied. The skill marker must resolve this way: `baselineMatchesEpoch` reuses the stored skill baseline only when the marker equals the latest compaction ID, so a null marker beside a copied baseline would re-resolve the live catalog and change the system prompt. The digest marker is compared only after a compaction newer than the previous Run, which in a fork happens only after a local compaction rewrites it; it follows the same rule for uniformity.

`createdAt` is copied because the temporal anchor resolves as `latestCompaction?.createdAt ?? chat.createdAt`; nothing else orders or gates on a Chat's creation time (the sidebar and digest use `updatedAt`, which the fork sets to now). The fork's `createdAt` therefore reports when its context began.

Copied baselines are whatever the source renders now, not the state at a historical anchor. Copying already-bound digest state is permitted after consent withdrawal, consistent with non-retroactive withdrawal; new baselines, appends, and re-bakes in the fork obey current consent. A source with no baseline yields a fork with none.

### D4: First-turn disclosure is ordinary new-chat behavior

The fork copies no Run, so its first turn has no previous Run and starts a fresh disclosure epoch (full tool-availability listing, no model-switch notice). Those items live on the context rail inside the new user turn, after the inherited history, so the cached inherited prefix is unaffected.

### D5: The shared path is unchanged

`forkSharedChat` keeps its public allowlist and copies text parts only. Its `toCopy` rows carry no `createdAt` or `usage`, and it copies no compaction or Chat-row baseline. The owner copy must not route through a shared helper in a way that changes that.

## Rejected alternatives

- R1: Per-turn `message_turn_contexts` evidence with a Chat-local `contextRevision` and pinned continuation state (v2-v4 D3-D4). Required a write on every accepted turn and execution, an adoption backfill, and boundary selection; its only readers were the fork copy and an endpoint nothing called. Provider caches expire within hours, so a historical boundary's exact digest is never cache-hot when forked.
- R2: `messages.inheritedTurnComplete` and `409 fork_context_unavailable` / `fork_boundary_unsettled`. Completion proof only bounded R1; rejecting a mid-Run fork breaks the subagent use case.
- R3: Usage provenance columns and a DTO field. No consumer; the ledger is #170.
- R4: A message-keyed context-receipt endpoint. Duplicated the Run-keyed endpoint for the source-deleted case only; the web client never called it.
- R5: A `chats.inheritedContextOriginAt` column. Copying `createdAt` gives the same anchor with no schema change.
- R6: A compaction staleness guard on `contextRevision`. Fixes a pre-existing race in which an accepted turn's told-set append is overwritten by a concurrent re-bake; unrelated to forks and narrow. Revisit with the compaction storage refactor ([#806](https://github.com/leon0399/llame/issues/806)).
- R7: Copy only the latest compaction with `parentId` null. Smaller, but `computeAbsorbedMessageCount` would report the whole coverage as absorbed by that checkpoint, changing what the fork's checkpoint UI shows.

## Trade-offs

- T1: Historical anchors inherit today's baselines and told-sets, not those at that boundary. An entry the source disclosed after the anchor is treated as told in the fork and is not announced again there; the digest and catalog are advisory data, and reconstructing told state from copied parts is what the base digest spec forbids.
- T2: Inherited receipts depend on the source Run's existence.
- T3: Usage summed across an original and its forks counts one execution more than once. Intended; #170 owns dedup.
- T4: Large histories lengthen the transaction. Keep chunked inserts; no message cap or partial response.

## Migration Plan

Single implementation layer after this proposal. No schema change and no migration.

## Verification

Three cases added to `fork-chat.integration.test.ts` under the self-provisioning suite:

- V1: A source with two compaction generations, a bound digest, and a skill baseline is forked whole; the fork and source, given identical new input, produce equal system prompts and inherited history through the real context builder and serializer, and the fork's absorbed-message count equals the source's.
- V2: An anchor before the latest checkpoint copies the earlier checkpoint only; the fork's active checkpoint and markers point at the copied row.
- V3: `forkSharedChat` of the V1 source yields no compaction, baseline, usage, or copied creation time.

Plus a manual check in the running app that the copied checkpoint renders in the fork ([#154](https://github.com/leon0399/llame/issues/154) acceptance).

## Sources

- S1: `apps/api/src/chats/chats.service.ts` (`forkChat`, `forkSharedChat`, `copyMessagesIntoNewChat`, `computeAbsorbedMessageCount`), `messages-repository.ts` (`findByChatId`, `createMany`, sequence allocation), `compactions-repository.ts` (`findLatestByChatId`, `create`, `assertCompactionWrite`), `chats-repository.ts` (`create`), `turn-context.ts` (`resolveFrozenState`, `resolveDisclosureEpoch`).
- S2: `apps/api/src/chats/skill-turn-state.ts` and `apps/api/src/skills/skill-prompt-baseline.ts` (`baselineMatchesEpoch`): the skill baseline is reused only when its marker equals the latest compaction ID.
- S3: `apps/api/src/runs/run-execution.service.ts` (`persistAssistantMessage` call sites), `apps/api/src/db/schema/chats.ts` (`chats` frozen columns, `compactions`, `runs`), `apps/api/src/db/tenant-db.service.ts` (`runAs` isolation options).
- S4: [OpenAI prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching) and [Anthropic prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching): matching request prefixes are relevant; application equality does not guarantee a hit.

## Revision history

- v1 (2026-09-12): Initial proposal from the agreed manual-fork contract, including Monday's pinned historical state, separate compactions, source-independent evidence, and explicit distinction between stale state and unrecorded state.
- v2 (2026-09-12): Two independent reviews led to explicit empty-fork initialization, immutable origin IDs without source foreign keys, a concrete initial-state home and adoption horizon, same-Chat checkpoint constraints, complete-owner-copy rollback requirements, owner-visible usage classification with server-only namespaced attribution, and typed conflict responses.
- v3 (2026-09-12): Reused the actual assistant completion predicate; moved the user completion fact onto user messages; specified `NO ACTION` constraints and deletion checks.
- v4 (2026-09-12): Removed the proposed mutable completion mirror; only copied user anchors retained an immutable inherited-completion fact.
- v5 (2026-09-15): Cut to the live-state copy after reviewing the v4 implementation (#816, #817): every evidence, revision, provenance, and conflict mechanism had no product reader. Boundary selection reverted to durable rows so mid-Run forks work for future subagents. Usage is copied as the conversation's price estimate. Copied `createdAt` replaced an origin column.
- v6 (2026-09-15): Review round 1 (two independent reviewers, then Codex on the PR). Both found the skill-catalog baseline (`skillCatalog*` columns, same lifecycle as the digest) uncopied, which would re-resolve the catalog on the fork's first turn and change the system prompt; D3 now copies every frozen Chat-row column with one marker-remap rule. Dropped the false "no assistant row mid-Run" claim (retry attempts keep a retryable row). Replaced `setRecencyDigest` (non-nullable marker) with an extended `create`. Deleted the `durable-runs` delta (master already creates no Run on fork) and restored the digest delta to the base text plus one sentence. Cut spec scenarios and tasks that restated master or verified untouched code. Rejected copying only the latest compaction (R7). `uptoSeq` copies verbatim. Codex: an uncopied marker now takes the copied active compaction's ID instead of null, so a copied skill baseline stays bound; told-sets copied at a historical anchor are recorded as trade-off T1.
