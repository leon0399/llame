# background-jobs Specification

## Purpose

A background job is work that continues after the tool call that started it returns. This
capability defines the job record, the `job://` locator, the `wait` and `stop` tools, and the
job lifetime. It also defines the notice that tells the assistant about a settlement, and the
controls of the owner.

## Requirements

### Requirement: A job belongs to its Chat and its owner

A job MUST record its Chat, its owner, its executor, and the Run and tool call that started it.
A job MUST continue after that Run ends, with any terminal status. A job MUST NOT continue after
its Chat is deleted. The executor name tells which kind of work the job does. `bash` is the only
executor that this capability defines.

#### Scenario: A job continues after its Run completes

- **WHEN** a Run starts a job and then completes with a final answer
- **THEN** the job stays `running`, and the Run is `completed`

#### Scenario: A job continues after its Run fails

- **WHEN** a Run starts a job and then fails on a provider error
- **THEN** the job stays `running`

### Requirement: A job has one state and settles once

A job MUST be `running`, `succeeded`, `failed`, `cancelled`, `timed_out`, or `lost`. Each state
other than `running` is a settled state. A settled job MUST NOT change its state or its result.
A `cancelled` job MUST record who stopped it: `owner`, `assistant`, or `worker`. A `lost` job
MUST state that its outcome is unknown.

#### Scenario: A late stop does not change a settled job

- **WHEN** a job is `succeeded` and the owner then requests a stop
- **THEN** the job stays `succeeded` with its recorded result

#### Scenario: A stopped job names its stopper

- **WHEN** the owner stops a job in state `running`
- **THEN** the job is `cancelled`, and its record names `owner`

### Requirement: A job has a locator scoped to its Chat

A job locator MUST have the form `job://<executor>-<n>` or `job://<executor>-<n>/<output>`. The
scheme MUST match without case. The number MUST be an artifact number of the Chat, reserved when
the job starts. The artifact of the job MUST use the same number. A locator MUST resolve only in
the Chat of the job. A job locator MUST route before local path resolution, and it needs no
executor.

#### Scenario: The job and its artifact share a number

- **WHEN** `job://bash-7` settles and its output is stored
- **THEN** the artifact locator is `artifact://bash-7`

#### Scenario: A locator of another Chat does not resolve

- **WHEN** a Run in Chat B reads `job://bash-7` and that job belongs to Chat A of the same owner
- **THEN** the result is `not_found`

### Requirement: The read tool returns a job record

A `read` of a job locator with no output name MUST return the record of the job. The record MUST
hold the locator, the executor, the state, the start time, and the elapsed time. It MUST name
each output of the job. A settled record MUST also hold the exit detail and the artifact locator
when an artifact exists. The record MUST NOT hold the content of an output.

#### Scenario: A record of a live job

- **WHEN** the model reads `job://bash-4` while the command runs
- **THEN** the result holds the state `running`, the elapsed time, and the output names `stdout` and `stderr`

#### Scenario: A record of a failed job

- **WHEN** the model reads `job://bash-4` after the command printed 50,000 characters and exited with code 2
- **THEN** the result holds the state `failed`, the exit code 2, and `artifact://bash-4`

### Requirement: The read tool returns one output of a job

A `read` of `job://<executor>-<n>/<output>` MUST return the stored text of that output. It MUST
accept the line selectors that an artifact read accepts. For a job in state `running`, it MUST
return the output that the worker stored up to that moment. An unknown output name MUST get
`not_found`.

#### Scenario: The tail of a live output

- **WHEN** the model reads `job://bash-4/stdout:-50` two minutes into a build
- **THEN** the result holds the last 50 stored lines of `stdout`

#### Scenario: An unknown output

- **WHEN** the model reads `job://bash-4/log`
- **THEN** the result is `not_found`

### Requirement: A bare job locator lists the jobs of the Chat

