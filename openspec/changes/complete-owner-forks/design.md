## Context

See [proposal.md](proposal.md) for scope and issue ownership. The selected boundary is a durable conversation prefix, not a replay of an earlier in-flight provider request.

`ChatsService.forkChat` currently copies messages with new IDs and dense sequence numbers. It drops timestamps and usage and copies no compactions or context state. `buildContext` already replays a stored compaction's `replacementHistory` followed by its retained tail. That projector is shared with ordinary continuation and remains unchanged.

Next-turn preparation also reads mutable Chat digest state and the previous Run's immutable prompt/tool snapshot. The receipt API joins through the original Run. Copying only messages and compactions therefore loses both continuation inputs and source-independent inspection. Digest updates overwrite the current Chat values; historical rendered receipts do not necessarily contain their original structured inputs.

## Goals / Non-Goals

Preserve the selected prefix and its recorded context without source-dependent reads after commit. Keep the copy transaction database-only, with the existing post-commit search projection dispatch. Reuse immutable owner-level effective-context snapshots and the normal context builder.

This is not a provider-state archive, a filesystem snapshot, a general message-revision graph, or a Run clone. Do not copy queue jobs, Run event streams, cancellation state, worker assignments, native-file operation records, mutation fences, or external resources referenced by tool output. Historical tool results survive verbatim; future tool calls use current authorization and resource availability.

## Decisions

### D1: Copy one explicit boundary and its continuation inputs

Resolve source ownership, the selected message boundary, governing turn evidence, and applicable compactions inside one owner-scoped `REPEATABLE READ` transaction. `TenantDbService.runAs` already supports transaction isolation options. Use the same transaction for the destination inserts. Do not hold a source Chat lock across a model call or introduce a source Run/Chat lock order opposite to terminal settlement.

For a whole-chat fork, select the last durably completed assistant turn in that snapshot. A terminal Run without its durable completed assistant projection is not a completed boundary. Exclude every later message, including the current Run's triggering user message. With no completed turn, create an empty private fork; an explicit historical anchor remains a separate operation.

For `fromMessageId`, retain the inclusive user or assistant boundary. For completed `U1 A1 U2 A2`, selecting `U2` yields `U1 A1 U2` and no Run. Resolve completion from the governing Run and stored assistant completion contract; a target belonging to an unfinished or retryable partial turn returns `409 fork_boundary_unsettled`. Unknown, cross-chat, and foreign-owner identifiers retain the existing not-found behavior.

A prefix may contain older failed-turn observations before a later completed boundary; do not filter individual stored parts out of that prefix. The cutoff excludes the unfinished suffix as a unit. Forking does not settle, cancel, retry, or otherwise mutate the source.

A concurrent source settlement or compaction is either visible in the transaction's consistent snapshot or absent. The destination never subscribes to later source writes. Source deletion racing with the snapshot may leave a complete independent copy or make the operation fail atomically; it must not leave a partial fork.

Alternative rejected: independently reading rows under default `READ COMMITTED`, which can combine a cutoff from one source state with digest or checkpoint data from another.

### D2: Keep storage identity separate from inherited content

Preassign destination message and compaction UUIDs. Build explicit old-to-new sequence and ID maps, bulk insert in stored order, and remap only relational references: Chat IDs, message IDs, `inReplyTo`, compaction `uptoSeq`, compaction trigger boundaries, and `parentId`. A missing required mapping is an integrity failure, not permission to shorten history.

Copy message roles, parts, attachments, sender attribution, original timestamps, and usage without re-rendering or re-budgeting. Preserve compaction `summary`, `replacementHistory`, timestamps, and usage. JSON member serialization is not the fidelity claim; text values, array order, and provider-visible identifiers are.

Never recursively replace IDs inside parts or tool payloads. Tool-call IDs, resource locators, quoted Chat IDs, and stored context text remain verbatim. Original Run IDs in historical metadata are provenance values, not executable destination Run IDs. Message-scoped receipt lookup removes the need to rewrite those values.

The destination receives a new Chat ID and creation time and retains the existing title-copy convention. It starts private, unarchived, unpinned, and outside a Project, as the existing copy path does. These organizational values are not inherited model context. Preserve the original context origin separately in a nullable `chats.inheritedContextOriginAt`; an ordinary Chat uses `createdAt`, and a fork copies its source's effective origin. Applicable compaction timestamps still take precedence over that origin.

Alternative rejected: setting every copied timestamp to fork time, which both loses evidence and changes the temporal prefix.

### D3: Record boundary state where the boundary is authored

