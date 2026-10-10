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
  L786-791 makes the live collector its only carrier.
- The assistant reply row is written only at settlement:
  `finishRunInTransaction` rebuilds parts from `run_events`
  (`reconstructDurableAssistant`, L3145-3154) and `persistAssistantMessage`
  creates it or replaces a non-completed reply (L3619-3659,
  `messages-repository.ts:649-688`).
- Several terminal writers never touch `messages`: the admission expiry in
  `chat-loop.service.ts:514-551`, `cancelSupersededRuns`
  (`chat-loop.service.ts` around L425-439), `failRunTransactionally`
  (`runs-repository.ts:555-579`), and `handleLostFinish` without an assistant
  turn (L3238-3276).
- Told and baseline state advances only on completion:
  `chats.workspace_told/_from` and the detach-reason clear, the
  recency-digest baseline and told set, and `runs.turn_tool_availability`
  (with `completed_attempt_id`, via `markFinished`). The model-switch item
  compares against the previous Run of any status
  (`findMostRecentByMessageSequence`, L4401-4461).
- `runs.context_items` is written at first dispatch (L1018-1028) and again
  on completion (L3165-3175). It is read only by
  `GET /api/v1/runs/{id}/context-items` (`runs.controller.ts:100-117`); the web
  app has the generated client and no caller.
- Seen sets for instruction files are derived from `messages.parts` in
  effective history (L2100-2140), which this change keeps.

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
  beyond recognizing the new `running` status as non-completed.

## Decisions

### D1: One fenced dispatch transaction

The first model request of an attempt is dispatched only after one
transaction, fenced by `activeAttemptId`, has:

1. locked the triggering user row (lock order runs, chats, messages, as
   today);
2. stored the attempt's accepted-turn items on it, or found this Run's
   items already stored (D2);
3. advanced the told and baseline state those items account for (D4);
4. created or reset the assistant reply in the `running` state (D3);
5. appended `model.requested`.

The request carries exactly the stored items. If the transaction loses its
fence, nothing is dispatched.

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
item. A retry of the same Run finds its items stored and reuses them as
stored text; it does not re-author `temporal`, the model switch, or an
availability reminder. Because the seen set is derived from `messages.parts`
and the stored items carry this runId, a retry's instruction load finds every
stored file already seen. A detaching retry keeps the stored items, as the
`prompt-imports` precedent requires (`workspace-entry` "Each Run attempt
re-checks the binding"). Request assembly stops prepending staged parts that
history replay already contains.

### D3: The reply row exists from first dispatch

The reply is created at D1 with empty parts and usage
`{ status: 'running', runId, attemptId }`. `running` is a non-completed status:

- `isCompletedAssistantTurn` and the replace guard in `updateAssistantReply`
  treat it as replaceable;
- search, conversation reads, and chat search keep excluding it, as they
  already exclude every non-completed reply;
- usage completeness ignores the current attempt's own row when deciding
  whether an earlier attempt prepared the Run.

When a step dispatches an in-Run item, a fenced transaction appends it to the
reply after the parts already stored. Settlement rebuilds text, reasoning, and
tool parts from the attempt's `run_events` and places each stored item after
the last tool part of the step that triggered it, the position completed
turns already use. `withoutContextItems` and the live-collector-only rule are
deleted.

Rejected: one reply row per model step (changes the unique `in_reply_to`,
retry-in-place, per-reply usage, and one-reply rendering).

### D4: Told and baseline state advances with the item

Each piece of state that records what history has told the model is written
in D1's transaction, beside the item it accounts for:

- `chats.workspace_told/_from` and the detach-reason clear, with the
  `workspace` item;
- the recency-digest told set and an existing epoch's disclosure accounting,
  with the digest item; initializing a chat's first digest baseline stays with
  the winning turn, because that baseline lives only in the system prompt and
  no history item accompanies it;
- the skill-catalog told set, with the catalog notice (already written at
  acceptance);
- `runs.turn_tool_availability`, with the availability reminder; the next
  turn compares against the most recent prior Run that dispatched.

The columns keep their shape. Rejected: deriving told state from
`messages.parts` (the digest told set is keyed by chat id, which items do not
carry, and `workspace_told` stays a lookup column by Leo's decision).

### D5: Model-switch baseline from the latest reply in history

The switch item compares the attempt's model with the model recorded on the
most recent prior assistant reply in effective history, whatever its status.
A failed or cancelled reply's switch item is in history, so counting only
completed turns would announce the same switch twice. Compaction keeps
looking up the previous completed Run's receipt through
`completed_attempt_id`.

### D6: Every terminal writer finalizes the reply

Completion, failure, cancellation, expiry by the worker, expiry by a new
message, supersession, retry exhaustion, and a lost settlement each end with
the reply in a terminal status: parts rebuilt from the attempt's events
around the stored items, and usage carrying that status. The admission expiry
and supersession paths gain this step; a lost settlement finalizes the reply
from the log instead of writing nothing.

### D7: A retry resets the reply before it reads history

A retry's D1 transaction resets the reply to `running` for the new attempt,
which drops the dead attempt's output and in-Run items together. The retry
reads history only through the triggering user message, so its own reply is
never part of its request.

### D8: Forks skip the in-progress reply

A whole-chat fork taken while a Run is in flight copies the prefix without
the `running` reply, which keeps `owner-chat-forks` "The owner selects a
durable prefix".

### D9: The Run-level record is removed

`runs.context_items`, the `RunContextItem` type, the endpoint, its DTOs, the
OpenAPI path and generated client, and `BuiltContext.contextItems` are
deleted. What a Run's requests carried is the effective history through its
triggering message plus its reply. The non-erasure note for content copied
from outside the chat stays, re-targeted to persisted message parts.

### D10: The web adopts a running server reply

History adoption treats a server reply whose usage is `running` for the
active Run as the live stream's message: same render key, the live parts win
while the stream is attached, and the server parts win after it ends. A
`running` reply of a Run that is no longer active renders as interrupted.

## Risks / Trade-offs

- [A terminal writer is missed and a reply stays `running`] -> D6 enumerates
  the writers; each gets a test that asserts the final status. Readers treat
  `running` as non-completed, so a missed one degrades to an excluded reply,
  never a published partial one.
- [One extra write per in-Run item step] -> only steps that dispatch an
  in-Run item write; instruction bundles are rare and bounded.
- [A retry reuses a dead attempt's `temporal` and model-switch items] -> both
  describe the same accepted turn; the retry answers that turn.
- [Web mid-stream duplication or blanking] -> covered by focused history
  tests and the existing chat-flow, tool-loop, and stop-from-submission e2e
  specs.
- [Dropping the endpoint breaks an external caller] -> pre-launch; the only
  client is the generated one, which no code calls.

## Migration Plan

1. L1 drops `runs.context_items` with a generated migration; rollback
   re-adds a nullable column with no data.
2. L2 and L3 change write timing only; no schema change. Rolling back L3
   leaves `running` replies that older code treats as completed, so roll back
   only after the in-flight Runs settle.
3. No backfill.

## Open Questions

None.
