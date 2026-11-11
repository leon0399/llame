## Context

See `proposal.md` for the motivation. Code references are at `master` `048f75aa`.

### Host bash today

- `admitManagedBash` returns `{ cwd, run, release }`, and `run()` resolves only after the child
  settles (`packages/bash-executor/src/execute.ts:239-295`). The child handle and the captured
  streams are private to `watchManagedChild` (`watch.ts:96-131`).
- The watcher always arms a deadline of `min(context.durationMs, options.timeoutMs)`
  (`watch.ts:203-205,236-241`). The host passes `durationMs: 300000`
  (`apps/api/src/tools/bash-limits.ts:28`), and `durationMs <= 0` is refused (`sanitize.ts:61`).
  Only the deadline path keeps the captured output; an abort returns `cancelled` with no streams
  (`watch.ts:172-188`).
- Output is captured in memory up to `tools.artifacts.maxBytes` and redacted once, at settlement
  (`watch.ts`, `knownCloseResult`; `sanitize.ts:103-180`).
- The process bound is a module-level counter with `maxProcesses: 1`, shared with `ssh://`
  (`execute.ts:17,62`; `bash-limits.ts:20-30`). The Machine daemon uses the same executor with
  its own bound of 1 (`packages/machine-protocol/src/constants.ts:34-35`), and its protocol
  admits the refusal types `unavailable | boundary_missing | cancelled` only
  (`packages/machine-protocol/src/types.ts:350-385`).
- The runner gives every call `AbortSignal.any([run abort, AbortSignal.timeout(callTimeout)])`
  and rejects 750 ms after that signal for `bash`. A `bash` rejection becomes `outcome_unknown`
  (`apps/api/src/tools/runner.ts:66,97-145,584-586`).
- A `bash` success renders through `renderBashText`, which always begins with `exit <code>`
  (`packages/bash-executor/src/model-text.ts:58-96`).
- `interruptFateOf` derives the fate from the classification and the name and never returns
  `background` (`apps/api/src/tools/registry.ts:45-52`). `settleOnInterrupt` handles `cancel` and
  `finish` only, and only a `cancel` call gets the interrupt signal
  (`run-execution.service.ts:2344-2411`).

### Runs today

- A Run status is a Postgres enum with no waiting state (`apps/api/src/db/schema/chats.ts:314-329`).
  `markStarted` claims any non-terminal Run as `running_model` with a new attempt
  (`runs-repository.ts:411-440`).
- `executeJob` throws when the Run is not terminal after its stream drains
  (`apps/api/src/runs/runs-worker.service.ts:293-301`). Its pickup gate settles a Run with a
  recorded cancellation and skips a terminal Run (`:170-194`). The dead-letter consumer expires a
  Run by the `runId` of any dead job (`:144-159`).
- Admission reads one queue job, by the id of the Run, and expires a Run whose job is absent for
  one heartbeat window or is settled (`apps/api/src/chats/chat-admission.ts:34-123`).
- A queue job id is a UUID, the primary key is `(name, id)`, and a second send with one id
  returns `null` for about 7 days (`pg-boss@12.25.0` `plans.js:303,601,1500,1998-2007`).
  `RunDispatchService.dispatch` always uses the Run id and fails the Run when the enqueue throws
  (`run-dispatch.service.ts:48-62`).
- A cancellation stamps the Run and notifies. Only a worker that executes the Run acts on the
  signal (`run-control-listener.service.ts:68-86`).
- A tool result is durable as a `tool.completed` event. The reply of a Run with a reply row is
  rebuilt from the window of its current attempt only, and that window ends at the next
  `run.started` (`run-reply-finalizer.ts:219-236,378-412`). The dispatch of an attempt clears the
  parts of an earlier attempt (`run-execution.service.ts:6980-6992`).
- A Continue seeds its attempts from a `run.continued` event that holds the kept parts. The
  finalizer, the stream bridge, and the step offset read that event
  (`run-creation.ts:98-107`, `run-execution.service.ts:5588-5603`,
  `continue-projection.ts:58-99`, `run-stream-bridge.ts:164`).
