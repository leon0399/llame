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

- **Server command parser.** A send whose only part is a text part that starts with a recognized
  command name is a command. The server parses it before message validation, chat creation, and
  delivery admission, on `POST /api/v1/chats/:id/messages` and on the first message of
  `POST /api/v1/chats`. A command never becomes a message row, a Run input, or model context. The
  answer is a JSON command result, not a Run stream.
- **Unknown names pass through.** Only `/rename` and `/compact` are commands in this change. Any
  other text, including `/etc/hosts is broken` and `/unknown`, is an ordinary message. There is no
  escape syntax.
- **`/rename <title>`** sets the title as written (1-200 characters after trimming).
  **`/rename`** alone regenerates the title with the configured title model from a bounded excerpt
  of the recent user and assistant turns. Without a configured title model it fails with an inline
  error. It never uses the chat model. Both forms work while a Run is active.
- **`/compact [focus]`** on an idle Chat starts a durable **compaction Run**: a Run with no user
  message. It summarizes every user and assistant row after the active checkpoint and publishes a
  checkpoint, then completes. It uses the model and effort of the send. The optional focus
  (at most 1,000 characters) is an `Additional focus:` paragraph after the fixed summary
  instruction, cannot change the section headings or the redaction rules, and shows on the
  checkpoint boundary. A Chat with nothing to absorb gets an inline notice and no Run.
