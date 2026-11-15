## Context

See `proposal.md` for the motivation. Facts below are at `05a426bd` (master after the background-jobs
change); paths are under `apps/api/src` unless they start with `apps/web`.

- **Send ingress.** `POST /api/v1/chats/:id/messages` (`chats/chats.controller.ts:356`) answers a
  UI-message stream (200) or a pending item (202, `:386-388`). `ChatLoopService.send`
  (`chats/chat-loop.service.ts:207`) validates the send (`:240`), then in one transaction resolves
  the Chat (creating it when the id is absent), admits the slot or stores a pending item
  (`admitToSlot` `:451`), stores the user message, adopts held job notices
  (`deliverPendingJobNotices` `:432`), and creates the Run. The slot check returns `free` or
  `blocked`, and the steer signal uses the mode as sent (`:494`).
- **Web send.** Ordinary sends use the AI SDK `DefaultChatTransport`, which adds an optimistic user
  message and expects a stream for every 2xx (`apps/web/app/(chat)/components/use-chat-engine.ts`).
  Delivery sends use a direct fetch (`apps/web/lib/services/chat/deliveries.ts`).
- **Titles.** `TitleService.maybeGenerateTitle` (`titles/title.service.ts`) runs after a completed
  turn while `title IS NULL`, on `defaults.titleGenerationModelId`, with the first user text
  (≤1,000 characters). Host messages never title a Chat; the precedent filter is
  `senderUserId IS NOT NULL` (`chats/messages-repository.ts:396`).
- **Pre-step compaction.** The trigger runs only for the first segment
  (`runs/run-execution.service.ts:6555`, `evaluateCompactionTrigger` `:5348`).
  `planCompactionCheckpoint` (`compaction/compaction.ts:396-412`) absorbs rows strictly between the
  active checkpoint and the trigger message. `summarize` sends `toolChoice: 'none'`
  (`compaction/compaction.service.ts:462`). `publishPreStepCompaction`
  (`run-execution.service.ts:6729`) fences on the attempt, writes the checkpoint with its usage, and
  re-bakes the epoch. Line 18 of `compaction/prompts/instruction.md` names the trigger message.
- **Step boundaries.** `stopWhenExtra` (`run-execution.service.ts:3174-3194`) stops the tool loop
  when `stepEndSignal` (`chats/chat-deliveries.repository.ts:325-357`) finds a pending owner steer or
  interrupt or a job notice. `onFinish` (`:3875`, branch `:4127-4157`) calls `deliverAtBoundary`
  (`:3299-3333`), which runs `deliverPendingSteering` (`runs/segment-delivery.ts:335-368`): fence,
  Chat lock, `closeSegmentAndStore` (`:235-267`), `storeDeliveredMessage` (`:128-158`), and
  `moveRunToDelivery` (`:273-320`, fresh attempt, `run.delivered` with `cause`). `startDelivered`
  (`run-execution.service.ts:1593`) re-enters the attempt with `firstSegment: false` and rebuilds
  the request from stored rows. The final-answer path delivers pending items in `finishRun`
  (`:5770-5790`). At a boundary the stored reply row is stale; the fresh parts are in the part
  collector.
- **Yield and wait.** A pending owner steer or interrupt, or a job notice, makes a foreground host
  `bash` move to a job and a `wait` return `interrupted` (`run-execution.service.ts:3455-3466`,
  `runs/run-control-listener.service.ts:158-176`, `runs/run-wait.service.ts`). The check reads pending
  rows, not their text.
- **Per-request measurement.** `onRequestUsage` (`run-execution.service.ts:3469`) keeps one receipt
  per provider request; `resolveCompactionThreshold` (`compaction.ts:366`) is the threshold.
- **Checkpoint and context items.** `createCompactionCheckpointPart`
  (`chats/context-item-producers.ts:670-684`) stores `payload: {v: 1, summary}`; the history reader
  accepts `v: 1` only (`:726-740`). `CONTEXT_ITEM_PRODUCERS` (`chats/context-item.ts:48`) already
  holds `compaction` with form `checkpoint`.