Add one owner-scoped `message_turn_contexts` relation keyed by the triggering user message, with same-Chat and same-owner constraints. It holds the current persisted turn's acceptance evidence: original Run ID, public model ID, resolved effort, accepted timestamp, immutable effective-context snapshot ID, and the structured continuation state after that user message's context items were committed. Retain the executed `contextItems` record separately from the effective-context snapshot, with its existing null-versus-empty semantics.

The continuation state records the active compaction identity and the complete digest triple: baseline, told-set, and re-bake marker. Each recorded state also carries a Chat-local increasing `contextRevision` and `sourceMaxSeq`, the highest message boundary whose state it observed. Advance the revision under the existing Chat transaction whenever acceptance or compaction publishes continuation state, and retain it on the corresponding turn/compaction record. A known absent digest is an explicit state; absence of a historical state record is not equivalent to a known empty digest. Use the existing digest data shapes, not a new rendering format or extensible producer registry.

Write acceptance evidence atomically with the user message, its final persisted context parts, the bound snapshot, and the Run. When an explicit retry rewrites the same stored turn under existing behavior, replace its current turn-context projection in that same transaction; the actual Run records retain their own immutable receipts. Copying a fork takes the current projection visible in its snapshot, without introducing message revisions. Record executed items under the existing winning-Run fence; a superseded attempt cannot overwrite the current turn's evidence.

Add the resulting continuation state to each compaction row. Its `sourceMaxSeq` includes the completed turn that triggered ordinary compaction or the user message that triggered transition compaction, even when `uptoSeq` covers an earlier prefix. Persist the resulting digest state with the compaction, including when consent or resolution failure means the old digest is retained. Extend the existing compaction staleness check to reject a commit if its captured continuation revision changed while inference ran; do not publish an obsolete digest over a newer accepted turn. This is a fixed companion to existing checkpoints, not the unified history refactor deferred to #806.

The Chat digest columns remain the current continuation state. The turn/compaction records preserve prior states before those columns are overwritten. Only the existing authoring transactions write these records; no watcher, background repair service, or independently advancing history cache is added.

Alternative rejected: recovering structured digest inputs by parsing arbitrary operator-rendered prompt prose. A complete rendered prompt proves what was sent, not every omitted template input or told-set membership.

### D4: Select applicable compaction and state together

A recorded state is eligible only when `sourceMaxSeq` is inside the selected prefix. A compaction's covered boundary must also fit. `uptoSeq` alone is insufficient: a checkpoint created after turn 18 may summarize messages 1 through 10, but an explicit fork at message 15 must not inherit the state change triggered by turn 18.

Select the highest eligible `contextRevision` across turn and compaction records; its active checkpoint is the replay authority. Copy that checkpoint's entire applicable parent chain. Parent links must remain within the source Chat and the destination copy. Validate the chain and the existing replacement-history contract before committing; do not silently drop a malformed ancestor, regenerate a checkpoint, or fall back to uncompacted history. Retained messages between `uptoSeq` and the selected boundary remain in ordinary replay order.

Take the digest triple from that same selected state, never from an independently chosen latest Chat row. Record the compaction identity observed by each accepted turn so equality with a copied checkpoint, rather than a fork timestamp, determines whether its disclosure epoch has already been observed. The revision orders acceptance and asynchronous compaction commits even when their triggering message boundaries coincide; `sourceMaxSeq` prevents a later state that observed excluded messages from entering the fork. Preserve copied revisions and their order, remap their message/compaction references, and initialize the destination counter to the highest copied revision before any local authoring.

A copied re-bake marker is remapped only to its copied compaction. External Chat identities inside the digest told-set remain unchanged. If a re-bake's supersession notice is pending at the selected boundary, the fork's next ordinary eligible turn emits it once; if an included user turn already observed it, copying creates no new notice.

Monday's pinned state wins over Tuesday's source state. Staleness, source deletion, or subsequent consent withdrawal is not a reason to refresh or reject an intact historical state. The fork intentionally preserves what was pinned at the chosen boundary.

### D5: Use message-owned evidence for history, Runs for execution

Reuse immutable `model_context_snapshots` rows within the same owner; these rows have no source Chat lifetime dependency. `message_turn_contexts` enforces `(snapshotId, ownerUserId)` and `(chatId, ownerUserId)` ownership and ties its message to the same Chat. Enable and force RLS with no public-read policy. A copied record belongs to the destination user message and retains the original model, effort, acceptance time, and recorded items.

