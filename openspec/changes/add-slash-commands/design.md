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
| D17  | Split the compaction work across layers to stay inside the review budget (eight implementation layers after round 2).    |

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

**Goals:** one parser on the message endpoint that later commands and surfaces reuse; a compaction
Run that reuses the existing summary request, publication transaction, cancellation, and queue
promotion.

**Non-Goals:** a parser on the web; a command abstraction beyond the two commands; changes to the
automatic compaction trigger.

## Decisions

### D1: The parser runs first on the message endpoint, for an existing Chat

`parseChatCommand(parts)` returns `{ name: 'rename' | 'compact', argument: string } | null`. A send
is a candidate only with exactly one text part whose first character is `/`; the name runs to the
first whitespace or the end. `ChatsController.createMessage` calls it first. On a hit,
`ChatCommandsService` looks the Chat up in the owner scope without creating it. When the Chat does
not exist for the owner, the send goes on unchanged, so a first message creates its Chat as today
and another owner's Chat id keeps its 404. The lookup comes first: only for a Chat of the owner is a
recognized name with a file part 400. `POST /api/v1/chats` and follow-up requests are not parsed.

The lookup runs before the send's transaction. Two tabs that send a first message to one new id at
the same time can store `/rename Foo` as an ordinary message in the Chat that the other tab created.
This race needs two first sends to one client-generated id and is accepted.

`/rename` runs without `validateTurn`. `/compact` validates the send settings with the same
functions as `validateTurn`, and its focus is neutralized with the message-text neutralizer before
it reaches a prompt.

Alternatives: parse inside `ChatLoopService.send` after `validateTurn` (rejected: `/rename` would
need a valid model, and `resolveChat` creates a Chat); parse on the web (rejected by grilling D7);
parse `POST /api/v1/chats` too (rejected: a new Chat has nothing to rename or compact, and it would
change `chat-creation`).

### D2: The command result is 200 JSON on the existing route

The route already answers either an SSE stream (200) or JSON (202). A command answers 200 with
`Content-Type: application/json` and `ChatCommandResultResponse`:
`{ type: 'command', command: 'rename', title }` or `{ type: 'command', command: 'compact', runId }`.
Errors are ordinary Nest exceptions; the web reads `message` from the JSON error body. The route stays tagged `streaming`, so
orval does not generate it; the response DTO is registered with `@ApiExtraModels` and parsed by
hand on the web, as the 202 branch is.

### D3: The web sends `/`-text on an existing Chat through the direct send path

The AI SDK transport adds an optimistic user message before the answer arrives. So, when the Chat
exists, the composer sends text that starts with `/` through the direct fetch that delivery sends
use, idle or not. `sendDelivery` gains a 200-JSON branch. The path handles four answers:

- a command result: show it inline, add no message, and invalidate the history query, so
  `latestRun` names a started compaction Run;
- 202: a pending item, as today;
- a stream: attach to the started Run, as a started delivery does;
- an error: restore the draft and show the server message inline, not the generic toast.

On the new-Chat page the composer keeps its current path, because a first message is never a
command. The web holds no list of command names.

Alternative: a custom `fetch` in the transport that turns a JSON answer into an empty stream
(rejected: it still inserts and then has to remove the optimistic message).

### D4: A bare `/rename` is one synchronous title request

`TitleService.regenerate({ chatId, userId })` returns the title or a typed failure
(`not_configured`, `empty`, `failed`). The command service checks archived and the title model
before any model request. The excerpt reads the newest `user` and `assistant` rows (no checkpoint,
system, or tool rows), renders each as a `User:` or `Assistant:` line group with its text parts and
media placeholder lines, and passes each group through `sanitizeAuthoredText`, so stored assistant
text cannot close the `<user>` block of the template. It takes groups newest first until 1,000
UTF-16 code units, tags and line breaks included, keeps the start of the group it cuts, and
restores stored order. It does not pass the result through `titlePromptInput` again, which would
cut the newest end. An empty excerpt is `empty`.

The excerpt goes into the existing packaged title user prompt where the first message goes today,
with the existing title system prompt, so the fake model client and the automatic path stay
unchanged. `requestTitle` is private and builds its prompt from user text; the refactor passes the
rendered input in and maps a thrown fallback or an empty `sanitizeTitle` result to `failed`. The
title stays capped at 80 characters by `sanitizeTitle`. The write uses `ChatsRepository.update`,
which bumps `updatedAt` and so moves the Chat to the top of the sidebar, as a sidebar rename does.
The command service enforces the 1-200 limit for `/rename <title>`, because that limit lives only in
`UpdateChatDto`. `not_configured` maps to 422, `empty` to 409 `Nothing to name.`, and `failed` to 502.

