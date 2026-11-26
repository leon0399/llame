## ADDED Requirements

### Requirement: A job is bound to its Machine daemon

A job MUST bind to the Machine name, the daemon instance id, and the daemon
job id. It MUST NOT bind to a worker. A daemon fact MUST NOT overwrite a settled row.
The installation MUST persist this binding before it sends `CreateJob`, and
any resend MUST reuse the persisted daemon job id. It MUST NOT resend after
the row has settled. Reconciliation MUST NOT settle or release a row while
its creating attempt can still deliver `CreateJob`. An observed daemon job
with no matching owner-scoped binding MUST be left unread and unreleased.
It MUST NOT create a Chat job or authorize access to another owner's data.

Foreground and background delivery MUST be recorded separately from daemon
execution state. An explicit background start MUST record background
delivery. A move caused by time, message, or disconnection MUST persist that
transition before returning a backgrounded result.
A foreground daemon binding is internal execution bookkeeping, not a
model-facing background job. Until background delivery is committed, the
background-job lifetime across terminal Runs, job listings, `wait`, `stop`,
and owner-facing job controls MUST NOT apply to it. Foreground Run
cancellation follows `bash-execution` instead.

#### Scenario: Another worker settles the job

- **WHEN** the worker that started a job exits and another worker attaches to the Machine
- **THEN** that worker settles the job from the daemon's record

#### Scenario: A worker stops after recording the start

- **WHEN** a worker exits after persisting the binding but before recording the answer to `CreateJob`
- **THEN** a later attachment reconciles that row from the daemon without starting the command again
- **AND** an unknown daemon job settles the row as `lost`

### Requirement: Foreground settlement does not announce background work

A foreground job's result MUST settle its row and preserve its available output
under `tool-artifacts` "Settled jobs preserve available output", without
creating a job notice, a settlement wake, or a job-notice Run. A
reconciler MUST NOT settle or release a foreground job while its owning Run
can still consume that result. When that Run is terminal and no foreground
consumer remains, reconciliation MUST recover the abandoned job as background
work and settle it with the normal notice and wake transaction, unless its
binding carries a cancellation request. A cancelled foreground binding MUST
deliver that request and settle without background promotion or a job notice.

#### Scenario: A foreground command returns its result

- **WHEN** a foreground command exits with code 7 before its foreground bound
- **THEN** its tool result retains that exit code and output
- **AND** no notice for that same foreground completion interrupts the next model step

#### Scenario: A second worker observes a foreground completion

- **WHEN** another worker observes a settled daemon job whose foreground Run is still active
- **THEN** it does not release the daemon output before the foreground consumer reads it

#### Scenario: An abandoned foreground command is recovered

- **WHEN** a foreground consumer is gone and its Run is terminal
- **THEN** reconciliation can settle its bound daemon job with one notice and wake

### Requirement: Daemon facts determine when a job is lost

A job MUST settle as `lost`, with its outcome unknown, when its daemon reports
it `lost`, when the daemon does not know the job after the creating attempt
has ended, or when the daemon instance id changed. The read MUST name the
cause and tell the model to check the environment. A known start refusal
MUST remove the unstarted binding and return a known refusal, not a lost job.

#### Scenario: A restarted daemon loses a running job

- **WHEN** the daemon restarts while a job runs
- **THEN** the job settles `lost` with the cause that the Machine daemon restarted

### Requirement: Job output lives on the Machine

A running job's output MUST be read from the Machine by byte offset. At
settlement the installation MUST preserve available output under
`tool-artifacts` "Settled jobs preserve available output", then release the
daemon record. A definitively missing job or output MUST remain explicitly
unavailable, not an empty captured result. Foreground
delivery MUST still obey "Foreground settlement does not announce background work".
Explicit owner deletion of the Chat MAY discard its stopped job's retained
output without first creating an artifact, under the deletion requirement.

#### Scenario: Output of a settled job

