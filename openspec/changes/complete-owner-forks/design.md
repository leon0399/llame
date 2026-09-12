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

For a whole-chat fork, select the last durably completed assistant turn in that snapshot. A terminal Run without its durable completed assistant projection is not a completed boundary. Exclude every later message, including the current Run's triggering user message. With no completed turn, create an empty private Chat with ordinary new-chat state: no inherited origin, digest, checkpoint, comparison baseline, or evidence, and revision zero. This empty case does not require historical state recovery and cannot fail with `fork_context_unavailable`; its first local turn intentionally starts an ordinary fresh disclosure epoch. An explicit historical anchor remains a separate operation.

For `fromMessageId`, retain the inclusive user or assistant boundary. For completed `U1 A1 U2 A2`, selecting `U2` yields `U1 A1 U2` and no Run. Resolve completion from the message-owned completed-turn fact in D3; whole-chat selection additionally requires the included durable assistant projection. A target belonging to an unfinished or retryable partial turn returns `409 fork_boundary_unsettled`. Unknown, cross-chat, and foreign-owner identifiers retain the existing not-found behavior. An inherited completed-turn fact remains usable without its original Run, including when a historical user anchor excluded that turn's assistant from the destination.

Publish the two named fork conflicts using the existing domain-error shape, `{ statusCode: 409, error: "Conflict", code, message }`, with `code` constrained to `fork_boundary_unsettled | fork_context_unavailable`. Document that response in OpenAPI and generate the client discriminant; the UI must not classify failures by human-readable message text.

A prefix may contain older failed-turn observations before a later completed boundary; do not filter individual stored parts out of that prefix. The cutoff excludes the unfinished suffix as a unit. Forking does not settle, cancel, retry, or otherwise mutate the source.

A concurrent source settlement or compaction is either visible in the transaction's consistent snapshot or absent. The destination never subscribes to later source writes. Source deletion racing with the snapshot may leave a complete independent copy or make the operation fail atomically; it must not leave a partial fork.

Alternative rejected: independently reading rows under default `READ COMMITTED`, which can combine a cutoff from one source state with digest or checkpoint data from another.

### D2: Keep storage identity separate from inherited content

Preassign destination message and compaction UUIDs. Build explicit old-to-new sequence and ID maps, bulk insert in stored order, and remap only relational references: Chat IDs, message IDs, `inReplyTo`, compaction `uptoSeq`, compaction trigger boundaries, and `parentId`. A missing required mapping is an integrity failure, not permission to shorten history.

Copy message roles, parts, attachments, sender attribution, original timestamps, and usage without re-rendering or re-budgeting. Preserve compaction `summary`, `replacementHistory`, timestamps, and usage. JSON member serialization is not the fidelity claim; text values, array order, and provider-visible identifiers are.

Never recursively replace IDs inside parts or tool payloads. Tool-call IDs, resource locators, quoted Chat IDs, and stored context text remain verbatim. Original Run IDs in historical metadata are provenance values, not executable destination Run IDs. Message-scoped receipt lookup removes the need to rewrite those values.

The destination receives a new Chat ID and creation time and retains the existing title-copy convention. It starts private, unarchived, unpinned, and outside a Project, as the existing copy path does. These organizational values are not inherited model context. For a non-empty prefix, preserve the original context origin separately in nullable `chats.inheritedContextOriginAt`; an ordinary or empty Chat uses `createdAt`, and a non-empty fork copies its source's effective origin. Applicable compaction timestamps still take precedence over that origin.

Alternative rejected: setting every copied timestamp to fork time, which both loses evidence and changes the temporal prefix.

### D3: Record boundary state where the boundary is authored

Add one owner-scoped `message_turn_contexts` relation keyed by its triggering user message, with that message constrained to the same Chat and owner. It holds immutable acceptance evidence: original Run ID, public model ID, resolved effort, accepted timestamp, immutable effective-context snapshot ID, and structured continuation state. The current admission contract allows one accepted Run per user message and rejects a reused message ID; this feature does not add retry admission or message revisions. Retain executed `contextItems` separately from the effective-context snapshot, with the existing null-versus-empty semantics; this evidence does not make the record executable.

`originRunId` and copied usage-origin identifiers are immutable provenance values with no foreign key to a source Run, message, or compaction. Source deletion must neither cascade-delete nor null them. Their schema comments must state this intentional exception. Author them only from trusted owned source records, and keep every live message/Chat/snapshot relationship separately constrained by owner-aware foreign keys.