This runs in the request thread, like `PATCH /api/v1/chats/:id`, under the existing 10 s title
timeout. `chat.upserted` already delivers the title to every device.

### D5: `runs.kind` marks a compaction Run

A generated migration adds `runs.kind text NOT NULL DEFAULT 'turn'` with a check for
`turn | compaction`. Existing rows become `turn`. `RunResponse` and `latestRun` gain `kind`. A
compaction Run has `message_id NULL` and `follow_up_action NULL`. The `runs_owner` policy does not
read columns, so the column needs no policy change.

Alternatives: a new `follow_up_action` value (rejected: several sites read any non-null value as a
follow-up); `message_id IS NULL` as the marker (rejected: the FK sets it to null when a message is
deleted).

### D6: The focus travels on `run.created` and lands in checkpoint payload `v: 2`

The `run.created` event of a compaction Run carries `compaction: { focus: string | null }`, as it
already carries `notice` and `replacesUsage`. The worker reads it at pickup, so a retried claim
uses the same focus. A checkpoint published with a focus stores `payload: { v: 2, summary, focus }`.
`checkpointSummary` accepts `v: 1` and `v: 2`, and the history read returns `focus`. The rendered
checkpoint text, which replay reads, is built from the summary only. Forks copy the part as it is.

The reader change lands in the same layer as the first `v: 2` writer (`compact-focus`). During a
rolling deploy of that layer, an API pod that still runs the old reader fails a history read that
meets a `v: 2` checkpoint until the rollout finishes; llame deploys API and worker together, and
this window is accepted. Reverting
that layer needs one data fix first, because the old reader throws on `v: 2`:
`UPDATE messages SET parts = jsonb_set(parts, '{0,data,payload}', (parts->0->'data'->'payload') - 'focus' || '{"v":1}') WHERE role = 'checkpoint' AND parts->0->'data'->'payload'->>'v' = '2'`.

Alternative: a `runs.compaction_focus` column (rejected: a second schema change for a value that
only the worker and the checkpoint read).

### D7: `RunJob.userMessage` becomes optional

`asyncapi.queues.yaml` makes `userMessage` optional, and `pnpm --filter api generate:queue-protocol`
regenerates the parser; the generator turns a property outside `required` into `.optional()`. The
worker already reads the claimed row at pickup and branches on `runs.kind`. For a turn Run it
narrows `job.userMessage` before `executeRun`, so `ExecuteRunInput.userMessage` stays required and
no test fixture changes. A turn job without `userMessage` is dead-lettered and its Run expires, as a
malformed job is today. During a rolling deploy, an old worker dead-letters a compaction job in the
same way; the owner sends `/compact` again.

### D8: The worker runs a compaction Run on its own branch

`runs-worker.service.ts` calls `executeCompactionRun` instead of `executeRun` for a compaction Run;
it returns no model stream for the worker to drain. The branch:

1. Claims the Run (the claim transaction of `executeRun`, extracted) and reads the focus from
   `run.created`.
2. Plans with `planCompactionCheckpoint({ rows, boundarySeq, triggeringUserSeq: nextSeq })`, so
   every committed row is absorbed. A `null` plan completes the Run with no checkpoint and no model
   request (two queued `/compact` items in a row).
3. Finds the source Run with the existing `findCompletedReplyRunBefore({ beforeSeq: nextSeq })`,
   which never returns a compaction Run. When the absorbed rows fit the window of the Run's model,
   it sends the source Run's stored receipt prompt (or no system prompt without a source Run), the
   Run's model and effort, no tool declarations, and the existing `toolChoice: 'none'`, with a
   `createRunMediaResolver` for `media://` rows. When they do not fit, it uses the existing `window`
   variant unchanged, and without a source Run the Run fails with `ContextIncompatibleError`. The
   compaction Run binds no receipt in either case, as the window variant binds none for its
   summary.