- **`/compact` during a live Run** becomes a pending queue item that keeps its command text. The
  server stores it as `queue` whatever `delivery` the send names, refuses a change to `steer` or
  `interrupt`, and starts a compaction Run when the queue promotes it. Compaction inside a running
  turn stays with [#1068](https://github.com/leon0399/llame/issues/1068).
- **Runs get a kind.** A Run is a `turn` or a `compaction`. The history read reports the kind of
  `latestRun`. Continue and Regenerate are not offered on a turn that a checkpoint absorbed, and
  the API refuses them with 409.
- **Web.** The composer sends commands through the ordinary send path and shows the command result
  or error inline, without an optimistic user message. A compaction Run shows progress and can be
  stopped. A pending command row offers only delete and edit.

No change is **BREAKING**. Command parsing affects only text that starts with `/rename` or
`/compact`.

## Assumptions, confirmed with Leo

The codes refer to the grilling record in `design.md`, "Grilling record".

- grilling D1: `/compact` on an idle Chat is a durable Run with no user message.
- grilling D2: command text never becomes a message or model context; the checkpoint is the
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
  queue re-parses it at promotion with the same parser. No new pending-item column.
- grilling D14: an owner compaction absorbs every committed user and assistant row after the
  active checkpoint, as automatic compaction absorbs everything before its trigger.
- grilling D15: the compaction Run uses the model and effort that the send names.
- grilling D16: only a Chat with nothing to absorb is refused; there is no minimum size.

Assumptions that follow from those decisions but that the grilling did not ask:

- A command is recognized only when the send has exactly one part, a text part, whose first
  character is `/` followed by a command name and then the end of the text or whitespace. A
  recognized name with a file part is refused with 400 rather than sent as a message.
- A command for a Chat that does not exist creates no Chat and answers 404. On `POST /api/v1/chats`
  (a new Chat), `/compact` gets the "nothing to compact" notice and `/rename` gets 404.
- A command on an archived Chat gets 409, as a send does.
- `/rename` does not need a valid `modelId`; `/compact` validates `modelId`, `effort`, and
  `permissionMode` as a send does.
- A retried `/compact` send with the same message id returns the same compaction Run: the message
  id becomes the Run id.
- A bare `/rename` overwrites any current title, generated or manual. Automatic titling stays
  write-once.
- A compaction Run that fails or is cancelled publishes nothing. A later automatic compaction is
  unaffected.
- A paused queue whose head is a command row starts it only after the next completed Run; the
  owner can delete it and type `/compact` again on the idle Chat.

## Capabilities

### New Capabilities

- `chat-commands`: the owner command parser at chat ingress, the command result, unknown-name
  pass-through, `/rename` in both forms, and `/compact` admission.

### Modified Capabilities

- `run-steering`: a command send during a live Run is always a queue item; a command row refuses a
  mode change; promotion of a command row starts a compaction Run, not a message; an idle-Chat
  command send does not start a turn Run; the web offers only delete and edit on a command row.
  MODIFIED: "A send with a delivery mode becomes a pending item during a live Run", "A send to an
  idle Chat starts a Run for every delivery mode", "The owner lists and changes pending items",
  "Queue items start one Run each after a completed Run", "A mode change on a paused item starts a
  Run", "The web shows pending items above the composer".
- `turn-actions`: `latestRun` reports its kind; a compaction Run and a turn that a checkpoint
  absorbed offer no follow-up. MODIFIED: "The chat history read reports the latest Run", "The
  latest turn shows Continue and Regenerate actions". ADDED: a follow-up on an absorbed turn is
  refused; a compaction Run offers no follow-up action.
- `durable-runs`: ADDED: a compaction Run executes as a durable Run with no user message, and a
  cancelled or failed compaction Run publishes nothing.
- `model-system-prompts`: ADDED: an owner compaction absorbs every committed row, takes a bounded
  focus, and fails its Run when it cannot publish.
- `available-models`: ADDED: an owner compaction selects its model from its own Run, with the
  existing window fallback.

Deliberately unchanged, with the reading under which each holds:

- `model-system-prompts` "Compaction publishes a summary-only checkpoint before the Run's first
  model step": it governs compaction that a turn Run's prepared request triggers. "the triggering
  user message" exists only for that case; the owner compaction requirements cover a compaction
  Run.
- `durable-runs` "Every message executes as a durable, resumable run": a command is not a user
  message. `/rename` writes chat metadata in the request thread, as `PATCH /api/v1/chats/:id`
  already does; "no inline (request-thread) execution path" applies to message execution.
- `durable-runs` "One in-flight run per chat (single-flight)": a compaction Run is a Run, so it
  holds the slot, and a send without `delivery` during it gets 409.
- `available-models` "Compaction inherits effort from the Run whose prefix it reuses": a
  compaction Run is that Run, and its effort is the send's effort.
- `available-models` "Model use for compaction and title generation is explicit": a bare
  `/rename` is title generation and uses `TITLE_GENERATION_MODEL_ID`; its inline error adds an
  owner-visible answer and keeps "does not fall back to `DEFAULT_MODEL_ID`".
- `run-usage-accounting` "Compaction uses the final request's size, not the aggregate": it
  governs the automatic trigger; an owner compaction has no trigger to evaluate.
- `run-usage-accounting` "Compaction and title spend stay separate categories": an owner
  compaction's usage stays on its checkpoint row, and a bare `/rename` records no usage.
- `run-cancellation` "A recorded cancellation settles the Run as cancelled": a compaction Run has
  no user message, so "no assistant message is persisted for its user message" holds vacuously,
  and the worker aborts its compaction request as the requirement says.
- `run-steering` "The composer offers delivery modes while a Run is active": Enter still sends a
  steer; the server stores a command as a queue item.
- `run-steering` "A delivered message gets its id from the system or the item": a promoted
  command row creates no user message.
- `run-steering` "A Chat title comes from the first message of its first Run": it governs
  automatic titles only.
- `context-injection` "Compaction is the rail's re-baseline boundary" and `chat-recency-digest`
  "Committed digest baselines remain stable until compaction": an owner checkpoint is a published
  checkpoint, so both re-baseline as they do today.

## Impact

- API: `chats.controller.ts`, `chat-loop.service.ts`, `chat-creation` admission, a new command
  module, `chat-deliveries.service.ts`, `queue-promotion.ts`, `run-execution.service.ts`,
  `runs-worker.service.ts`, `compaction/`, `titles/`, `follow-up-admission.service.ts`, the
  history DTOs, `asyncapi.queues.yaml` (`RunJob`), and `openapi.json`.
- Data: a generated migration adds `runs.kind` (`turn` | `compaction`, default `turn`). No change
  to `chat_deliveries` or `messages`.
- Web: the send path, the transcript, turn-action rules, the pending-item stack, the compaction
  boundary, and stories.
- Docs: `SPEC.md` §2.1 and §9, the operator compaction notes, and `CHANGELOG.md` in the shipping
  layers.

## Non-Goals

- Autocomplete and a command list endpoint (#1671, #1672).
- User-defined, operator-defined, or plugin commands (#1489).
- Compaction inside a running turn, or a steer or interrupt that compacts (#1068).
- Titles from the chat's own model or prompt-cache reuse for titles (#1096).
- Fixing the Anthropic adapter's removal of tool declarations when compaction sends
  `toolChoice: 'none'` (recorded in `design.md` for #1483).

## Acceptance

- `/rename Foo` and a bare `/rename` work on an idle Chat and during a live Run, through both
  ingress paths, and create no message, Run, or pending item.
- `/compact` and `/compact <focus>` on an idle Chat publish a checkpoint through a compaction Run;
  the next turn replays only the checkpoint and later rows.
- `/compact` during a Run is queued, runs after the Run completes, and then lets the queue promote
  its next item.
- Ordinary messages that start with `/` behave as today.
- Negative tests: commands against another owner's Chat reveal nothing; a command row refuses
  steer and interrupt; a follow-up on an absorbed turn is refused.