The continuation state records the active compaction identity and the complete digest triple: baseline, told-set, and re-bake marker. Each recorded state also carries a Chat-local increasing `contextRevision` and `sourceMaxSeq`, the highest message boundary whose state it observed. Advance the revision under the existing Chat transaction whenever acceptance or compaction publishes continuation state, and retain it on the corresponding turn/compaction record. A known absent digest is an explicit state; absence of a historical state record is not equivalent to a known empty digest. Use the existing digest data shapes, not a new rendering format or extensible producer registry.

Enforce same-Chat integrity for every stored active-compaction reference and non-null re-bake marker, including immutable initial and historical states. Persist these references in typed nullable columns with composite `(compactionId, chatId)` foreign keys on all three carriers: Chat initial state, turn evidence, and compaction companions. Their JSON payloads contain the remaining state, not duplicate unconstrained copies of those references. A same-owner reference to another Chat's checkpoint must fail too; RLS alone does not establish same-Chat integrity.

Write acceptance evidence atomically with the user message, snapshot, and Run. Capture the complete state actually committed by that transaction. Existing worker delivery attempts remain attempts of the same Run and cannot replace its accepted snapshot or continuation state. Record executed items under the existing Run fence against that Run's message-owned evidence. A rejected duplicate-message request must create no new evidence or mutate the original record.

Retain a nullable `completedAt` fact alongside acceptance evidence, populated only by the same fenced transaction that commits the Run's completed status and durable assistant projection. It records that the source turn reached a complete fork boundary; it is not a cloned Run status or execution control. Copy it unchanged, including for an inclusive user anchor that omits the source's later assistant output. Whole-chat selection still requires an assistant inside the selected prefix. This lets a fork establish its own historical boundaries after source deletion without querying original Runs. Migration may project this fact only from a retained completed Run and its durable answer.

Add the resulting continuation state to each compaction row. Its `sourceMaxSeq` includes the completed turn that triggered ordinary compaction or the user message that triggered transition compaction, even when `uptoSeq` covers an earlier prefix. Persist the resulting digest state with the compaction, including when consent or resolution failure means the old digest is retained. Extend the existing compaction staleness check to reject a commit if its captured continuation revision changed while inference ran; do not publish an obsolete digest over a newer accepted turn. This is a fixed companion to existing checkpoints, not the unified history refactor deferred to #806.

The Chat digest columns remain the current continuation state. The turn/compaction records preserve prior states before those columns are overwritten. Only the existing authoring transactions write these records; no watcher, background repair service, or independently advancing history cache is added.

Give each Chat one immutable `initialContinuationState` using the same state shape. An ordinary new Chat starts with known-empty state at revision and message boundary zero. An existing Chat receives its factually observed adoption state with that observation's message horizon; a new fork receives its selected initial state and also copies the eligible earlier turn/compaction records needed for historical fork-of-fork. This is the storage home for the adoption boundary, not an additional history table. Never install an adoption state at boundary zero when earlier messages already exist.

Alternative rejected: recovering structured digest inputs by parsing arbitrary operator-rendered prompt prose. A complete rendered prompt proves what was sent, not every omitted template input or told-set membership.

### D4: Select applicable compaction and state together

A recorded state is eligible only when `sourceMaxSeq` is inside the selected prefix. A compaction's covered boundary must also fit. `uptoSeq` alone is insufficient: a checkpoint created after turn 18 may summarize messages 1 through 10, but an explicit fork at message 15 must not inherit the state change triggered by turn 18.

Select the highest eligible `contextRevision` across the initial state, turn records, and compaction records; its active checkpoint is the replay authority. Copy the selected state into the fork's immutable initial state, changing only mapped storage references and sequence boundaries. Equal revision values in that initial state and copied records must denote the same state, not competing values. Copy that checkpoint's entire applicable parent chain. Parent links must remain within the source Chat and the destination copy. Every recorded ancestor companion must satisfy the selected message horizon and revision ordering; an unrecorded legacy companion remains missing and cannot independently supply continuation evidence. Validate the chain, compaction references, and existing replacement-history contract before committing; do not silently drop a malformed ancestor, regenerate a checkpoint, or fall back to uncompacted history. Retained messages between `uptoSeq` and the selected boundary remain in ordinary replay order.

