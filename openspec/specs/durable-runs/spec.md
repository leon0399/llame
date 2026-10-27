# durable-runs

## Purpose

**durable-runs** is the worker-processed execution of chat runs _on_ the `job-queue` substrate: every user message becomes a run whose progress is an append-only, replayable event log a client subscribes to (refresh-safe), with the worker as the sole executor (no inline request-thread path). It owns the run lifecycle contract — per-chat single-flight (one non-terminal run per chat, enforced at the datastore) with job-state recovery of a stuck run whose queue job can no longer execute it; crash-safe claim/finish (claim-if-non-terminal, first-writer-wins completion); liveness enforced with no cross-tenant reaper (no default time or step limit; an opt-in in-process wall-clock budget, a worker-side execution ceiling below the queue's job duration, and a model-stream idle watchdog + native queue-heartbeat worker-death recovery + dead-letter terminal expiry in the owner's tenant scope); fail-fast + self-healing enqueue; failure classification (infra retries, model failure is terminal-but-job-succeeds); parallel execution across chats via the queue's per-consumer concurrency; and a dedicated no-HTTP worker process that scales independently of the api via the same worker-profile mechanism, draining gracefully on shutdown.

## Requirements

### Requirement: Every message executes as a durable, resumable run

A user message SHALL become a worker-processed **run** whose progress is an append-only, replayable event log; a client SHALL be a subscriber to that log, not the holder of run state, so a page refresh or reconnect resumes an in-flight run and replays a completed one without loss. There SHALL be no inline (request-thread) execution path — the worker is the sole executor.

#### Scenario: Refresh mid-run resumes from the event log

- **WHEN** a client refreshes or reconnects while a run is streaming
- **THEN** it resubscribes to the run's event log and continues without losing prior deltas or the final result

### Requirement: One in-flight run per chat (single-flight)

At most one non-terminal Run MUST exist for each Chat. The datastore MUST enforce this with a
partial unique index over non-terminal Runs, not with application checks only. When a Chat has an
in-flight Run, a different message for that Chat MUST get a conflict (409). A chat send that
names a message id that already has a Run MUST get a conflict as a duplicate. A chat send never
makes a second Run for one message. Only a follow-up Run from `turn-actions` can add a Run to a
message that has a Run. A follow-up request MUST pass the same admission as a new message.
When a worker stops during execution, the `job-queue` substrate MUST recover or expire its Run
(worker-death recovery or dead-letter).

Each Run MUST go into the queue as the job that has the Run's own id (per `job-queue`'s
named-job requirement). Thus the single-flight admission path judges a blocker Run from the
state of its own job, not from the age of the Run. A blocker Run whose job is `queued`,
`retrying`, or `active` is live. Admission MUST reject the new message or follow-up request with
409, however old that Run is. A blocker Run whose job is absent, `completed`, `failed`, or
`cancelled` is **stuck**, because the queue cannot execute it. A crash before the enqueue, or a
job that settled before its Run settled, can cause this. The admission path MUST expire a stuck
Run on the next message or follow-up request, so a stuck Run cannot block a Chat permanently. A
Run younger than one liveness window (`runs.heartbeatSeconds`) whose job is absent MUST count as
live, because its enqueue can still be in progress. A job state that admission cannot read in a
bounded wait, or cannot read at all, MUST count as live, never as stuck. Admission MUST read only
the job that has the id of the blocker Run. It MUST read it only for a Run in the tenant scope of
the owner that sends the request. It MUST NOT scan the queue. It MUST NOT read the Run or the job
of another owner.

#### Scenario: Concurrent different message is refused

- **WHEN** a Chat has a non-terminal Run whose job is `queued`, `retrying`, or `active`, and a different message arrives for that Chat
- **THEN** admission rejects the second message with 409, and the first Run does not change

#### Scenario: A long-running live blocker is never expired by age

- **WHEN** a Run of a Chat executes for hours with an `active` job, and a different message arrives
- **THEN** admission rejects the message with 409, and the Run continues

#### Scenario: A duplicate message id is rejected

- **WHEN** a chat send names a message id that already has a Run
- **THEN** admission rejects it as a duplicate
- **AND** the chat send makes no second Run for that message