- The lock order is the Run row, then the Chat row (`segment-delivery.ts:303-345`;
  `chats.service.ts:488-498` calls that order "load-bearing for deadlock avoidance").
- No worker has an identity. `runs.worker_id` is the native executor id.

### Deliveries, messages, and context items today

- `chat_deliveries` has owner RLS, text columns `producer`, `sender_ref`, `mode`, and `state`,
  and the type `ChatDeliveryProducer = 'owner'` (`db/schema/chat-deliveries.ts:15-97`).
- `lockPendingSteering` serves the boundary delivery and `pauseBehind`, which turns every locked
  item into a `queue` item after a Run that did not complete
  (`chat-deliveries.repository.ts:151-166,227-250`).
- A delivery stores one user message through `createUserMessageIfAbsent`, which hardcodes the
  role `user` and a non-null sender (`messages-repository.ts:640-665`).
- `sender_user_id` is nullable. A trigger requires that `in_reply_to` names a row with the role
  `user` (`migrations/0013_reply_integrity_trigger.sql:13-30`).
- A user row with no content is dropped from the model messages, and `requestMessages` replaces
  the last message with the trigger content (`context-builder.ts:713-723`,
  `run-execution.service.ts:7151-7177`).
- The `interrupted` item is built from the `run.delivered` event at the first dispatch of the
  segment and stored on the delivered message (`run-execution.service.ts:5165-5188,6620-6624`).
- Producer order is the array `CONTEXT_ITEM_PRODUCERS` (`chats/context-item.ts:48-70`). The
  envelope does not escape the body; each producer does.

## Prior art

| Harness     | Background start           | Wait                           | After a settlement          | Steer during a command     |
| ----------- | -------------------------- | ------------------------------ | --------------------------- | -------------------------- |
| oh-my-pi    | `async`, 60 s, steer       | `wait()`, all jobs, 5 to 300 s | follow-up notice, idle turn | moves to background        |
| Claude Code | `run_in_background`, 120 s | none for `bash`                | later-turn notice           | not documented             |
| Hermes      | `background`, 180 s        | one job, 180 s                 | notice per call             | wait returns `interrupted` |
| OpenClaw    | `yieldMs` 10 s             | `poll` to 30 s                 | ordinary turn               | steer never stops a tool   |
| Codex       | `yield_time_ms` 10 s       | `write_stdin` poll             | pull only                   | no                         |
| OpenCode    | `background`               | none                           | notice, "DO NOT poll"       | moves to background        |

Sources are in the decision record on #1657. No harness releases its process while it waits, so
`awaiting_jobs` has no precedent. oh-my-pi holds a completion after an interrupt until the next
prompt (`agent-session.ts:2480-2492`), which is the hold rule of this change.

## Goals / Non-Goals

**Goals:** one executor-neutral job record; host `bash` that outlives its call; a `wait` that
frees the worker; exactly-once notices through the shipped delivery queue; owner controls.

**Non-Goals:** a second executor; file-backed output; adoption of a job by another worker; a
change to the Machine protocol or to the behavior of the Machine daemon; a new provider role.

## Decisions

### D1: Three tables, one of them infrastructure

- `chat_jobs`: `id`, `chat_id` and `owner_user_id` (composite FK to `chats`, cascade),
  `executor`, `seq`, `state`, `stopped_by`, `run_id`, `tool_call_id`, `worker_instance_id`, `pid`,
  `started_at`, `settled_at`, `deadline_at`, `stop_requested_at`, `stop_requested_by`, `result`
  (jsonb: exit code, truncation flags), `outputs` (text array), `artifact_id`,
  `artifact_readable`, and the settings of the starting Run. Unique on
  `(chat_id, executor, seq)`. Policy as `chat_deliveries_owner`, with
  `FORCE ROW LEVEL SECURITY` appended by hand.
- `chat_job_chunks`: `job_id`, `output`, `position`, `content` (bytea), with the same owner
  policy through a composite FK.