Take the digest triple from that same selected state, never from an independently chosen latest Chat row. Record the compaction identity observed by each accepted turn so equality with a copied checkpoint, rather than a fork timestamp, determines whether its disclosure epoch has already been observed. The revision orders acceptance and asynchronous compaction commits even when their triggering message boundaries coincide; `sourceMaxSeq` prevents a later state that observed excluded messages from entering the fork. Preserve copied revisions and their order, remap their message/compaction references, and initialize the destination counter to the highest copied revision before any local authoring.

A copied re-bake marker is remapped only to its copied compaction. External Chat identities inside the digest told-set remain unchanged. If a re-bake's supersession notice is pending at the selected boundary, the fork's next ordinary eligible turn emits it once; if an included user turn already observed it, copying creates no new notice.

Monday's pinned state wins over Tuesday's source state. Staleness, source deletion, or subsequent consent withdrawal is not a reason to refresh or reject an intact historical state. The fork intentionally preserves what was pinned at the chosen boundary.

### D5: Use message-owned evidence for history, Runs for execution

Reuse immutable `model_context_snapshots` rows within the same owner; these rows have no source Chat lifetime dependency. `message_turn_contexts` enforces `(snapshotId, ownerUserId)` and `(chatId, ownerUserId)` ownership and ties its message to the same Chat. Enable and force RLS with no public-read policy. A copied record belongs to the destination user message and retains the original model, effort, acceptance time, and recorded items.

Introduce owner-only `GET /api/v1/chats/:chatId/messages/:messageId/context-receipt`, using the existing safe receipt DTO. A user message resolves its accepted context; an assistant message resolves through its remapped `inReplyTo`. Resolve only evidence for that owned Chat and message, never a global Run lookup. Owner history returns validated destination receipt references for its stored context controls and assistant metadata. Where those controls or metadata contain an original Run identity, it must agree with the message-owned evidence before a receipt reference is exposed. Preserve original snapshot timestamps and hashes. Missing or inconsistent evidence returns not found; do not substitute another turn or latest receipt.

Move transcript receipt actions and query keys to the destination Chat/message reference, including model-switch and tool-availability controls. Migrate existing transcript consumers and remove their obsolete global Run receipt lookup plumbing. Keep the Run-keyed receipt resource for inspection of actual Runs; it is an execution resource, not a compatibility route for inherited messages. Do not add a generic inherited-Run union to queue/control APIs.

Both next-turn disclosure preparation and transition-compaction source selection use the same message-owned prior-turn resolver. It retains current message-sequence ordering and returns the preceding accepted turn's model, effort, acceptance time, snapshot, and observed compaction state. Actual execution still uses the newly accepted Run's own bound snapshot. This keeps inherited and locally executed conversation history on one continuation path without changing turn admission or Run identity.

For a historical fork ending at a user message, copy its acceptance receipt and continuation state, but do not attach excluded assistant output, usage, or later execution-only observations to that truncated turn. The copied user message does not imply that an assistant reply ran in the destination.

Alternative rejected: cloning terminal Runs to make existing joins work. That fabricates executions and imports lifecycle concerns into a historical copy.

### D6: Preserve ordinary replay and distinguish inherited spend

The comparison oracle is ordinary next-turn reconstruction of the same selected state with identical model selection, provider options, effective-context inputs, external candidate observations, and new user input under the same runtime/SDK versions. Compare the inherited system-prefix and ordered model history, plus declarations/options where cache-affecting. Do not compare a fork's next turn against a prior live request from the middle of a tool loop.

For non-empty inherited history, preserve the source's model/tool comparison baseline and frozen digest/origin state. Future real configuration, personalization, availability, consent, corpus, or model changes follow ordinary rules. A new Chat ID alone cannot cause a model-switch notice, fresh degraded-availability baseline, or digest reinitialization. The explicitly empty fork in D1 has no inherited epoch and follows ordinary new-chat initialization. New user-turn temporal text remains ordinary newly authored input. A fork does not freeze future authorization or promise identical future tool results.

Keep the current assistant/tool projection and reasoning omission policy. Do not modify the AI SDK conversion or enable opaque provider reasoning retention for this feature. Exact inherited input maximizes prefix-cache eligibility; routing, account scope, TTL, and provider decisions still control actual hits. Add no cache key, retention setting, or provider-specific behavior.