- **WHEN** a job settles and its daemon retains the output
- **THEN** its artifact holds the bounded, credential-redacted output and the daemon deletes the job directory

### Requirement: A job on an unreachable Machine shows as unknown

While a Machine is unreachable its unsettled jobs MUST show their last known
state as unknown. Unknown MUST NOT settle a job. A stop MUST be delivered when
the Machine is reachable again.

#### Scenario: A stop waits for the Machine

- **WHEN** the owner stops a job on an unreachable Machine
- **THEN** the stop is delivered on the next connection

### Requirement: The installation redacts model-visible job output

The Machine MUST NOT receive the installation's configured credential set.
Before returning live job output to a model, or copying it into a settled
artifact, the installation MUST replace each member of that set with
`[REDACTED]`. It MUST apply the cut, dropped-prefix, and retained-gap rules of
`bash-execution`, including a member that crosses RPC chunk boundaries.
Raw output may exist in the private job directory on the Machine until release.

#### Scenario: A credential crosses read chunks

- **WHEN** a job prints a configured provider key split between two RPC output chunks
- **THEN** the model-facing read and settled artifact contain no part of the key

#### Scenario: An output bound cuts a credential

- **WHEN** the retained output ends inside a configured credential
- **THEN** the model-facing read and settled artifact contain no retained prefix of that credential

### Requirement: A wait returns daemon-reconciled lost jobs

When reconciliation settles a listed job as `lost`, `wait` MUST return
`ended: "settled"` with that job's lost entry rather than `ended: "timeout"`.
A worker crash alone MUST NOT settle a job. An unreachable Machine MUST keep
its last known job state unknown until a later contact can reconcile it.

#### Scenario: The daemon of a waited job loses its job

- **WHEN** the model waits on `job://bash-4` and reconciliation finds that the daemon lost it
- **THEN** `wait` returns at its deadline at the latest with `ended: "settled"` and the job as `lost`

### Requirement: The chat list counts daemon-held background jobs

Each item of the chat list and each live Chat record MUST hold `runningJobs`.
It MUST count the Chat's background jobs whose stored state is `running`,
independently of the starting worker's lease. Foreground delivery rows MUST
NOT count as background jobs. A change of that count MUST reach each device
of the owner through the existing live Chat projection.

#### Scenario: A worker loses its lease while its daemon job runs

- **WHEN** a background job stays `running` and its starting worker loses its lease
- **THEN** the Chat's `runningJobs` count does not fall merely because the lease expired

#### Scenario: A daemon settlement lowers the count

- **WHEN** reconciliation settles the last running background job of a Chat
- **THEN** the owner's devices receive the Chat projection with `runningJobs` 0

#### Scenario: Another owner gets no projection

- **WHEN** a background job of owner A settles
- **THEN** a socket of owner B receives no projection for that Chat

## REMOVED Requirements

### Requirement: The worker stores the output of a live job in increments

**Reason**: Output lives in files on the Machine.
**Migration**: `chat_job_chunks` is dropped with its rows.

### Requirement: A job is bound to the worker that started it

**Reason**: Jobs bind to the Machine daemon.
**Migration**: See "A job is bound to its Machine daemon".

### Requirement: A worker that shuts down ends its jobs

**Reason**: Jobs outlive workers while their daemon runs.
**Migration**: None.

### Requirement: A job on a dead worker settles as lost

**Reason**: Worker liveness no longer decides a job's fate.
**Migration**: See "Daemon facts determine when a job is lost".

### Requirement: A stop request reaches the worker of the job

**Reason**: Any worker attached to the Machine stops the job.
**Migration**: See "A job on an unreachable Machine shows as unknown".

### Requirement: A stopped worker command never overwrites a lost row

**Reason**: The daemon owns execution independently of worker heartbeats.
**Migration**: The job binding requirement prohibits overwriting a settled row with a later daemon fact.

### Requirement: Stored job output holds no configured credential

**Reason**: The Machine stores raw bytes rather than hub-written increments.
**Migration**: See "The installation redacts model-visible job output".

