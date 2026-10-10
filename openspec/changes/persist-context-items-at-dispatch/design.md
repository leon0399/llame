## Context

See proposal.md (Why). Line references are to master `72add0f6`.

- Accepted-turn items: `prompt-imports` and `skill-activation` are already
  persisted on the user message before the first request, as runId-keyed,
  row-locked, idempotent inserts a retry reuses
  (`apps/api/src/runs/run-execution.service.ts:969-978`, the prompt-import
  part repository). Every other accepted-turn item (`temporal`, model switch,
  availability, Workspace, digest, catalog notice, accepted-turn
  `instructions`) is staged in memory
  (`deriveAttemptStagedContext` around L4393-4537, `placeInstructionsPart`
  around L2700-2740) and prepended to the user message only by
  `persistFinishedContext` on completion (L3324-3401).
- In-Run items: `onStepStart` stages an in-Run `instructions` bundle into the
  live collector (L1720-1733). Only a completed settlement publishes it;
  `withoutContextItems` strips it from every other outcome, and the comment at
  L786-791 makes the live collector its only carrier. The item's step anchor
  lives only in the in-memory staged item
  (`apps/api/src/runs/in-run-context-items.ts:58-66`), and the context-item
  envelope accepts only exact key sets (`context-item.ts:109-121`).
- The assistant reply row is written only at settlement:
  `finishRunInTransaction` rebuilds parts from `run_events`
  (`reconstructDurableAssistant`, L3145-3154) and `persistAssistantMessage`
  creates it or replaces a non-completed reply (L3619-3659;
  `messages-repository.ts` `createAssistantReplyIfAbsent` L564-590 and
  `updateAssistantReply` L646-683). `run_events` has no attempt column,
  `run.started` carries no payload (L897), and the rebuild replays every event
  of the Run (`assistant-transcript.ts:672-679`).
- Several terminal writers never touch `messages`: the admission expiry in
  `chat-loop.service.ts:514-551`, `cancelSupersededRuns`
  (`chat-loop.service.ts` around L425-439), `failRunTransactionally`
  (`runs-repository.ts:557-576`, called at pickup from
  `runs-worker.service.ts:183-191`), the claim-time `markFinished` calls
  (L847-864, L869-886), and `handleLostFinish` without an assistant turn
  (L3248-3275). Settlements that rebuild no parts write nothing
  (`buildAssistantTurnForFinish`, L3436-3443), and an update without telemetry
  leaves the stored usage as it was. `ChatLoopService` cannot call
  `RunExecutionService` (`run-worker.module.ts:57`).
- Told and baseline state advances only on completion:
  `chats.workspace_told/_from` and the detach-reason clear, the
  recency-digest baseline and told set, the skill-catalog told set
  (L3385-3391) and baseline freeze (L3377-3384), and
  `runs.turn_tool_availability` (with `completed_attempt_id`, via
  `markFinished`). Epoch start is judged against the previous completed Run
  (`startsEpoch`, L4410-4436), which also gates the digest supersession marker
  (L4437-4441). The model-switch item compares against the previous Run of any
  status (`findMostRecentByMessageSequence`, L4401-4461).
- `runs.context_items` is written at first dispatch (L1018-1028) and again
  on completion (L3165-3175). It is read only by
  `GET /api/v1/runs/{id}/context-items` (`runs.controller.ts:100-117`); the web
  app has the generated client and no caller.
- Seen sets for instruction files are derived from `messages.parts` in
  effective history (L2100-2140), which this change keeps. Preparation reads
  history only through the triggering user message (`maxSeq`, L2118-2125).

### Prior art

| Harness                  | Turn settings                                                                                              | Injected context                                                                                                     | Per-run copy of transcript |
| ------------------------ | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| OMP / pi-mono / OpenClaw | `model_change` and `thinking_level_change` entries; model on each assistant message                        | system-prompt files rebuilt per request; `custom_message` entries persisted inline                                   | none                       |
| OpenCode                 | requested model on the user message, actual model on the assistant message; latest copy on the session row | instructions rebuilt per request; nested `AGENTS.md` appended to the `read` tool output and recorded in its metadata | none                       |
| Codex CLI                | `TurnContextItem` per turn in the rollout                                                                  | contextual user fragments persisted as conversation items before the turn context                                    | settings only              |
| Vercel chatbot           | request body / cookie                                                                                      | system prompt rebuilt per request                                                                                    | none                       |

Every harness that persists injected context does so as transcript content
when it enters the request, and derives seen state from the transcript. None
keeps a separate per-run copy of it.

## Goals / Non-Goals

**Goals:**

- One rule for every rail item: persisted with the request that first carries
  it, on the message its trigger belongs to.
