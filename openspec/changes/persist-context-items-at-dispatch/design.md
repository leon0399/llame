## Context

See proposal.md (Why). Line references are to master `72add0f6`.

- Accepted-turn items: `prompt-imports` and `skill-activation` are already
  persisted on the user message before the first request, as runId-keyed,
  row-locked, idempotent inserts a retry reuses
  (`apps/api/src/runs/run-execution.service.ts:969-978`, the prompt-import
  part repository). Every other accepted-turn item (`temporal`, model switch,
  availability, Workspace, digest, catalog notice, accepted-turn
  `instructions`) is staged in memory
  (`deriveAttemptStagedContext` around L4393-4537, and `placeInstructionsPart`
  at L612, called from `refreshTurnInstructions` around L2699-2740) and
  prepended to the user message only by `persistFinishedContext` on
  completion (L3324-3401).
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
  `chat-loop.service.ts:514-551`, `failRunTransactionally`
  (`runs-repository.ts:557-576`, called at pickup from
  `runs-worker.service.ts:183-191`), the claim-time `markFinished` calls
  (L847-864, L869-886), and `handleLostFinish` without an assistant turn
  (L3248-3275). Settlements that rebuild no parts write nothing
  (`buildAssistantTurnForFinish`, L3436-3443), and an update without telemetry
  leaves the stored usage as it was. `ChatLoopService` cannot call
  `RunExecutionService` (`run-worker.module.ts:57`). `cancelSupersededRuns`
  (`chat-loop.service.ts` around L425-439) is defensive cleanup on a fresh
  message: a message id maps to exactly one Run (L293-297, L354-361), so it
  never meets a reply.
- Settlers that hold the attempt (completion, failure, cancellation) persist
  the live collector's parts verbatim (L3437-3442); only settlers without it
  rebuild from events.
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

1. locked in the worker's existing completion order: the run, then
   `messages` (the triggering user row, then the reply), then `chats` (the
   told columns);
2. stored the attempt's accepted-turn items on the user row; on a retry
   after an earlier attempt dispatched, kept the items that dispatch stored
   and appended only what D2's comparison newly yields;
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

### D2: Each dispatch inserts its own accepted-turn items once

Accepted-turn items carry no per-item identity, and no insert dedupes by
text. Each dispatch transaction inserts the items it derived exactly once,
and the attempt fence (D1) lets that transaction commit at most once per
attempt. A producer + runId key, as the pre-dispatch `prompt-imports` and
`skill-activation` repositories use, would suppress a retry's second
`workspace`, `tool-availability`, or `recency-digest` item; a key on producer,
form, and text would suppress a legitimate repeated transition, such as a
tool going unavailable, then available, then unavailable again across
retries, which is stored again. The retry rule below derives only items new
relative to the stored state, so no dedupe is needed. `prompt-imports` and
`skill-activation` keep their own per-Run identity: they are facts stored
before dispatch, not dispatch items.

The first dispatch of a Run inserts at producer rank around the facts stored
before dispatch (`prompt-imports`, `skill-activation`), so a turn that
completes on its first attempt carries the same bytes as today. A retry of a
Run whose earlier attempts dispatched nothing stores everything at producer
rank, as a first attempt does.

Only items an earlier attempt's dispatch transaction stored are kept and
appended after. A same-Run retry after such a dispatch keeps those items,
unchanged and in place. It then derives each accepted-turn producer again,
treating the items already stored on the triggering user message, and the
told, seen, and baseline state their dispatch advanced, as already told. It
stores only the items that comparison newly yields, after the last stored
context item and before the user text, in producer order, in its own dispatch
transaction. Consequences:

- no second `temporal` or model-switch item for the same turn;
- a detaching retry appends its detach notice and snapshot after the stored
  items, as `workspace-entry` "Each Run attempt re-checks the binding"
  requires;
- an availability change since the stored record yields one new reminder
  compared against that record, so current callability stays correct:
  `Added tools` lists only tools callable now. The stored reminders stay; the
  Run's single id/state record advances to the observation of the last
  attempt that dispatched.

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
with `effort` omitted when the Run has none and `permissionMode: 'bypass'`
added when the dispatching attempt's effective mode is bypass. `running` is a
non-completed status everywhere:

- `isCompletedAssistantTurn` and the replace guard in `updateAssistantReply`
  treat it as replaceable;
- search, conversation reads, and chat search keep excluding it, as they
  already exclude every non-completed reply;
- owner-facing reads skip it (D10);
- usage completeness ("replaces an earlier reply") does not count the Run's
  own `running` usage as an earlier reply. A message id maps to exactly one
  Run, so no other Run's reply can be replaced, and a same-Run retry is
  already incomplete through the receipts clause.

Finalization by source: D1 records the dispatching attempt id on the
`model.requested` payload, and the reply's `usage.attemptId` names the attempt
that last dispatched.

- A settler that holds the attempt's live part collector (completion,
  in-process failure, cancellation, in-process worker expiry, lost
  settlement) persists the collector's parts, which already hold the in-Run
  items in position. A turn that completes is stored as it is today.
- A settler without the collector (dead-letter retry exhaustion,
  native-recovery settlement, claim-time terminal transitions, pickup
  failure, admission expiry, and a later attempt that fails, is cancelled, or
  expires before its own dispatch) rebuilds text, reasoning, and tool parts
  only from the named attempt's events, from its `model.requested` up to the
  next attempt's `run.started`, and places the stored in-Run items among
  them.