A `read` of `job://` MUST list the jobs of the Chat, with the oldest job first. Each line MUST
hold the locator, the state, and the start time. The list MUST accept one line range. An `edit`
or a `write` of a job locator MUST get `invalid_path`.

#### Scenario: A list of two jobs

- **WHEN** the Chat has `job://bash-4` in state `running` and `job://bash-2` in state `succeeded`
- **THEN** a `read` of `job://` returns two lines, with `job://bash-2` first

#### Scenario: A write is refused

- **WHEN** the model calls `write` with the path `job://bash-4/stdout`
- **THEN** the result is `invalid_path`, and the job does not change

### Requirement: Jobs are isolated by owner

Each job, each stored output, and each job notice MUST be readable only by the owner of the
Chat. The datastore MUST enforce this with row-level security, and it MUST fail closed without
an identity. A request that names a job of another owner MUST get the answer for a job that
does not exist. This applies to `read`, `wait`, `stop`, and the API.

#### Scenario: Another owner reads a job

- **WHEN** user B calls `GET /api/v1/chats/:chatId/jobs` for a Chat of user A
- **THEN** the API answers 404

#### Scenario: A query without an identity finds no job

- **WHEN** a query reads the job table with no owner identity in its transaction
- **THEN** it returns no row

#### Scenario: A query without an identity finds no stored output

- **WHEN** a query reads the table of output increments with no owner identity in its transaction
- **THEN** it returns no row

#### Scenario: Another owner cannot stop a job

- **WHEN** user B sends the `PATCH` that stops a job in a Chat of user A
- **THEN** the API answers 404, and the job stays `running`

#### Scenario: A tool call cannot name a job of another owner

- **WHEN** a Run of user B calls `wait` or `stop` with a locator that only resolves in a Chat of user A
- **THEN** the result is `not_found`, and no job of user A changes

### Requirement: The worker stores the output of a live job in increments

The worker MUST store new output of a job in state `running` as appended increments. It MUST
store an increment when 16 KiB of new output exist, or 1 second after the first unstored byte.
It MUST NOT write while the job gives no output. Each output MUST be bounded by
`tools.artifacts.maxBytes`. Output past that bound MUST be dropped, and the record MUST mark the
output as truncated.

#### Scenario: A quiet job writes nothing

- **WHEN** a job runs `sleep 600`
- **THEN** the worker stores no output increment in those 10 minutes

#### Scenario: A stored line is readable two seconds later

- **WHEN** a job prints one line and then stays quiet
- **THEN** a `read` of that output 2 seconds later returns the line

### Requirement: Stored job output holds no configured credential

The worker MUST replace each member of the configured credential set with `[REDACTED]` before
it stores an increment. A member that crosses the boundary between two increments MUST also be
replaced. The rules of `bash-execution` for a member that a bound cuts MUST apply to stored job
output.

#### Scenario: A credential across two increments

- **WHEN** a job prints a provider key, and the 16 KiB boundary falls inside the key
- **THEN** no stored increment holds a part of the key

### Requirement: A job has an operator lifetime

A job MUST end when it has run for `tools.jobs.maxSeconds` from its start. The worker MUST then
stop the job. The job MUST settle as `timed_out` under the proof rule of this capability. The
model MUST NOT be able to set or change this lifetime. A job that starts with `unlimited: true`
has no lifetime. A call with `unlimited: true`
MUST be refused before any work starts when `tools.jobs.allowUnlimited` is `false`.

#### Scenario: A hung build ends at the lifetime

- **WHEN** `tools.jobs.maxSeconds` is 7,200 and a job runs for 7,200 seconds
- **THEN** the worker stops the job, and the job is `timed_out`

#### Scenario: An unlimited job is refused by default

- **WHEN** `tools.jobs.allowUnlimited` is `false` and the model starts a job with `unlimited: true`
- **THEN** the call returns an error that names the setting, and no job starts

### Requirement: A job is bound to the worker that started it