Copy historical usage intact for owner inspection. On messages and compactions with recorded usage, persist `usageOriginKind`, `usageOriginId`, and `usageProvenance`. The origin key is namespaced as `run`, `message`, or `compaction`: use a message's proven originating Run ID when available, otherwise its original message ID; a compaction uses its original checkpoint ID. New local usage is `local`; copying sets `inherited` while retaining the origin key transitively through fork-of-fork. Origin identifiers remain server-side provenance values with no source foreign keys. The owner message and compaction DTOs expose only `usageProvenance: local | inherited | null` in addition to their existing usage fields; null means no recorded usage. Do not add origin keys to the historical usage payload, model context, or public projections.

Copying creates no new spend event, moves no usage timestamp, and contributes no local execution spend. This change adds no analytics endpoint or aggregation subsystem. A consumer summing retained historical usage across originals and forks groups by `(ownerUserId, usageOriginKind, usageOriginId)` before summing once; a consumer reporting only locally executed usage excludes `inherited`. Verify those semantics against persisted original, fork, and fork-of-fork rows for both turns and compactions. Historical totals describe retained evidence, not a new billing ledger or recovery of unrecorded provider costs.

### D7: Public disclosure remains a separate copy contract

Leave `forkSharedChat` based on the public response allowlist. It receives no private parts, receipt pointers, continuation state, compactions, usage, or source-owner identity. Do not route it through the new complete-owner state loader, even if both paths reuse low-level bulk insertion.

Public views of an owner fork, ordinary exports, search projections, and conversation locators keep their current disclosure rules. Receipt contents and control metadata remain private. Existing source resource locators inside historical text are not remapped to the fork or treated as authorization grants.

### D8: Additive adoption without invented history

Populate new evidence records from existing actual Run/snapshot/message relationships where those relationships prove the values. This is a deterministic projection of retained facts, not a prompt regeneration or preservation backfill from guessed defaults. Keep genuinely absent historical receipts absent.

Capture each existing Chat's current digest triple and current checkpoint state in its immutable `initialContinuationState` before new writers can overwrite it. Its adoption `sourceMaxSeq` is exactly `COALESCE(MAX(messages.seq), 0)` for that Chat in the same quiesced transaction, including unfinished user and assistant rows; it is not the last completed boundary or the active checkpoint's coverage. Assign the initial local revision there, without assigning that revision or state to older Run projections. For `U1 A1 U2` at sequences 1/2/3 with unfinished U2, adoption is at 3; an A1 fork cannot use it and returns unavailable if no earlier facts prove the required state. This makes retained current state available to subsequent forks without asserting it applied to every older message. Preserve historical rendered snapshots verbatim regardless of whether their structured companions were recorded.

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

Rollback requires quiescing the affected API/workers and a revision that supports every retained state's readers and writers. Once a complete fork exists, the minimum compatible runtime includes the complete `owner-copy` consumer changes; `history-state` alone is explicitly not a rollback target. The first `owner-copy` deployment has no earlier compatible target, so an incident requires keeping admission quiesced and fixing forward unless another complete-owner-copy revision is available. Retain all added data and source-independent references; never drop evidence or let an older renderer reinterpret a fork. Record the exact compatible revision, or the absence of one, in the shipping PR.

## Verification

- V1: A real-DB owner fork of multi-generation compacted history produces the same inherited request prefix through the real context builder and provider serializer as the boundary-equivalent source. Include ordered tool observations and preserved provider-visible IDs. A deliberate timestamp reset, dropped checkpoint, or payload rewrite must fail the comparison.
- V2: Controlled settlement/compaction interleavings prove whole-chat cutoff, historical user/assistant anchors, pending re-bake state, atomic rollback, and source-independent fork-of-fork continuation.
- V3: Negative datastore and API checks reject foreign source/anchor/snapshot references, same-owner cross-Chat checkpoint references, and missing identity; public/shared views, exports, and search contain no copied private evidence.
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
- v2 (2026-09-12): Two independent reviews led to explicit empty-fork initialization, immutable origin IDs without source foreign keys, a concrete initial-state home and adoption horizon, same-Chat checkpoint constraints, complete-owner-copy rollback requirements, owner-visible usage classification with server-only namespaced attribution, and typed conflict responses. Clarified ancestor eligibility and initial-state equality without adding a state hash. Rejected speculative multi-attempt receipt/admission work after verifying that the actual admission guard rejects reused message IDs; receipt evidence remains one record per accepted user turn. Stale pinned state remains valid, and genuinely discarded historical inputs remain unavailable.
