## Context

See `proposal.md` for the motivation. Code references are at `master` `048f75aa`.

### Host bash today

- `admitManagedBash` returns `{ cwd, run, release }`, and `run()` resolves only after the child
  settles (`packages/bash-executor/src/execute.ts:239-295`). The child handle and the captured
  streams are private to `watchManagedChild` (`watch.ts:96-131`).
- Output is captured in memory up to `tools.artifacts.maxBytes` and redacted once, at settlement
  (`watch.ts`, `knownCloseResult`; `sanitize.ts:103`).
- The process bound is a module-level counter with `maxProcesses: 1`, shared with `ssh://`
  (`execute.ts:16,62`; `apps/api/src/tools/bash-limits.ts:20-30`).
- The runner gives every call `AbortSignal.timeout(tools.callTimeoutSeconds)` and races the tool
  against it, with a 750 ms grace for `bash` (`apps/api/src/tools/runner.ts:66,75,123-145`).
- `interruptFateOf` derives the fate from the classification and the name and never returns
  `background` (`apps/api/src/tools/registry.ts:45-52`). A test pins that
  (`registry.test.ts:229-233`).

### Runs today

- A Run status is a Postgres enum with no waiting state (`apps/api/src/db/schema/chats.ts:314-329`).
  `markStarted` claims any non-terminal Run as `running_model` (`runs-repository.ts:411-440`).
- `executeJob` throws when the Run is not terminal after its stream drains
  (`apps/api/src/runs/runs-worker.service.ts:293-301`).
- Admission reads one queue job, by the id of the Run, and expires a Run whose job is absent for
  one heartbeat window or is settled (`apps/api/src/chats/chat-admission.ts:34-123`).
- A queue job id is a UUID, the primary key is `(name, id)`, and a second send with one id
  returns `null` for about 7 days (`pg-boss@12.25.0` `plans.js:303,601,1500,1998-2007`).
  `RunDispatchService.dispatch` ignores that return (`run-dispatch.service.ts:38-60`).
- A cancellation stamps the Run and notifies. Only a worker that executes the Run acts on the
  signal (`run-control-listener.service.ts:68-86`). A queued Run settles at pickup
  (`runs-worker.service.ts:170-191`).
- A tool result is durable as a `tool.completed` event. The stored reply is rebuilt from the
  log (`run-reply-finalizer.ts:355-360`). A Continue seeds its attempt from a `run.continued`
  event that holds the kept parts (`run-creation.ts:98-107`, `run-execution.service.ts:5588-5603`).
- No worker has an identity. `runs.worker_id` is the native executor id.

### Deliveries, messages, and context items today

- `chat_deliveries` has owner RLS, text columns `producer`, `sender_ref`, `mode`, and `state`,
  and the type `ChatDeliveryProducer = 'owner'` (`db/schema/chat-deliveries.ts:15-97`).
- A delivery stores one user message through `createUserMessageIfAbsent`, which hardcodes the
  role `user` and a non-null sender (`messages-repository.ts:640-665`).
- `sender_user_id` is nullable. A trigger requires that `in_reply_to` names a row with the role
  `user` (`migrations/0013_reply_integrity_trigger.sql:13-30`).
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
change to the Machine protocol; a new provider role.

## Decisions

### D1: Three tables, one of them infrastructure

- `chat_jobs`: `id`, `chat_id` and `owner_user_id` (composite FK to `chats`, cascade),
  `executor`, `seq`, `state`, `stopped_by`, `run_id`, `tool_call_id`, `worker_instance_id`, `pid`,
  `started_at`, `settled_at`, `deadline_at`, `stop_requested_at`, `stop_requested_by`, `result`
  (jsonb: exit code, truncation flags), `outputs` (text array), `artifact_id`, and the settings of
  the starting Run. Unique on `(chat_id, executor, seq)`. Policy as `chat_deliveries_owner`,
  with `FORCE ROW LEVEL SECURITY` appended by hand.
- `chat_job_chunks`: `job_id`, `output`, `position`, `content` (bytea), with the same owner
  policy through a composite FK.
- `worker_instances`: `id`, `last_seen_at`. A plain table with no tenant column and no RLS, as
  `embedding_model_bindings` is (`db/schema/search.ts:274-290`).

Rejected: job state in `run_events`. A job outlives its Run, and a count per Chat needs an index.