#### Scenario: Only a follow-up Run adds a Run to a message

- **WHEN** the owner sends a follow-up request for the latest user message of a Chat with no live Run
- **THEN** admission creates another Run for that message
- **AND** a chat send with the same message id still gets 409

#### Scenario: A stuck blocker cannot wedge a chat forever

- **WHEN** a non-terminal Run older than one liveness window has no job, or its job is `completed`, `failed`, or `cancelled`, and a different message arrives
- **THEN** the admission path expires the stuck Run with a terminal `run.expired` and admits the new message
- **AND** the Chat does not get 409 answers without end

#### Scenario: An unreadable job state never expires a run

- **WHEN** a Run of a Chat is old enough to be stuck, and admission cannot read its job state in time or at all
- **THEN** admission rejects the submission with 409, and the Run does not expire or change

#### Scenario: A queued run blocks during a worker outage

- **WHEN** no worker consumes the runs queue, a Run of a Chat is still `queued`, and a different message arrives
- **THEN** admission rejects the message with 409, and the queued Run executes when a worker returns

#### Scenario: Another owner's run is never judged

- **WHEN** a caller sends a message or a follow-up request that names the Chat of another owner, whose Run is live or stuck
- **THEN** the API rejects the request as not found and reads no job state
- **AND** that Run does not expire, and the answer does not reveal it

### Requirement: Run claiming and completion are crash-safe

A worker SHALL claim a run only if it is non-terminal; a run already marked running SHALL be re-executed only after the queue substrate has determined its prior holder is no longer alive (redelivering the job per the native worker-liveness path), so two live workers racing the same run cannot both execute it. Completion SHALL be first-writer-wins: once a run is terminal, no later writer may change its outcome — this is the safety net that keeps even a transient two-worker overlap (a paused-but-not-dead worker) to a single terminal result.

#### Scenario: Two workers race one run

- **WHEN** two workers attempt to claim/execute the same run
- **THEN** exactly one executes it; the other's claim is refused (not stale) and it does not double-run

#### Scenario: Terminal run is immutable

- **WHEN** a late writer (a lagging worker, a deadman check) tries to mutate a run that has already reached a terminal state
- **THEN** the write is rejected and the recorded terminal outcome stands

Every queue-authorized claim or reclaim SHALL atomically assign a fresh trusted `activeAttemptId` persisted on the Run. Successful completion SHALL record `completedAttemptId`. These identifiers SHALL not reuse or overwrite `workerId`, which remains native executor authority. Attempt-owned events SHALL carry their attempt id so projections can select the winner; Run-level queue/cancellation events need no fabricated attempt. Context preparation, receipt publication, new invocation admission, and successful finalization SHALL verify their expected attempt id against the Run's current attempt. A superseded worker SHALL not start new admitted effects or publish an answer, attempt context, or availability baseline. Already admitted native effects retain their existing settlement/unknown-outcome rules, including when dispatch has not yet been observed. The native executor identity and durable native effect-recovery fence SHALL remain authoritative before starting a fresh model loop.

Native effect admission SHALL check the trusted owner, non-terminal uncancelled Run state, and expected `activeAttemptId` atomically with recording the existing durable native effect fence, before dispatch. An earlier preparation-time identity check SHALL not authorize that admission. After admission, an effect without a recorded result SHALL be treated as potentially executed during reclaim, even if the old worker paused before dispatch. Recovery SHALL apply the existing native unknown-outcome rules before any fresh model loop and SHALL NOT authorize duplicate execution; recording a new attempt id does not clear the effect fence.

#### Scenario: Reclaim precedes native effect admission

- **WHEN** attempt A pauses after preparation and attempt B reclaims the Run before A admits a native mutation
- **THEN** A's conditional admission is refused and it dispatches no mutation
- **AND** no stale effect record is admitted

#### Scenario: Reclaim follows admission but precedes observed dispatch

- **WHEN** A records native effect admission and pauses before dispatch, then B reclaims the Run without a recorded effect result
- **THEN** B treats the admitted operation as potentially executed and applies the existing unknown-outcome recovery rules
- **AND** B starts no fresh model loop or duplicate mutation while that effect is unsettled, even if A later resumes dispatch

#### Scenario: Superseded worker attempts late publication