### Requirement: A wait on a lost job returns the lost entry

**Reason**: A worker crash alone no longer makes a job lost.
**Migration**: See "A wait returns daemon-reconciled lost jobs".

### Requirement: The chat list reports the live jobs of each Chat

**Reason**: Worker-lease expiry no longer determines whether a daemon job runs.
**Migration**: See "The chat list counts daemon-held background jobs".

## MODIFIED Requirements

### Requirement: A job has an operator lifetime

A job MUST end when it has run for `tools.jobs.maxSeconds` from its start.
The daemon MUST enforce this deadline independently of worker liveness.
The job MUST settle as `timed_out` under the proof rule of this capability.
The model MUST NOT be able to set or change this lifetime. A job that starts
with `unlimited: true` has no lifetime. A call with `unlimited: true` MUST be
refused before any work starts when `tools.jobs.allowUnlimited` is `false`.

#### Scenario: A hung build ends at the lifetime

- **WHEN** `tools.jobs.maxSeconds` is 7,200 and a job runs for 7,200 seconds
- **THEN** the daemon stops the job, and the job is `timed_out`

#### Scenario: An unlimited job is refused by default

- **WHEN** `tools.jobs.allowUnlimited` is `false` and the model starts a job with `unlimited: true`
- **THEN** the call returns an error that names the setting, and no job starts

### Requirement: A settlement that fails to commit is retried

The settlement of a job MUST be one transaction with any notice and wake
required for its delivery mode.
A failed transaction MUST roll back and leave the row `running`. A later
reconciliation MUST retry from the daemon's retained settlement and output,
without repeating the command or discarding those records before commit.
A worker crash MUST NOT make a retained daemon settlement unknown.

#### Scenario: A queue insert fails during a settlement

- **WHEN** a job exits, and the transaction of its settlement rolls back because the queue insert of a wake fails
- **THEN** the job stays `running`, and reconciliation commits the same daemon settlement later

#### Scenario: The worker ends before the retry commits

- **WHEN** a settlement keeps failing and its worker then crashes or loses its heartbeat
- **THEN** another worker retries the settlement from the daemon without starting the command again

### Requirement: An orderly shutdown keeps known settlements

An orderly shutdown MUST await its in-flight settlement passes before closing
the queue. A failed pass MUST leave the row unchanged for later daemon
reconciliation. Shutdown MUST NOT replace known natural settlement facts with
cancellation, and worker shutdown alone MUST NOT stop daemon-held jobs.

#### Scenario: A shutdown with a pending settlement

- **WHEN** a job exited, its settlement failed to commit, and its worker then shuts down in order
- **THEN** a later settlement uses the same daemon facts rather than replacing them with `lost`

#### Scenario: Shutdown cannot commit the known settlement

- **WHEN** a command exited, its settlement remains unavailable, and its worker shuts down in order
- **THEN** shutdown leaves the row `running` and leaves the daemon record for another worker
- **AND** worker death alone does not make the known daemon settlement lost

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

- **WHEN** a query reads the job artifact with no owner identity in its transaction
- **THEN** it returns no row

#### Scenario: Another owner cannot stop a job

- **WHEN** user B sends the `PATCH` that stops a job in a Chat of user A
- **THEN** the API answers 404, and the job stays `running`

#### Scenario: A tool call cannot name a job of another owner

- **WHEN** a Run of user B calls `wait` or `stop` with a locator that only resolves in a Chat of user A
- **THEN** the result is `not_found`, and no job of user A changes

### Requirement: A fork of a Chat has no job

A fork of a Chat MUST NOT copy its jobs. A copied tool part
or `job` context item that names a job or its artifact stays as text. The fork copies an artifact
only under the rules of `owner-chat-forks`, so such a name can fail to resolve in the fork.

#### Scenario: A fork during a live job

- **WHEN** the owner forks a Chat while `job://bash-4` is `running`
- **THEN** a `read` of `job://` in the fork returns an empty list