### D2: The job number is a reserved artifact number

`ArtifactsRepository.nextSeq` already runs in its own transaction and accepts gaps
(`artifacts-repository.ts:82`). A job reserves a number when it starts.
`writeToolArtifact` gains an optional reserved `seq`. `job://bash-7` and `artifact://bash-7`
then name one thing at two times.

Rejected: a separate job counter. The notice would name two different numbers for one command.

### D3: The executor returns a handle

`packages/bash-executor` gains `startManagedBash(input, context, options)`. It returns
`{ pid, settled: Promise<BashResult>, snapshot(), stop() }`. The handle has its own abort
controller, so the signals of the call no longer end the child. `executeManagedBash` stays as a
wrapper that awaits `settled`, so `apps/machine/src/proc.ts:88-90` does not change.

The pipes stay. Rejected: output files (grilling GA5). A file that the child writes has no size
bound, and `RLIMIT_FSIZE` would kill a command that today only loses output.

### D4: A registry in the worker owns live commands

`BashJobRegistry` is a singleton of the worker process. Every host command is registered at
spawn. The foreground call races four things: `settled`, the foreground bound, the yield signal
of the segment, and the abort signal of the Run.

- `settled` first: the call returns the ordinary result, as today.
- Bound or yield first: the registry promotes the command. It reserves the number, inserts the
  `chat_jobs` row, stores the output captured up to that point, and the call returns
  `backgrounded`. The call appends `native.result` with that result.
- Abort first: the registry stops the command, as today.

`async: true` promotes at spawn. The registry holds the facts that a settlement needs after the
call context is gone: owner, Chat, Run, tool call, the artifact bound, and the credential set.

### D5: Output increments reuse the settle-time redaction

A flush takes the unflushed text of each stream, keeps back the lookahead of the longest
credential, and redacts the rest with `sanitizeKnownResultAtBound`. The kept-back tail joins the
next flush. One timer per job arms at the first unflushed byte and fires after 1 s; 16 KiB
flushes at once. At settlement the registry writes the artifact from the full capture, as
`spillBashResult` does, and deletes the chunks in the same transaction. When the artifact write
fails, the chunks stay.

### D6: One settlement transaction

In `tenantDb.runAs(owner)`, under the Chat row lock:

1. Settle the job with a conditional update on `state = 'running'`. A lost update ends the
   transaction.
2. Write the artifact and delete the chunks.
3. Read the Chat's non-terminal Run. When it is in `awaiting_jobs` and lists the job, skip the
   notice. Otherwise insert the `notice` item, unless `stop_requested_by = 'assistant'`.
4. When a Run is in `awaiting_jobs`, run the waker update (D11).
5. When no Run is live, apply the idle rule (D15).

The Chat lock orders this transaction against a completion, a delivery, and an admission, which
take the same lock.

### D7: A limiter object replaces the module counter

`BashProcessLimiter` is created once per worker with `tools.bash.maxProcesses`. A slot is held
from admission to the settlement of the child, in the foreground or in the background. The
`ssh://` path takes a slot from the same object (`ssh-bash.ts:418`). The refusal is a new result
member `limit_reached`. `resetManagedExecutorForTests` goes; each test builds its own limiter.

### D8: The lifetime is a timer of the registry

`deadline_at` is stored on the row. The registry arms one timer per job and calls `stop()` with
the cause `lifetime`. The settlement is `timed_out` when the group is proven empty and `lost`
otherwise. `unlimited: true` stores no deadline.

### D9: Worker identity, heartbeat, and the end of a worker

A worker takes a random UUID at boot and upserts `worker_instances` every
`runs.heartbeatSeconds`. In the same tick it re-reads its own jobs, each in the tenant scope of
its owner. A missing row or a recorded stop request stops the command.

`lost` is decided on touch, by a query that joins the job to its `worker_instances` row. The
touch points are the Run claim, the admission, the deadline job, the `job://` reader, and the
jobs API. Each runs in the scope of one owner. The chat list count uses the same join.

`BashJobRegistry.onModuleDestroy` stops every job and settles it `cancelled` / `worker`. It runs
before the queue stops. Chat deletion requests a stop for each live job before the cascade
(`chats.service.ts:486-507`).

Rejected: a queue job per background job. A queue job cannot be pinned to the process that owns
the child, and the queue refuses an expiry above 24 h.