4. Calls `summarizeCheckpoint` with an `owner` variant. `COMPACTION_INSTRUCTION` becomes a render
   function: the owner variant leaves out the second sentence of `instruction.md:18` ("The newer
   triggering user message follows that prefix …") and keeps the `Latest Request` and fold
   sentences. The owner variant throws on a failed or empty summary, where the automatic variant
   returns `null`. The automatic request stays byte-identical, and a test pins it.
5. Publishes and completes in one transaction: it locks the Run, settles it `cancelled` with no
   checkpoint when a cancellation is recorded, and otherwise writes the checkpoint with its usage,
   re-bakes the digest and Workspace epoch state as `publishPreStepCompaction` does, and completes
   the Run with no reply. Steering delivery is skipped for a compaction Run, and queue promotion
   runs.

The skill epoch is not re-baked by the compaction Run, because it has no Workspace root. The next
turn starts it: `resolveTurnSkillState` (`apps/api/src/chats/skill-turn-state.ts:93-119`) starts a
new epoch when the stored baseline does not match the latest checkpoint, and the turn passes its own
Workspace root (`run-execution.service.ts:6240`). No `model.requested` event is written.

Alternative for step 3: render a fresh system prompt for the Run's model (rejected: it needs the
Workspace preparation, the composed tool catalog, the digest, and personalization of a turn, about
200 more lines, and with no admitted tools an operator template that renders only tool-gated text
fails). Alternative: prepare a full first attempt without a user turn, for a prompt-cache read of
the turn prefix (rejected for this change: `prepareAttemptContext` reads the trigger message at
seven sites, and the Messages adapter drops the tools of a compaction request anyway, D12).

### D9: The existing follow-up check refuses after a compaction Run

`latestTurnRun` (`apps/api/src/chats/follow-up-admission.service.ts:562-575`) answers 409 when the
newest Run of the Chat does not belong to the latest user message. A compaction Run has no
message, so a follow-up after any compaction Run, failed ones included, is refused with no new
code. The turn-actions delta records this, and a test pins it.

### D10: Queue items for commands and during a compaction Run

- `/compact` admission is one tenant transaction owned by `ChatCommandsService`: lock the Chat
  without creating it, assert it is not archived, return the stored pending item for the message
  id when one exists, then claim the slot. A free slot (after stuck-Run expiry) plans and creates
  the compaction Run; a live Run with `delivery` stores a `queue` item; a live Run without
  `delivery` gets 409. The Run id is server-generated, so a retry of an idle `/compact` after a lost
  answer meets its own live Run: with `delivery` it queues an item that later completes with nothing
  to absorb, and without `delivery` it gets 409. That outcome is accepted.
- `claimActiveRunSlot` also returns the kind of a live blocker, so `admitToSlot` stores `queue` for
  every delivery mode while the live Run is a compaction Run.
- `ChatDeliveryResponse` gains `command: 'compact' | null`, computed by the parser for `queue`
  items, so the web does not parse.
- `changeMode` reads the item with `findById` after the Chat lock, before its update, and answers
  400 for a command item, and for `steer` or `interrupt` while a compaction Run is live.
- `startItemRun` branches before `createUserMessageIfAbsent`: a command item validates its focus as
  admission does, then creates a compaction Run with the item's settings, writes the focus on
  `run.created`, and marks the item delivered with no message id (the column is nullable;
  `markDelivered` takes an optional id). An item that fails that validation stays pending, as an
  item that a send cannot use.
- A command item is a `queue` item. A `steer` item with `/compact` text, stored before this change,
  is not a command item and is delivered as a message, as before.

### D11: The web shows a compaction Run as one transcript row

When `latestRun.kind` is `compaction`, the transcript ends with a "Compacting context" row while the
Run is live, with Stop (`cancelRun`), and an error row with no action when it failed or expired.
These read `kind`: `turn-action-rules.ts`, `turn-actions.tsx`, `chat-transcript.tsx`,
`history-adoption.ts`, the busy check in `deliveries.ts`, `active-runs-context.tsx` (no "Reply
ready" notice or unseen mark for a compaction Run), `use-chat-delivery.ts` (no hand-off wait for a
promoted command item, which creates no message), and the pending-item rows (Steer now and
Interrupt now hidden while a compaction Run is live). On reload, the resume stream of a live
compaction Run opens an assistant message with the Run id; the web drops that message when
`latestRun.kind` is `compaction`. The web refetches history when the Run ends, so the boundary
appears. `compaction-boundary.tsx` shows the focus under the summary. `run-kind` and
`queued-commands` regenerate the live AsyncAPI modules, because the generated live parsers strip
unknown keys such as `kind` and `command`.

### D12: The Anthropic tool-drop finding stays out of scope

