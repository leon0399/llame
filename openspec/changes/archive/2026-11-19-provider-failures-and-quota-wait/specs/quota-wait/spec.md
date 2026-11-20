## ADDED Requirements

### Requirement: A Run that waits for a quota reset holds no worker

`awaiting_quota` MUST be a non-terminal Run status. A Run MUST enter it when a request to its own
model fails with a reset time more than 60 seconds away. That reset time MUST also be at most
`runs.quotaWaitMaxSeconds` away. The failure class MUST be `quota_exhausted` or `rate_limited`. No tool call of the failed send MUST
have started, as `provider-failures` defines. The queue job MUST then end,
and no worker MUST execute the Run while it waits. The Run MUST stay the in-flight Run of its Chat.

#### Scenario: A weekly limit frees the worker

- **WHEN** a Codex step request fails with `usage_limit_reached` and a reset in two days, and the worker concurrency is 1
- **THEN** the Run is in `awaiting_quota`, and the worker executes a Run of another Chat

#### Scenario: A short reset does not park the Run

- **WHEN** a step request fails with a reset time 45 seconds away
- **THEN** the Run stays `running_model` and sends the request again after the wait

### Requirement: The quota wait covers every request of a Run to its model

The quota wait MUST apply to a step request. A summary request of a compaction on the model of the Run
MUST also enter it. This applies before dispatch, at a step boundary, and in a compaction Run. A summary on another
model, such as a model-switch compaction, is a side call. A side call MUST NOT make a Run wait.

#### Scenario: A compaction Run waits

- **WHEN** the owner sends `/compact`, and its summary request fails with a Codex usage limit and a reset in three hours
- **THEN** the compaction Run is in `awaiting_quota`, and the Chat has no new checkpoint yet

### Requirement: The entry to a quota wait is one fenced transaction

The move to `awaiting_quota` MUST be one attempt-fenced transaction. It MUST store the completed
steps and parts of the attempt, the failure class, the reset time, and the wake time. It MUST record
the deadline job as the next queue job of the Run, with a new wake generation.
Before this move, a `model.superseded` event MUST name each stored output part of the failed send.

#### Scenario: A worker crash after the entry

- **WHEN** a Run enters `awaiting_quota`, and its worker stops before the queue job ends
- **THEN** the deadline job is queued, and it resumes the Run at the wake time

### Requirement: The wake time follows the reset time

The wake time MUST be the reset time plus 60 seconds plus a random part from 0 to 18 seconds. The
deadline job MUST start at the wake time, not before it. A restart of a worker or a process MUST NOT
change the wake time.

#### Scenario: A wake after a restart

- **WHEN** a Run waits for a reset at 10:00:00, and every worker restarts at 09:00
- **THEN** the deadline job has a start time from 10:01:00 to 10:01:18, and no worker claims the Run before 10:01:00

### Requirement: A reset beyond the cap ends the request

A reset time more than `runs.quotaWaitMaxSeconds` after receipt MUST NOT start a quota wait. The
request MUST then fail with its failure class and its `resetsAt`. The failure rule of its caller
then applies.

#### Scenario: A monthly budget beyond the default cap

- **WHEN** an OpenRouter budget block states a reset 20 days away, and the cap is the default 691,200 seconds
- **THEN** the Run fails with `error.code` `quota_exhausted` and `error.resetsAt` 20 days away

#### Scenario: A step-boundary summary beyond the cap

- **WHEN** the summary request of a step-boundary compaction gets a reset 20 days away
- **THEN** the Run records a compaction failure and continues, as `model-system-prompts` defines

### Requirement: Only the deadline job and a cancellation wake a quota wait

The deadline job and a cancellation MUST be the only wakers of a Run in `awaiting_quota`. A `steer`,
an `interrupt`, a `queue` item, and a job notice MUST stay pending and MUST NOT wake it. A send
without a delivery mode MUST get 409, as for any live Run.

#### Scenario: A steer during a quota wait

- **WHEN** the owner sends a steer to a Chat whose Run is in `awaiting_quota`
- **THEN** the steer is a pending item, and the Run stays in `awaiting_quota`

#### Scenario: A job settles during a quota wait

- **WHEN** a background job of the Chat settles while its Run is in `awaiting_quota`
- **THEN** the job notice is pending, and the Run stays in `awaiting_quota`

### Requirement: One waker resumes a quota wait

One conditional update of the wake generation MUST move the Run from `awaiting_quota` to `queued`.
Only its winner MUST insert and record the next queue job in that transaction, unless the winner is
the deadline job. When that insert fails, the transaction MUST roll back, and the Run MUST stay in
`awaiting_quota`.

#### Scenario: A cancellation and the deadline job arrive together

- **WHEN** the owner cancels a Run at the same moment as its deadline job starts
- **THEN** one queue job resumes the Run, and the Run settles `cancelled` without a model request

### Requirement: A woken Run sends the same request again

When the deadline job wakes the Run, the next claim MUST rebuild the stored steps. It MUST then send
the request that failed again, on the same model and effort. It MUST NOT send a part that the failed
send streamed. Pending steers and interrupts MUST then reach the Run at its first step boundary.

#### Scenario: A steer after the reset

- **WHEN** the owner sent a steer during a quota wait, and the deadline job wakes the Run
- **THEN** the Run sends the failed request again, and the steer is delivered at the next step boundary