- **WHEN** queue recovery starts attempt B and attempt A later tries to publish context or complete the Run
- **THEN** A's stale write is refused even if the Run is still non-terminal
- **AND** only the active attempt can publish a successful turn and availability record

#### Scenario: Successful context publication is atomic

- **WHEN** the active attempt dispatches a model request
- **THEN** the exact context text that request carries, the context-derived chat-state updates and minimal availability record that text accounts for, the Run's assistant message created or reset to `running` for that attempt when this is the attempt's first request, and the request record commit atomically before the request is sent
- **AND** a transaction failure persists none of those updates and sends no request
- **AND** when the active attempt commits a successful assistant turn, the finalized assistant message and terminal completion commit atomically

### Requirement: A run never stays stuck, enforced without a cross-tenant reaper

A run SHALL NOT remain non-terminal indefinitely, and its liveness SHALL be enforced with **no cross-tenant scan** — every liveness action runs either in-process on the executing worker or in the run owner's tenant scope. A run that keeps making progress SHALL have **no default limit** on its duration or step count: it ends when the model answers, when the owner cancels it, or by one of the mechanisms below. These mechanisms cover the failure modes:

- **Optional in-process time budget** — when the operator configures `runs.timeoutSeconds`, a run that exceeds that wall-clock budget while its worker is alive SHALL be aborted in-process and recorded as a terminal `run.expired` (distinct from a user-requested `run.cancelled`). Without a configured budget, no wall-clock budget applies.
- **Execution ceiling** — the executing worker SHALL end any run still executing 23 hours 55 minutes after its current execution attempt started, recording a terminal `run.expired` whose message names the execution ceiling rather than a configured budget. The ceiling SHALL fall before the `runs` queue's declared job duration (per `job-queue`), so the queue never fails and re-executes a live run from its beginning because of its age.
- **Model stream idle watchdog** — while the worker reads a model's streamed response, a request that yields no streamed part for 300 seconds after it is sent, or for 300 seconds after its previous part, SHALL be aborted, and the run SHALL be recorded as terminally failed with the error code `model_stream_idle` on the run's error and in its `run.failed` event. The watchdog SHALL measure only time spent waiting on the model's response; time spent executing tools SHALL never count toward it. It SHALL NOT retry the request.
- **Worker-death recovery** — if the executing worker dies or hangs (stops signalling liveness), the run's job SHALL be detected as stalled by the `job-queue` substrate (see its native worker-liveness requirement) and retried, so a healthy worker re-executes the run rather than leaving it orphaned. Re-execution is safe because claiming and completion are crash-safe (single-flight, first-writer-wins).
- **Tenant-scoped terminal expiry** — a run whose job exhausts its retries SHALL be settled to a terminal `run.expired` state in the run owner's tenant scope, via the queue's dead-letter path, with no cross-tenant scan.

There SHALL be no application-level liveness poll or per-run "deadman" job; native queue heartbeat drives worker-death detection.

#### Scenario: A progressing run has no default time limit

- **WHEN** no wall-clock budget is configured and a run keeps making model and tool progress for longer than the substrate's default job expiry
- **THEN** the run continues until the model answers, and it is neither expired nor re-executed from its beginning

#### Scenario: An overrunning run is aborted in-process

- **WHEN** the operator configured a wall-clock budget and a run exceeds it while its worker is alive
- **THEN** the worker aborts it in-process and records a terminal `run.expired` — no separate liveness job is involved

#### Scenario: A run reaching the execution ceiling ends before the queue expires it

- **WHEN** a run is still executing 23 hours 55 minutes after its current execution attempt started
- **THEN** the worker records a terminal `run.expired` whose message names the execution ceiling
- **AND** the queue does not fail or retry the job

#### Scenario: A stalled model stream fails the run

- **WHEN** a model request yields no streamed part for 300 seconds, before its first part or between two parts
- **THEN** the request is aborted and the run is recorded as terminally failed with error code `model_stream_idle`
- **AND** the parts observed before the stall remain in the run's record and the request is not retried

#### Scenario: A long tool call does not trip the stream watchdog

- **WHEN** a tool call executes for longer than 300 seconds between two model requests
- **THEN** the stream watchdog does not fire, and the next model request starts with a fresh 300-second window