- `worker_instances`: `id`, `last_seen_at`. A plain table with no tenant column and no RLS, as
  `embedding_model_bindings` is (`db/schema/search.ts:274-290`). It holds no tenant data.

Rejected: job state in `run_events`. A job outlives its Run, and a count per Chat needs an index.

### D2: The job number is a reserved artifact number

`ArtifactsRepository.nextSeq` already runs in its own transaction and accepts gaps
(`artifacts-repository.ts:82`). A job reserves a number when it starts. A new
`commitArtifactInTransaction(tx, request, seq)` writes the artifact rows with a reserved number
inside a caller's transaction. Host files are written after the commit. `job://bash-7` and
`artifact://bash-7` then name one thing at two times. The number stays unused when the output
fits inline.

Rejected: a separate job counter. The notice would name two different numbers for one command.

### D3: The executor returns a handle and arms no deadline for it

`packages/bash-executor` gains `startManagedBash(input, context, options)`. It returns
`{ pid, settled: Promise<BashResult>, snapshot(), stop(cause) }`.

- The handle arms **no** deadline and listens to no signal of the call. The caller owns both.
- `stop(cause)` settles through the path that the deadline uses today: kill the group, prove it
  empty, drain for 50 ms, and return the captured streams. The cause maps the result to
  `timed_out` (`lifetime`) or to `cancelled` with output (`owner`, `assistant`, `worker`,
  `run`). An unproven stop is `outcome_unknown`.
- `executeManagedBash` stays, with its deadline, its signals, and a per-process limiter of
  `context.maxProcesses`. `apps/machine/src/proc.ts:88-90` and the Machine protocol do not
  change.

The pipes stay. Rejected: output files (grilling GA5). A file that the child writes has no size
bound, and `RLIMIT_FSIZE` would kill a command that today only loses output.

### D4: A registry in the worker owns live host commands

`BashJobRegistry` is a singleton of the worker process. Every host command is registered at
spawn. The runner changes for a host `bash` call:

- The call gets the Run abort and the per-call timeout as **separate** signals. The timeout is a
  move trigger and never an abort. The 750 ms rejection of `withAbort` applies to the Run abort
  only.
- The foreground bound is `min(tools.bash.backgroundAfterSeconds, tools.callTimeoutSeconds)`.

The foreground call races four things: `settled`, the bound, the yield signal of the segment,
and the Run abort.

- `settled` first: the call returns the ordinary result, as today.
- Bound or yield first: the registry promotes the command. It reserves the number, inserts the
  `chat_jobs` row, and stores the output captured up to that point. The call then returns
  `backgrounded` and appends `native.result` with that result. A promotion that fails leaves the
  command in the foreground and the call waits for `settled`.
- Abort first: the registry calls `stop('run')`, and the call settles as today.

`async: true` promotes at spawn. The registry holds the facts that a settlement needs after the
call context is gone: owner, Chat, Run, tool call, the artifact bound, the credential set, and
the decision of `canReadArtifacts` with the host-file setting.

`backgrounded` is a success object with `backgrounded: true`, the job locator, the cause, and
the elapsed time. `renderBashText` gets a branch for it, and the web `BashTool` output schema
gets the same member. `ssh://` and `machine://` calls keep today's path, with one composed
signal.

### D5: Output increments are cut at safe positions

A flush works on the unflushed text of one stream, which includes the tail that an earlier flush
kept back.

1. Find every protected interval and every trailing prefix of a member in that text.
2. Move the cut to the start of any interval or prefix that crosses the end.
3. Redact the intervals before the cut, write that text, and keep the rest for the next flush.

The per-stream bound is tracked over the whole stream, as the capture limit already does, and
not per flush. One timer per job arms at the first unflushed byte and fires after 1 s; 16 KiB
flushes at once.

### D6: One settlement transaction, in the Run-then-Chat order

In `tenantDb.runAs(owner)`. The transaction is retried on `40P01` and `40001`.