### D10: Stop is a recorded request plus a signal

`stop` and the `PATCH` stamp `stop_requested_at` and `stop_requested_by` and send
`{ kind: 'job-stop', jobId }` on `llame_run_control` in the same transaction. The listener of
the hosting worker confirms the request in the owner's scope and calls `stop()`. The heartbeat
tick of D9 covers a lost signal. A request for a job on a dead worker settles it `lost` at once.

### D11: `awaiting_jobs`, the wake generation, and the current job

New on `runs`: `wake_generation integer`, `current_job_id uuid`, and `awaiting jsonb` (the open
`wait` call id, the listed job ids, the deadline). `awaiting_jobs` joins the `run_status` enum.

**Suspend.** `wait.execute` first answers from the job rows when a listed job is settled.
Otherwise it asks the executor to suspend. The executor waits for the other calls of the step,
then runs one transaction, fenced by `activeAttemptId` and under the Chat lock: re-check the jobs,
the pending items, and the cancellation; set `status = 'awaiting_jobs'`, increment
`wake_generation`, set `awaiting` and `current_job_id` to a fresh UUID; append `run.suspended`.
After the commit it enqueues the deadline job under that UUID with `startAfter` and returns.
`executeJob` accepts `awaiting_jobs` as a normal end.

**Wake.** `UPDATE runs SET status = 'queued', current_job_id = $new WHERE id = $id AND status =
'awaiting_jobs' AND wake_generation = $gen RETURNING ...`. The winner enqueues a `runs` job under
`$new` after its commit. The `RunJob` payload gains `wake?: { generation, cause }`.

**Deadline job.** It is an ordinary `runs` job. `executeJob` compares its generation with the
Run. Same generation and `awaiting_jobs`: it performs the wake update itself with the cause
`timeout` and executes. Same generation, another status, and `current_job_id` absent past one
heartbeat window: it executes (lost wake). Otherwise it returns.

**Admission** reads `current_job_id ?? run.id` (`chat-admission.ts:34-71`).

Rejected: a `run_waits` table. Admission and the web would join a second table to judge one Run.

### D12: A woken attempt reuses the Continue projection

The waker appends `run.resumed { generation, cause }`. The claim of a job that carries `wake`
does not apply the `native.attempt` recovery check; a redelivery of that job does. The attempt
then:

1. Rebuilds the reply of the current segment from the log, as the finalizer does.
2. Computes the `wait` result from the job rows and the cause, and appends `tool.completed` for
   the open call.
3. Takes `continueKeptParts` of that reply and sends the next request through
   `requestMessages(context, keptMessages)`, the path of a Continue Run
   (`run-execution.service.ts:7151-7177`).
4. Before that request, runs the step-boundary delivery, so a steer or a notice that woke the
   Run is delivered there.

### D13: Steer, interrupt, and cancellation as wakers

`admitToSlot` (`chat-loop.service.ts:402-439`) and `requestCancel` run the wake update when the
Run is in `awaiting_jobs`. A cancelled Run then settles at pickup through the shipped
`settleCancelledBeforeStart`, and `settleOpenToolCalls` settles the `wait` call.

For a Run that executes, admission of a steer sends `{ kind: 'steer' }`. The listener raises a
yield signal on the segment, which is not an abort. `interruptFateOf` returns `background` for
`bash` and `wait`, and the interrupt path raises the same signal for those calls.

### D14: A notice is a delivery row that points at a job

`ChatDeliveryProducer` becomes `'owner' | 'job'`, and the mode gains `notice`. A `job` row has
`sender_ref = job id`, empty parts, and the settings of the starting Run. A partial unique index
on `sender_ref` for `producer = 'job'` gives one notice per job.

`stepEndSignal` and the final-answer check add `notice` to their mode list. The delivery
transaction stores the owner items as today. With no owner item it stores a host message:
`role = 'user'`, `sender_user_id = NULL`, no parts. `run.delivered` names every delivered id.

The `job` context items are authored where the `interrupted` item is: at the first dispatch of
the segment, from the `run.delivered` event and the job rows, through `storeAtDispatch`. The
body is a packaged template. Output text passes the delimiter neutralization of tool results.

