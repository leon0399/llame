## ADDED Requirements

### Requirement: A Run that waits for a quota reset holds no worker

`awaiting_quota` MUST be a non-terminal Run status. A Run MUST enter it when a request to its own
model fails with a reset time more than 60 seconds away. The failure class of that request MUST be
`quota_exhausted` or `rate_limited`. The
queue job of the Run MUST then end, and no worker MUST execute the Run while it waits. The Run MUST
stay the in-flight Run of its Chat.

#### Scenario: A weekly limit frees the worker

- **WHEN** a Codex step request fails with `usage_limit_reached` and a reset in two days, and the worker concurrency is 1
- **THEN** the Run is in `awaiting_quota`, and the worker executes a Run of another Chat

#### Scenario: A short reset does not park the Run

- **WHEN** a step request fails with a reset time 45 seconds away
- **THEN** the Run stays `running_model` and sends the request again after the wait

### Requirement: The quota wait covers every request of a Run to its model

A step request, the summary request of an in-Run compaction, and the summary request of a
compaction Run MUST each enter the quota wait. A side call, such as title generation or hosted web
search, MUST NOT make a Run wait.

#### Scenario: A compaction Run waits

- **WHEN** the owner sends `/compact`, and its summary request fails with a Codex usage limit and a reset in three hours
- **THEN** the compaction Run is in `awaiting_quota`, and the Chat has no new checkpoint yet

### Requirement: The entry to a quota wait is one fenced transaction

The move to `awaiting_quota` MUST be one attempt-fenced transaction. It MUST store the completed
steps and parts of the attempt, the failure class, the reset time, and the wake time. It MUST record
the deadline job as the next queue job of the Run, with a new wake generation.

#### Scenario: A worker crash after the entry

- **WHEN** a Run enters `awaiting_quota`, and its worker stops before the queue job ends
- **THEN** the deadline job is queued, and it resumes the Run at the wake time

### Requirement: The wake time follows the reset time

The wake time MUST be the reset time plus 60 seconds plus a random part from 0 to 18 seconds. The
deadline job MUST start at the wake time. A restart of a worker or a process MUST NOT change the
wake time.

#### Scenario: A wake after a restart

- **WHEN** a Run waits for a reset at 10:00:00, and every worker restarts at 09:00
- **THEN** a worker claims the Run between 10:01:00 and 10:01:18

### Requirement: A reset beyond the cap fails the Run

A reset time more than `runs.quotaWaitMaxSeconds` after receipt MUST NOT start a quota wait. The Run
MUST fail with the failure class `quota_exhausted` and its `resetsAt`.

#### Scenario: A monthly budget beyond the default cap

- **WHEN** an OpenRouter budget block states a reset 20 days away, and the cap is the default 691,200 seconds
- **THEN** the Run fails with `error.code` `quota_exhausted` and `error.resetsAt` 20 days away

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

### Requirement: A woken Run sends the same request again

When the deadline job wakes the Run, the next claim MUST rebuild the stored steps. It MUST then send
the request that failed again, on the same model and effort. It MUST NOT send a part of the failed request.
Pending steers and interrupts MUST then reach the Run at its first step boundary.

#### Scenario: A steer after the reset

- **WHEN** the owner sent a steer during a quota wait, and the deadline job wakes the Run
- **THEN** the Run sends the failed request again, and the steer is delivered at the next step boundary

### Requirement: A Run waits at most three more times

A woken Run whose request again fails with a reset time more than 60 seconds away MUST wait again.
It MUST wait at most 3 times after the first wait. After the third one, such a failure MUST fail the
Run with the failure class of that request.

#### Scenario: A reset that does not clear

- **WHEN** a Run wakes after its third re-wait, and its request again fails with `quota_exhausted` and a reset time
- **THEN** the Run fails with `error.code` `quota_exhausted`

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

The Run MUST append one `run.suspended` event when it enters `awaiting_quota`. That event MUST name
the failure class, the reset time, and the wake time. The Run MUST append one `run.resumed` event
when it wakes, with the cause `timeout` or `cancelled`. The event stream MUST stay open between
them.

#### Scenario: A reload during a quota wait

- **WHEN** the owner reloads the Chat while its Run is in `awaiting_quota`
- **THEN** the event stream replays the `run.suspended` event with the reset time and the wake time

### Requirement: The Run response shows the quota wait

A Run read, the latest Run of a Chat, and the active Runs MUST carry `quotaWait` while the Run is in
`awaiting_quota`. It MUST hold the failure class, `resetsAt`, and `wakeAt`. It MUST be `null` for
every other status. It MUST NOT name a provider entry or a base URL.

#### Scenario: Another owner cannot read the wait

- **WHEN** a second owner requests the Run of the first owner that is in `awaiting_quota`
- **THEN** the API answers 404, and no `quotaWait` is returned

### Requirement: The web shows a quota wait above the composer

While the latest Run of a Chat is in `awaiting_quota`, the web MUST show a box above the prompt
composer, over the transcript. It MUST show the model name, the local reset time, a live countdown to the wake
time, and a Stop control. After the wake time, it MUST show that the Run resumes.

#### Scenario: A Codex weekly limit

- **WHEN** the Run of a Chat waits for a reset in 2 days and 3 hours
- **THEN** the box names the model, shows the local reset time, and counts down from about 2 days and 3 hours

### Requirement: The web shows the reset time of a failed quota Run

A Run can fail with `quota_exhausted` and a `resetsAt`. When it is the latest Run of its Chat, the
failed turn MUST show the local reset time with the failure message. The latest Run of a Chat MUST carry
`errorCode` and `errorResetsAt` for this.

#### Scenario: A reset beyond the cap

- **WHEN** a Run failed because its reset is 20 days away
- **THEN** the failed turn shows the failure message and the local reset time
