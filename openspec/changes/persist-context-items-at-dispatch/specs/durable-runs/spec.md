## MODIFIED Requirements

### Requirement: One in-flight run per chat (single-flight)

At most one non-terminal run SHALL exist per chat, enforced **at the datastore** (a partial unique index over non-terminal runs), not by application checks alone. A second, _different_ message for a chat that already has an in-flight run SHALL be rejected with a conflict (409). Re-submitting an already-accepted message id SHALL be rejected as a duplicate — a message never produces two runs. A run whose worker has died mid-execution SHALL be recovered or expired by the `job-queue` substrate (worker-death recovery / dead-letter).

Each run SHALL be enqueued as the job named by the run's own id (per `job-queue`'s named-job requirement), so the single-flight admission path can judge a blocking run from its own job's state rather than from the run's age. A blocking run whose job is queued, retrying, or active SHALL be treated as live: the new message is rejected (409), however long the run has existed. A blocking run whose job is absent, completed, failed, or cancelled SHALL be treated as **stuck** — the queue can no longer execute it (a job never enqueued after a crash, or a job that settled without settling its run) — and SHALL be expired by the admission path on the next message, so a stuck run can never wedge a chat permanently. That expiry SHALL settle the stuck run through the same assistant-message projection as every other settlement, projecting its durable output (partial text, settled tool activity, and in-Run context items) into its assistant message. A run younger than one liveness window (`runs.heartbeatSeconds`) whose job is absent SHALL be treated as live, because its enqueue may still be in flight. A job state admission cannot read within a bounded wait, or at all, SHALL be treated as live, never as stuck. Admission SHALL read only the job named by the blocking run's id, and only for a run visible in the requesting owner's tenant scope; it SHALL NOT scan the queue or read another owner's run or job.

#### Scenario: Concurrent different message is refused

- **WHEN** a chat has a non-terminal run whose job is queued, retrying, or active, and a different message is submitted for it
- **THEN** the second submission is rejected (409), and the first run is unaffected

#### Scenario: A long-running live blocker is never expired by age

- **WHEN** a chat's run has been executing for hours with its job active, and a different message is submitted
- **THEN** the submission is rejected (409) and the running run continues

#### Scenario: A duplicate message id is rejected

- **WHEN** a message id that already has a run is submitted again
- **THEN** it is rejected as a duplicate; a second run is never created for the same message

#### Scenario: A stuck blocker cannot wedge a chat forever

- **WHEN** a non-terminal run older than one liveness window has no job, or its job is completed, failed, or cancelled, and a new different message arrives
- **THEN** the admission path expires the stuck run with a terminal `run.expired` and admits the new message, rather than 409-ing the chat indefinitely
- **AND** the stuck run's assistant message carries its durable partial text, settled tool activity, and in-Run context items

#### Scenario: An expired stuck run's in-Run items enter the next turn

- **WHEN** the admission path expires a stuck run whose event log holds an in-Run `instructions` item
- **THEN** the new message's Run replays that item at its stored position
- **AND** its first trigger omits the files that item names

#### Scenario: An unreadable job state never expires a run

- **WHEN** a chat's run is old enough to be stuck and admission cannot read its job state, because the read fails or does not answer in time
- **THEN** the submission is rejected (409) and the run is neither expired nor otherwise changed

#### Scenario: A queued run blocks during a worker outage

- **WHEN** no worker is consuming the runs queue, a chat's run is still queued, and a different message is submitted
- **THEN** the submission is rejected (409) and the queued run executes once a worker returns

#### Scenario: Another owner's run is never judged

- **WHEN** a caller submits a message naming another owner's chat whose run is live or stuck
- **THEN** the request is rejected as not found, no job state is read, and that run is neither expired nor revealed

### Requirement: Run claiming and completion are crash-safe

A worker SHALL claim a run only if it is non-terminal; a run already marked running SHALL be re-executed only after the queue substrate has determined its prior holder is no longer alive (redelivering the job per the native worker-liveness path), so two live workers racing the same run cannot both execute it. Completion SHALL be first-writer-wins: once a run is terminal, no later writer may change its outcome — this is the safety net that keeps even a transient two-worker overlap (a paused-but-not-dead worker) to a single terminal result.

#### Scenario: Two workers race one run

- **WHEN** two workers attempt to claim/execute the same run
- **THEN** exactly one executes it; the other's claim is refused (not stale) and it does not double-run

#### Scenario: Terminal run is immutable

- **WHEN** a late writer (a lagging worker, a deadman check) tries to mutate a run that has already reached a terminal state
- **THEN** the write is rejected and the recorded terminal outcome stands