A job MUST run in the worker process that started it. The job record MUST hold the instance
identity of that worker, the process identity of the work, and its start time. The instance
identity MUST be new at each process start. A second worker MUST NOT adopt a job. When the
worker stops, its jobs end.

#### Scenario: A resumed Run on another worker reads a job

- **WHEN** worker A hosts `job://bash-4`, and worker B executes the next segment of the Run
- **THEN** a `read` of `job://bash-4/stdout` on worker B returns the output that worker A stored

### Requirement: A worker that shuts down ends its jobs

A worker that shuts down in an orderly way MUST stop each hosted command that still runs.
It MUST settle that job as `cancelled` with the stopper `worker`, under the proof rule of this
capability. It MUST act in the owner's tenant scope and store the captured output.

#### Scenario: A deploy ends a job

- **WHEN** a worker gets a shutdown signal while the command of `job://bash-4` still runs, and it proves the process group empty
- **THEN** the job is `cancelled`, its record names `worker`, and its captured output is stored

### Requirement: A job on a dead worker settles as lost

Each worker MUST record a heartbeat for its instance at the interval `runs.heartbeatSeconds`. A
worker with no heartbeat for four intervals is dead. A job in state `running` on a dead worker
MUST settle as `lost` at its next touch. A touch is a Run start or a step boundary in its Chat.
The end of a `wait` on it, a `read` of it, and an owner API request are also touches. A process
MUST NOT scan the jobs of more than one owner.

#### Scenario: A crash is found at the next message

- **WHEN** the worker of `job://bash-4` crashes, and the owner sends a message one hour later
- **THEN** the job is `lost` before the first model request of the new Run

#### Scenario: A live Run learns of a crash at its next step

- **WHEN** worker A crashes while it hosts `job://bash-4`, and a Run of that Chat executes on worker B
- **THEN** the job is `lost` at the next step boundary of that Run, and its notice is delivered there

#### Scenario: A lost job keeps its stored output

- **WHEN** a job settles as `lost` after it stored 40 lines of `stdout`
- **THEN** a `read` of that output returns the 40 lines

### Requirement: A settlement that fails to commit is retried

The settlement of a job MUST be one transaction with its notice and any wake. A failed
transaction MUST roll back and leave the job `running`. The worker MUST keep the immutable facts
of the settlement and MUST retry it at each heartbeat until it commits or the worker ends. A
worker that crashes or loses its heartbeat is dead, and the touch rule settles its job as `lost`.
The retry MUST NOT stop a running command.

#### Scenario: A queue insert fails during a settlement

- **WHEN** a job exits, and the transaction of its settlement rolls back because the queue insert of a wake fails
- **THEN** the job stays `running`, and the worker commits the same settlement at a later heartbeat

#### Scenario: The worker ends before the retry commits

- **WHEN** a settlement keeps failing and its worker then crashes or loses its heartbeat
- **THEN** the job settles as `lost` at its next touch

### Requirement: A stopped worker command never overwrites a lost row

A hosted command whose stored row is already settled MUST be stopped at the next heartbeat check
of its worker. The stop MUST NOT change the state or the result of the settled row.

#### Scenario: A worker resumes after its row was settled lost

- **WHEN** a job row is settled `lost` after a heartbeat lapse, and the original worker then resumes and rechecks the job
- **THEN** the worker stops the process group, and the row keeps the state `lost` and its result

### Requirement: An orderly shutdown keeps known settlements

An orderly shutdown MUST keep known natural settlement facts. It MUST await an in-flight pass
or retry a pending pass once before the queue closes. Each pass MUST allow at most five attempts
for deadlock or serialization failure. If it still fails, shutdown MUST leave the row unchanged
and continue closing. It MUST NOT replace these facts with cancellation; later dead-worker touches apply.

#### Scenario: A shutdown with a pending settlement

- **WHEN** a job exited, its settlement failed to commit, and its worker then shuts down in order
- **THEN** the worker retries the same settlement, and it does not replace it with `lost`

#### Scenario: Shutdown cannot commit the known settlement