#### Scenario: A dead worker's run is recovered, not orphaned

- **WHEN** the worker executing a run dies mid-run
- **THEN** the queue detects the stalled job and retries it, and a healthy worker re-executes the run — the run does not sit non-terminal forever

#### Scenario: Retry exhaustion expires the run in-tenant

- **WHEN** a run's job exhausts its retries (e.g. it keeps killing its worker)
- **THEN** it is settled to a terminal `run.expired` in the owner's tenant scope via the dead-letter path — without any cross-tenant scan

### Requirement: Enqueue is fail-fast and self-healing

Enqueuing a run SHALL NOT be assumed transactional with the run row. An enqueue failure SHALL immediately fail the run (freeing the chat's single-flight slot); any residual `queued`-but-orphaned state SHALL self-heal — a same-message retry supersedes it, and a different message expires it through single-flight admission once the run has no job and is older than one liveness window — with no manual cleanup.

#### Scenario: Enqueue failure frees the slot and self-heals

- **WHEN** the run row is written but the enqueue then fails
- **THEN** the run is failed (freeing the chat's single-flight slot), and no orphaned `queued` state persists beyond one liveness window once a different message arrives

### Requirement: Run failures are classified — infra retries, model failure is terminal

Runs SHALL execute on the `job-queue` substrate. An **infrastructure** failure (credential resolution, DB unavailability, a thrown handler) SHALL be retried by the queue's retry/dead-letter policy (see the `job-queue` capability). A **run-level** failure (e.g. a model error) SHALL instead be recorded durably as the run's terminal state, and the queue job SHALL still succeed — re-running a turn whose failure is already the source of truth is never correct.

#### Scenario: Model-error run is terminal and the job succeeds

- **WHEN** a run fails at the model level (durably recorded as the run's terminal state)
- **THEN** the queue job completes successfully and is not retried

#### Scenario: Infra failure retries via the queue

- **WHEN** a run's execution throws for an infrastructure reason
- **THEN** the queue retries the job (per `job-queue`'s retry policy), rather than the run being left terminally failed on a transient cause

### Requirement: Runs execute in parallel across chats

A worker SHALL execute up to an **operator-configured concurrency** of runs in parallel (via the `job-queue` per-consumer concurrency) — an IO-bound model stream MUST NOT serialize the others behind it. Because `job-queue` settles each job independently, one run's failure or retry never affects a sibling run executing alongside it.

#### Scenario: Concurrent runs of different chats execute in parallel

- **WHEN** several chats each have a run enqueued and a worker's concurrency is greater than one
- **THEN** those runs execute in parallel, and a long IO-bound run does not block the others

### Requirement: Single-flight holds under concurrency

Even with a worker executing many runs in parallel, two runs of the **same chat** SHALL NEVER execute concurrently — guaranteed by single-flight at enqueue (the queue never offers two claimable runs for one chat), so parallelism is inherently across distinct chats.

#### Scenario: Same-chat runs never overlap

- **WHEN** a worker runs at concurrency greater than one
- **THEN** no two runs belonging to the same chat are ever executing at the same instant

### Requirement: The worker can run as a dedicated process, scaled independently

Run execution SHALL be bootable as a **standalone process with no HTTP surface**, composed from the same image as the api, so worker processes scale independently of api replicas. The process SHALL run runs by subscribing to the runs queue through a **worker profile** (per the `job-queue` capability); run throughput SHALL scale as per-queue concurrency × the number of processes subscribed to the runs queue. Co-locating run execution in the api process and running it in a dedicated worker SHALL be the _same_ profile mechanism applied to different processes — not two separate execution code paths — so a single-process (co-located) deployment and a `worker × M` deployment share one boot path.

#### Scenario: Headless worker scales separately from the api

- **WHEN** the deployment runs the worker entrypoint (subscribed to the runs queue) with N replicas alongside the api's own replicas
- **THEN** run throughput scales with the worker replicas independent of api replicas, and the worker serves no HTTP

#### Scenario: Co-located and dedicated execution are one mechanism

- **WHEN** run execution is co-located in the api process (single-process/dev) and, separately, run in a dedicated worker (production)
- **THEN** both are the same worker profile applied to different processes, with no divergent execution path between them

### Requirement: Workers drain gracefully on shutdown

On shutdown, a worker SHALL stop claiming new jobs and finish (drain) in-flight runs before exiting, so a deploy or rollout does not abandon a mid-stream run (which would otherwise be recovered only later via the stale-liveness/deadman path).

#### Scenario: Shutdown drains in-flight runs

- **WHEN** a worker receives a shutdown signal while runs are in flight
- **THEN** it stops accepting new jobs and lets the in-flight runs finish (or reach a safe point) before the process exits

### Requirement: Final assistant-message projection preserves replay order

The final assistant message of a Run MUST be an ordered projection of the reasoning, text, and tool
activity that the durable run-event log holds. It MUST NOT put all reasoning before the tools or
all text after the tools. A partial message persisted after a model error MUST keep the same order
for each part observed before the failure.

The assistant message of a Run MUST exist from the first model request of the Run. The dispatch
transaction of the first request of an attempt MUST create that message with no parts. When the
message exists from an earlier attempt or an earlier Run, it MUST reset it with no parts. Its usage MUST be the non-completed
`{ status: 'running', complete: false, runId, attemptId, modelId, effort }` of that attempt. The
usage omits `effort` when the Run has none, and adds `permissionMode: 'bypass'` when the effective
permission mode of the attempt is bypass. Each `model.requested` event MUST carry the id of the
attempt that dispatches it. The system MUST store each in-Run context item in the fenced
transaction that dispatches the first request that carries it. That transaction MUST also store
the current part snapshot of the attempt: its reasoning, text, and tool parts so far, then the new
item.

Each terminal path MUST finalize the assistant message of the Run through one shared finalizer.
These paths are completion, failure, cancellation, expiry by the worker, retry exhaustion (dead
letter), and cancellation before start. They are also the native-recovery `outcome_unknown`
settlement, pickup failure, the claim-time terminal transitions, and expiry by a new message. A
lost settlement persists the turn of its attempt through the same ownership rule, without that
finalizer. Some settlers hold the live part collector of the attempt: completion, in-process
failure, cancellation, expiry by the worker, and a lost settlement. Such a settler MUST persist the
reasoning, text, and tool parts of the collector, which already hold the in-Run items of that
attempt in position. Other settlers do not hold that collector: retry exhaustion, the
native-recovery settlement, and the claim-time terminal transitions. Cancellation before start,
pickup failure, and expiry by a new message are also such settlers. A later attempt that fails, is cancelled, or expires before
its own dispatch is also such a settler. Such a settler MUST rebuild the reasoning, text, and tool
parts only from the events of the attempt that the usage of the message names. That window starts
at the `model.requested` of that attempt and ends at the `run.started` of the next attempt. Thus a
settler that never dispatched finalizes the message of the attempt that did. For a Continue Run
from `turn-actions`, the rebuild MUST start with the kept parts of its `run.continued` event, then
add the parts of the window. Such a rebuild MUST place each stored in-Run item of the Run itself
after a rebuilt part. That part is the last one whose toolCallId occurs before the item in the
stored snapshot. It
MUST place the item at the start only when none of those toolCallIds is in the rebuild. Thus the
item stays after the last tool part of the step that triggered it. A Continue rebuild MUST NOT
place a second copy of a kept context item. When the reply usage names the Run, the finalizer
MUST write a terminal usage, also with no parts. A follow-up Run that ends before its own dispatch
MUST leave the reply of the earlier Run unchanged. That usage carries the status (`completed`,
`error`, or `aborted`), `complete`, the Run id, the attempt id, the model id, and the effort. Some
finalizers do not belong to the attempt that the reply usage names. Examples are an out-of-attempt
settler, and a later attempt that ends before its own dispatch. Such a finalizer MUST write `complete: false`
with the `runId`, `attemptId`, `modelId`, `effort`, and `permissionMode` of the current usage. It
writes no token counts, latency, or measured size. A finalizer that finds no assistant message for
the Run MUST use the event log of the Run to decide. When the log has a `model.requested` event, the
Run dispatched before the system created replies at dispatch. The finalizer MUST then create the
reply from the full event log of the Run, with no in-Run items, and write terminal usage per
`run-usage-accounting`. When the log has no such event, the Run never dispatched: cancellation
before start, or a pickup or claim failure before dispatch. The finalizer MUST then write no
assistant message and no usage. An assistant message MUST NOT stay `running` after its Run is terminal.

Owner-facing reads are chat history, public share, the sources of shared-Chat and owner forks, and
the chat-list preview. They MUST omit an assistant message whose usage status is `running`. The
live stream shows it, and it becomes visible after finalization.

#### Scenario: Completed run projects event order into message parts

- **WHEN** a completed Run emits reasoning, text, tool activity, reasoning, and text in that order
- **THEN** its assistant message stores the parts in that same order

#### Scenario: Failed run projects observed part order

- **WHEN** a Run emits reasoning and text before a model error
- **THEN** its partial assistant message keeps the observed order of reasoning before text

The prospective cutover boundary in `context-injection` MUST govern these publication rules. The
system MUST NOT filter or rebuild the current conversation state retrospectively.

Operational and UI replay MUST keep the observed part order of a failed attempt, and that persisted
record MUST become model history. A failed, cancelled, expired, or superseded attempt keeps the
partial assistant turn that the user saw. It also keeps the rail context items that its dispatched
requests carried. These enter later model context, model-facing recall, and compaction like any
other committed turn. A later attempt of the same Run MUST instead reset that assistant message to
`running` for itself, in the transaction that dispatches its first request. That reset removes the
output and the in-Run items of the earlier attempt together. Its preparation MUST read history only
through the triggering user message, so its own assistant message never enters its request. A
later attempt can fail, be cancelled, or settle before its own dispatch. It MUST then leave the
message, output, and items of the earlier attempt unchanged. The finalizer then uses the attempt
that the usage names. A follow-up Run from `turn-actions` replaces the record in the same way: its
dispatch resets the reply of the earlier Run. A Continue Run puts back the kept parts and drops the
unfinished step. A Regenerate Run drops the whole earlier reply. Inside a successful attempt, a
single failed tool call stays a normal paired observation.

A compaction checkpoint can come before the first model request of a Run, and it publishes before
that request. The checkpoint row and the re-baked epoch state that it names MUST commit in one
transaction before the model request. They MUST stay when that attempt later fails, is cancelled,
or expires, because a checkpoint describes only committed history. A checkpoint row is committed
history, and the outcome of the attempt MUST NOT hold it back or retract it. A later attempt of the
same Run MUST use the published checkpoint again and MUST NOT pay for a second summary call.

#### Scenario: Failed attempt output stays visible and is model history

- **WHEN** an attempt streams reasoning, text, or tool results and then fails
- **THEN** operational and UI replay keep the observed order
- **AND** that partial output stays part of the record, with the rail context items that its dispatched requests carried
- **AND** it enters later model context, recall, and compaction like any other committed turn, until a follow-up Run replaces it

#### Scenario: A checkpoint published before a failed attempt survives it

- **WHEN** an attempt publishes a compaction checkpoint and its re-baked epoch state before its first model request, and that request then fails
- **THEN** the checkpoint row and the epoch state that it names stay committed
- **AND** the next attempt of the Run replays the same checkpoint and does not summarize the same prefix again

#### Scenario: Fresh retry succeeds after an earlier failure

- **WHEN** attempt B succeeds after attempt A failed
- **THEN** the committed assistant turn comes only from the events of B
- **AND** the events of A cannot merge into the assistant projection of B
- **AND** the reminders on the triggering user message are those of A, then any that B appended after them
- **AND** the id and state availability record of the Run is the observation of B, as the last attempt that dispatched

#### Scenario: A Run expired by a new message leaves no running reply

- **WHEN** a Run dispatched a model request, and a different message expires it through single-flight admission
- **THEN** the system finalizes the assistant message of that Run with a terminal status
- **AND** its parts are rebuilt from the events of the attempt that its usage names, around its stored in-Run items
- **AND** no assistant message of that Run stays `running`

#### Scenario: A retry drops the dead attempt's output and in-Run items

- **WHEN** attempt A streamed output and stored an in-Run item on the assistant message of the Run before its worker died
- **AND** attempt B of the same Run dispatches its first request
- **THEN** the dispatch transaction of B resets that assistant message to `running` for B, and removes the output and the in-Run item of A together
- **AND** the request of B carries neither the output nor the in-Run item of A
- **AND** the accepted-turn items on the triggering user message do not change, and B stores only the items that its comparison newly yields after them

#### Scenario: A settler that never dispatched finalizes the dispatched attempt's reply

- **WHEN** attempt A dispatches, streams output, admits a native mutation, and stores an in-Run item before its worker dies
- **AND** redelivered attempt B finds the admitted effect with no recorded result, and settles the Run `outcome_unknown` without a dispatch
- **THEN** the assistant message of the Run keeps the output and the in-Run item of A, and has status `error`
- **AND** its parts are rebuilt from the events of A
- **AND** its usage names the attempt of A with `complete: false` and no token counts, and no assistant message of that Run stays `running`

#### Scenario: A retry that fails before dispatch leaves the earlier reply

- **WHEN** attempt A dispatched, streamed output, and stored an in-Run item, and attempt B of the same Run fails during preparation before its first request
- **THEN** B does not reset the assistant message of the Run, which keeps the output and the in-Run item of A
- **AND** the terminal settlement of the Run finalizes that message from the events of A, with usage that names the attempt of A

#### Scenario: A Run that never dispatched gets no reply

- **WHEN** a Run is cancelled before start, or fails at pickup or claim, before any attempt dispatched a model request
- **AND** thus its event log has no `model.requested` event
- **THEN** the finalizer creates no assistant message for that Run and records no usage

#### Scenario: An in-Run item keeps its step position

- **WHEN** the tool call `t1` of an attempt completes, the next request first carries an in-Run item, and the attempt later completes
- **THEN** the dispatch transaction of the item stores a part snapshot that puts the item after the tool part of `t1`
- **AND** the completion settler persists the live collector parts of the attempt, which keep the item directly after the tool part of `t1`

#### Scenario: A rebuilt reply keeps an in-Run item after its step's tool parts

- **WHEN** the stored snapshot of an attempt is `t1`, `t2`, then an in-Run item, and its worker dies
- **AND** a settler without the collector rebuilds the parts from the events of that attempt as `t2`, `t1`
- **THEN** the finalized message puts the item after `t1`, the last rebuilt part whose toolCallId occurs before the item in the snapshot
- **AND** an item none of whose earlier toolCallIds survives in the rebuild goes first

#### Scenario: A running reply stays out of owner-facing reads

- **WHEN** a Run has dispatched and its assistant message is still `running`
- **THEN** chat history, public share, fork sources, and the chat-list preview omit that message, and the live stream shows it
- **AND** the message appears in those reads after a terminal path finalizes it

#### Scenario: A follow-up dispatch replaces the earlier Run's reply

- **WHEN** a Regenerate Run dispatches its first request for a turn whose reply belongs to an earlier Run
- **THEN** its dispatch transaction resets that reply to `running` for the Regenerate Run, with no parts
- **AND** a Regenerate that fails before its dispatch leaves that reply unchanged

#### Scenario: A Continue rebuild starts with the kept parts

- **WHEN** the worker of a Continue Run dies after it stored an in-Run item, and a settler without the collector finalizes the Run
- **THEN** the reply holds the kept parts of `run.continued` once, then the rebuilt parts of the attempt, with its own in-Run item in its step position

### Requirement: Received reasoning is durable before browser delivery

Each normalized reasoning delta received by llame SHALL be durably recorded before it is forwarded to a browser stream. The run transcript SHALL retain deltas received before either a worker failure or an upstream provider failure, and SHALL project them on both successful and failed terminal runs.

#### Scenario: Successful run retains streamed reasoning

- **WHEN** llame receives reasoning deltas and the run subsequently succeeds
- **THEN** the final assistant message contains the received reasoning in durable event order

#### Scenario: Provider failure retains received reasoning

- **WHEN** llame receives reasoning deltas and the upstream provider subsequently fails
- **THEN** the terminal failed run retains every reasoning delta durably recorded before that failure

#### Scenario: Worker failure never contradicts prior browser output

- **WHEN** llame has forwarded a reasoning delta to the browser and the worker subsequently fails
- **THEN** reconnect replay includes that delta
