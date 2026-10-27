## Why

A Run that fails, is cancelled, or expires leaves its turn with no way forward except a new
message. A long agentic turn that fails at step 40 starts again at step 1, and the model pays
again for work that it already did (#1047). A completed answer that the owner does not like
cannot be redone, and the web shows a disabled `Regenerate` stub (#1451).

## What Changes

- A new route, `POST /api/v1/chats/:chatId/messages/:userMessageId/runs`, starts a
  **follow-up Run** on the Chat's latest user message. The body is
  `{ action: 'continue' | 'regenerate', modelId?, effort?, permissionMode? }`. The route answers
  with the same UI message stream as a chat send. It also works when the earlier Run failed
  before any reply row existed.
- **Continue** keeps the same turn. The follow-up Run keeps every completed step of the reply:
  each settled tool call with its result, and the text and reasoning before it, with the
  reasoning provider metadata. It drops the unfinished step after the last settled tool call and
  requests the next step from that point. It adds no user message, because a user-role message
  ends the provider's reasoning chain. Continue applies only when the latest Run of the turn is
  `failed`, `cancelled`, or `expired`. It keeps that Run's model and effort and takes the
  permission mode from the request.
- **Regenerate** starts the turn again from the user message, on any terminal status, with the
  model, effort, and permission mode in the request. Its dispatch replaces the reply in place,
  including a `completed` reply. The old reply stays only in the old Run's event log.
- A Regenerate that discards a tool call with a classification other than `read_only` adds a
  short fixed notice as the first part of the new reply. The notice tells the model that this
  is a new attempt and that files or state can have changed.
- A stored tool part of a call that started records the tool's classification, so the web and
  the API can find non-read-only calls in a reply.
- A reply that a Regenerate replaced after it was `completed` stops being addressable
  conversation evidence, permanently.
- The web shows Continue and Regenerate on the latest turn. Regenerate is a split button: a plain
  click repeats the old Run's model, effort, and permission mode, and the menu picks other values
  and also sets the composer. Before a Regenerate discards non-read-only calls, the web asks for
  confirmation and names those calls.
- A follow-up Run's usage replaces the reply's usage. The spend of the replaced attempt is not
  kept; #170 owns durable usage provenance.

No change is **BREAKING**. `POST /api/v1/chats/:id/messages` keeps its contract, including 409
for a message id that exists.

## Assumptions, confirmed with Leo

From the grilling record of 2026-10-27 (codes Q1 to Q19):

- Q1: this change ships Continue and Regenerate; file rewind is a separate later feature. Every
  harness that this change compares keeps file restore separate from regenerate.
- Q2-A: Continue is a new Run on the same assistant row; no new message identity.
- Q3-A: Continue applies only to `failed`, `cancelled`, and `expired`, not to a `completed`
  reply that hit the step cap or the output limit.
- Q4-A and Q12: Continue keeps the continued Run's model and effort; the permission mode comes
  from the composer.
- Q5-B and Q13-A: Regenerate is a split button; a plain click repeats the old Run's model,
  effort, and permission mode; a menu pick also becomes the composer selection.
- Q6-A: the unfinished step leaves the stored parts; the failed Run's event log keeps it.
- Q7-A: an `outcome_unknown` or `cancelled` tool result at the boundary goes to the model as
  recorded and never executes again automatically.
- Q8-A: the step boundary is inferred from the last settled tool call; no stored step markers
  (#599 stays separate).
- Q9-A: both actions apply only to the latest turn.
- Q10: confirmation before a Regenerate that discards non-read-only calls, plus the fixed
  notice for the new attempt.
- Q11: Regenerate also replaces a `completed` reply, in place, with no sibling version.
- Q14-C: the follow-up Run's usage replaces the reply's usage.
- Q15-A: a replaced `completed` reply stops being addressable evidence.
- Q16-A: the notice is a persisted context item at the start of the new reply.
- Q17-A: the route is keyed on the user message.
- Q18-B: when Continue would keep no completed step, the web shows only Regenerate.
- Q19-A: one change, stacked as proposal, API Continue, API Regenerate, web, finalize.

Assumptions that follow from those answers but were not asked:

- A follow-up Run treats the context items that earlier Runs stored on the triggering user
  message as a retry of the same Run treats them (design D8). It adds a model-switch item only
  when its model differs from the model that the turn's context last announced.
- The Continue Run's own event log starts with the kept parts (design D5). A refresh during the
  Continue Run therefore replays the whole reply, and every attempt of that Run starts from the
  same kept parts.
- Continue with no completed step starts from the user message. The API accepts it; only the web
  hides the button.

## Capabilities

### New Capabilities

- `turn-actions`: owner actions that start a follow-up Run on the latest turn: the route,
  validation, availability, Continue and Regenerate semantics, the follow-up Run's usage, and the
  web actions.

### Modified Capabilities

- `durable-runs`: "One in-flight run per chat (single-flight)": a message id still produces at
  most one Run through a chat send, and only a follow-up Run adds another Run; follow-up requests
  pass the same single-flight admission.
- `available-models`: "Existing message ids conflict": scoped to a chat send, so the follow-up
  route can name a message that exists.
- `permission-modes`: "The accepted mode is fixed on its Run": the mode is the one accepted with
  the request that created the Run.
- `conversation-reads`: "Conversation reads derive authority only from trusted Run identity": a
  regenerated reply is not eligible evidence.
- `context-injection`: "An item is either persisted-literal or bind-time": a follow-up Run's
  dispatch can also remove in-Run items. ADDED: "A follow-up Run keeps the turn's stored context
  items" and "A Regenerate notice opens the new reply".
- `instruction-files`: "A file is loaded once per compaction epoch, derived from effective
  history": a follow-up Run's reset also removes in-Run bundles, and Continue keeps the bundles
  of the kept steps.
- `tool-calling`: "No mid-run tool-state checkpointing (read-only slice; write-tool landmine)":
  a later Run resumes earlier tool-loop state only through Continue. ADDED: "A stored tool part
  records the classification of a call that started".
- `model-system-prompts`: ADDED "A follow-up Run announces a model change against the turn's
  last model".

Deliberately unchanged:

- `durable-runs` "Final assistant-message projection preserves replay order" and
  `context-injection` "Server-authored context is injected as discrete items on one rail": a
  follow-up Run's dispatch creates or resets the reply with no parts, and its preparation reads
  history only through the triggering user message. Continue's kept parts come from the
  follow-up Run's own event log (design D5), not from the reply row.
- `tool-calling` "Tool observations survive into later turns as stored UI parts": it describes the
  record that a terminal attempt leaves. A later owner action that replaces the record is owned
  by `turn-actions`.
- `run-usage-accounting` "Usage records whether it is complete": it already states that a new
  reply's usage replaces an earlier reply's usage and does not carry its spend forward.
- `search-projection` "Lexical indexing is synchronous on turn completion, with async fallback
  and coalescing": it already rebuilds the projection after any regenerate.
- `chat-creation` "The message step commits the message and its Run before the enqueue": a resend
  as a new message stays valid after an enqueue failure; the follow-up route is an extra option.
- `workspace-entry`, `media-attachments`, `reasoning-output`, `chat-recency-digest`, and
  `temporal-anchor`: their rules are stated per Run or per attempt and hold for a follow-up Run
  unchanged.

## Impact

- API: a new route and service path that reuse the chat-send admission (single-flight, stuck-run
  expiry, dispatch, stream bridge); a new run event that carries Continue's kept parts; seeded
  part collection and finalization; Regenerate's reset of a `completed` reply; the notice
  producer; classification on stored tool parts; follow-up rules for accepted-turn context items
  and the model-switch item.
- OpenAPI: one new `streaming` path, which the generated web client excludes.
- Database: two migrations. `runs` gains the follow-up action and the source Run id. `messages`
  gains `revised_at`. The evidence predicate excludes revised rows.

## Non-Goals

- File rewind or restore of tool effects (a separate later feature).
- Sibling versions, a version switcher, or edits of user messages (#611).
- Automatic retry of a failed model request (#1049) and continuation across the queue's 24 h
  job expiry (#1048).
- Recovery of a non-terminal Run after worker death from semantic checkpoints (#309).
- Replay of a failed tool batch without a model call (the oh-my-pi tool-replay path).
- Continue on a `completed` reply that hit the step cap or the output limit.
- Usage history of replaced attempts (#170).
- Continue or Regenerate on a turn that is not the latest.

## Acceptance

- An owner continues a `failed` Run that completed three tool steps. The follow-up request
  carries those three steps with their reasoning metadata and no added user message. No tool
  executes again. The final reply holds the kept parts and the new parts in order.
- A refresh during a Continue Run shows the kept parts and the new parts.
- An owner regenerates a `completed` reply with another model. The reply shows only the new
  answer. `conversation_read` and `search_conversations` stop returning that reply.
- A Regenerate that discards a `bash` call shows a confirmation in the web, and the new reply's
  first part is the notice. A Regenerate that discards only `read_only` calls shows neither.
- A follow-up request on a turn that is not the latest, on a live Run, or on another owner's
  Chat changes nothing. The answers are 409, 409, and 404.
- A Continue request on a `completed` Run answers 409, and a Continue request that names
  `modelId` or `effort` answers 400.
- A turn whose first Run failed before any reply row existed can be regenerated.