A loopback probe through llame's own clients showed that `@ai-sdk/anthropic` 3.0.118 removes every
tool declaration when `toolChoice` is `'none'` (`anthropic-prepare-tools.ts:424-426`), so an
automatic compaction request on the Messages wire does not share the tools prefix of the turn. It
belongs to compaction fidelity ([#1483](https://github.com/leon0399/llame/issues/1483)) and changes
no requirement here.

## Risks / Trade-offs

- [The source receipt prompt was written for another model] → it only frames the summary request;
  the instruction carries the task. A fresh render is the named alternative in D8.
- [A layer exceeds the review budget] → eight implementation layers; re-measure each at its
  boundary.
- [A compaction Run as `latestRun` confuses client code that assumes a message] → `kind` on every
  Run response, and `compact-web` updates every reader listed in D11.
- [Owner text in a summary prompt] → the focus is neutralized, capped at 1,000 characters, placed
  after the fixed instruction, and the instruction keeps headings and redaction above it. It is the
  same trust level as any owner message.
- [A steer sent during a compaction Run waits] → it runs right after the compaction Run, which is
  one bounded summary request.
- [No prompt-cache read of the turn prefix for an owner compaction] → accepted (D8); a later change
  can prepare a full attempt without a user turn.
- [Two first sends race to one new Chat id] → accepted (D1).
- [The web sends `/`-text on an existing Chat through the direct path] → an ordinary `/etc/hosts`
  message has no optimistic bubble until the Run attaches; the path already exists for delivery
  sends.

## Migration Plan

The migration adds one defaulted column; existing Runs read as `turn`. `RunJob` keeps accepting jobs
with `userMessage`. Rollback: revert the layers from the top. Reverting `compact-focus` needs the
data fix in D6 first. Drop `runs.kind` only after no compaction Run is live; compaction Run rows
can stay, because their checkpoints are ordinary checkpoints.

## Revision history

- **r2 (2026-11-11):** Round 2, two reviewers (spec consistency: 4 P1, 8 P2; feasibility: 2 P1,
  9 P2), each verified against code. Fixed: `chat-creation` "The first-message creation path is
  unchanged" is MODIFIED with a third exception; the pending-item block is MODIFIED so its steer
  scenario names a turn Run, and a `/rename` with a delivery mode runs at once; the failed-turn row
  needs a turn `latestRun`; the summary request of a compaction Run now sends the stored receipt
  prompt of its source Run and binds no receipt, so it needs no Workspace preparation and leaves the
  skill epoch to the next turn; publication and completion share one transaction that checks for a
  recorded cancellation; the bare `/rename` excerpt counts its tags, is neutralized, keeps the start
  of a cut row, refuses an empty Chat and an archived Chat before any model request; the attachment
  rule needs a Chat of the owner; a command item is a `queue` item; the web hides Steer now during a
  compaction Run, raises no reply notice, and skips the hand-off wait; the `ExecuteRunInput` union
  is dropped; rolling-deploy windows and the first-send race are stated; `commands` and
  `compact-run` are split further (`commands-web`, `compact-window`). Rejected: none. Round 2 still
  changed substance, so the review has not converged; the GitHub review loop is the next round.
- **r1 (2026-11-11):** Round 1, two reviewers (spec consistency: 9 P1, 10 P2; feasibility: 1 P0,
  6 P1, 8 P2), each verified against code. Fixed: a steer during a compaction Run was folded into
  it (now stored as `queue`, steering delivery skipped); `/compact` admission now owns its
  transaction and never creates a Chat; a first message and `POST /api/v1/chats` are never
  commands, so `chat-creation` is unchanged; `/compact` without `delivery` during a Run gets 409 as
  single-flight requires; dropped the client-chosen Run id; stuck-Run expiry, two queued compacts,
  and the paused queue are specified; D9 now relies on the existing `latestTurnRun` check; the
  summary request of a compaction Run has no tool declarations and a named window fallback; checkpoint
  `v: 2` gets a reader in the same layer and a rollback data fix; `RunJob.userMessage` becomes
  optional instead of a union; a bare `/rename` reuses the packaged title prompts with a specified
  excerpt; the web drops the resumed assistant message and lists every `latestRun` reader;
  `compact-run` is split into `run-kind`, `compact-run`, and `compact-focus`; readings added for
  `media-attachments`, title templates, Regenerate, resume, and the paused-queue scenario.
  Rejected: none.
- **r0 (2026-11-11):** Initial draft.