A host message keeps the role `user`, because `context-injection` fixes the wire role and the
reply trigger needs it. Readers that must skip it test `sender_user_id IS NULL`: the title input,
the list preview, the search evidence predicate, `conversation_read`, and the shared-fork sender
rewrite (`chats.service.ts:76`). The message DTO gains `host: boolean`.

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

`chat-loop.service.ts` and `startItemRun` mark the pending notices delivered to the user message
that they store. The first dispatch authors the items, as in D14. A follow-up Run changes
nothing at admission; its first step boundary or its final answer delivers them.

### D17: API and live updates

`ChatJobsController` follows `ChatDeliveriesController`. `ChatListItemResponse` gains
`runningJobs`, from one grouped query beside `findLatestPerOwnedChat`. `llame_notify_change()`
is restated with a branch for `chat_jobs` that emits the pointer of the owning Chat, so the
shipped `chat.upserted` message carries the new count.

### D18: Web

- `ChatActivityStatus` gains `background`. `resolveChatActivityStatus` takes `runningJobs` and
  the status of the tracked Run.
- `SESSION_DETAILS_SECTIONS` gains `jobs`. The section polls the jobs API while the panel is
  open, as the git section does, and refetches on `chat.upserted`.
- `PendingDeliveries` renders a `job` item with delete only.
- `chat-message-row.tsx` renders a host message as notices, and gets rows for `wait`, `stop`,
  and the `backgrounded` result.

### D19: Tool registration

`wait` (`read_only`) and `stop` (`execute_code`) join `TOOLS` and `TOOL_PROMPT_IDS`.
`isHostCapabilityTool` admits `stop`. `LOCATOR_READERS` gains `job`. The permission projection
leaves `job://` as written, which is the logical-text match that artifacts use.

## Threats

- **Cross-tenant read or stop.** Every job, chunk, and notice row has forced owner RLS. The
  signal carries only ids, and the worker confirms each request in the owner's scope. Negative
  tests cover the reader, both tools, both endpoints, and a query with no identity.
- **Injected instructions in output.** A notice is a rail item with the precedence statement,
  neutralized delimiters, and a 2,000-character preview. The model reads more only through
  `read`, which is a tool result.
- **A Run with nobody present.** The host starts it only for the owner of the Chat, with
  settings that the current configuration admits, and never after a Run that did not complete.
- **A runaway model.** The process bound refuses the 65th command of a worker. Per-owner
  fairness is not provided (#1663).
- **A job that outlives a permission change.** Accepted (grilling GQ25). A job is not checked
  again after it starts.
- **Secrets in stored output.** Increments are redacted before the write, with a kept-back tail.

## Risks / Trade-offs

- [A worker restart ends every job] → the job is `cancelled` / `worker` or `lost`, and the next
  Run is told. #1662 tracks adoption.
- [A crash after a wake fails a Run whose segment ran `bash`] → the shipped recovery rule
  applies unchanged, and the owner can Continue. A change needs a rewrite of
  `No mid-run tool-state checkpointing`.
- [The enqueue of a wake is not transactional] → the deadline job executes the Run at the
  deadline at the latest. Until then the Run is `queued` with an absent job, and the next
  message of the owner expires it under the shipped rule.
- [One row write per second for a chatty job] → bounded by the 16 KiB batch and the output
  bound. #1627 moves host output to a file.
- [Two consecutive `user` rows reach the provider when a host message precedes a send] → the
  held notices go into the user message of the send (D16), so this occurs only for a host-started
  Run that fails before it replies. The projection already replays a paused queue that way.
- [`tools.callTimeoutSeconds` below 120 moves commands earlier] → documented; see the third
  deviation in `proposal.md`.

## Migration Plan

1. `job-store` adds the three tables. No existing row changes.
2. `wait` adds the enum value in a migration of its own, then the `runs` columns.
3. `notices` restates `llame_notify_change()` and adds the index on `chat_deliveries`.
4. Deploy the API and the workers together for the `RunJob` change. An old worker ignores an
   unknown `wake` field and would run a woken Run from its segment start, so the two must not
   mix.
5. Rollback: remove `wait` and `stop` from `tools.allowed`. A Run in `awaiting_jobs` must wake
   before an older build starts; its deadline is at most 1 h away.

## Open Questions

- The preview size of a notice (2,000 characters per output) and the heartbeat multiple (four)
  are first values. Both can change without a schema change.

## Revision history

- **v1 (2026-11-11):** initial draft.