### Requirement: One request waits at most four times

A woken request that again fails with a reset time in the range of the first requirement MUST wait
again. One
request MUST wait at most 3 times after its first wait. A fourth such failure MUST end the request
with its failure class. A successful request MUST reset the count, also when it emits no Run part event.

The wait count MUST remain bound to that request across a worker redelivery after a wake and
across compaction replanning. Clearing `awaiting` MUST NOT clear the count. A quota suspension
that is not followed by its matching `run.quota_recovered` event MUST remain the durable source
of that request's count. A successful request MUST append that marker before another request starts.

#### Scenario: A reset that does not clear

- **WHEN** a request wakes after its third re-wait, and it again fails with `quota_exhausted` and a reset time
- **THEN** the Run fails with `error.code` `quota_exhausted`

#### Scenario: Two limits in one long Run

- **WHEN** a Run waits for one reset, continues for ten steps, and later hits a second usage limit
- **THEN** the second limit starts a new first wait, and the count of the first does not apply

#### Scenario: A successful summary starts a new allowance for the next request

- **WHEN** a summary succeeds after four quota waits, and the next step request reaches a quota reset before content
- **THEN** the step request starts its own first wait

#### Scenario: A quota wake claim dies before its request succeeds

- **WHEN** a worker claims a request after its fourth quota wait, clears `awaiting`, and dies before the request succeeds
- **THEN** redelivery restores the count of four, and another quota failure ends the Run without another wait

#### Scenario: A compaction wait count survives replanning

- **WHEN** a compaction Run wakes after its fourth quota wait and replans its summary
- **THEN** that summary keeps the count of four, and another quota failure ends the Run without another wait

### Requirement: A cancellation ends a quota wait

A cancellation of a Run in `awaiting_quota` MUST wake the Run at once. The next claim MUST settle the
Run `cancelled` without a model request. The deadline job MUST then do nothing when it starts.

#### Scenario: The owner stops a quota wait

- **WHEN** the owner presses Stop on a Chat whose Run waits for a reset in two days
- **THEN** the Run becomes `cancelled` in seconds, and its pending steers move to the paused queue

### Requirement: The time in a quota wait does not count toward the budget

The time of a Run in `awaiting_quota` MUST NOT count toward `runs.timeoutSeconds`. The budget
deadline MUST be the first claim plus the budget plus the total time in quota waits. The execution
ceiling MUST count from each claim.

#### Scenario: A long wait under a budget

- **WHEN** `runs.timeoutSeconds` is 1,800, and a Run executes for 600 seconds, waits 2 days, and wakes
- **THEN** the claim does not expire the Run, and 1,200 seconds of budget remain

### Requirement: A quota wait and its wake are Run events

The Run MUST append one `run.suspended` event when it enters `awaiting_quota`. It MUST carry
`kind: 'quota'`, `attemptId`, `generation`, `failureClass`, `resetsAt`, `wakeAt`, `resumeAt`,
`waitCount`, `parts`, and `steps`. Its checkpoint parts and steps MUST exclude the failed send.
The Run MUST append one `run.resumed` event when it wakes, with `kind: 'quota'`, the waking
`attemptId`, the same `generation`, and the cause `timeout` or `cancelled`. A `run.suspended` or
`run.resumed` payload without `kind` MUST mean a job suspension or wake. The event stream MUST stay open between suspension and wake.

On successful recovery of the request, `run.quota_recovered` MUST carry the suspension's
`generation` and `resumeAt`. It MUST end only that request's wait count. A summary MUST write it in
the checkpoint publication transaction; a step MUST write it in ordered successful-step settlement.

#### Scenario: A reload during a quota wait

- **WHEN** the owner reloads the Chat while its Run is in `awaiting_quota`
- **THEN** the event stream replays the `run.suspended` event with the reset time and the wake time

### Requirement: The Run response shows the quota wait

A Run read, the latest Run of a Chat, and the active Runs MUST carry `quotaWait` while the Run is in
`awaiting_quota`. It MUST hold `failureClass`, `resetsAt`, and `wakeAt`. It MUST be `null` for every
other status. It MUST NOT name a provider entry or a base URL.

#### Scenario: Another owner cannot read the wait

- **WHEN** a second owner requests the Run of the first owner that is in `awaiting_quota`
- **THEN** the API answers 404, and no `quotaWait` is returned

### Requirement: The web shows a quota wait above the composer

While the latest Run of a Chat is in `awaiting_quota`, the web MUST show a box above the prompt
composer, over the transcript. The box MUST show the model name, the local reset time, a live
countdown to the wake time, and a Stop control. After the wake time, the box MUST show that the Run
sends its request again.

#### Scenario: A Codex weekly limit

- **WHEN** the Run of a Chat waits for a reset in 2 days and 3 hours
- **THEN** the box names the model, shows the local reset time, and counts down from about 2 days and 3 hours

### Requirement: The web shows the reset time of a failed Run

The latest Run of a Chat MUST carry `errorCode`, equal to `error.code`, and `errorResetsAt`, equal
to `error.resetsAt`. For a failed Run with an `errorResetsAt`, the web MUST show the local reset
time with the failure message. The web MUST show them on the failed turn, or on the error
row of a compaction Run.

#### Scenario: A reset beyond the cap

- **WHEN** a Run failed because its reset is 20 days away
- **THEN** the failed turn shows the failure message and the local reset time