- **WHEN** a command exited, its settlement remains unavailable, and its worker shuts down in order
- **THEN** shutdown makes one bounded settlement pass, leaves the row `running`, and does not stop the already-ended command
- **AND** a later touch settles the row `lost` after the worker is dead

### Requirement: A deleted Chat ends its jobs

The deletion of a Chat MUST end each job of that Chat in state `running`. The committed absence
of the job record MUST be the stop fact, and the deletion records no request field. A worker MUST
stop a job that it hosts when its record no longer exists, at its next heartbeat at the latest.

#### Scenario: A deleted Chat leaves no process

- **WHEN** the owner deletes a Chat that has a job in state `running`
- **THEN** the worker stops the work of that job within one heartbeat interval

### Requirement: A fork of a Chat has no job

A fork of a Chat MUST NOT copy its jobs or their stored output increments. A copied tool part
or `job` context item that names a job or its artifact stays as text. The fork copies an artifact
only under the rules of `owner-chat-forks`, so such a name can fail to resolve in the fork.

#### Scenario: A fork during a live job

- **WHEN** the owner forks a Chat while `job://bash-4` is `running`
- **THEN** a `read` of `job://` in the fork returns an empty list

### Requirement: The wait tool names its jobs and a timeout

The `wait` tool MUST accept `jobs`, a list of 1 to 16 job locators, and an optional `timeout` in
seconds. The timeout MUST be an integer from 1 to 3,600, and its default is 3,600. A call with
other input MUST be refused as invalid input. A locator that names no job of the Chat MUST make
the call return `not_found`, and the Run MUST NOT wait.

#### Scenario: A timeout above the cap is refused

- **WHEN** the model calls `wait` with `timeout: 7200`
- **THEN** the call is refused as invalid input

#### Scenario: An unknown job ends the call

- **WHEN** the model calls `wait` with `job://bash-99`, and the Chat has no such job
- **THEN** the result is `not_found`

### Requirement: A wait returns at the first settlement

A `wait` MUST return when one of its jobs settles. Its result MUST hold `ended: "settled"` and
one entry for each listed job. Each entry MUST hold the locator and the state. An entry of a
settled job MUST also hold the exit detail, the elapsed time, and the preview of each output that
a notice holds. It MUST hold the artifact locator when an artifact exists. A `wait` on a job that
is already
settled MUST return at once.

#### Scenario: One of three jobs fails

- **WHEN** the model waits on three jobs and the lint job exits with code 1
- **THEN** the result names that job as `failed` and the other two as `running`

#### Scenario: A settled job returns at once

- **WHEN** the model calls `wait` on a job that settled a minute ago
- **THEN** the call returns the settled entry and the Run does not wait

### Requirement: A wait ends early without a settlement

A `wait` MUST end with `ended: "timeout"` when its timeout passes. It MUST end with
`ended: "interrupted"` when a steer, an interrupt, or a notice for a job outside its list
arrives. The result MUST list each job with its state, and the jobs MUST NOT stop. For a job that
is still `running`, it MUST say: "The jobs continue in the background. You get a notice when one
of them settles." It MUST NOT promise a notice for a settled job.

#### Scenario: A steer ends a wait

- **WHEN** the model waits on a build and the owner sends a steer
- **THEN** the `wait` returns `ended: "interrupted"`, the build stays `running`, and the steer is delivered at that boundary

#### Scenario: Another job ends a wait

- **WHEN** the model waits on `job://bash-4`, and `job://bash-5` fails
- **THEN** the `wait` returns `ended: "interrupted"`, and the notice for `job://bash-5` is delivered at that boundary

### Requirement: A wait on a lost job returns the lost entry

A listed job on a dead worker MUST end the `wait` when a touch finds it. The latest such touch
is the deadline of the `wait`. The `wait` MUST then return `ended: "settled"` with the `lost`
entry of that job, and it MUST NOT return `ended: "timeout"`.

#### Scenario: The worker of a waited job crashes