- No path that leaves a reply permanently in progress.
- No told or baseline state that can fall behind the items in history.

**Non-Goals:**

- Changing what the model sees on a successful turn: request bytes for a turn
  that completes are unchanged.
- Changing search, conversation-read, or usage-completeness eligibility rules
  beyond recognizing the new `running` status as non-completed and hiding a
  `running` reply from owner-facing reads (D10).
- Changing the web app.

## Decisions

### D1: One fenced dispatch transaction

The first model request of an attempt is dispatched only after one
transaction, fenced by `activeAttemptId`, has:

1. locked the triggering user row (lock order runs, chats, messages, as
   today);
2. stored the attempt's accepted-turn items on it; on a retry, kept the items
   an earlier attempt stored and appended only what D2's comparison newly
   yields;
3. advanced the told and baseline state those items account for, including
   `runs.turn_tool_availability`, written even when it is `[]` (D4, D11);
4. created or reset the assistant reply in the `running` state for this
   attempt (D3, D7);
5. appended `model.requested` carrying the dispatching attempt id (D3).

The request carries exactly the items stored on the triggering message. If
the transaction loses its fence, nothing is dispatched and nothing is reset.

Rejected:

- Settlement-time publication (today): loses items whenever settlement does
  not complete the turn.
- Logging items as run events and materializing them at settlement: the
  admission expiry never settles, and history lacks the items between the
  crash and settlement.
- Staging in `runs.context_items`: a second authority beside
  `messages.parts`.

### D2: Accepted-turn items reuse the prompt-import pattern

The runId-keyed, idempotent insert at producer rank already used for
`prompt-imports` and `skill-activation` is generalized to every accepted-turn
item.

A same-Run retry keeps every item an earlier attempt of the Run stored,
unchanged and in place. It then derives each accepted-turn producer again,
treating the items already stored on the triggering user message, and the
told, seen, and baseline state their dispatch advanced, as already told. It
stores only the items that comparison newly yields, after the stored ones, in
producer order, in its own dispatch transaction. Consequences:

- no second `temporal` or model-switch item for the same turn;
- a detaching retry appends its detach notice and snapshot after the stored
  items, as `workspace-entry` "Each Run attempt re-checks the binding"
  requires;
- an availability change since the stored record yields one new reminder
  compared against that record, so current callability stays correct:
  `Added tools` lists only tools callable now.

Because the seen set is derived from `messages.parts` and the stored items
carry this runId, a retry's instruction load finds every stored file already
seen. Request assembly stops prepending staged parts that history replay
already contains.

Rejected: reusing the stored items and skipping the comparison. A reused
reminder could then advertise a tool the retry cannot call, and a detaching
retry would have nowhere to narrate the detach.

### D3: The reply row exists from first dispatch

The reply is created at D1 with empty parts and usage
`{ status: 'running', complete: false, runId, attemptId, modelId, effort }`,
with `effort` omitted when the Run has none. `running` is a non-completed
status everywhere:

- `isCompletedAssistantTurn` and the replace guard in `updateAssistantReply`
  treat it as replaceable;
- search, conversation reads, and chat search keep excluding it, as they
  already exclude every non-completed reply;
