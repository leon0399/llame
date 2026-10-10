## MODIFIED Requirements

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

### Requirement: Final assistant-message projection preserves replay order

The final assistant message written for a run SHALL be an ordered projection of the same reasoning, text, and tool activity represented by the durable run-event log. It SHALL not regroup all reasoning before tools or all text after tools. A partial message persisted after a model error SHALL retain the same ordering rule for every part observed before failure.

The Run's assistant message SHALL exist from the Run's first model request. The transaction that dispatches an attempt's first request SHALL create that message, or reset an earlier attempt's message, with no parts and a non-completed usage `{ status: 'running', complete: false, runId, attemptId, modelId, effort }` naming that attempt, with effort omitted when the Run has none. Every `model.requested` event SHALL carry the dispatching attempt id. Each in-Run context item SHALL be stored in the fenced transaction that dispatches the request first carrying it, together with the attempt's current part snapshot: its reasoning, text, and tool parts so far followed by the new item.

Every terminal path SHALL finalize the Run's assistant message through one shared finalizer: completion, failure, cancellation, expiry by the worker, retry exhaustion (dead letter), cancellation before start, the native-recovery `outcome_unknown` settlement, pickup failure, the claim-time terminal transitions, expiry by a new message, supersession, and a lost settlement. Finalization SHALL rebuild reasoning, text, and tool parts only from the events of the attempt named in the message's usage, from that attempt's `model.requested` up to the next attempt's `run.started`, whichever attempt or process settles the Run, so a settler that never dispatched finalizes the message of the attempt that did. It SHALL keep each stored item immediately after the tool part whose toolCallId precedes it in the stored snapshot, or first when none does. It SHALL always write a terminal usage carrying status (`completed`, `error`, or `aborted`), `complete`, Run id, attempt id, model id, and effort, even with no parts; a finalizer outside an executing attempt (dead-letter expiry, native-recovery settlement, cancellation before start, expiry by a new message, supersession, pickup failure) writes `complete: false` and no token counts. No assistant message SHALL remain `running` after its Run is terminal.

Owner-facing reads (chat history, public share, shared-chat and owner fork sources, and the chat-list preview) SHALL omit an assistant message whose usage status is `running`; the live stream renders it, and it becomes visible once finalized.

#### Scenario: Completed run projects event order into message parts

- **WHEN** a completed run emits reasoning, text, tool activity, reasoning, and text in that order
- **THEN** its assistant message stores parts in that same order

#### Scenario: Failed run projects observed part order

- **WHEN** a run emits reasoning and text before a model error
- **THEN** its partial assistant message retains the observed reasoning-before-text order

The prospective cutover boundary in `context-injection` SHALL govern these publication rules; existing conversation state SHALL not be retrospectively filtered or rebuilt.

Operational and UI replay SHALL retain a failed attempt's observed part order, and that persisted record SHALL become model history. A failed, cancelled, expired, or superseded attempt keeps the partial assistant turn the user saw, together with the rail context items its dispatched requests carried, entering later model context, model-facing recall, and compaction like any other committed turn. A later attempt of the same Run SHALL instead reset that assistant message to `running` for itself in the transaction that dispatches its first request, removing the earlier attempt's output and in-Run items together; its preparation SHALL read history only through the triggering user message, so its own assistant message never enters its request. A later attempt that fails, is cancelled, or is settled before its own dispatch SHALL leave the earlier attempt's message, output, and items untouched, to be finalized from the attempt named in its usage. Within a successful attempt, an individually failed tool call remains a normal paired observation.

A Run's first model request MAY be preceded by a compaction checkpoint that publishes before that request. The checkpoint row and the re-baked epoch state it names SHALL commit in one transaction before the model request, and SHALL be retained when that attempt later fails, cancelled, or expires: a checkpoint describes committed history only, so it is correct regardless of the attempt's outcome. A checkpoint row is committed history and SHALL NOT be withheld or retracted on the attempt's outcome. A later attempt of the same Run SHALL reuse the published checkpoint rather than pay a second summary call.

#### Scenario: Failed attempt output stays visible and is model history

- **WHEN** an attempt streams reasoning, text, or tool results and then fails
- **THEN** operational/UI replay retains the observed order
- **AND** that partial output remains part of the record and enters later model context, recall, and compaction like any other committed turn, together with the rail context items its dispatched requests carried

#### Scenario: A checkpoint published before a failed attempt survives it

- **WHEN** an attempt publishes a compaction checkpoint and its re-baked epoch state before its first model request and that request then fails
- **THEN** the checkpoint row and the epoch state it names remain committed
- **AND** the Run's next attempt replays the same checkpoint instead of summarizing the same prefix again

#### Scenario: Fresh retry succeeds after an earlier failure

- **WHEN** attempt B succeeds after attempt A failed
- **THEN** the committed assistant turn derives only from B's events
- **AND** A's events cannot be merged into B's assistant projection
- **AND** the availability record and reminders are those stored by the Run's dispatched attempts: A's, plus any B appended after them

#### Scenario: A Run expired by a new message leaves no running reply

- **WHEN** a Run has dispatched a model request and a different message expires it through single-flight admission
- **THEN** that Run's assistant message is finalized with a terminal status, its parts rebuilt from the events of the attempt named in its usage around its stored in-Run items
- **AND** no assistant message of that Run remains `running`

#### Scenario: A retry drops the dead attempt's output and in-Run items

- **WHEN** attempt A streamed output and stored an in-Run item on the Run's assistant message before its worker died, and attempt B of the same Run dispatches its first request
- **THEN** B's dispatch transaction resets that assistant message to `running` for B, removing A's output and in-Run item together
- **AND** B's request carries neither A's output nor A's in-Run item, while the accepted-turn items stored on the triggering user message stay unchanged and B stores only the items its comparison newly yields after them

#### Scenario: A settler that never dispatched finalizes the dispatched attempt's reply

- **WHEN** attempt A dispatches, streams output, admits a native mutation, and stores an in-Run item before its worker dies, and redelivered attempt B finds the admitted effect without a recorded result and settles the Run `outcome_unknown` without dispatching
- **THEN** the Run's assistant message keeps A's output and in-Run item, its parts rebuilt from A's events, and is finalized with status `error`
- **AND** its usage names A's attempt with `complete: false` and no token counts, and no assistant message of that Run remains `running`

#### Scenario: A retry that fails before dispatch leaves the earlier reply

- **WHEN** attempt A dispatched, streamed output, and stored an in-Run item, and attempt B of the same Run fails during preparation before its first request
- **THEN** B does not reset the Run's assistant message, which keeps A's output and in-Run item
- **AND** the Run's terminal settlement finalizes that message from A's events, its usage naming A's attempt

#### Scenario: An in-Run item keeps its step position

- **WHEN** an attempt's tool call `t1` completes, the next request first carries an in-Run item, and the attempt later completes
- **THEN** the item's dispatch transaction stores a part snapshot placing the item after `t1`'s tool part
- **AND** the finalized message keeps the item immediately after `t1`'s rebuilt tool part

#### Scenario: A running reply stays out of owner-facing reads

- **WHEN** a Run has dispatched and its assistant message is still `running`
- **THEN** chat history, public share, fork sources, and the chat-list preview omit that message while the live stream renders it
- **AND** the message appears in those reads once a terminal path finalizes it