Introduce owner-only `GET /api/v1/chats/:chatId/messages/:messageId/context-receipt`, using the existing safe receipt DTO. A user message resolves its own context; an assistant message resolves through its remapped `inReplyTo`. Receipt selection follows the governing stored turn, not a Run ID embedded in arbitrary payload content. Preserve original snapshot timestamps and hashes. Absent historical evidence remains explicitly absent; do not substitute the latest receipt.

Move transcript receipt actions and query keys to Chat/message identity, including model-switch and tool-availability controls. Migrate existing transcript consumers and remove their obsolete Run-ID-derived receipt plumbing. Keep the Run-keyed receipt resource for inspection of actual Runs; it is an execution resource, not a compatibility route for inherited messages. Do not add a generic inherited-Run union to queue/control APIs.

Both next-turn disclosure preparation and transition-compaction source selection use the same message-owned prior-turn resolver. It returns model, effort, acceptance time, snapshot, and observed compaction state from the last relevant stored user turn. Actual execution still uses the newly accepted Run's own bound snapshot. This keeps inherited and locally executed conversation history on one continuation path.

For a historical fork ending at a user message, copy its acceptance receipt and continuation state, but do not attach excluded assistant output, usage, or later execution-only observations to that truncated turn. The copied user message does not imply that an assistant reply ran in the destination.

Alternative rejected: cloning terminal Runs to make existing joins work. That fabricates executions and imports lifecycle concerns into a historical copy.

### D6: Preserve ordinary replay and distinguish inherited spend

The comparison oracle is ordinary next-turn reconstruction of the same selected state with identical model selection, provider options, effective-context inputs, external candidate observations, and new user input under the same runtime/SDK versions. Compare the inherited system-prefix and ordered model history, plus declarations/options where cache-affecting. Do not compare a fork's next turn against a prior live request from the middle of a tool loop.

Preserve the source's model/tool comparison baseline and frozen digest/origin state. Future real configuration, personalization, availability, consent, corpus, or model changes follow ordinary rules. A new Chat ID alone cannot cause a model-switch notice, fresh degraded-availability baseline, or digest reinitialization. New user-turn temporal text remains ordinary newly authored input. A fork does not freeze future authorization or promise identical future tool results.

Keep the current assistant/tool projection and reasoning omission policy. Do not modify the AI SDK conversion or enable opaque provider reasoning retention for this feature. Exact inherited input maximizes prefix-cache eligibility; routing, account scope, TTL, and provider decisions still control actual hits. Add no cache key, retention setting, or provider-specific behavior.

Copy historical usage intact for owner inspection, while recording a storage-only origin identity and inherited classification on copied messages and compactions. Use the original execution identity when present; otherwise use the original message/compaction identity. Preserve that origin transitively through fork-of-fork. Copying must not create a new spend event, move its timestamp to fork time, or count inherited usage as local execution. Any usage aggregation touched by this change must deduplicate origin identity; merely preserving an old `runId` is not sufficient evidence that a sum is correct.

### D7: Public disclosure remains a separate copy contract

Leave `forkSharedChat` based on the public response allowlist. It receives no private parts, receipt pointers, continuation state, compactions, usage, or source-owner identity. Do not route it through the new complete-owner state loader, even if both paths reuse low-level bulk insertion.

Public views of an owner fork, ordinary exports, search projections, and conversation locators keep their current disclosure rules. Receipt contents and control metadata remain private. Existing source resource locators inside historical text are not remapped to the fork or treated as authorization grants.

### D8: Additive adoption without invented history

Populate new evidence records from existing actual Run/snapshot/message relationships where those relationships prove the values. This is a deterministic projection of retained facts, not a prompt regeneration or preservation backfill from guessed defaults. Keep genuinely absent historical receipts absent.

Capture each existing Chat's current digest triple and current checkpoint state at a recorded adoption boundary before new writers can overwrite it. This makes that retained state available to subsequent forks without asserting it applied to every older message. Preserve historical rendered snapshots verbatim regardless of whether their structured companions were recorded.

A missing old companion cannot be represented as an empty digest or reconstructed from Tuesday's values. If the selected continuation state is genuinely unprovable, return an explicit `409 fork_context_unavailable` with no copy; this is an integrity limitation, not a staleness rejection. Do not claim the migration can recreate discarded inputs. Exact historical forks are supported wherever the recorded boundary state exists; the operator documentation must distinguish that from older history containing only a rendered receipt.

Do not repair previously lossy forks by linking them back to a source or by replacing their history. They retain the evidence they actually have. No production Chat reset or destructive migration is part of this change.

## Risks / Trade-offs