1. Read the Chat's non-terminal Run. Lock that Run row, then the Chat row, then the job row.
2. Settle the job with a conditional update on `state = 'running'`. A lost update ends the
   transaction.
3. When an output does not fit 2,000 characters and `artifact_readable` holds, write the artifact
   in a savepoint and delete the chunks. A failed write rolls back the savepoint only.
4. When the Run is in `awaiting_jobs` and lists the job, skip the notice. Otherwise insert the
   `notice` item, unless `stop_requested_by = 'assistant'`.
5. When the Run is in `awaiting_jobs`, run the waker update (D11). When the Run executes, call
   `notifyRunControl(tx, { runId, kind: 'steer' })`, so a foreground command yields.
6. When no Run is live, apply the idle rule (D15).

Every new writer uses one lock order: Run row (when one is read), Chat row, `chat_jobs`,
`chat_deliveries`. The suspension (D11), the admission wakers (D13), and the Chat deletion (D9)
follow it.

### D7: A limiter object replaces the module counter on the host

`BashProcessLimiter` is created once per worker with `tools.bash.maxProcesses`. A slot is held
from admission to the settlement of the child, in the foreground or in the background. The
`ssh://` path takes a slot from the same object (`ssh-bash.ts:418`).

The executor refusal stays `unavailable`. The API maps the refusal of the host path and of the
`ssh://` path to the tool result `limit_reached`. The Machine daemon keeps its own limiter of 1
inside `executeManagedBash` and its `unavailable` refusal, so no protocol type changes.
`resetManagedExecutorForTests` goes; each test builds its own limiter.

### D8: The lifetime is a timer of the registry

`deadline_at` is stored on the row. The registry arms one timer per job and calls
`stop('lifetime')`. The settlement is `timed_out` when the group is proven empty and `lost`
otherwise. `unlimited: true` stores no deadline and arms no timer.

### D9: Worker identity, heartbeat, and the end of a worker

A worker takes a random UUID at each process start and upserts `worker_instances` every
`runs.heartbeatSeconds`. In the same tick it re-reads its own jobs, each in the tenant scope of
its owner. A missing row or a recorded stop request stops the command.

`lost` is decided on touch, by a query that joins the job to its `worker_instances` row. The
touch points are the Run claim, the step-end check of a Run in the Chat, the deadline job, the
`job://` reader, and the jobs API. Each runs in the scope of one owner. The chat list count uses
the same join and settles nothing.

A `WorkerShutdownService` owns the order at shutdown. It first makes the registry refuse new
commands and promotions, then stops every job and settles it `cancelled` / `worker`, and only
then lets the queue wrapper stop. The registry module depends on the queue module, so Nest
destroys it first.

Chat deletion stamps a stop request on each live job before the cascade, after it took the Run
row and the Chat row (`chats.service.ts:486-507`).

Rejected: a queue job per background job. A queue job cannot be pinned to the process that owns
the child, and the queue refuses an expiry above 24 h.

### D10: Stop is a recorded request plus a signal

`stop` and the `PATCH` stamp `stop_requested_at` and `stop_requested_by` and send
`{ kind: 'job-stop', jobId }` on `llame_run_control` in the same transaction. The listener of
the hosting worker confirms the request in the owner's scope and calls `stop(cause)`. The
heartbeat tick of D9 covers a lost signal. A request for a job on a dead worker settles it
`lost` at once. `parseRunControl` returns `undefined` for a kind that an older worker does not
know (`run-control.ts:30-48`).

### D11: `awaiting_jobs`, the wake generation, and the current job

New on `runs`: `wake_generation integer`, `current_job_id uuid`, and `awaiting jsonb` (the open
`wait` call id, the listed job ids, the deadline). `awaiting_jobs` joins the `run_status` enum.

**Suspend.** `wait.execute` answers at once from the job rows when a listed job is settled or
lost, and it withdraws a pending notice of each job that it reports as settled. Otherwise it
returns a suspension sentinel. The executor does not record the sentinel as a result. When every
other call of the step has settled, the executor ends the stream with the stop cause `suspend`
and runs one transaction, fenced by `activeAttemptId`, in the D6 lock order:

1. Re-check the listed jobs, the pending `steer`, `interrupt`, and `notice` items, and the
   cancellation. A failed check ends the transaction, and the `wait` returns in the same attempt.
2. Set `status = 'awaiting_jobs'`, increment `wake_generation`, and set `awaiting` and
   `current_job_id` to a fresh UUID.
3. Append `run.suspended { toolCallId, jobIds, generation, parts, steps, usage }`. `parts` is the
   reply of the current segment so far, with the open `wait` call.

After the commit the worker enqueues the deadline job under that UUID with `startAfter`, and
`executeJob` accepts `awaiting_jobs` as a normal end.

**Wake.** `UPDATE runs SET status = 'queued', current_job_id = $new WHERE id = $id AND status =
'awaiting_jobs' AND wake_generation = $gen RETURNING ...`, with `run.resumed { generation,
cause }` appended in the same transaction. The winner enqueues a `runs` job under `$new` after
its commit, through a dispatch variant that takes the job id. A failed enqueue leaves the Run
`queued`; it does not fail the Run. The `RunJob` payload gains `wake?: { generation }`.

**Deadline job.** It is a `runs` job whose id is the `current_job_id` of the suspension.

- Its wake update keeps `current_job_id` as its own id, so admission reads a live job.
- `executeJob` compares the generation and the job id with the Run **before** its pickup gate. A
  job that is not current returns at once, and it never settles or claims the Run.
- Same generation and `awaiting_jobs`: it wakes with the cause `timeout` and executes.
- Same generation, status `queued`, and the recorded job absent past one heartbeat window: it
  sets `current_job_id` to its own id and executes (lost wake).
- `expireDeadLetteredRun` ignores a dead job that is not the current job of its Run.

**Admission** reads `current_job_id ?? run.id` (`chat-admission.ts:34-71`).

Rejected: a `run_waits` table. Admission and the web would join a second table to judge one Run.

### D12: A woken attempt is seeded like a Continue

`run.suspended` is a `run.continued`-shaped record. The claim of a woken Run reads the latest
one. A claim is the first after a wake when no `run.started` follows the latest `run.resumed`;
only that claim skips the `native.attempt` recovery check. A later claim is a retry and follows
the shipped rules.

The first attempt after a wake:

1. Computes the `wait` result from the job rows and the cause, withdraws the pending notice of
   each job that the result reports as settled, and appends `tool.completed` for the open call.
2. Seeds its state from `run.suspended`, through the readers that a Continue uses:
   `continueStateFromEvents` (kept messages for `requestMessages`), `replyParts` in the finalizer
   (so `upsertRunningReply` and the per-attempt window keep the earlier steps), the stream bridge
   replay, and the step offset of the segment budget.
3. Carries the usage of the attempt before the wait into the usage of the reply.
4. Runs the step-boundary delivery before its first request, so a steer or a notice that woke
   the Run is delivered there.

### D13: Steer, interrupt, and cancellation as wakers

`admitToSlot` (`chat-loop.service.ts:402-439`) runs the wake update for the modes `steer` and
`interrupt`, and `requestCancel` runs it for a cancellation, when the Run is in `awaiting_jobs`.
A `queue` item does not wake. A cancelled Run then settles at pickup through the shipped
`settleCancelledBeforeStart`, and `settleOpenToolCalls` settles the `wait` call.

For a Run that executes, admission of a steer sends `{ kind: 'steer' }`. The listener raises a
yield signal on the segment, which is not an abort.

The interrupt fate is decided **per call**: a host `bash` call and a `wait` call are
`background`; a `bash` call with an `ssh://` or `machine://` `cwd` stays `cancel` and gets the
interrupt signal. `settleOnInterrupt` raises the yield signal and then awaits the `done` of each
`background` call, as it does for `finish`, so the real `backgrounded` result is recorded before
the delivery closes the reply.

### D14: A notice is a delivery row that points at a job