- **WHEN** the model waits on `job://bash-4` with the default timeout, and the worker of that job crashes
- **THEN** the `wait` returns at its deadline at the latest, with `ended: "settled"` and the job as `lost`

### Requirement: A discarded tool result restores consumed notices

A retry can discard a `wait` or `stop` result that reported a settled job. The system MUST
restore exactly the notice ids consumed by that result, recorded as server-only event metadata.
It MUST update existing rows. It MUST NOT restore notices consumed by a kept result or deleted
by the owner. A settlement MUST NOT be lost because a worker stopped.

#### Scenario: A worker stops after a wait returned

- **WHEN** a `wait` reports `job://bash-4` as `failed`, the worker stops, and the retry restarts the segment
- **THEN** the Chat has a pending notice for `job://bash-4`, and the retry delivers it at its first step boundary

#### Scenario: A kept result does not restore its notice

- **WHEN** a kept result consumed a notice, and a later discarded result reports the same job but consumed nothing
- **THEN** the notice stays withdrawn

#### Scenario: A discarded stop result restores its notice

- **WHEN** a recorded `stop` result consumed a notice and a retry discards that result
- **THEN** the existing notice becomes pending again

### Requirement: A wait takes the place of the notice

A settlement MUST retain its notice until the transaction that records the settled `wait`
result withdraws it. A `wait` that returns a settled job MUST withdraw its pending notice in
that transaction and record the consuming Run. A `read` MUST NOT withdraw a notice.

#### Scenario: A waited job gives no notice

- **WHEN** the model waits on `job://bash-4` and the job succeeds
- **THEN** the `wait` result holds the settlement, and the Chat has no pending notice for that job

#### Scenario: A read keeps the notice

- **WHEN** a job settles, and the model reads its record before the next step boundary
- **THEN** the notice is still delivered at that boundary

#### Scenario: A cancellation after a waited job settled keeps the notice

- **WHEN** a listed job settles while its Run waits, and the owner cancels the Run before pickup
- **THEN** the Run is cancelled, and the Chat has a pending notice for that job

### Requirement: The stop tool ends listed jobs

`stop` MUST accept 1 to 16 job locators, stop each running job, and return each state. Settled
jobs MUST keep their states. A stopped job MUST name the stopper `assistant`. A settled state
reported by `stop` MUST consume its notice in the transaction that records the result. After
5 seconds without settlement, `stop` MUST report `running` and consume no notice.

#### Scenario: The model stops a monitor

- **WHEN** the model calls `stop` with `job://bash-4`, and that job is `running`
- **THEN** the result names the job as `cancelled`, and its recording transaction withdraws the notice

#### Scenario: A settled job keeps its state

- **WHEN** the model calls `stop` with a job in state `succeeded`
- **THEN** the result names the job as `succeeded`

#### Scenario: A stop that settles late

- **WHEN** the model calls `stop`, and the worker of the job does not settle it within 5 seconds
- **THEN** the result names the job as `running` with a recorded stop request

#### Scenario: A late stop gets a notice

- **WHEN** `stop` reports a job as `running`, and it settles later as `cancelled`
- **THEN** the Chat has one pending notice for that job, naming the stopper `assistant`

#### Scenario: A cancelled stop keeps the notice

- **WHEN** a job settles during `stop`, and the Run is cancelled before its result is recorded
- **THEN** the Chat keeps the pending notice for that job

### Requirement: A stop is known only after proof

A stopped job MUST settle as `cancelled` only when the worker proved that the work stopped. For
`bash`, the proof is the empty process group of `bash-execution`. A stop that the worker cannot
prove MUST settle the job as `lost`. A stop request for a job on a dead worker MUST settle the
job as `lost`.

#### Scenario: A stop that is not proved

- **WHEN** the worker signals the process group of a job, and the group does not end
- **THEN** the job is `lost`, and its record states that the outcome is unknown

### Requirement: A stop request reaches the worker of the job