- R1: A rendered receipt may survive after structured historical digest state has been discarded. Preserve the receipt and document the exact missing state; never silently substitute current context. Stale but complete snapshots remain valid.
- R2: Reusing a snapshot across source and fork creates additional retention references. Enforce owner FKs and preserve it until no owning history requires it; source deletion alone cannot collect it.
- R3: Large histories increase transaction duration and storage. Retain chunked inserts and complete-copy semantics; no arbitrary message cap, partial response, or asynchronous half-fork.
- R4: Background compaction races with Run acceptance. Persist the trigger boundary and resulting state atomically and test a controlled interleaving; timestamps and coverage alone are not sufficient ordering evidence.
- R5: New immutable companion state and old writer processes can disagree. Treat acceptance/compaction/evidence authoring as one API/worker revision boundary, with an explicit coordinated deployment.

## Migration Plan

The exact delivery stack is `master <- complete-owner-forks/proposal <- complete-owner-forks/history-state <- complete-owner-forks/owner-copy <- complete-owner-forks/finalize`. The proposal branch contains only these planning artifacts. `history-state` ships the durable evidence and boundary-state records without changing the fork endpoint. `owner-copy` consumes those records, ships the complete API/UI behavior, and closes #154. Finalize only syncs and archives specs/task records.

Generate the schema migration through Drizzle, append required forced RLS and documented manual data projection steps, and run migration consistency plus negative isolation tests. Quiesce Run acceptance and drain co-located/dedicated workers before capturing current-state adoption boundaries and upgrading the authoring revision. Do not allow an old process to continue overwriting state without its companion. Deploy the evidence-aware runtime before enabling the changed owner-fork behavior through the next stack layer; no feature flag is required.

Rollback by quiescing the affected API/workers and returning to an evidence-aware compatible revision. Retain the added data and source-independent references; do not roll back by dropping evidence or allowing an old renderer to reinterpret forks. Once a complete fork exists, a pre-feature runtime is not a safe reader/writer for it. Record the supported rollback revision in the shipping PR.

## Verification

- V1: A real-DB owner fork of multi-generation compacted history produces the same inherited request prefix through the real context builder and provider serializer as the boundary-equivalent source. Include ordered tool observations and preserved provider-visible IDs. A deliberate timestamp reset, dropped checkpoint, or payload rewrite must fail the comparison.
- V2: Controlled settlement/compaction interleavings prove whole-chat cutoff, historical user/assistant anchors, pending re-bake state, atomic rollback, and source-independent fork-of-fork continuation.
- V3: Negative datastore and API checks reject foreign source/anchor/snapshot references and missing identity; public/shared views, exports, and search contain no copied private evidence.
- V4: Browser verification opens a copied checkpoint and receipt after source deletion, shows inherited model/usage/timestamps, and continues the fork with no creation-time inference or artificial context-change notice.
- V5: A fixed Monday/Tuesday digest fixture proves Monday's retained baseline/told-set are selected despite a later refresh. Test known empty state separately from genuinely missing old evidence. Usage attribution across two forks counts the original execution once.

## Sources

- S1: `apps/api/src/chats/chats.service.ts`, `turn-context.ts`, `context-builder.ts`, `compactions-repository.ts`, and `apps/api/src/compaction/compaction.service.ts`: current copy, reconstruction, and state authoring.
- S2: `apps/api/src/db/schema/chats.ts`, `model-context.ts`, and `apps/api/src/runs/model-context-snapshots.repository.ts`: ownership, current mutable digest state, and Run-dependent receipt access.
- S3: [OMP checkpoint reconstruction](https://github.com/can1357/oh-my-pi/blob/9f829f49ccd9709d4092731600df53bca795f2a3/packages/coding-agent/src/session/session-context.ts#L488-L555) retains an explicit kept-history boundary. [Codex replacement history](https://github.com/openai/codex/blob/94697375cb9d2aa8ae74d61957c6b396819bec94/codex-rs/core/src/session/rollout_reconstruction.rs#L342-L369) installs a typed replacement. Neither requires moving llame checkpoints into provider system messages.
- S4: [OpenAI prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching) and [Anthropic prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching): matching request prefixes are relevant, but application equality does not guarantee a hit.

Source inspection and local in-memory projection probes were performed during exploration. No upstream program or live-provider cache experiment was run.

## Revision history

- v1 (2026-09-12): Initial proposal from the agreed manual-fork contract, including Monday's pinned historical state, separate compactions, source-independent evidence, and explicit distinction between stale state and unrecorded state.