`ChatDeliveryProducer` becomes `'owner' | 'job'`, and the mode gains `notice`. A `job` row has
`sender_ref = job id`, empty parts, and the settings of the starting Run. A partial unique index
on `sender_ref` for `producer = 'job'` gives one notice per job.

- The boundary delivery gets its own locked read for `steer`, `interrupt`, and `notice`.
  `stepEndSignal` and the final-answer check add `notice`.
- `pauseBehind` keeps its read of `steer` and `interrupt`, so a notice never becomes a `queue`
  item. `firstPendingQueueItem` and `changePendingMode` exclude `producer = 'job'`.
- With no owner item, the delivery stores a host message: `role = 'user'`,
  `sender_user_id = NULL`, no parts. `run.delivered` names every delivered id and the cause.

The `job` context items are authored at the first dispatch of the segment or Run, from the
delivery rows whose delivered message is the trigger message. That source serves all four
paths: a boundary, a host-started Run, a send, and a promoted item. They are stored through
`storeAtDispatch`, as the `interrupted` item is. The body is a packaged template. Output text
passes the delimiter neutralization of tool results.

A trigger row with no stored content is appended to the model messages and does not replace the
last message: `appendUserMessage` keeps the position, and `requestMessages` substitutes only a
trigger that it found.

A host message keeps the role `user`, because `context-injection` fixes the wire role and the
reply trigger needs it. Readers that must skip it test `sender_user_id IS NULL`: the title input,
the list preview, the recency digest (`messages-repository.ts:399`), the public projection
(`dto/chats.dto.ts:613-635`), and the shared fork rows (`chats.service.ts:53-86`). Search and
`conversation_read` need no change: a host message has no text part, and context-item parts give
no visible text. The message DTO gains `host: boolean`.

Rejected: a new `message_role` value. Replay, search, fork, the public projection, the reply
trigger, and the web all branch on the role, and each would need a new case.

### D15: The host starts a Run through the promotion path

The idle rule runs in the settlement transaction: no non-terminal Run, the latest Run
`completed`, the Chat not archived, and a job state that wakes. It validates the settings of the
first pending notice with `resolveSendSettings`, stores the host message, calls
`createRunForMessage`, marks every pending notice delivered, and dispatches after the commit.
This is `startItemRun` (`queue-promotion.ts:106-147`) with a host message in place of a user
message.

### D16: A send takes the held notices

`chat-loop.service.ts`, `startItemRun`, and the mode change of a paused item mark the pending
notices delivered to the user message that they store. The first dispatch authors the items, as
in D14. A follow-up Run changes nothing at admission; its first step boundary or its final
answer delivers them.

### D17: API and live updates

`ChatJobsController` follows `ChatDeliveriesController`. `ChatListItemResponse` gains
`runningJobs`, from one grouped query beside `findLatestPerOwnedChat`; the live loader
(`live/live-record-loader.ts:75-78`) fills the same field. `llame_notify_change()` is restated
with a branch for `chat_jobs` that emits the pointer of the owning Chat, so the shipped
`chat.upserted` message carries the new count.

### D18: Web

- `ChatActivityStatus` gains `background`. `resolveChatActivityStatus` takes `runningJobs` and
  the status of the tracked Run.
- `SESSION_DETAILS_SECTIONS` gains `jobs`. The section polls the jobs API while the panel is
  open, as the git section does, and refetches on `chat.upserted`.
- `PendingDeliveries` renders a `job` item with delete only, and labels a paused queue only for
  `owner` items.
- `chat-message-row.tsx` renders a host message as notices, and gets rows for `wait`, `stop`,
  and the `backgrounded` result.

### D19: Tool registration

`wait` (`read_only`) and `stop` (`execute_code`) join `TOOLS` and `TOOL_PROMPT_IDS`.
`isHostCapabilityTool` admits `stop`. `LOCATOR_READERS` gains `job`, and `importPlan` excludes
the scheme from prompt imports, as it excludes `artifact`
(`prompt-imports/prompt-imports.ts:283-293`). The permission projection lowers the scheme and
removes the selector.