- **Runs.** `runs.message_id` is nullable (`db/schema/chats.ts:357`). Runs gained `awaiting_jobs`,
  `wake_generation`, `current_job_id`, and `awaiting`; `RunJob` gained `wake` and still requires
  `userMessage` (`apps/api/asyncapi.queues.yaml:254-290`). A host Run is an ordinary turn Run on a
  host message. `findLatestByChatId` returns the newest Run of any kind (`runs/runs-repository.ts:322`).
- **Queue and notices.** Pending items live in `chat_deliveries` with producer `owner` or `job` and
  mode `steer`, `interrupt`, `queue`, or `notice` (`db/schema/chat-deliveries.ts:19-26`).
  `promoteNextQueueItem` (`runs/queue-promotion.ts:47`, `startItemRun` `:106`, notice adoption
  `deliverPromotedItem` `:146`) runs in `finishRunInTransaction` (`run-execution.service.ts:5731`,
  promotion `:5832-5845`). A notice on an idle Chat starts a host Run only at its settlement
  (`runs/job-notice-run.service.ts:44-76`).

## Grilling record

Decisions confirmed by Leo; `proposal.md` cites them as "grilling Dn" or "grilling Qn".

| Code | Decision                                                                                                                                  |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| D1   | `/compact` on an idle Chat is a durable Run with no user message.                                                                         |
| D2   | Command text is never a message or model context. The checkpoint is the in-band record.                                                   |
| D3   | Focus: capped owner text, appended as `Additional focus:`, subordinate to headings and redaction, shown on the boundary.                  |
| D5   | Titles keep the dedicated title model, for automatic titles and a bare `/rename`.                                                         |
| D6   | Only recognized names are commands; no escape syntax.                                                                                     |
| D7   | One fixed server-side parser at ingress; no registry, list endpoint, or autocomplete.                                                     |
| D9   | A bare `/rename` reads a bounded excerpt of recent turns.                                                                                 |
| D10  | A bare `/rename` without a title model fails inline.                                                                                      |
| D11  | Two issues (#1675, #1676), one change, one stack.                                                                                         |
| D12  | Revised by Q22: `/compact` during a live Run follows its delivery mode.                                                                   |
| D13  | A pending `/compact` keeps its raw text in `chat_deliveries`; delivery and promotion parse it again.                                      |
| D14  | An owner compaction absorbs every committed row after the active checkpoint.                                                              |
| D15  | A compaction Run uses the model and effort of the send.                                                                                   |
| D16  | Only a Chat with nothing to absorb is refused.                                                                                            |
| Q18  | Notices skip a compaction Run; its completion starts the idle-Chat notice Run.                                                            |
| Q20  | Independently mergeable layers under the CONTRIBUTING review target.                                                                      |
| Q21  | After a compaction, unfinished work continues; a completed turn goes idle.                                                                |
| Q22  | `/compact` behaves like any owner input in each delivery mode.                                                                            |
| Q23  | Compaction during a live Run happens inside that Run at a step boundary.                                                                  |
| Q24  | The automatic step-boundary trigger is part of this change (#1068).                                                                       |
| Q25  | After a mid-turn compaction: checkpoint, then a continue notice with the current request verbatim. A verbatim tail is later work (#1069). |
| Q26  | A failed mid-turn compaction continues uncompacted and shows inline.                                                                      |
| Q27  | No count cap on automatic compaction; a progress guard only.                                                                              |

Rejected during grilling: titles from the chat's own model (#1096); a command registry and
autocomplete now (#1671, #1672); queue-only `/compact`; a separate compaction Run plus a
continuation Run for a live Run (Q23-A); a count cap on automatic compaction.

## Prior art

Source inspection (OMP `73d7521`, OpenClaw `5d8c251`, Codex `e58bf8f`, OpenCode `51fcace`, Open
WebUI `b0e6098`) and Claude Code public docs and issues.

| Harness     | Dispatch                                        | Manual `/compact` while busy                                            | Automatic compaction mid-turn                                                                 | Bare `/rename`                            |
| ----------- | ----------------------------------------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------- |
| OpenCode v2 | server for prompt commands, TUI for UI commands | steer-delivered at the next boundary; resumes if mid-work, idle if done | at a boundary, then the loop re-samples                                                       | regenerates through the title agent       |
| Codex       | client                                          | refused in the TUI; core aborts the turn, no resume                     | at a boundary when the turn needs a follow-up; user messages kept verbatim                    | editable suggestion                       |
| OMP         | client builtins, also RPC/ACP                   | queued until the agent yields; `Additional focus:`                      | at a boundary; continue prompt skipped after a final answer; continues uncompacted on failure | dedicated title model from recent context |
| OpenClaw    | server gateway for all channels                 | aborts after 60 s, asks to resend; `Additional focus:`                  | at a boundary, hidden "Continue the current task" prompt, attempt caps                        | shows the current name                    |
| Claude Code | client                                          | queued until the turn ends, then idle                                   | inside the query loop; "Autocompact is thrashing" guard                                       | regenerates from history                  |

OpenCode v2 is the precedent for `/compact` as a steer that resumes unfinished work. Codex
`CompactTask` is the precedent for a compaction Run with no user input. Every peer compacts only
after a step's tool results settle, so call and result pairs are never split.

## Goals / Non-Goals

**Goals:** one parser on the message endpoint that later commands and surfaces reuse; one
step-boundary compaction mechanism for the owner command and the automatic trigger, built on the
existing segment delivery; a compaction Run for an idle Chat that reuses the summary request,
publication, cancellation, and queue promotion.

**Non-Goals:** a parser on the web; partial absorption of a turn (#1069); compaction of one request
that cannot fit (#153).

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
before any model request. The excerpt reads the newest owner `user` rows (`senderUserId IS NOT NULL`, so no host message) and
`assistant` rows (no checkpoint, system, or tool rows), renders each as a `User:` or `Assistant:` line group with its text parts and
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
compaction Run has `message_id NULL` and `follow_up_action NULL`. A host Run stays a `turn`. The `runs_owner` policy does not
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

The reader change lands in the same layer as the first `v: 2` writer (`compact-focus`). A `/compact`
steer or queue item carries its focus in its text, and delivery and promotion parse it again. During a
rolling deploy of that layer, an API pod that still runs the old reader fails a history read that
meets a `v: 2` checkpoint until the rollout finishes; llame deploys API and worker together, and
this window is accepted. Reverting
that layer needs one data fix first, because the old reader throws on `v: 2`:
`UPDATE messages SET parts = jsonb_set(parts, '{0,data,payload}', (parts->0->'data'->'payload') - 'focus' || '{"v":1}') WHERE role = 'checkpoint' AND parts->0->'data'->'payload'->>'v' = '2'`.

Alternative: a `runs.compaction_focus` column (rejected: a second schema change for a value that
only the worker and the checkpoint read).

### D7: `RunJob.userMessage` becomes optional

`asyncapi.queues.yaml` makes `userMessage` optional, and `pnpm --filter api generate:queue-protocol`
regenerates the parser; the generator turns a property outside `required` into `.optional()`. Pickup
(`runs/runs-worker.service.ts:171-260`) returns `kind` from the claimed row after the wake gate and
branches on it. For a turn Run it
narrows `job.userMessage` before `executeRun`, so `ExecuteRunInput.userMessage` stays required and
no test fixture changes. A turn job without `userMessage` is dead-lettered and its Run expires, as a
malformed job is today. During a rolling deploy, an old worker dead-letters a compaction job in the
same way; the owner sends `/compact` again.

### D8: The worker runs a compaction Run on its own branch

`runs-worker.service.ts` calls `executeCompactionRun` instead of `executeRun` for a compaction Run;
it returns no model stream for the worker to drain. The branch:

1. Claims the Run through the claim of `executeRun`, extracted with its queue-identity fence, Chat
   lock, `settleOnDeadWorkers` (the job touch), and pending-wake check
   (`run-execution.service.ts:1294-1428`), and reads the focus from `run.created`.
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
   the Run through `finishRunInTransaction` with no attempt, so steering and notice adoption are
   skipped and its queue-identity fence holds. Queue promotion runs. When no queue item starts, the
   idle-Chat notice rule of `background-jobs` runs for pending notices, and its first job is
   enqueued in the same transaction (`enqueueInTransaction`).

The skill epoch is not re-baked by the compaction Run, because it has no Workspace root. The next
turn starts it: `resolveTurnSkillState` (`apps/api/src/chats/skill-turn-state.ts:93-119`) starts a
new epoch when the stored baseline does not match the latest checkpoint, and the turn passes its own
Workspace root (`run-execution.service.ts:6984`). No `model.requested` event is written.

Alternative for step 3: render a fresh system prompt for the Run's model (rejected: it needs the
Workspace preparation, the composed tool catalog, the digest, and personalization of a turn, about
200 more lines, and with no admitted tools an operator template that renders only tool-gated text
fails). Alternative: prepare a full first attempt without a user turn, for a prompt-cache read of
the turn prefix (rejected for this change: `prepareAttemptContext` reads the trigger message at
seven sites, and the Messages adapter drops the tools of a compaction request anyway, D14).

### D9: The existing follow-up check refuses after a compaction Run

`latestTurnRun` (`chats/follow-up-admission.service.ts:561-575`) answers 409 when the
newest Run of the Chat does not belong to the latest user message. A compaction Run has no
message, so a follow-up after any compaction Run, failed ones included, is refused with no new
code. The turn-actions delta records this, and a test pins it.

### D10: `/compact` admission and command items in the queue

- `/compact` admission is one tenant transaction owned by `ChatCommandsService`: lock the Chat
  without creating it, assert it is not archived, return the stored pending item for the message
  id when one exists, then claim the slot.
  - A free slot (after stuck-Run expiry) plans and creates the compaction Run with a
    server-generated id. It skips `deliverPendingJobNotices`: notices stay pending.
  - A live turn Run with `delivery` stores a pending item in that mode, with the raw command text.
  - A live compaction Run with `delivery` stores `queue`.
  - Without `delivery`, the send gets 409.

  A retry of an idle `/compact` after a lost answer meets its own live Run. That outcome is
  accepted: with `delivery` it queues an item that later finds nothing to absorb.

- `claimActiveRunSlot` also returns the kind of a live blocker. While the blocker is a compaction
  Run, `admitToSlot` stores every owner item as `queue`. The steer signal uses the stored mode, not
  the sent mode (`chat-loop.service.ts:494`), so a queued item never wakes a Run that waits on jobs.
- A command item is a pending `owner` item whose text the parser reads as `/compact`, in any mode.
  `ChatDeliveryResponse` gains `command: 'compact' | null`, computed by the parser, so the web
  labels the row without parsing. Mode changes work as for any owner item. While a compaction Run is
  live, `changeMode` answers 400 for `steer` and `interrupt`; the check comes after `claimSlot` and
  `requireChangeableItem`.
- `startItemRun` branches before `createUserMessageIfAbsent`. A command item validates its focus as
  admission does. It then creates a compaction Run with the item's settings, writes the focus on
  `run.created`, skips notice adoption, and marks the item delivered with no message id
  (`markDelivered` takes an optional id). An item that fails validation stays pending.
- A `/compact` item stored before this change is parsed the same way. No migration is needed.

### D11: The step boundary delivers a command item as a compaction

A pending command item in mode `steer` or `interrupt` is a pending steer or interrupt for every
existing signal: `stepEndSignal` stops the loop, a foreground host command yields to a job, a `wait`
returns `interrupted`, and an interrupt aborts the step. Only delivery changes.

`deliverPendingSteering` parses the locked owner items. When one or more are command items, the
fenced delivery transaction:

1. Closes the reply of the segment: `completed` for a steer or automatic cause, and `aborted` with
   `interrupted: true` for an interrupt, as `closeSegmentAndStore` does today.
2. Publishes the checkpoint prepared before the transaction (D12). It absorbs every row above the
   active checkpoint through the closed reply, and stores its usage and the focus of the first
   command item. It re-bakes the digest, skill, and Workspace epoch state with the Workspace root
   of the live attempt.
3. Marks every command item delivered with no message.
4. When message items are pending, stores them as the owner message after the checkpoint, as
   today, and moves the Run to it with cause `steer` or `interrupt`. Otherwise, stores a host
   message with the `interrupted` item (for an interrupt), the boundary's `notice` items, and one
   `compaction` notice item, and moves the Run to it with cause `compaction`.

At the final answer, `finishRun` does the same before it looks for message items. When only command
items were pending, it publishes the checkpoint and completes the Run with no host message. The
segment that a compaction starts carries the step count of the segment before it (`stepBase`),
because a compaction is not new owner input.

The `compaction` notice item uses the existing producer `compaction` with form `notice`. Its payload
holds the quoted request: the text parts of the newest owner message of the Run, at most 4,000
UTF-16 code units, neutralized. Its body is a packaged template: "The conversation was compacted.
Continue your task from the checkpoint. The owner's current request was:" and the quote. It ranks
after `job` (`context-injection`). The web host row renders it as a muted "Context compacted.
Continuing." notice; search, titles, previews, and the public view ignore it, because it is a
`data-context` part.

### D12: The summary request of a step-boundary compaction

The summary is computed before the delivery transaction, outside it, and the transaction then
checks the attempt fence again. The request:

- uses the live client, system prompt, schema-only tool declarations, and effort of the attempt,
  with the existing `toolChoice: 'none'`;
- replays the absorbed rows through the stored projection (`buildContext`). The closed reply comes
  from the part collector through `projectStoredReplyParts`, because the stored reply row is stale
  at a boundary and the next segment rebuilds from stored rows;
- ends with the instruction rendered without the trigger sentence (the second sentence of
  `instruction.md:18`), and the focus paragraph when a command item has a focus.

`CompactionService` gains a `boundary` variant with an explicit absorbed range (`uptoSeq` of the
closed reply) instead of `triggeringUserSeq`. A failed or empty summary returns `null`. The
delivery then marks the command items delivered, appends a `run.compaction_failed` event that the
web shows inline, and continues as `deliverPendingSteering` would with no command item. An abort
from cancellation or interrupt rethrows, as today.

The summary request is a strict prefix of the live request plus one instruction. That is the best
case for the prompt cache, except on the Messages wire (D14).

### D13: The automatic trigger runs at the same boundary

`stopWhenExtra` gains a third cause, `compact`. After a step that called tools, the worker measures
the next request: the context tokens of the latest request receipt, plus `estimateModelRequestTokens`
of that step's tool results. When the measure reaches `resolveCompactionThreshold` of the Run model,
the boundary compacts as in D11, with no command item, cause `compaction`, and no focus. A final
answer never compacts automatically.

The progress guard is per-attempt state in the worker:

- no automatic compaction before one model step after the previous compaction of the Run;
- no automatic compaction when the absorbed range is empty;
- after an automatic compaction, the measure of the first request is compared with the threshold.
  When it still reaches the threshold, automatic compaction stops for the rest of the Run, and a
  `run.compaction_disabled` event tells the web. An owner command still compacts.

There is no count limit. The guard does not survive a crash retry; a retried segment starts with
the guard open, which costs at most one more compaction.

The image-overflow condition stays a pre-step condition (`media-attachments`).

### D14: The Anthropic tool-drop finding stays out of scope

A loopback probe through llame's own clients showed that `@ai-sdk/anthropic` 3.0.118 removes every
tool declaration when `toolChoice` is `'none'` (`anthropic-prepare-tools.ts:424-426`), so a
compaction request on the Messages wire does not share the tools prefix of the turn. It
belongs to compaction fidelity ([#1483](https://github.com/leon0399/llame/issues/1483)) and changes
no requirement here.

### D15: The web shows compactions

When `latestRun.kind` is `compaction`, the transcript ends with a "Compacting context" row while the
Run is live, with Stop (`cancelRun`), and an error row with no action when it failed or expired.
These read `kind`: `turn-action-rules.ts`, `turn-actions.tsx`, `chat-transcript.tsx`,
`history-adoption.ts`, the busy check in `deliveries.ts`, `active-runs-context.tsx` (no "Reply
ready" notice or unseen mark for a compaction Run), `use-chat-delivery.ts` (no hand-off wait for a
promoted command item, which creates no message), `job-notice-run.service.ts` on the API side
(`startNoticeRunForIdleChat` reads the latest Run), and the pending-item rows (Steer now and
Interrupt now hidden while a compaction Run is live; a command item labelled "Compact"). On reload, the resume stream of a live
compaction Run opens an assistant message with the Run id; the web drops that message when
`latestRun.kind` is `compaction`. The web refetches history when the Run ends, so the boundary
appears. `compaction-boundary.tsx` shows the focus under the summary. `run-kind` and
`compact-in-run` regenerate the live AsyncAPI modules, because the generated live parsers strip
unknown keys such as `kind` and `command`.

A mid-turn compaction reaches the web as a `run.delivered` event with cause `compaction`. The
hand-off then attaches the next segment to the host message, as for a notice. The boundary renders
before the host message, and the host row renders the continue notice. A
`run.compaction_failed` or `run.compaction_disabled` event renders as a muted inline note on the
live reply.

## Risks / Trade-offs

- [The stored reply row is stale at a boundary] → the summary reads the part collector through the
  stored projection (D12), and a test compares it with the replay of the next segment.
- [Owner text in a summary prompt] → the focus and the quoted request are neutralized and capped,
  placed after the fixed instruction, and the instruction keeps headings and redaction above them.
  They are the same trust level as any owner message.
- [Automatic compaction runs often in a long Run] → each one is a cache-aligned prefix of the live
  request. The guard stops it when a compaction does not bring the request below the threshold.
- [A compaction keeps the step budget] → an operator step cap still bounds a Run that compacts many
  times. A steer still gives a fresh budget.
- [The compaction Run source prompt was written for another model] → it only frames the summary
  request; the instruction carries the task.
- [A `/compact` sent during a job wait] → as a steer it wakes the Run; as a queue item it waits for
  the Run, as any queue item does.
- [Layers above the review target] → `commands` and `compact-in-run` are over 2,000 authored lines
  and stay whole, because each is one mergeable behavior (CONTRIBUTING now treats the number as a
  target).
- [Two first sends race to one new Chat id] → accepted (D1).

## Migration Plan

The migration adds one defaulted column; existing Runs read as `turn`. `RunJob` keeps accepting jobs
with `userMessage`. The `compaction` notice item and the new Run events are additive; an older web
ignores them. Rollback: revert the layers from the top. Reverting `compact-focus` needs the data fix
in D6 first. Reverting `compact-in-run` leaves host messages with a `compaction` notice item; the layer adds a
replay test that an item it cannot render is skipped, so the continuation reply stays readable. Drop `runs.kind` only after no compaction Run is live.

## Revision history

- **r3 (2026-11-15):** Rebased onto `05a426bd` (background jobs, Run suspension, CONTRIBUTING #1723,
  Drizzle RC5). Redesigned after grilling Q18-Q27:
  - `/compact` follows its delivery mode (D12 revised);
  - compaction during a live Run happens at a step boundary inside the Run (D11-D12);
  - the automatic step-boundary trigger with a progress guard is added (D13, closes #1068);
  - notices skip a compaction Run, and its completion starts the idle-Chat notice Run;
  - owner items, not notices, are coerced to `queue` during a compaction Run;
  - the steer signal uses the stored mode;
  - the `/rename` excerpt skips host messages;
  - the claim and finish of a compaction Run keep the new fences;
  - the stack is re-planned as mergeable layers.

  New MODIFIED deltas: `background-jobs` (4), `context-injection` (1), `media-attachments` (1), and
  seven more `run-steering` blocks. Removed: the queue-only and command-item mode-change rules.

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
