## Why

The chat composer has no commands. An owner cannot compact a long chat at a natural break or steer
what the checkpoint keeps, because compaction runs only before a Run's first model step. A long
agentic turn therefore keeps growing until the provider rejects the request, and the turn's work is
lost ([#1068](https://github.com/leon0399/llame/issues/1068)). Renaming a chat needs the sidebar
menu. A chat whose topic drifted keeps the title of its first message, and nothing can regenerate
it ([#1675](https://github.com/leon0399/llame/issues/1675),
[#1676](https://github.com/leon0399/llame/issues/1676)). Peer harnesses compact inside the turn and
keep working; OpenCode also delivers a manual `/compact` as a steer and resumes unfinished work.
`design.md` records the prior art, the code facts, and the grilling decisions.

## What Changes

- **Server command parser.** A send to `POST /api/v1/chats/:id/messages` for a Chat of the owner is
  a command when its only part is text that starts with `/rename` or `/compact`. The server parses
  it before it validates the model or admits a pending item. Command text never becomes an owner
  message or model context. A command that runs at once answers with a JSON command result instead
  of a Run stream. A first message that creates a Chat is never a command, and `POST /api/v1/chats`
  is unchanged. Any other text, including `/etc/hosts is broken`, is an ordinary message. There is
  no escape syntax.
- **`/rename <title>`** sets the title as written (1-200 characters after trimming). **`/rename`**
  alone regenerates the title with the configured title model and the packaged title prompts, from
  a bounded, neutralized excerpt of the recent owner and assistant turns. Without a configured title
  model it fails inline. It never uses the chat model. Both forms work while a Run is active.
- **`/compact [focus]` on an idle Chat** starts a durable **compaction Run**: a Run with no user
  message. It summarizes every user and assistant row after the active checkpoint with the model and
  effort of the send, publishes a checkpoint, and completes. A Chat with nothing to absorb gets
  `Nothing to compact.` and no Run.
- **`/compact` during a live turn Run follows its delivery mode**, as any owner input does:
  - **steer** (Enter): the Run compacts at its next step boundary. As with any steer, a foreground
    host command moves to a background job, and a `wait` returns early.
  - **interrupt**: the current step stops at once, and the Run then compacts.
  - **queue** (Mod+Enter): a compaction Run starts after the Run completes.

  The owner can change a pending `/compact` between these modes like any other item.

- **Mid-turn (step-boundary) compaction.** At a step boundary, one transaction closes the reply of
  the segment, publishes a checkpoint that absorbs the turn so far, and continues the Run:
  - **Mid-work:** the Run stores a host message with a `compaction` notice. The notice tells the
    model to continue and quotes the owner's current request (at most 4,000 characters). The Run
    sends its next model request.
  - **At the final answer:** the Run completes after the checkpoint, and the Chat goes idle.
  - **A steer pending with the `/compact`:** it is delivered after the checkpoint as the owner
    message.
  - **Job notices:** notices that settle during the compaction land in the continue message, after
    the checkpoint.
  - **Request shape:** the summary request reuses the live request's model, effort, system prompt,
    and tool declarations.
  - **Failure:** a failed mid-turn compaction leaves no checkpoint, shows inline, and the Run
    continues.
- **Automatic mid-turn compaction.** At each boundary where the Run takes another step, the worker
  measures the next request. When the request reaches the model's compaction threshold, the Run
  compacts at that boundary. There is no count limit. A progress guard stops automatic compaction
  for the rest of the Run when a compaction leaves the next request still at the threshold. This
  closes #1068.
- **Focus.** The optional focus of `/compact` (at most 1,000 characters) is an `Additional focus:`
  paragraph after the fixed summary instruction. It cannot change the section headings or the
  redaction rules, and it shows on the checkpoint boundary.
- **Runs get a kind.** A Run is a `turn` or a `compaction`. The history read reports the kind of
  `latestRun`. During a compaction Run, owner items are stored as `queue` and job notices stay
  pending. When the compaction Run completes, the next queue item or a pending notice starts the
  next Run. Continue and Regenerate are not offered after a compaction Run.
- **Web.** On an existing Chat, the composer sends text that starts with `/` through the direct send
  path. It shows a command result or error inline without an optimistic message. The web shows:
  - a compaction Run as one transcript row with Stop;
  - a mid-turn compaction as the boundary followed by a muted continue notice;
  - a failed compaction inline.

No change is **BREAKING**. Command parsing affects only text that starts with `/rename` or
`/compact` sent to an existing Chat.

## Assumptions, confirmed with Leo

The codes refer to the grilling record in `design.md`, "Grilling record".

- grilling D1, D2, D3, D5-D11, D14-D16: see the record; unchanged since the first draft.
- grilling D12 (revised by Q22): `/compact` during a live Run follows its delivery mode. It is no
  longer queue-only.
- grilling D13: a pending `/compact` keeps its raw text in the existing pending-item storage, and
  delivery and promotion parse it again. No new pending-item column.
- grilling Q18: notices skip a compaction Run; its completion starts the idle-Chat notice Run.
- grilling Q20: independently mergeable layers under the new CONTRIBUTING review target.
- grilling Q21: after a mid-turn compaction, unfinished work continues; a turn that had completed
  goes idle.
- grilling Q22-A: `/compact` behaves like any owner input in each delivery mode.
- grilling Q23-B: compaction during a live Run happens inside that Run at a step boundary.
- grilling Q24-A: the automatic step-boundary trigger is part of this change and closes #1068.
- grilling Q25-A: after a mid-turn compaction, the model sees the checkpoint and a continue notice
  with the current request verbatim. Retaining a verbatim tail of recent turns is later work on
  [#1069](https://github.com/leon0399/llame/issues/1069).
- grilling Q26-A: a failed mid-turn compaction continues uncompacted and shows inline.
- grilling Q27-A: no count cap on automatic compaction; a progress guard only.

Decisions that the grilling did not ask, made in review. Leo, please confirm or change:

- **A command needs an existing Chat.** A first message is never a command.
- **A compaction Run takes no steer or interrupt.** It has no step boundary, so owner items sent
  during it are stored as `queue`.
- **`/compact` without `delivery` during a live Run gets 409**, as any send does. The web always
  sends a mode while a Run is active.
- **A compaction Run blocks Continue and Regenerate**, also when it failed.
- **A compaction Run reuses the stored system prompt of the Run of the newest completed reply**,
  with its own model and effort, no tools, and no receipt of its own. A mid-turn compaction has the
  live request and needs none of this.
- **A bare `/rename` reuses the existing title prompts**; a Chat with no turn gets `Nothing to
  name.`
- **A mid-turn compaction keeps the step budget.** The segment that a compaction starts gets only
  the steps that the segment before it did not use. A steer still gives a fresh budget.
- **A mid-turn compaction uses the model and effort of the live Run**, not the composer selection
  sent with the `/compact` steer. That keeps the summary request a prefix of the live request.
- **The focus of the first `/compact` item wins** when two are pending at one boundary.

Assumptions that follow from those decisions:

- A recognized name with a file part gets 400. A command on an archived Chat gets 409.
- `/rename` needs no valid `modelId`. `/compact` validates its settings as a send does, and on an
  idle Chat it expires a stuck Run as a send does.
- A bare `/rename` overwrites any current title. Automatic titling stays write-once.
- A failed or cancelled compaction Run publishes nothing and pauses the queue, as any Run that does
  not complete does. A settled job then starts no Run, as after a failed turn Run.
- A `/compact` steer wakes a Run that waits on jobs, as any steer does.

## Capabilities

### New Capabilities

- `chat-commands`: the owner command parser on the message endpoint, the command result,
  unknown-name pass-through, `/rename` in both forms with its excerpt, and `/compact` admission per
  delivery mode.

### Modified Capabilities

- `chat-creation`: MODIFIED "The first-message creation path is unchanged" (a command to a stored
  chat is its third exception).
- `run-steering`: MODIFIED "A send with a delivery mode becomes a pending item during a live Run",
  "A send to an idle Chat starts a Run for every delivery mode", "The owner lists and changes
  pending items", "Queue items start one Run each after a completed Run", "A mode change on a paused
  item starts a Run", "The queue pauses after a Run that does not complete", "The web shows pending
  items above the composer", "A segment attempt prepares its own accepted turn", "A pending item at
  the final answer continues the Run", "The items delivered at one boundary form one user message",
  "Each segment has its own step budget and retry scope", and "A delivered message is a Run event".
  ADDED: a command item compacts the Run once at its boundary; a compaction boundary stores a
  continue message; owner items during a compaction Run are queue items.
- `turn-actions`: MODIFIED "The chat history read reports the latest Run", "An owner starts a
  follow-up Run on the latest turn", and "The latest turn shows Continue and Regenerate actions".
  ADDED: a compaction Run offers no follow-up action and shows no assistant message or reply notice.
- `durable-runs`: ADDED: a compaction Run is a durable Run with no user message; one with nothing
  left to absorb completes; a cancelled one publishes nothing.
- `model-system-prompts`: ADDED: compaction-Run absorption, request, and failure; step-boundary
  absorption, request, continue notice, and failure; the automatic step-boundary trigger and its
  progress guard; the focus paragraph and its storage.
- `available-models`: ADDED: a compaction Run uses its own model with the window fallback; a
  step-boundary compaction uses the model and effort of the live Run.
- `background-jobs`: MODIFIED "A held notice goes with the next Run", "A host message carries
  notices when no owner message exists", "A notice starts a Run on an idle Chat", and "The web shows
  notices and host messages as notices".
- `context-injection`: MODIFIED "Co-occurring items have a total author-time order" (the
  `compaction` notice item and its rank).
- `media-attachments`: MODIFIED "Image overflow compacts at the start of the next Run" (the overflow
  condition, not every compaction, is limited to the first step).

Deliberately unchanged, with the reading under which each holds:

- `model-system-prompts` "Compaction publishes a summary-only checkpoint before the Run's first
  model step": it governs the pre-step trigger of a turn Run and says nothing about other points.
  Four of its rules do not apply to a step-boundary compaction:
  - its phrase "the triggering user message ... replayed verbatim after the checkpoint";
  - its checkpoint bound "below the triggering user message's sequence";
  - its `context_incompatible` failure;
  - its window variant.

  The ADDED step-boundary requirements govern that case.

- `model-system-prompts` "Summarization instructions and the title prompts are packaged
  templates": every owner variant renders the same packaged summarization template, with one
  sentence left out and one paragraph added. A bare `/rename` uses the same packaged title prompts.
  The automatic pre-step and title requests stay byte-identical.
- `model-system-prompts` "Every execution attempt resolves its effective context in the worker":
  it governs turn attempts. A compaction Run makes none. A step-boundary compaction runs inside a
  resolved attempt.
- `media-attachments` "Title generation receives image placeholders": it defines the input of the
  automatic title of a turn. A bare `/rename` uses the same placeholder lines.
- `run-usage-accounting` "Compaction uses the final request's size, not the aggregate" and
  `available-models` "Per-model compaction threshold": both describe the pre-step measurement. The
  step-boundary measurement is ADDED. "Compaction and title spend stay separate categories": every
  checkpoint keeps its own usage receipt, and a bare `/rename` records no usage.
- `available-models` "Model use for compaction and title generation is explicit" and "Compaction
  inherits effort from the Run whose prefix it reuses": a step-boundary compaction reuses the prefix
  of its own Run with that Run's model and effort. A compaction Run is its own Run.
- `durable-runs` "Every message executes as a durable, resumable run": a command is not a user
  message. `/rename` writes chat metadata in the request thread, as `PATCH /api/v1/chats/:id`
  already does.
- `durable-runs` "One in-flight run per chat (single-flight)": a compaction Run holds the slot. A
  send without `delivery` during any live Run, `/compact` included, gets 409.
- `durable-runs` "One waker resumes a Run that waits": a `/compact` steer or interrupt is an
  admitted steer or interrupt.
- `run-steering`:
  - "A delivered message starts a segment and an attempt", "A delivered message gets its id from
    the system or the item", "A steer closes its segment reply as completed", "A delivered item
    reaches the model exactly once", "An interrupted notice comes first in the delivered message",
    "The interrupted notice names stopped calls", "A notice item is delivered as a steer is", and
    "A steer and a notice signal the worker": the continue message is a delivered host message,
    its reply closes like a steer's or an interrupt's, and a `/compact` item is a steer or
    interrupt item.
  - "The composer offers delivery modes while a Run is active": Enter still sends a steer.
  - "A Chat title comes from the first message of its first Run": it governs automatic titles only.
- `turn-actions` "Regenerate replaces the reply of the latest turn": its start rule applies to a
  request that "An owner starts a follow-up Run on the latest turn" admits. "A turn that a host
  message started accepts follow-up Runs" covers the continue message, and a follow-up keeps its
  items.
- `tool-calling` "Absorbed tool activity crosses a checkpoint only as summary text": a step-boundary
  checkpoint absorbs the closed reply whole, after every call of the step has settled.
- `turn-replay` "A compaction request replays its rows like a later turn": both new requests replay
  their absorbed rows through the same projection.
- `run-cancellation` "A recorded cancellation settles the Run as cancelled" and "The Run stream
  identifies its Run at acceptance": a compaction Run has no user message, and the web drops its
  resumed assistant message. A step-boundary compaction ends the segment with a `run.delivered`
  event, as a steer does.
- `context-injection` "Compaction is the rail's re-baseline boundary" and `chat-recency-digest`
  "Committed digest baselines remain stable until compaction": every published checkpoint
  re-baselines, also one published mid-turn.
- `owner-chat-forks`: a fork copies checkpoints and host messages as rows, and the continue message
  has no text part.

## Impact

- API:
  - the chats controller and `chat-loop.service.ts` admission;
  - a command module;
  - `chat-deliveries.service.ts` and `segment-delivery.ts`;
  - `queue-promotion.ts`;
  - `run-execution.service.ts`: the step boundary, the final answer, and the compaction branch;
  - `runs-worker.service.ts`;
  - `compaction/`, `titles/`, and `job-notice-run.service.ts`;
  - the history DTOs, `asyncapi.queues.yaml` (`RunJob.userMessage` becomes optional), and
    `openapi.json`.
- Data: a generated migration adds `runs.kind` (`turn` | `compaction`, default `turn`). The
  checkpoint part payload gets `v: 2` with `focus`. A context-item form `notice` is added to the
  existing `compaction` producer. No change to `chat_deliveries`.
- Web:
  - the send path and the transcript (the compaction Run row, the mid-turn boundary, the continue
    and failure notices);
  - the turn-action rules;
  - resume and notifications;
  - the pending-item stack;
  - the compaction boundary;
  - the stories.
- Docs: `SPEC.md` §2.1 and §9, `docs/product/reference/`, and `CHANGELOG.md` in the shipping layers.

## Non-Goals

- Autocomplete and a command list endpoint (#1671, #1672).
- User-defined, operator-defined, or plugin commands (#1489).
- A verbatim tail of recent turns after a checkpoint (#1069).
- Titles from the chat's own model (#1096).
- The Anthropic adapter's removal of tool declarations when compaction sends `toolChoice: 'none'`
  (design D14, for [#1483](https://github.com/leon0399/llame/issues/1483)).
- Progressive compaction when no single request fits (#153).

## Acceptance

- **`/rename`:** `/rename Foo` and a bare `/rename` work on an idle Chat and during a live Run. They
  create no message, Run, or pending item.
- **Idle `/compact`:** `/compact` and `/compact <focus>` on an idle Chat publish a checkpoint
  through a compaction Run. The next turn replays only the checkpoint and later rows.
- **`/compact` as a steer mid-work:** the Run compacts at the next boundary and continues the task
  after the checkpoint. A foreground host command moves to a background job, and its result arrives
  as a notice.
- **`/compact` as a steer at the final answer:** the Run compacts and goes idle.
- **`/compact` as a queue item:** it compacts after the Run completes.
- **Automatic trigger:** a long agentic turn compacts itself at the threshold as often as it needs
  to and finishes without a provider overflow.
- **Ordinary text:** a first message and ordinary messages that start with `/` start their Run as
  today.
- **Negative tests:**
  - commands against another owner's Chat reveal nothing;
  - a compaction Run refuses steer and interrupt;
  - a follow-up after a compaction Run is refused;
  - a failed mid-turn compaction does not lose the turn.
