## Why

The chat composer has no commands. An owner cannot compact a long chat at a natural break or steer
what the checkpoint keeps, because compaction runs only before a Run's first model step when the
request reaches the threshold or the window. Renaming a chat needs the sidebar menu. A chat whose
topic drifted keeps the title generated from its first message, and nothing can regenerate it
([#1675](https://github.com/leon0399/llame/issues/1675),
[#1676](https://github.com/leon0399/llame/issues/1676)). Peer harnesses ship both commands: Claude
Code, OMP, and OpenClaw accept `/compact [focus]`, and OMP, OpenCode, and Claude Code regenerate a
title on a bare `/rename`. `design.md` records the prior art, the code facts, and the grilling
decisions.

## What Changes

- **Server command parser.** A send to `POST /api/v1/chats/:id/messages` for a Chat of the owner is
  a command when its only part is text that starts with `/rename` or `/compact`. The server parses
  it before it validates the model or admits a pending item. A command never becomes a message row
  or turn-Run context, and it answers with a JSON command result instead of a Run stream. A first
  message that creates a Chat is never a command, and `POST /api/v1/chats` is unchanged.
- **Unknown names pass through.** Any other text, including `/etc/hosts is broken` and
  `/unknown`, is an ordinary message. There is no escape syntax.
- **`/rename <title>`** sets the title as written (1-200 characters after trimming).
  **`/rename`** alone regenerates the title with the configured title model and the packaged title
  prompts, from a bounded excerpt of the recent user and assistant turns. Without a configured
  title model it fails with an inline error. It never uses the chat model. Both forms work while a
  Run is active.
- **`/compact [focus]`** on an idle Chat starts a durable **compaction Run**: a Run with no user
  message. It summarizes every user and assistant row after the active checkpoint with the model
  and effort of the send, publishes a checkpoint, and completes. The optional focus (at most 1,000
  characters) is an `Additional focus:` paragraph after the fixed summary instruction. It cannot
  change the section headings or the redaction rules, and it shows on the checkpoint boundary. A
  Chat with nothing to absorb gets `Nothing to compact.` and no Run.
- **`/compact` during a live Run** with a `delivery` mode becomes a pending queue item that keeps its
  command text. It refuses a change to `steer` or `interrupt` and starts a compaction Run when the
  queue promotes it. Without `delivery` it gets 409, as a send does. Compaction inside a running
  turn stays with [#1068](https://github.com/leon0399/llame/issues/1068).
- **A compaction Run takes no steer.** While a compaction Run is live, every pending item is
  stored as `queue`, and a change to `steer` or `interrupt` gets 400.
- **Runs get a kind.** A Run is a `turn` or a `compaction`. The history read reports the kind of
  `latestRun`. A follow-up request needs the newest Run of the Chat to be a turn Run of the latest
  message, so Continue and Regenerate are not offered after a compaction Run.
- **Web.** On an existing Chat, the composer sends text that starts with `/` through the direct
  send path that delivery sends use. It shows a command result or error inline without an
  optimistic message, and an ordinary `/` message attaches to its Run. A compaction Run shows as one
  transcript row with Stop. A pending command row offers only delete and edit.

No change is **BREAKING**. Command parsing affects only text that starts with `/rename` or
`/compact` sent to an existing Chat.

## Assumptions, confirmed with Leo

The codes refer to the grilling record in `design.md`, "Grilling record".

- grilling D1: `/compact` on an idle Chat is a durable Run with no user message.
- grilling D2: command text never becomes a message or turn-Run context; the checkpoint is the
  in-band record of a compaction.
- grilling D3: focus is capped owner guidance appended after the fixed instruction, subordinate to
  its headings and redaction, and shown on the checkpoint boundary.
- grilling D5: titles keep the dedicated title model, for automatic titles and for a bare
  `/rename`. Titles from the chat's own model stay with
  [#1096](https://github.com/leon0399/llame/issues/1096).
- grilling D6: only recognized command names are intercepted; there is no escape syntax.
- grilling D7: one fixed server-side parser at ingress; no registry, no list endpoint, and no
  autocomplete ([#1671](https://github.com/leon0399/llame/issues/1671),
  [#1672](https://github.com/leon0399/llame/issues/1672)). Runtime plugins
  ([#1489](https://github.com/leon0399/llame/issues/1489)) extend the same dispatch point later.
- grilling D9: a bare `/rename` reads a bounded excerpt of recent turns.
- grilling D10: a bare `/rename` without a configured title model fails inline.
- grilling D11: two issues, one change, one stack.
- grilling D12: `/compact` during a live Run is queue-only; the pending row cannot become a steer
  or an interrupt.
- grilling D13: a queued command keeps its raw text in the existing pending-item storage; the
  queue parses it again at promotion. No new pending-item column.
- grilling D14: an owner compaction absorbs every committed user and assistant row after the
  active checkpoint, as automatic compaction absorbs everything before its trigger.
- grilling D15: the compaction Run uses the model and effort that the send names.
- grilling D16: only a Chat with nothing to absorb is refused; there is no minimum size.
- grilling D17: the compaction work is split across layers to stay inside the review budget.

Decisions that the grilling did not ask, made in review round 1. Leo, please confirm or change:

- **A command needs an existing Chat.** A first message that creates a Chat is stored as an
  ordinary message, and `POST /api/v1/chats` parses nothing. A new Chat has nothing to rename or
  compact, and this keeps `chat-creation` unchanged.
- **A compaction Run takes no steer or interrupt.** A compaction Run has no step boundary, so a
  steer sent during it is stored as a queue item and runs after it. Without this, the completion
  path would fold the steer into the compaction Run.
- **`/compact` without `delivery` during a live Run gets 409**, as any send does. The web always
  sends a mode while a Run is active, so this changes nothing for the composer.
- **A compaction Run blocks Continue and Regenerate**, also when it failed. The existing follow-up
  check already refuses when the newest Run is not the message's Run.
- **The summary request of a compaction Run has no tool declarations.** It holds the Run's own
  system prompt, the absorbed rows, and the instruction. Building the tool set of a turn without a
  user turn is a large refactor, and on the Messages wire the adapter drops the tools of a
  compaction request anyway (design D12). The cost is no cache read of the turn's tool prefix.
- **A bare `/rename` reuses the existing packaged title prompts** and puts the role-tagged excerpt
  where the first message goes today. No new template.

Assumptions that follow from those decisions:

- A recognized name with a file part gets 400 rather than going to the model.
- A command on an archived Chat gets 409, as a send does.
- `/rename` needs no valid `modelId`; `/compact` validates `modelId`, `effort`, and
  `permissionMode` as a send does, and expires a stuck Run as a send does.
- A bare `/rename` overwrites any current title. Automatic titling stays write-once.
- A failed or cancelled compaction Run publishes nothing and pauses the queue, as any Run that does
  not complete does.
- `/compact` on a Chat with a paused queue counts as an owner act, so the queue resumes after the
  compaction Run completes.

## Capabilities

### New Capabilities

- `chat-commands`: the owner command parser on the message endpoint, the command result,
  unknown-name pass-through, `/rename` in both forms with its excerpt, and `/compact` admission.

### Modified Capabilities

- `run-steering`: MODIFIED "A send to an idle Chat starts a Run for every delivery mode", "The owner
  lists and changes pending items", "Queue items start one Run each after a completed Run", "A mode
  change on a paused item starts a Run", "The queue pauses after a Run that does not complete", and
  "The web shows pending items above the composer". ADDED: a command item and every item sent
  during a compaction Run are queue items.
- `turn-actions`: MODIFIED "The chat history read reports the latest Run" (adds `kind`), "An owner
  starts a follow-up Run on the latest turn" (the newest Run must be a turn Run of the message),
  and "The latest turn shows Continue and Regenerate actions" (a terminal turn Run). ADDED: a
  compaction Run offers no follow-up action and shows no assistant message.
- `durable-runs`: ADDED: a compaction Run is a durable Run with no user message; one with nothing
  left to absorb completes; a cancelled one publishes nothing.
- `model-system-prompts`: ADDED: an owner compaction absorbs every committed row, sends no tool
  declarations, takes a bounded focus that shows on the checkpoint but is not replayed, and fails
  its Run when the summary fails.
- `available-models`: ADDED: an owner compaction uses the model and effort of its Run, with the
  existing window variant as the only fallback.

Deliberately unchanged, with the reading under which each holds:

- `model-system-prompts` "Compaction publishes a summary-only checkpoint before the Run's first
  model step": it governs compaction that a turn Run's prepared request triggers. "The triggering
  user message" exists only for that case.
- `model-system-prompts` "Summarization instructions and the title prompts are packaged
  templates": the owner variant renders the same packaged summarization template with one sentence
  left out and one paragraph added, and a bare `/rename` uses the same packaged title prompts. The
  automatic title and compaction requests stay byte-identical.
- `media-attachments` "Title generation receives image placeholders": it defines the input of the
  automatic title of a turn ("the titled turn's user message"). A bare `/rename` has no titled turn;
  its excerpt uses the same placeholder lines.
- `durable-runs` "Every message executes as a durable, resumable run": a command is not a user
  message. `/rename` writes chat metadata in the request thread, as `PATCH /api/v1/chats/:id`
  already does; "no inline (request-thread) execution path" applies to message execution.
- `durable-runs` "One in-flight run per chat (single-flight)": a compaction Run is a Run, so it
  holds the slot, and a send without `delivery` during any live Run, `/compact` included, gets 409.
- `run-steering` "A send with a delivery mode becomes a pending item during a live Run": a pending
  item still answers 202 with no Run and no message; the ADDED requirement fixes its mode.
- `run-steering` "The composer offers delivery modes while a Run is active": Enter still sends a
  steer; the server stores it as a queue item when the ADDED requirement says so.
- `run-steering` "A delivered message gets its id from the system or the item": a promoted command
  item creates no user message.
- `run-steering` "A Chat title comes from the first message of its first Run": it governs
  automatic titles only.
- `run-steering` scenario "A failed Run shows a paused queue" ("the Continue action stays
  available"): Continue exists only for a failed turn Run.
- `turn-actions` "Regenerate replaces the reply of the latest turn": its start rule applies to a
  request that "An owner starts a follow-up Run on the latest turn" admits.
- `run-cancellation` "The Run stream identifies its Run at acceptance": a compaction Run is the
  active Run, so its resume stream starts with the `start` frame as required; the web drops the
  empty assistant message for a compaction Run.
- `run-cancellation` "A recorded cancellation settles the Run as cancelled": a compaction Run has no
  user message, so "no assistant message is persisted for its user message" holds, and the worker
  aborts its summary request as the requirement says.
- `available-models` "Compaction inherits effort from the Run whose prefix it reuses" and "Model use
  for compaction and title generation is explicit": a compaction Run is that Run, and the window
  variant keeps its source Run. A bare `/rename` uses `TITLE_GENERATION_MODEL_ID`, and its error
  adds an owner-visible answer without a fallback to `DEFAULT_MODEL_ID`.
- `run-usage-accounting` "Compaction uses the final request's size, not the aggregate": it governs
  the automatic trigger; an owner compaction evaluates no trigger. "Compaction and title spend stay
  separate categories": owner compaction usage stays on its checkpoint row, and a bare `/rename`
  records no usage.
- `chat-creation`: unchanged, because a send that creates a Chat is never a command.
- `context-injection` "Compaction is the rail's re-baseline boundary" and `chat-recency-digest`
  "Committed digest baselines remain stable until compaction": an owner checkpoint is a published
  checkpoint, so both re-baseline as they do today.

## Impact

- API: `chats.controller.ts`, `chat-loop.service.ts` admission, a new command module,
  `chat-deliveries.service.ts`, `queue-promotion.ts`, `run-execution.service.ts`,
  `runs-worker.service.ts`, `compaction/`, `titles/`, the history DTOs, `asyncapi.queues.yaml`
  (`RunJob.userMessage` becomes optional), and `openapi.json`.
- Data: a generated migration adds `runs.kind` (`turn` | `compaction`, default `turn`). The
  checkpoint part payload gets `v: 2` with `focus`. No change to `chat_deliveries`.
- Web: the send path, the transcript, turn-action rules and actions, resume, the pending-item stack,
  the compaction boundary, and stories.
- Docs: `SPEC.md` §2.1 and §9, `docs/product/reference/`, and `CHANGELOG.md` in the shipping layers.

## Non-Goals

- Autocomplete and a command list endpoint (#1671, #1672).
- User-defined, operator-defined, or plugin commands (#1489).
- Compaction inside a running turn, or a steer or interrupt that compacts (#1068).
- Titles from the chat's own model or prompt-cache reuse for titles (#1096).
- The Anthropic adapter's removal of tool declarations when compaction sends `toolChoice: 'none'`
  (design D12, for [#1483](https://github.com/leon0399/llame/issues/1483)).

## Acceptance

- `/rename Foo` and a bare `/rename` work on an idle Chat and during a live Run, and create no
  message, Run, or pending item.
- `/compact` and `/compact <focus>` on an idle Chat publish a checkpoint through a compaction Run;
  the next turn replays only the checkpoint and later rows.
- `/compact` with a delivery mode during a Run is queued, runs after the Run completes, and then lets
  the queue promote its next item. A steer during a compaction Run runs after it.
- A first message and ordinary messages that start with `/` behave as today.
- Negative tests: commands against another owner's Chat reveal nothing; a command item and a
  compaction Run refuse steer and interrupt; a follow-up after a compaction Run is refused.