A stop request of the owner through the API and a stop request of the model MUST be recorded on
the job before it is sent. The deletion of a Chat is the exception that `A deleted Chat ends its
jobs` defines. The request MUST reach the worker
that hosts the job, also in another process. The recorded request MUST stay the source of truth.
When the signal is lost, the worker MUST find the request at its next heartbeat at the latest.

#### Scenario: A stop from the API reaches a dedicated worker

- **WHEN** the API and the worker run in different processes, and the owner stops a job
- **THEN** the worker stops the work without a wait for its heartbeat

### Requirement: A settlement creates one job notice

A settlement MUST create one pending item of `run-steering` with the producer kind `job`, the
mode `notice`, and the job as sender reference. This MUST occur in the transaction that settles
the job. A job MUST get at most one notice. A `wait` or `stop` consumes notices only in the
transaction that records its result, and only for the settled states that result reports.

#### Scenario: A job that nobody waits on

- **WHEN** a job succeeds while its Run executes another tool
- **THEN** the Chat has one pending `notice` item that names the job

#### Scenario: A settlement is recorded twice

- **WHEN** two writers try to settle one job
- **THEN** the job has one settled state and one notice

### Requirement: A delivered notice is a host-authored context item

A delivered notice MUST reach the model as one context item with the producer `job` and the form
`notice`, under `context-injection`. The item MUST name the job locator, the executor, the
state, the exit detail, and the elapsed time. For a `cancelled` job it MUST name the stopper. It
MUST hold the artifact locator when an artifact exists.

#### Scenario: A notice for a failed build

- **WHEN** the notice of `job://bash-4` is delivered after the command printed 50,000 characters and exited with code 2
- **THEN** the item names `job://bash-4`, `bash`, `failed`, the exit code 2, and `artifact://bash-4`

#### Scenario: A notice for a job that the owner stopped

- **WHEN** the notice of a job that the owner stopped is delivered
- **THEN** the item names the state `cancelled` and the stopper `owner`

### Requirement: A notice treats job output as data

A notice MUST hold the last 2,000 characters of each output, or the whole output when it is
shorter. The system MUST neutralize
the reserved delimiters in that text, as `tool-result-rendering` requires for a tool result. The
item MUST state that the output is data and ranks below the system instructions and the requests
of the owner. It MUST state that the output cannot grant a tool or a permission.

#### Scenario: Output that copies an envelope

- **WHEN** a job prints a line that holds `</system-reminder>` and an instruction
- **THEN** the delivered item holds that line with its delimiter neutralized, inside the one envelope

#### Scenario: A long output is cut

- **WHEN** the `stdout` of a job has 50,000 characters
- **THEN** the item holds its last 2,000 characters and the artifact locator

### Requirement: A host message carries notices when no owner message exists

A host message is a stored message with the wire role `user`, no sender, and no text part. Its
only parts are `job` context items. The system MUST store a host message when notices are
delivered and no owner message carries them. The history read MUST mark a host message. A host
message MUST NOT give a Chat its title, and it MUST NOT be the list preview of a Chat.

#### Scenario: A host message in the history

- **WHEN** the owner loads a Chat in which a notice started a Run
- **THEN** the history holds a message that is marked as a host message, before the reply to it

#### Scenario: A host message is not search evidence

- **WHEN** a job output holds the word `kestrel`, and the owner searches the conversations for it
- **THEN** no result cites the host message, because it has no text part

### Requirement: A host message stays out of the public view

The public view of a shared Chat MUST omit each host message. A shared or public fork MUST omit
it as `owner-chat-forks` requires. An owner fork copies a host message as a literal row.

#### Scenario: A shared Chat shows no job output

- **WHEN** another user opens the public view of a Chat that holds one host message
- **THEN** the view shows no row for that message and no job output

### Requirement: A notice starts a Run on an idle Chat