- owner-facing reads skip it (D10);
- usage completeness ("replaces an earlier reply") ignores the current Run's
  own `running` row; because the reset row no longer carries an earlier Run's
  usage, a reply counts as replaced when another Run on the same triggering
  user message dispatched before this one (a `runs` lookup by `message_id`
  using D11's dispatched rule).

Attempt-scoped finalization: D1 records the dispatching attempt id on the
`model.requested` payload, and the reply's `usage.attemptId` names the attempt
that last dispatched. Finalization rebuilds text, reasoning, and tool parts
only from that attempt's events, from its `model.requested` up to the next
attempt's `run.started`, whichever attempt or process performs the
settlement. A settler that never dispatched (native recovery
`outcome_unknown`, dead-letter exhaustion, admission expiry, a cancel or
failure before dispatch) finalizes the reply of the attempt named in the reply
usage. An earlier attempt's events therefore never merge into a later
attempt's reply, and the #1177 crash path keeps the output with the items it
was produced under.

In-Run item position: each in-Run item write stores, in one fenced
transaction, the reply's current part snapshot: the attempt's text,
reasoning, and tool parts so far plus the new item, as the live collector
holds them. Finalization replaces the non-item parts with the attempt's event
rebuild and keeps each stored item immediately after the tool part whose
`toolCallId` precedes it in the stored snapshot, or at the start if none
does. No envelope field is added. `withoutContextItems` and the
live-collector-only rule are deleted.

Terminal usage: every finalizer writes an explicit terminal usage object with
status (`completed`, `error`, or `aborted`, per `run-usage-accounting`),
`complete`, `runId`, `attemptId`, `modelId`, and `effort`, even when it has no
parts and no telemetry. Finalizers outside an executing attempt (dead-letter
expiry, native-recovery settlement, cancellation before start, admission
expiry, supersession, pickup failure) write the status and identity fields
with `complete: false` and no token counts. A usage object without a status
would otherwise read as completed (`assistant-completion.ts:16-18`).

Rejected:

- One reply row per model step (changes the unique `in_reply_to`,
  retry-in-place, per-reply usage, and one-reply rendering).
- An anchor field on the item envelope or a per-step event: the snapshot
  already records the order the live collector produced.

### D4: Told and baseline state advances with the item

Each piece of state that records what history has told the model is written
in D1's transaction, beside the item it accounts for:

- `chats.workspace_told/_from` and the detach-reason clear, with the
  `workspace` item;
- the recency-digest told set and an existing epoch's baseline-disclosure
  accounting, in the attempt's dispatch transaction whether or not the
  request carries a digest item; only initializing a chat's first digest
  baseline stays with the winning turn, because that baseline lives only in
  the system prompt and no history item accompanies it;
- the skill-catalog told set, with the catalog notice; the first-epoch
  catalog baseline freeze stays with the winning turn, like the first digest
  baseline, because it too lives only in the system prompt;
- `runs.turn_tool_availability`, with the availability comparison, including
  `[]` and a comparison that emits no reminder; the next turn compares against
  the most recent prior dispatched Run (D11).

The columns keep their shape. Rejected: deriving told state from
`messages.parts` (the digest told set is keyed by chat id, which items do not
carry, and `workspace_told` stays a lookup column by Leo's decision).

### D5: Model-switch baseline from the latest prior reply in the Chat

The switch item compares the attempt's model with `usage.modelId` of the most
recent prior assistant reply in the Chat whose seq is below the triggering
user message, regardless of its status and regardless of checkpoints. A
failed or cancelled reply's switch item is persisted, so counting only
completed turns would announce the same switch twice. A checkpoint can absorb
every earlier reply, for example window-variant compaction forced by the
switch itself, so reading only the rows after the active checkpoint would
leave a real switch unannounced.

This reader lands in the reply layer, because only from then on does every
dispatched Run have a reply carrying `modelId` (D3). The record and user-turn
layers keep master's Run-based comparison. Compaction keeps looking up the
previous completed Run's receipt through `completed_attempt_id`.

### D6: Every terminal writer finalizes the reply

One repository-level reply finalizer, callable from both the chat module and
the run worker, ends every terminal path with the reply in a terminal status:
parts rebuilt from the named attempt's events around the stored items (D3) and
terminal usage written even when the parts are empty. The event rebuild and
the open-tool settlement move with it, because `ChatLoopService` cannot call
`RunExecutionService`. Its callers:

- completion, failure, cancellation, and expiry by the worker;
- retry exhaustion (dead letter) and cancellation before start;
- native-recovery `outcome_unknown`;
- pickup failure (`failRunTransactionally`);
- the claim-time `markFinished` paths;
- expiry by a new message (admission expiry) and supersession;
- lost settlement, which finalizes the reply from the log instead of writing
  nothing.

Each caller gets a focused test asserting the final status.

### D7: A retry resets the reply in its own dispatch transaction

The reply is created or reset to `running` inside the D1 dispatch
transaction, not ahead of preparation. The reset drops the dead attempt's
output and in-Run items together. A retry's preparation reads history only
through the triggering user message, and the reply's seq is above it, so the
retry's own reply never enters its request. A retry that fails before its own
dispatch (native recovery, a preparation error, the context-window rejection)
leaves the earlier attempt's reply, output, and items untouched, and the
finalizer settles that reply from the earlier attempt's events (D3).

### D8: Forks skip the in-progress reply

A whole-chat fork taken while a Run is in flight copies the prefix without
the `running` reply, which keeps `owner-chat-forks` "The owner selects a
durable prefix". A fork anchor naming a `running` reply is rejected as not
found. A shared-chat fork copies the shared projection, which already omits
the reply (D10).

### D9: The Run-level record is removed

`runs.context_items`, the `RunContextItem` type, the endpoint, its DTOs, the
OpenAPI path and generated client, and `BuiltContext.contextItems` are
deleted. What a Run's requests carried is the effective history through its
triggering message plus its reply. The non-erasure note for content copied
from outside the chat stays, re-targeted to persisted message parts.

### D10: Owner-facing reads skip a running reply

History, the public share, the shared-chat fork source, owner fork selection,
and the chat-list preview omit an assistant reply whose usage status is
`running`; the live stream renders it meanwhile. No web change is needed: the
reply becomes visible when it is finalized, with a higher max seq than the
client had, which is today's adoption path. Web tests run as a regression
check only.

Rejected: adopting a `running` server row as the live stream's message. The
stream's message id is the Run id while the row has its own id, adoption
re-runs only when seq coverage grows, and a refetch during an active Run would
drop the live partial for an empty row.

### D11: A dispatched Run anchors epoch start and baselines

A Run counts as dispatched when its `turn_tool_availability` is not null
(written in D1 from the user-turn layer on, including `[]`) or its status is
`completed` (pre-cutover Runs). Epoch-start detection, the digest
supersession marker, and the availability baseline all use the most recent
prior dispatched Run, not the most recent completed Run. A failed Run that
dispatched a checkpoint's supersession marker and full `Unavailable tools:`
list has persisted both, so judging against an older completed Run would
emit them a second time. A pre-cutover failed Run has a null record and is not
completed, so its discarded reminder never becomes a baseline.

Canonical text that still says "successful turn" for these moves to the
dispatched Run: `mcp-tools` "MCP namespace filtering remains exact and
lifecycle-safe", and `model-system-prompts` "Every execution attempt resolves
its effective context in the worker", whose comparison records become
dispatched-turn records. A retry still resolves and renders the system prompt
and tool declarations again; its rail items follow D2.

### Delivery layers

Three implementation layers sit between the proposal and finalize layers:

- `record`: D9 only, about 800 authored lines (net production deletion);
- `user-turn`: D1 without step 4 and the attempt id, D2, D4, and D11;
- `reply`: D3, D5, D6, D7, D8, and D10, about 2,200 authored lines.

Named budget exception for `reply`: attempt-scoped finalization, the shared
finalizer, and the per-writer tests protect one invariant (no reply stays
`running`). Splitting them would publish a layer that creates `running` rows
some writers never finalize.

## Risks / Trade-offs

- [A terminal writer is missed and a reply stays `running`] -> D6 enumerates
  the writers; each gets a test that asserts the final status. Readers treat
  `running` as non-completed and owner-facing reads skip it, so a missed one
  degrades to a hidden reply, never a published partial one.
- [One extra write per in-Run item step] -> only steps that dispatch an
  in-Run item write their snapshot; instruction bundles are rare and bounded.
- [A retry's request carries an earlier attempt's `temporal` and model-switch
  items] -> both describe the same accepted turn, which the retry answers; D2
  compares against them, so nothing is announced twice.
- [A reply appears in history only once it is finalized] -> the live stream
  renders it meanwhile; the web history tests and the chat-flow, tool-loop,
  and stop-from-submission e2e specs run as regression checks.
- [Dropping the endpoint breaks an external caller] -> pre-launch; the only
  client is the generated one, which no code calls.

## Migration Plan

1. `record` drops `runs.context_items` with a generated migration; rollback
   re-adds a nullable column with no data.
2. `user-turn` changes write timing only; no schema change.
3. `reply` changes write timing only; no schema change. Master treats
   `running` as non-completed (hidden from search and reads, replaceable by a
   retry), but master's writers do not finalize it, so rolling back this layer
   leaves such rows hidden until a retry replaces them. Rollback step: after
   the older code is deployed, finalize leftover `running` replies to
   `aborted` with a one-off statement:

   ```sql
   UPDATE messages
   SET usage = usage || '{"status": "aborted", "complete": false}'::jsonb
   WHERE role = 'assistant'
     AND usage ->> 'status' = 'running';
   ```

4. No backfill.

## Open Questions

None.

## Revision history

- v2 (2026-10-10), round 1:
  - A same-Run retry keeps stored items, compares against them, and appends
    only what is new (D2).
  - The reply is created or reset in the dispatch transaction; a retry that
    fails before dispatch leaves the earlier reply untouched (D1, D7).
  - Finalization replays only the events of the attempt named in the reply
    usage, which `model.requested` now records (D3).
  - Each in-Run item write stores the reply's part snapshot, and finalization
    keeps items after the tool part that preceded them (D3).
  - Running and terminal reply usage carry status, `complete`, and Run,
    attempt, model, and effort identity; `run-usage-accounting` is modified
    (D3).
  - One repository-level finalizer serves the full list of terminal writers
    (D6).
  - The model-switch baseline is the latest prior reply in the whole Chat,
    any status, shipped in the reply layer (D5).
  - Epoch start, the supersession marker, and the availability baseline use
    the most recent dispatched Run (D11).
  - Digest disclosure accounting and the skill-catalog told set commit at
    dispatch; first baselines stay with the winning turn (D4).
  - Owner-facing reads skip a `running` reply, and the web app is unchanged
    (D10).
  - Rollback finalizes leftover `running` replies; Context citations fixed;
    layer sizes re-estimated.
