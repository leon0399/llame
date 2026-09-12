## MODIFIED Requirements

### Requirement: Run claiming and completion are crash-safe

A worker SHALL claim a run only if it is non-terminal; a run already marked running SHALL be re-executed only after the queue substrate has determined its prior holder is no longer alive (redelivering the job per the native worker-liveness path), so two live workers racing the same run cannot both execute it. Completion SHALL be first-writer-wins: once a run is terminal, no later writer may change its outcome — this is the safety net that keeps even a transient two-worker overlap (a paused-but-not-dead worker) to a single terminal result.

#### Scenario: Two workers race one run

- **WHEN** two workers attempt to claim/execute the same run
- **THEN** exactly one executes it; the other's claim is refused (not stale) and it does not double-run

#### Scenario: Terminal run is immutable

- **WHEN** a late writer (a lagging worker, a deadman check) tries to mutate a run that has already reached a terminal state
- **THEN** the write is rejected and the recorded terminal outcome stands

Every queue-authorized claim or reclaim SHALL atomically assign a fresh trusted `activeAttemptId` persisted on the Run. Successful completion SHALL record `completedAttemptId`. These identifiers SHALL not reuse or overwrite `workerId`, which remains native executor authority. Attempt-owned events SHALL carry their attempt id so projections can select the winner; Run-level queue/cancellation events need no fabricated attempt. Context preparation, receipt publication, new invocation admission, and successful finalization SHALL verify their expected attempt id against the Run's current attempt. A superseded worker SHALL not start new admitted effects or publish an answer, attempt context, or availability baseline. Already dispatched operations retain their existing settlement/unknown-outcome rules. The native executor identity and durable native effect-recovery fence SHALL remain authoritative before starting a fresh model loop.

#### Scenario: Superseded worker attempts late publication

- **WHEN** queue recovery starts attempt B and attempt A later tries to publish context or complete the Run
- **THEN** A's stale write is refused even if the Run is still non-terminal
- **AND** only the active attempt can publish a successful turn and availability record

#### Scenario: Successful context publication is atomic

- **WHEN** the active attempt commits a successful assistant turn
- **THEN** the assistant message, exact attempt-owned context text, context-derived chat-state updates, minimal availability record, and terminal completion commit atomically
- **AND** a transaction failure publishes none of those updates

### Requirement: Final assistant-message projection preserves replay order

The final assistant message written for a run SHALL be an ordered projection of the same reasoning, text, and tool activity represented by the durable run-event log. It SHALL not regroup all reasoning before tools or all text after tools. A partial message persisted after a model error SHALL retain the same ordering rule for every part observed before failure.

#### Scenario: Completed run projects event order into message parts

- **WHEN** a completed run emits reasoning, text, tool activity, reasoning, and text in that order
- **THEN** its assistant message stores parts in that same order

#### Scenario: Failed run projects observed part order

- **WHEN** a run emits reasoning and text before a model error
- **THEN** its partial assistant message retains the observed reasoning-before-text order

Operational and UI replay SHALL remain distinct from model-context publication. Only the successfully committed attempt's assistant output and context SHALL become model history. Failed/cancelled/expired or superseded attempt projections may remain displayable in their original part order but SHALL be excluded from retry input, later model history, model-facing recall, and compaction. Within a successful attempt, an individually failed tool call remains a normal paired observation.

#### Scenario: Failed attempt output is visible but not model history

- **WHEN** an attempt streams reasoning, text, or tool results and then fails
- **THEN** operational/UI replay retains the observed order
- **AND** a retry and subsequent model-context consumers exclude that attempt's output and context

#### Scenario: Fresh retry succeeds after an earlier failure

- **WHEN** attempt B succeeds after attempt A failed
- **THEN** the committed assistant turn and availability baseline derive only from B
- **AND** A's events cannot be merged into B's assistant projection