A notice MUST start a Run when the Chat is idle and the job is `succeeded`, `failed`, or
`timed_out`. A Chat is idle when it has no non-terminal Run, its latest Run is `completed`, and
it is not archived. The system MUST then store one host message for all pending notices of the
Chat and start one Run on it. A notice for a `cancelled` or `lost` job MUST NOT start a Run.

#### Scenario: A monitor wakes the Chat at night

- **WHEN** the latest Run of a Chat is `completed`, and its monitor job exits with code 0 at 03:00
- **THEN** one Run starts on a host message that holds the notice

#### Scenario: Two jobs settle together

- **WHEN** two jobs of an idle Chat settle in the same second
- **THEN** one Run starts, and its host message holds both notices

#### Scenario: A lost job starts no Run

- **WHEN** a job of an idle Chat settles as `lost`
- **THEN** no Run starts, and the notice stays pending

### Requirement: A host-started Run is queued atomically

When settlement creates a host Run, it MUST commit the job, host message, Run, delivered-notice
marks, and first queue job in one owner transaction. A failed enqueue MUST roll back all those
writes. A process failure after commit MUST NOT leave a committed host Run without its first job.

#### Scenario: A host enqueue failure rolls back settlement

- **WHEN** a job settles on an idle Chat, and insertion of the host Run's first queue job fails
- **THEN** the job stays `running`, no host message or Run commits, and earlier notices remain pending

#### Scenario: A host worker crashes after commit

- **WHEN** job settlement and a host Run commit, and the hosting process crashes before any later call
- **THEN** the recorded first queue job lets another worker execute the Run without an owner admission

### Requirement: A Run that the host starts uses the settings of its notice

A notice MUST record the model, the effort, and the permission mode of the Run that started its
job. A Run that the host starts MUST use the settings of the first pending notice. The system
MUST validate those settings as `run-steering` validates a queue item. When they are no longer
valid, no Run MUST start, and the notices MUST stay pending.

#### Scenario: The recorded mode is no longer enabled

- **WHEN** a job started under `bypass`, and the operator removed `bypass` before the job settles
- **THEN** no Run starts, and the notice stays pending

### Requirement: A held notice goes with the next Run

A notice MUST stay pending when it starts no Run and no Run is live. A Run can then start from a
chat send, a promoted queue item, or a mode change of a pending item. That Run MUST take all
pending notices of the Chat into its user message. When a follow-up Run of `turn-actions`
starts, the notices MUST be delivered at its
first step boundary.

#### Scenario: A result after a Stop waits for the owner

- **WHEN** the owner cancels a Run, its job succeeds two minutes later, and the owner then sends a message
- **THEN** no Run starts at the settlement, and the first model request of the new Run carries the notice before the owner text

#### Scenario: A result after a failed Run waits for Continue

- **WHEN** a Run fails, its job succeeds, and the owner then starts a Continue
- **THEN** the Continue Run gets the notice at its first step boundary

### Requirement: The owner lists and stops jobs through the API

`GET /api/v1/chats/:chatId/jobs` MUST return the jobs of the Chat with their records, the live
jobs first. `PATCH /api/v1/chats/:chatId/jobs/:jobId` with `state: "cancelled"` MUST request a
stop with the stopper `owner`. A request for a job that the owner already stopped MUST get 200.
A request for a job in another settled state MUST get 409. A Chat or a job of another owner MUST
get 404.

#### Scenario: The owner stops one of two jobs

- **WHEN** a Chat has two jobs in state `running`, and the owner sends the `PATCH` for the first
- **THEN** the first job becomes `cancelled`, and the second stays `running`

#### Scenario: A stop of a settled job

- **WHEN** the owner sends the `PATCH` for a job in state `succeeded`
- **THEN** the API answers 409

#### Scenario: A repeated stop of a stopped job

- **WHEN** the owner sends the `PATCH` again for a job that the owner already stopped
- **THEN** the API answers 200, and the job stays `cancelled`

### Requirement: The chat list reports the live jobs of each Chat