### Requirement: A settlement creates one job notice

A background settlement MUST create one pending item of `run-steering` with the producer kind `job`, the
mode `notice`, and the job as sender reference. This MUST occur in the transaction that settles
the job. A foreground settlement MUST NOT create a notice. A background job MUST get at most one notice. A `wait` or `stop` consumes notices only in the
transaction that records its result, and only for the settled states that result reports.

#### Scenario: A job that nobody waits on

- **WHEN** a background job succeeds while its Run executes another tool
- **THEN** the Chat has one pending `notice` item that names the job

#### Scenario: A settlement is recorded twice

- **WHEN** two writers try to settle one background job
- **THEN** the job has one settled state and one notice

### Requirement: A stop is known only after proof

A stopped job MUST settle as `cancelled` only when the daemon proved that the work stopped. For
`bash`, the proof is the empty process group of `bash-execution`. A daemon-confirmed stop whose process-group proof fails MUST settle the job as `lost`. An unreachable daemon MUST leave the stop pending and the outcome unknown; worker death alone MUST NOT settle it.

#### Scenario: A stop that is not proved

- **WHEN** the daemon signals the process group of a job, and the group does not end
- **THEN** the job is `lost`, and its record states that the outcome is unknown

### Requirement: The read tool returns one output of a job

A `read` of `job://<executor>-<n>/<output>` MUST return the stored text of that output. It MUST
accept the line selectors that an artifact read accepts. For a job in state `running`, it MUST
read the current retained output from the Machine and redact it before returning it. An unreachable Machine MUST return an unavailable observation, not an empty or settled output. An unknown output name MUST get
`not_found`.

#### Scenario: The tail of a live output

- **WHEN** the model reads `job://bash-4/stdout:-50` two minutes into a build
- **THEN** the result holds the last 50 stored lines of `stdout`

#### Scenario: An unknown output

- **WHEN** the model reads `job://bash-4/log`
- **THEN** the result is `not_found`

### Requirement: The Session details panel lists the jobs

The Session details panel MUST have a Jobs section that lists the background jobs of the open Chat, the
live jobs first. Each live job MUST offer a stop control. The section MUST offer "Stop all" when
two or more jobs are live. The Stop control of the composer and the Esc key MUST NOT stop a background job.

#### Scenario: Stop all with no live Run

- **WHEN** a Chat has two live jobs and no live Run, and the owner chooses "Stop all"
- **THEN** both jobs become `cancelled`, and no Run starts

#### Scenario: The composer Stop leaves jobs alone

- **WHEN** the owner presses Stop while a Run streams and one background job is live
- **THEN** the Run is cancelled, and the job stays `running`

### Requirement: A deleted Chat ends its jobs

Before deleting a Chat and its job bindings, the installation MUST cancel
each of its running daemon jobs using those owner-scoped bindings.
Deletion MUST fail while any binding's creating attempt can still deliver
`CreateJob`, even if the daemon currently reports that id as unknown.
A binding with an unproved stop MUST continue to block deletion on later
attempts; a stored `lost` state alone MUST NOT turn that stop into proof.
If the Machine is unreachable or cancellation cannot be confirmed, deletion
MUST fail without deleting the Chat or its job bindings. A successful deletion
MUST leave no running command belonging to that Chat. Before deleting the
bindings, the installation MUST release their known settled daemon records.
Because Chat deletion explicitly discards its artifacts, it MAY release these
stopped jobs without creating an artifact or notice solely for deletion.
The same stop-before-delete precondition MUST apply when an installation
operation deletes the owner and cascades through its Chats.

#### Scenario: A deleted Chat leaves no process

- **WHEN** the owner deletes a Chat that has a job in state `running`
- **THEN** the installation confirms that the job stopped before deleting the Chat

#### Scenario: An unreachable Machine prevents Chat deletion

- **WHEN** a Chat has a running job on an unreachable Machine and its owner requests deletion
- **THEN** deletion fails and the Chat and its job binding remain available for a later stop
