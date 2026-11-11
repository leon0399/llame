## Context

See `proposal.md` for the motivation. Facts below are at `048f75aa`.

- **Send ingress.** `POST /api/v1/chats/:id/messages` (`apps/api/src/chats/chats.controller.ts:328`)
  answers a UI-message stream (200) or a pending item (202). `ChatLoopService.send` validates the
  model, effort, permission mode, and parts before any write, then in one transaction resolves the
  Chat (creating it when the id is absent), admits the turn, admits the slot or stores a pending
  item, stores the user message, and creates the Run (`chat-loop.service.ts:186-470`).
  `POST /api/v1/chats` admits a first message through `ChatCreationService` and
  `ChatLoopService.startFirstRun` (`chat-loop.service.ts:271`).
- **Web send.** Ordinary sends use the AI SDK `DefaultChatTransport`, which adds an optimistic user
  message and expects a stream for every 2xx (`apps/web/app/(chat)/components/use-chat-engine.ts:339`).
  Delivery sends use a direct fetch (`apps/web/lib/services/chat/deliveries.ts`) that handles 202,
  or attaches to a started Run.
- **Titles.** `TitleService.maybeGenerateTitle` (`apps/api/src/titles/title.service.ts`) runs after a
  completed turn while `title IS NULL`, on `defaults.titleGenerationModelId`, with the first user
  text (≤1,000 characters), and swallows every error. `models.service.ts:227` returns no model when
  the id is unset. Title usage is not persisted. `PATCH /api/v1/chats/:id` sets a title of 1-200
  characters; `chat.upserted` carries it to every device.
- **Compaction.** Only automatic, before the first model step of a turn Run
  (`apps/api/src/runs/run-execution.service.ts:5855-5880`). `planCompactionCheckpoint`
  (`apps/api/src/compaction/compaction.ts:390-409`) absorbs user and assistant rows strictly between
  the active checkpoint and the triggering user message, and returns `null` when there are none.
  `CompactionService.summarizeCheckpoint` (`compaction.service.ts:179`) uses the triggering
  sequence only to find the active checkpoint and the previous completed reply Run. The summary
  request is the last user message after the replayed prefix, with `toolChoice: 'none'`
  (`compaction.service.ts:420-463`). `publishPreStepCompaction` (`run-execution.service.ts:6034-6110`)
  fences on the Run row, writes the checkpoint with its usage, and re-bakes the epoch. The
  instruction is `compaction/prompts/instruction.md`; line 18 describes the triggering message.
- **Checkpoint part.** `createCompactionCheckpointPart` (`apps/api/src/chats/context-item-producers.ts:670`)
  stores `payload: {v: 1, summary}` and a rendered `body`; replay reads the rendered text, and the
  history read reads the payload summary.
- **Runs.** `runs.message_id` is nullable (`apps/api/src/db/schema/chats.ts:349`). There is no Run
  kind; `follow_up_action` is `continue | regenerate | NULL`, and several sites read
  `followUpAction != null` as "a follow-up" (`run-execution.service.ts:5732,6759-6775`,
  `usage-completeness.ts:125,135`). `RunJob` requires `userMessage` (`apps/api/asyncapi.queues.yaml:253-278`).
  `findLatestByChatId` returns the newest Run of any kind (`runs-repository.ts:320`).
- **Queue.** Pending items live in `chat_deliveries` with raw `parts` and send `settings`
  (`apps/api/src/db/schema/chat-deliveries.ts:53-91`). `admitToSlot` stores the sent mode
  (`chat-loop.service.ts:~446`). `changeMode` changes a pending mode (`chat-deliveries.service.ts:90`).
  `promoteNextQueueItem` (`apps/api/src/runs/queue-promotion.ts:47`) runs in the completing Run's
  transaction (`run-execution.service.ts:5139-5149`) and stores the item as a user message.

## Grilling record

Decisions confirmed by Leo on 2026-11-11; `proposal.md` cites them as "grilling Dn".