An earlier attempt's events therefore never merge into a later attempt's
reply, and the #1177 crash path keeps the output with the items it was
produced under. When a finalizer finds no reply row, the Run's event log
decides. A Run whose log has a `model.requested` event dispatched before the
reply layer existed (under master, or accepted before this layer); the
finalizer creates its reply from the Run's full event log as today, with no
in-Run items, and writes terminal usage per `run-usage-accounting`. A Run
whose log has no `model.requested` never dispatched (cancellation before
start, a pickup or claim failure before dispatch); the finalizer writes no
reply and no usage, as `run-usage-accounting` requires for a Run with no
dispatched attempt.

In-Run item position: each in-Run item write stores, in one fenced
transaction, the reply's current part snapshot: the attempt's text,
reasoning, and tool parts so far plus the new item, as the live collector
holds them. A rebuilding settler places each stored item after the last
rebuilt part whose `toolCallId` appears anywhere before that item in the
stored snapshot, and at the start only when none of those ids survive in the
rebuild. The intent is "after the last tool part of the triggering step";
anchoring on every earlier id keeps the rule defined when the rebuild orders
a step's tool parts by admission rather than reservation, or lacks one. No
envelope field is added. `withoutContextItems` is deleted; the live collector
stays the source for settlers that hold it.

Terminal usage: every finalizer that finds or creates a reply writes an
explicit terminal usage object with status (`completed`, `error`, or
`aborted`, per `run-usage-accounting`), `complete`, `runId`, `attemptId`,
`modelId`, `effort`, and `permissionMode` when present, even when it has no
parts and no telemetry; its `billing` is resolved then, since the `running`
usage carries none. A finalizer whose own attempt is not the attempt named in
the reply usage (any settler outside an executing attempt, and a later
attempt that ends before its own dispatch) writes the terminal status,
`complete: false`, and the running usage's `runId`, `attemptId`, `modelId`,
`effort`, and `permissionMode` when present, with no tokens, latency, or
measured size. A usage object without a status would otherwise read as
completed (`assistant-completion.ts:16-18`).

Rejected:

- One reply row per model step (changes the unique `in_reply_to`,
  retry-in-place, per-reply usage, and one-reply rendering).
- An anchor field on the item envelope or a per-step event: the snapshot
  already records the order the live collector produced.
- Rebuilding a completing turn from events: the rebuild orders tool parts by
  admission rather than by the slots the user saw, and an unreadable output
  left pending would roll a streamed answer back into salvage.

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
- the skill-catalog told set, with the catalog notice, in the dispatch
  transaction that persists the notice, whatever the Run's outcome; when that
  transaction fails before commit, neither the notice nor the updated told
  state is visible, and a retry produces one consistent notice. The
  first-epoch catalog baseline freeze stays with the winning turn, like the
  first digest baseline, because it too lives only in the system prompt;
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
the live collector's parts when the settler holds them, otherwise parts
rebuilt from the named attempt's events around the stored items, or, when no
reply row exists, a reply created from the Run's full event log only if that
log has a `model.requested` event (D3); terminal usage is written even when
the parts are empty. A Run that never dispatched gets no reply and no usage.
The event rebuild and the open-tool settlement move with it, because
`ChatLoopService` cannot call `RunExecutionService`. Its callers:

- completion, failure, cancellation, and expiry by the worker;
- retry exhaustion (dead letter) and cancellation before start;
- native-recovery `outcome_unknown`;
- pickup failure (`failRunTransactionally`);
- the claim-time `markFinished` paths;
- expiry by a new message (admission expiry);
- lost settlement, which finalizes a reply still `running` with the
  collector's parts instead of writing nothing.

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
- v3 (2026-10-10), round 2:
  - Settlers holding the attempt's live collector persist its parts; only
    settlers without it rebuild from the attempt's events, so a completing
    turn is stored as today (D3, D6).
  - Rebuilt replies anchor each in-Run item after the last rebuilt part
    whose `toolCallId` appears anywhere before it in the snapshot (D3).
  - Accepted-turn items use a per-item identity; the first dispatch inserts
    at producer rank, and keep-and-append applies only after an earlier
    attempt dispatched (D1, D2).
  - The `runs` lookup for replaced replies and the supersession finalizer
    caller are dropped: a message id maps to exactly one Run (D3, D6).
  - A finalizer that finds no reply row creates it from the Run's full event
    log (D3, D6).
  - D1's lock order follows the worker's completion order: run, messages,
    chats.
  - Token-less terminal usage is defined by relation to the attempt named in
    the reply usage; running and terminal usage carry `permissionMode` when
    present (D3).
  - The skill-catalog told set commits in the dispatch transaction that
    persists the notice, whatever the Run's outcome (D4).
  - A retry's dispatch advances the Run's availability record to its own
    observation (D2).
  - Tasks: the reply PR body carries `Closes #1177`; SPEC.md §9.7 and the
    `model-system-prompts` Purpose sentence get update tasks.
- v4 (2026-10-10), GitHub review:
  - A finalizer that finds no reply row creates one from the Run's full event
    log only when that log has a `model.requested` event; a Run that never
    dispatched gets no reply and no usage (D3, D6).
  - Accepted-turn items carry no per-item identity or text dedupe: each
    dispatch transaction inserts its own items once under the attempt fence,
    so a repeated availability transition across retries is stored again
    (D2).
  - `run-usage-accounting` "Usage records its billing mode" is modified: the
    `running` usage carries no `billing`, and the terminal usage that
    replaces it does.
  - Context: `placeInstructionsPart` is cited at L612 and its caller
    `refreshTurnInstructions` at L2699-2740.
