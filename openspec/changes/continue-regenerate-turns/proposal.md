## Why

A Run that fails, is cancelled, or expires leaves its turn with no way forward except a new
message. A long agentic turn that fails at step 40 starts again at step 1, and the model pays
again for work that it already did (#1047). A completed answer that the owner does not like
cannot be redone, and the web shows a disabled `Regenerate` stub (#1451).

## What Changes

- A new route, `POST /api/v1/chats/:chatId/messages/:userMessageId/runs`, starts a
  **follow-up Run** on the Chat's latest user message. The body is
  `{ action: 'continue' | 'regenerate', modelId?, effort?, permissionMode? }`. The route answers
  with the same UI message stream as a chat send.
- **Continue** keeps the same turn. The follow-up Run keeps every completed step of the reply:
  each settled tool call with its result, and the text and reasoning before it, with the reasoning
  provider metadata. It drops the unfinished step after the last settled tool call and requests
  the next step from that point, with the kept steps shaped as the live loop sent them. It adds no
  user message, because a user-role message ends the provider's reasoning chain. Continue applies
  only to a reply of the latest Run when that Run is `failed`, `cancelled`, or `expired`. It keeps
  that Run's model and effort and takes the permission mode from the request.
- **Regenerate** starts the turn again from the user message, after any terminal status, with the
  model, effort, and permission mode in the request. Its dispatch replaces the reply in place,
  including a `completed` reply. The old reply stays only in the old Run's event log. It also works
  when the earlier Run failed before any reply row existed.
- When a Regenerate discards a tool call with a classification other than `read_only`, the turn
  gets a short fixed notice on its user message: an earlier attempt ran tools that can change files
  or state, so check the current state.
- A stored tool part records the classification of its tool, or `null` when the call did not
  start, so the web and the API can find non-read-only calls in a reply.
- A reply that a Regenerate replaced after it was `completed` stops being addressable conversation
  evidence and leaves search, permanently.
- The Chat read reports the Chat's latest Run (`latestRun`) with its status, model, effort, and
  accepted mode.
- The web shows Continue and Regenerate on the latest turn. Regenerate is a split button: a plain
  click repeats the latest Run's model, effort, and permission mode, and the menu picks other
  values and also sets the composer. Before a Regenerate discards non-read-only calls, the web asks
  for confirmation and names those calls.
- A follow-up Run's usage replaces the reply's usage. The spend of the replaced attempt is not
  kept; #170 owns durable usage provenance.

No change is **BREAKING**. `POST /api/v1/chats/:id/messages` keeps its contract, including 409 for
a message id that exists.

## Assumptions, confirmed with Leo

From the grilling record of 2026-10-27 (codes Q1 to Q19):

- Q1: this change ships Continue and Regenerate; file rewind is a separate later feature. Every
  harness that this change compares keeps file restore separate from regenerate.
- Q2-A: Continue is a new Run on the same assistant row; no new message identity.
- Q3-A: Continue applies only to `failed`, `cancelled`, and `expired`, not to a `completed` reply
  that hit the step cap or the output limit.
- Q4-A and Q12: Continue keeps the continued Run's model and effort; the permission mode comes from
  the composer.
- Q5-B and Q13-A: Regenerate is a split button; a plain click repeats the latest Run's model,
  effort, and permission mode; a menu pick also becomes the composer selection.
- Q6-A: the unfinished step leaves the stored parts; the failed Run's event log keeps it.
- Q7-A: an `outcome_unknown` or `cancelled` tool result at the boundary goes to the model as
  recorded and never executes again automatically.
- Q8-A: the step boundary is inferred from the last settled tool call; no stored step markers (#599
  stays separate).
- Q9-A: both actions apply only to the latest turn.
- Q10: confirmation before a Regenerate that discards non-read-only calls, plus the fixed notice for
  the new attempt.
- Q11: Regenerate also replaces a `completed` reply, in place, with no sibling version.
- Q14-C: the follow-up Run's usage replaces the reply's usage.
- Q15-A: a replaced `completed` reply stops being addressable evidence.
- Q17-A: the route is keyed on the user message.
- Q18-B: when Continue would keep no completed step, the web shows only Regenerate.
- Q19-A: one change, stacked as proposal, API, web, finalize.

Assumptions that follow from those answers but were not asked:

- A follow-up Run treats the context items that earlier Runs stored on the triggering user message
  as a retry of the same Run treats them (design D8). A Regenerate replaces the turn's model-switch
  item, because that item names the model of the earlier Run.
- The Continue Run's own event log starts with the kept parts (design D5). A refresh during the
  Continue Run therefore replays the kept text, reasoning, and tool parts, and every attempt of
  that Run starts from the same kept parts.
- Continue needs a reply of the latest Run. A turn whose Run failed before its reply existed can
  only be regenerated.
- The API layer is split in three (follow-up admission, Continue worker, Regenerate) to stay in
  the review budget.

## Deviation from the grilling record

Q16-A placed the Regenerate notice at the start of the new reply. This change stores it on the
triggering user message as an accepted-turn item instead (design D9). The reply reset writes no
parts, the in-Run carrier does not run for a Run without tools, and the rail rules require a
turn-level item inside the triggering user message. The user message also keeps the notice for a
later Regenerate of the same turn, which a reply part would lose. Leo, confirm this change or ask
for a rail rule that allows a reply-leading item.

## Capabilities

### New Capabilities

- `turn-actions`: owner actions that start a follow-up Run on the latest turn: the route,
  validation, availability, Continue and Regenerate semantics, the follow-up Run's usage, the
  latest-Run report, and the web actions.

### Modified Capabilities

- `durable-runs`: "One in-flight run per chat (single-flight)": a chat send makes at most one Run
  for a message id, only a follow-up Run adds another, and follow-up requests pass the same
  admission. "Final assistant-message projection preserves replay order": a follow-up dispatch
  resets the reply of an earlier Run, a Continue rebuild starts with the kept parts, and a failed
  attempt's record stays in later context until a follow-up Run replaces it.
- `available-models`: "Existing message ids conflict": scoped to a chat send.
- `permission-modes`: "The accepted mode is fixed on its Run": the mode is the one accepted with the
  request that created the Run.
- `conversation-reads`: "Conversation reads derive authority only from trusted Run identity": a
  retryable row is a non-completed reply, and a revised reply is not eligible evidence.
- `search-projection`: "Only user-visible conversation text is indexed": a revised reply leaves the
  index.
- `context-injection`: "Server-authored context is injected as discrete items on one rail": a
  follow-up Run keeps and appends items as a retry does, and a Regenerate replaces the model-switch
  item. "Co-occurring items have a total author-time order": the `regenerate` producer. "An item
  is either persisted-literal or bind-time": a follow-up dispatch can remove in-Run items and the
  model-switch item.
- `instruction-files`: "A file is loaded once per compaction epoch, derived from effective
  history": a follow-up reset removes in-Run bundles, and Continue keeps the bundles of its kept
  steps.
- `tool-calling`: "No mid-run tool-state checkpointing (read-only slice; write-tool landmine)": a
  later Run resumes earlier tool-loop state only through Continue. "Tool observations survive into
  later turns as stored UI parts": a follow-up Run can replace the record, and Continue's kept
  parts use their own projection. ADDED: "A stored tool part records the classification of a call
  that started".
- `model-system-prompts`: "Model switches use canonical persisted context text and metadata": a
  Regenerate replaces the stored switch item, and a replaced Run is not the previous completed Run.

Deliberately unchanged:

- `run-usage-accounting` "Usage records whether it is complete": it already states that a new
  reply's usage replaces an earlier reply's usage and does not carry its spend forward.
- `search-projection` "Lexical indexing is synchronous on turn completion, with async fallback and
  coalescing": it already rebuilds the projection after any regenerate.
- `chat-creation` "The message step commits the message and its Run before the enqueue": a resend
  as a new message stays valid after an enqueue failure; the follow-up route is an extra option.
- `workspace-entry`, `media-attachments`, `reasoning-output`, `chat-recency-digest`, and
  `temporal-anchor`: their rules are stated per Run or per attempt and hold for a follow-up Run
  unchanged.

## Impact

- API: a new route and service path that reuse the chat-send admission (lock, single-flight,
  stuck-run expiry, dispatch, stream bridge); a `run.continued` event; seeded part collection, a
  step-grouped Continue projection, stream replay, and finalization; Regenerate's reset of a
  `completed` reply; the `regenerate` notice producer; classification on `tool.started` and stored
  tool parts; follow-up rules for accepted-turn context items and the model-switch item;
  `latestRun` on the Chat read.
- Database: two migrations. `runs` gains the follow-up action and the source Run id. `messages`
  gains `revised_at`. The evidence predicate excludes revised rows.
- OpenAPI: one new `streaming` path, which the generated web client excludes, and the `latestRun`
  field, which it includes.
- Web: the action row on the latest assistant turn, the Regenerate split button and confirmation,
  the transport route for follow-up Runs, and the notice display. Stories and a focused E2E test.
- Docs: a reference page for the two actions; `CHANGELOG.md` in each shipping layer.

## Non-Goals

- File rewind or restore of tool effects (a separate later feature).
- Sibling versions, a version switcher, or edits of user messages (#611).
- Automatic retry of a failed model request (#1049) and continuation across the queue's 24 h job
  expiry (#1048).
- Recovery of a non-terminal Run after worker death from semantic checkpoints (#309).
- Replay of a failed tool batch without a model call (the oh-my-pi tool-replay path).
- Continue on a `completed` reply that hit the step cap or the output limit.
- Usage history of replaced attempts (#170).
- Continue or Regenerate on a turn that is not the latest.
- Any change to later-turn replay of stored tool parts (#599).

## Acceptance

- An owner continues a `failed` Run that completed three tool steps, one with two parallel calls.
  The first model request carries those steps, each step's calls in one assistant message, with
  their reasoning metadata, every result in full, and no added user message. No tool executes
  again. The final reply holds the kept parts and the new parts in order.
- A refresh during a Continue Run shows the kept parts and the new parts.
- An owner regenerates a `completed` reply with another model. The reply shows only the new answer.
  `conversation_read` and `search_conversations` stop returning that reply.
- A Regenerate that discards a `bash` call shows a confirmation in the web, and the triggering user
  message gets the notice. A Regenerate that discards only `read_only` calls shows neither.
- A follow-up request on a turn that is not the latest, on a live Run, or on another owner's Chat
  changes nothing. The answers are 409, 409, and 404.
- A Continue request on a `completed` Run answers 409, a Continue request that names `modelId` or
  `effort` answers 400, and a Continue after a Regenerate that failed before its dispatch answers 409.
- A turn whose first Run failed before any reply row existed can be regenerated.