Every queue-authorized claim or reclaim SHALL atomically assign a fresh trusted `activeAttemptId` persisted on the Run. Successful completion SHALL record `completedAttemptId`. These identifiers SHALL not reuse or overwrite `workerId`, which remains native executor authority. Attempt-owned events SHALL carry their attempt id so projections can select the winner; Run-level queue/cancellation events need no fabricated attempt. Context preparation, receipt publication, the dispatch transaction that `context-injection` defines, new invocation admission, and successful finalization SHALL verify their expected attempt id against the Run's current attempt. A superseded worker SHALL not start new admitted effects or publish an answer, attempt context, or availability baseline. Already admitted native effects retain their existing settlement/unknown-outcome rules, including when dispatch has not yet been observed. The native executor identity and durable native effect-recovery fence SHALL remain authoritative before starting a fresh model loop.

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
- **AND** only the active attempt can commit dispatch context, an availability record, or a successful turn

#### Scenario: Successful context publication is atomic

- **WHEN** the active attempt commits a successful assistant turn
- **THEN** the assistant message, with its in-Run context items at their step positions, and terminal completion commit atomically
- **AND** a transaction failure publishes none of those updates

#### Scenario: Dispatch context publication is atomic

- **WHEN** the active attempt commits its dispatch transaction before its first model request
- **THEN** the exact attempt-owned turn-attached context text, context-derived chat-state updates, and minimal availability record commit atomically
- **AND** a transaction failure publishes none of those updates and sends no model request

#### Scenario: Settlement keeps the assistant turn's rail items

- **WHEN** the active attempt settles its Run as completed, failed, cancelled, expired, or with an unknown outcome
- **THEN** the assistant message, with its in-Run context items at their step positions, and the terminal outcome commit atomically
- **AND** settlement writes no told state or availability record

### Requirement: Final assistant-message projection preserves replay order

The final assistant message written for a run SHALL be an ordered projection of the same reasoning, text, tool activity, and in-Run context items represented by the durable run-event log. It SHALL not regroup all reasoning before tools or all text after tools. A partial message persisted after a model error SHALL retain the same ordering rule for every part observed before failure.

#### Scenario: Completed run projects event order into message parts

- **WHEN** a completed run emits reasoning, text, tool activity, reasoning, and text in that order
- **THEN** its assistant message stores parts in that same order

#### Scenario: Failed run projects observed part order

- **WHEN** a run emits reasoning and text before a model error
- **THEN** its partial assistant message retains the observed reasoning-before-text order

#### Scenario: A failed run projects its in-Run context items

- **WHEN** a run records a `context.item` event after a tool result and then fails
- **THEN** its partial assistant message stores that context part directly after that tool part
- **AND** later replay supplies it at that position

#### Scenario: An expired stuck Run keeps its in-Run context items

- **WHEN** the admission path expires a stuck Run whose event log holds a `context.item` event after a tool result
- **THEN** the assistant message it writes stores that context part directly after that tool part
- **AND** the next turn replays it like a failed Run's item

The prospective cutover boundary in `context-injection` SHALL govern these publication rules; existing conversation state SHALL not be retrospectively filtered or rebuilt.

Operational and UI replay SHALL retain a failed attempt's observed part order, and that persisted record SHALL become model history. A failed, cancelled, expired, or superseded attempt keeps the partial assistant turn the user saw, entering later model context, model-facing recall, and compaction like any other committed turn. The rail context such an attempt dispatched stays in history with that turn under `context-injection`, and the projection keeps the `context.item` events of exactly the attempts whose model output it projects, under the rule `context-injection` states, which drops a later attempt's item only when every file it names is already named by an earlier projected item. Every settlement that writes the assistant message, including completion, failure, cancellation, `outcome_unknown`, in-process or dead-letter expiry, and the admission path's expiry of a stuck Run, SHALL use this same projection, so its in-Run context items persist. `context.item` events are projection input only and are not forwarded to stream subscribers. Within a successful attempt, an individually failed tool call remains a normal paired observation.

A Run's first model request MAY be preceded by a compaction checkpoint that publishes before that request. The checkpoint row and the re-baked epoch state it names SHALL commit in one transaction before the model request, and SHALL be retained when that attempt later fails, cancelled, or expires: a checkpoint describes committed history only, so it is correct regardless of the attempt's outcome. A checkpoint row is committed history, not attempt-owned staged rail context, and SHALL NOT be withheld or retracted on the attempt's outcome. A later attempt of the same Run SHALL reuse the published checkpoint rather than pay a second summary call.

#### Scenario: Failed attempt output stays visible and is model history

- **WHEN** an attempt streams reasoning, text, or tool results and then fails
- **THEN** operational/UI replay retains the observed order
- **AND** that partial output remains part of the record and enters later model context, recall, and compaction like any other committed turn, together with the rail items it dispatched

#### Scenario: A checkpoint published before a failed attempt survives it

- **WHEN** an attempt publishes a compaction checkpoint and its re-baked epoch state before its first model request and that request then fails
- **THEN** the checkpoint row and the epoch state it names remain committed
- **AND** the Run's next attempt replays the same checkpoint instead of summarizing the same prefix again

#### Scenario: Fresh retry succeeds after an earlier failure

- **WHEN** attempt B succeeds after attempt A failed
- **THEN** the committed assistant turn derives only from B, while B reuses the turn-attached items and availability record that A's dispatch transaction committed, if A dispatched
- **AND** A's events cannot be merged into B's assistant projection, so A's in-Run context items are absent from it