| Code | Decision                                                                                                                 |
| ---- | ------------------------------------------------------------------------------------------------------------------------ |
| D1   | `/compact` on an idle Chat is a durable Run with no user message.                                                        |
| D2   | Command text is never a message or model context. The checkpoint is the in-band record.                                  |
| D3   | Focus: capped owner text, appended as `Additional focus:`, subordinate to headings and redaction, shown on the boundary. |
| D5   | Titles keep the dedicated title model, for automatic titles and a bare `/rename`.                                        |
| D6   | Only recognized names are commands; no escape syntax.                                                                    |
| D7   | One fixed server-side parser at ingress; no registry, list endpoint, or autocomplete.                                    |
| D9   | A bare `/rename` reads a bounded excerpt of recent turns.                                                                |
| D10  | A bare `/rename` without a title model fails inline.                                                                     |
| D11  | Two issues (#1675, #1676), one change, one stack.                                                                        |
| D12  | `/compact` during a live Run is queue-only; its row refuses steer and interrupt.                                         |
| D13  | A queued command keeps its raw text in `chat_deliveries`; promotion parses it again.                                     |
| D14  | An owner compaction absorbs every committed row after the active checkpoint.                                             |
| D15  | The compaction Run uses the model and effort of the send.                                                                |
| D16  | Only a Chat with nothing to absorb is refused.                                                                           |
| D17  | Split the compaction work across layers to stay inside the review budget.                                                |

Rejected during grilling: titles from the chat's own model (prefix-reuse measured as possible but
unproven as a cache hit, and 16-166× a small model at list prices; kept in #1096); a command
registry and autocomplete now; steer or interrupt for `/compact` (needs #1068); a `kind` column on
`chat_deliveries` (D13).

## Prior art

Source inspection only (OMP `73d7521`, OpenClaw `5d8c251`, Codex `e58bf8f`, OpenCode `51fcace`,
Open WebUI `b0e6098`; Claude Code public docs).

| Harness     | Dispatch                                        | `/compact`                                                                           | Bare `/rename`                                                  |
| ----------- | ----------------------------------------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| OMP         | client builtins, also over RPC/ACP              | session operation; `Additional focus:` appended to the summarizer prompt             | regenerates with the dedicated title model from recent context  |
| OpenClaw    | server gateway, shared by all channels          | `runSessionMutation` kind `compaction`, preempts the active run; `Additional focus:` | shows the current name                                          |
| Codex       | client                                          | `CompactTask` (`TaskKind::Compact`), no user input, ignores args                     | editable suggestion from recent messages                        |
| OpenCode    | server for prompt commands, TUI for UI commands | server `session.compact`, no focus                                                   | regenerates through the title agent                             |
| Open WebUI  | client parse, typed `POST /chats/{id}/compact`  | 409 while a task is active                                                           | none                                                            |
| Claude Code | client                                          | `/compact [instructions]`; summary request repeats system, tools, history            | regenerates from history; small/fast model for automatic titles |

Codex's `CompactTask` is the closest precedent for a compaction Run with no user input. OpenClaw is
the closest precedent for server-side dispatch across surfaces.

## Goals / Non-Goals

**Goals:** one parser that every current and future ingress path calls; a compaction Run that
reuses the existing summary request, publication transaction, cancellation, and queue promotion.

**Non-Goals:** a parser on the web; a command abstraction beyond the two commands; changes to the
automatic compaction trigger.

## Decisions

### D1: The parser runs first on each ingress path

`parseChatCommand(parts)` returns `{ name: 'rename' | 'compact', argument: string } | null`. It
reads the parts as sent, before `validateTurn` and `resolveChat`. A send is a candidate only with
exactly one text part whose first character is `/`; the name runs to the first whitespace or the
end. A recognized name with any file part is 400. `ChatsController.createMessage` and the
`POST /api/v1/chats` admission call it first; a hit goes to `ChatCommandsService`, and a miss goes
on unchanged. A follow-up request has no text and is not parsed.

`/compact` text that becomes a pending item still goes through `validateTurn` (model, effort,
permission mode, and neutralization), then `admitToSlot` forces mode `queue`. The focus is
neutralized with the same function as message text before it reaches a prompt.

Alternatives: parse inside `ChatLoopService.send` after `validateTurn` (rejected: `/rename` would
need a valid model, and `resolveChat` would create a Chat for a command); parse on the web
(rejected by D7).

### D2: The command result is 200 JSON on the existing route

The route already answers either an SSE stream (200) or JSON (202). A command answers 200 with
`Content-Type: application/json` and `ChatCommandResultResponse`:
`{ type: 'command', command: 'rename', title }` or `{ type: 'command', command: 'compact', runId }`.
Errors are ordinary Nest exceptions. The route stays tagged `streaming`, so orval does not
generate it; the response DTO is registered with `@ApiExtraModels` and parsed by hand on the web,
as the 202 branch is.

Alternative: a separate `POST /chats/:id/commands` (rejected by D7: every surface would parse).

### D3: The web sends every `/`-text through the direct send path

The web cannot know whether text is a command, and the AI SDK transport adds an optimistic user
message. So the composer sends any text that starts with `/` through the direct fetch that delivery
sends already use, idle or not. That path handles three answers: a command result (show it inline,
keep no optimistic message), 202 (a pending item), or a stream (attach to the started Run, as a
started delivery does). Errors restore the draft and show the server message inline. The web holds
no list of command names, so a later server command needs no web change to execute.

Alternative: a custom `fetch` in the transport that turns a JSON answer into an empty stream
(rejected: it still inserts and must then remove the optimistic message).

### D4: A bare `/rename` is a synchronous title request

`TitleService.regenerate({ chatId, userId })` returns the title or a typed failure
(`not_configured`, `failed`). It reads the newest user and assistant rows of the Chat, newest
first, and keeps their text and media placeholder lines until 1,000 characters, then restores
chronological order. A new packaged template `titles/prompts/conversation.md` frames the excerpt as
`<conversation>` with role-tagged messages. The request reuses `requestTitle` (structured, then text
fallback), the 10 s timeout, the `title` lane, and `sanitizeTitle`. The write uses
`ChatsRepository.update`, not the write-once `setGeneratedTitle`. `not_configured` maps to 422 and
`failed` to 502.

This runs in the request thread, like `PATCH /api/v1/chats/:id`. One bounded small-model request is
cheaper than a queued job and needs no new event: `chat.upserted` already delivers the title.

### D5: `runs.kind` marks a compaction Run

A generated migration adds `runs.kind text NOT NULL DEFAULT 'turn'` with a check for
`turn | compaction`. Existing rows become `turn`. `RunResponse` and `latestRun` gain `kind`. A
compaction Run has `message_id NULL` and `follow_up_action NULL`.

Alternatives: a new `follow_up_action` value (rejected: several sites read any non-null value as a
follow-up); `message_id IS NULL` as the marker (rejected: the FK sets it to null when a message is
deleted).

### D6: The focus travels on `run.created`

The `run.created` event of a compaction Run carries `compaction: { focus: string | null }`, as it
already carries `notice` and `replacesUsage`. The worker reads it at pickup, so a retried claim
uses the same focus. The published checkpoint stores it as `payload: { v: 2, summary, focus }`;
`checkpointSummary` accepts `v: 1` and `v: 2`. The rendered checkpoint text, which replay reads, is
built from the summary only.

Alternative: a `runs.compaction_focus` column (rejected: a second schema change for a value that
only the worker and the checkpoint read).

### D7: `RunJob` becomes a union by kind

`asyncapi.queues.yaml` makes `RunJob` a discriminated union: `kind: 'turn'` with `userMessage`, and
`kind: 'compaction'` without it. `pnpm --filter api generate:queue-protocol` regenerates the parser.
A job without `kind` is read as `turn`, so jobs enqueued before the deploy still run.

### D8: The worker runs a compaction Run on its own branch

`executeRun` branches on `run.kind` right after the claim transaction. `executeCompactionRun`:

1. Reads the focus from `run.created` and the rows of the Chat.
2. Plans with `planCompactionCheckpoint({ rows, boundarySeq, triggeringUserSeq: nextSeq })`, so
   every committed row is absorbed. A `null` plan completes the Run with no checkpoint (a race after
   admission; admission already refuses an empty plan).
3. Prepares the system prompt and tool declarations of the Run's model through the attempt
   preparation that a turn's first attempt uses, with no staged user turn, and binds the attempt's
   receipt. The summary request is then the same cache-aligned continuation as a threshold
   compaction. If the prepared request does not fit the window of the Run's model, it takes the
   `window` variant: the previous completed turn Run's model, receipt, and effort.
4. Calls `summarizeCheckpoint` with an `owner` variant: the template renders without the trigger
   sentence of `instruction.md:18`, and appends the focus paragraph.
5. Publishes through the same transaction as `publishPreStepCompaction` (fence, checkpoint with
   usage, epoch re-bake) with an input that has no user message, then completes the Run through
   `finishRunInTransaction` with no reply, so queue promotion runs.

A summary failure ends the Run `failed`; cancellation aborts the summary request through the Run's
abort signal, as today. No `model.requested` event is written, so the progress phase stays
`queued`; the web shows its own row (D11).

If step 3 cannot run without a staged user turn inside the L2 budget, the fallback is the `window`
request shape with the Run's own model (no tool declarations, previous receipt). The specs fix only
the model and effort, so the fallback changes no requirement; it costs the prompt-cache read on the
Responses wire.

### D9: A follow-up after an owner compaction is refused

`admitFollowUpRun` reads the active checkpoint after `lockLatestTurn`. When its absorbed-through
sequence is at or above the latest user message's sequence, it answers 409. Automatic compaction
never absorbs its triggering message, so only an owner compaction reaches this case.

### D10: A queued `/compact` is a parsed `chat_deliveries` row

- `admitToSlot` stores mode `queue` when the parser reads the parts as `/compact`.
- `ChatDeliveryResponse` gains `command: 'compact' | null`, computed by the parser, so the web does
  not parse.
- `changeMode` loads the item after the Chat lock and answers 400 for a command item.
- `startItemRun` branches: a command item creates a compaction Run with the item's id as the Run id
  and settings, writes the focus on `run.created`, and marks the item delivered with no message id
  (the column is nullable; `markDelivered` takes an optional id).
- `deliverPendingSteering` reads only `steer` and `interrupt` rows, so a command row never enters a
  live Run.

### D11: The web shows a compaction Run as one transcript row

When `latestRun.kind` is `compaction`, the transcript ends with a "Compacting context" row while the
Run is live, with Stop (`cancelRun`), and an error row with no action when it failed or expired.
`turn-action-rules.ts`, `history-adoption.ts`, and the busy check in `deliveries.ts` read `kind`.
The web refetches history when the Run ends, so the boundary appears. `compaction-boundary.tsx`
shows the focus under the summary.

### D12: The Anthropic tool-drop finding stays out of scope

A loopback probe through llame's own clients showed that `@ai-sdk/anthropic` 3.0.118 removes every
tool declaration when `toolChoice` is `'none'` (`anthropic-prepare-tools.ts:424-426`), so a
compaction request on the Messages wire does not share the tools prefix of the turn. This affects
automatic and owner compaction alike, belongs to compaction fidelity
([#1483](https://github.com/leon0399/llame/issues/1483)), and changes no requirement here.

## Risks / Trade-offs

- [The attempt preparation assumes a staged user turn] → D8 names a fallback that keeps the specs;
  L2 decides with a focused test and records the choice in its PR.
- [L2 exceeds the review budget] → the web half is its own layer (L3); re-estimate at the L2
  boundary and split focus into its own layer if needed.
- [A compaction Run as `latestRun` confuses client code that assumes a message] → `kind` on every
  Run response, and L3 updates every reader that the code facts list.
- [Owner text in a summary prompt] → the focus is neutralized, capped at 1,000 characters, placed
  after the fixed instruction, and the instruction keeps headings and redaction above it. It is the
  same trust level as any owner message.
- [A queued command row stays behind a paused queue] → it starts after the next completed Run; the
  owner can delete it and type `/compact` on the idle Chat.
- [The web sends every `/`-text through the direct path] → an ordinary `/etc/hosts` message has no
  optimistic bubble until the Run attaches; the path already exists for delivery sends.

## Migration Plan

The migration adds one defaulted column; existing Runs read as `turn`. `RunJob` accepts jobs without
`kind`. Rollback: revert the layers; drop `runs.kind` only after no compaction Run is live. Deleting
compaction Run rows is not required, because their checkpoints are ordinary checkpoints.

## Revision history

- **r0 (2026-11-11):** Initial draft.