## Threats

- **Cross-tenant read or stop.** Every job, chunk, and notice row has forced owner RLS. The
  signal carries only ids, and the worker confirms each request in the owner's scope. The
  heartbeat re-read of a worker runs once per owner. Negative tests cover the reader, both
  tools, both endpoints, the chunk table, and a query with no identity.
- **Injected instructions in output.** A notice is a rail item with the precedence statement,
  neutralized delimiters, and a 2,000-character preview. The model reads more only through
  `read`, which is a tool result.
- **A Run with nobody present.** The host starts it only for the owner of the Chat, with
  settings that the current configuration admits, and never after a Run that did not complete.
- **A runaway model.** The process bound refuses the 65th command of a worker. Per-owner
  fairness is not provided (#1663).
- **A job that outlives a permission change.** Accepted (grilling GQ25). A job is not checked
  again after it starts.
- **Secrets in stored output.** An increment ends before any credential or credential prefix
  that crosses its cut (D5).
- **Job output in a shared Chat.** The public projection and a shared fork omit host messages.

## Risks / Trade-offs

- [A worker restart ends every job] → the job is `cancelled` / `worker` or `lost`, and the next
  Run or step is told. #1662 tracks adoption.
- [A crash after a wake fails a Run whose segment ran `bash`] → the shipped recovery rule
  applies, and the owner can Continue. A read-only segment restarts from its first step.
- [The enqueue of a wake is not transactional] → the deadline job executes the Run at the
  deadline at the latest. Until then the Run is `queued` with an absent job, and the next
  message of the owner expires it under the shipped rule.
- [One row write per second for a chatty job] → bounded by the 16 KiB batch and the output
  bound. #1627 moves host output to a file.
- [The resumed attempt touches the finalizer, the bridge, and the usage path] → it reuses the
  Continue readers and gets its own layer with its own integration suite.
- [`tools.callTimeoutSeconds` below 120 moves commands earlier] → documented; see the third
  deviation in `proposal.md`.

## Migration Plan

1. `job-store` adds the three tables. No existing row changes.
2. `wait-suspend` adds the enum value in a migration of its own, then the `runs` columns.
3. `notices` restates `llame_notify_change()` and adds the index on `chat_deliveries`.
4. Deploy the API and the workers together for the `RunJob` change. An old worker ignores an
   unknown `wake` field and would run a woken Run from its segment start, so the two must not
   mix.
5. Rollback is a deploy of the earlier build. No setting turns the background move off.
   Before the rollback, stop every job (the worker shutdown does this) and let each Run in
   `awaiting_jobs` wake, which takes at most 1 h. An earlier build reads the Run id as the queue
   job of such a Run, finds it settled, and expires the Run at the next message. It ignores
   `notice` rows that it cannot type, so delete pending notices first.

## Open Questions

- The preview size of a notice (2,000 characters per output) and the heartbeat multiple (four)
  are first values. Both can change without a schema change.

## Revision history

- **v2 (2026-11-11, review round 1):** two reviewers, 0 P0, 29 P1, 36 P2. Fixed in the specs:
  new MODIFIED blocks for `No mid-run tool-state checkpointing`, three more `run-steering`
  requirements, `Remote bash uses the local bounds`, the shared-fork rule, and the `bash`
  rendering; new deltas for `tool-call-permissions` and `tool-result-rendering`; the proof rule
  on every stop; the step boundary as a touch; the artifact only for output that does not fit.
  Fixed in the design: no executor deadline for a handle (D3), separate runner signals (D4), the
  redaction cut (D5), the lock order and the savepoint (D6), the Machine limiter (D7), the
  suspension record and the Continue readers (D11, D12), the per-call fate (D13), the notice
  reads and the empty trigger row (D14), and the shutdown order (D9). The stack grew from 7 to 11
  implementation layers. Rejected: a MODIFIED block for the `context-injection` rail requirement
  and for `Tool failure is an observation`; both are listed with their reading.
- **v1 (2026-11-11):** initial draft.