Each item of the chat list MUST hold `runningJobs`. That number counts the jobs of the Chat in
state `running` on a worker that is not dead. The live record of a Chat MUST hold the same
number. A change of that number MUST reach each device of the owner live, including a change that only
the end of a worker lease causes.

#### Scenario: An open socket sees a lease expire

- **WHEN** the owner subscribed before a job started, the worker of the job then loses its lease, and no job row is written
- **THEN** the owner receives `chat.upserted` with the lower `runningJobs` within one heartbeat interval of the expiry, and the job state does not change

#### Scenario: A late heartbeat restores the count

- **WHEN** the count fell to 0 because a lease expired, and the worker then renews its lease
- **THEN** the owner receives `chat.upserted` with the restored `runningJobs` within one heartbeat interval of the revival

#### Scenario: Only the remaining workers count

- **WHEN** jobs of one Chat run on two workers, and one lease expires
- **THEN** `runningJobs` of that Chat counts only the job on the other worker

#### Scenario: Another owner gets no projection

- **WHEN** a lease of a job of owner A expires
- **THEN** a socket of owner B receives nothing

#### Scenario: A job on a dead worker is not counted

- **WHEN** the only job of a Chat is `running` on a worker with no heartbeat for four intervals
- **THEN** `runningJobs` of that Chat is 0

### Requirement: The sidebar shows a background state

The sidebar MUST show the state `background` for a Chat when its `runningJobs` is above 0 and no
Run of it is live. It MUST also show `background` while the live Run of the Chat is in
`awaiting_jobs`. The order of precedence MUST be `processing`, `background`, `failed`, `unread`.

#### Scenario: A monitor with no live Run

- **WHEN** a Chat has one job in state `running` and no live Run
- **THEN** its sidebar row shows the `background` state on each device of the owner

#### Scenario: A Run that waits

- **WHEN** the live Run of a Chat is in `awaiting_jobs`
- **THEN** its sidebar row shows `background`, not `processing`

### Requirement: The Session details panel lists the jobs

The Session details panel MUST have a Jobs section that lists the jobs of the open Chat, the
live jobs first. Each live job MUST offer a stop control. The section MUST offer "Stop all" when
two or more jobs are live. The Stop control of the composer and the Esc key MUST NOT stop a job.

#### Scenario: Stop all with no live Run

- **WHEN** a Chat has two live jobs and no live Run, and the owner chooses "Stop all"
- **THEN** both jobs become `cancelled`, and no Run starts

#### Scenario: The composer Stop leaves jobs alone

- **WHEN** the owner presses Stop while a Run streams and one job is live
- **THEN** the Run is cancelled, and the job stays `running`

### Requirement: The web shows notices and host messages as notices

The web MUST show a pending `notice` item above the composer with the job locator and the state.
The item MUST offer delete and no other action. The transcript MUST show a host message as a
muted notice for each job that it names, and never as a message of the owner.

#### Scenario: The owner drops a result

- **WHEN** a notice is pending, and the owner deletes it
- **THEN** the item is `withdrawn`, and no later Run carries it

#### Scenario: A host message in the transcript

- **WHEN** a host message names one job that succeeded
- **THEN** the transcript shows one muted notice with the job locator and `succeeded`

### Requirement: The job tools pass the allowlist and the permission policy

`wait` and `stop` MUST be available only when `tools.allowed` names them. `tool-calling` defines
their classifications. A Run whose mode is `read-only` MUST be able to call `wait`, and it MUST
NOT be able to call `stop`. The description of each tool MUST tell the model what the tool
returns and that a job gives a notice when it settles.

#### Scenario: A Run in read-only mode waits

- **WHEN** a Run whose mode is `read-only` calls `wait` and then `stop`
- **THEN** the `wait` is admitted, and the `stop` is rejected with the fixed read-only message

#### Scenario: A read group rejects job locators

- **WHEN** the `read` group has a reject clause that matches `job://`
- **THEN** a `read` of `job://bash-4` is rejected, and no job record is returned
