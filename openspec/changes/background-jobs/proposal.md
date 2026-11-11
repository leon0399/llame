## Why

A host `bash` command lives and dies with its tool call. The call is killed at
`tools.callTimeoutSeconds` (120 s), an interrupt kills it with `outcome_unknown`, a steer waits
behind it, and one worker process runs one command at a time
([#1050](https://github.com/leon0399/llame/issues/1050),
[#1051](https://github.com/leon0399/llame/issues/1051)). Long builds, test suites, and monitors
cannot run, and the agent cannot react to the owner while a command runs.

[#1657](https://github.com/leon0399/llame/issues/1657) asks for one background job primitive that
`bash` uses first and child Runs ([#765](https://github.com/leon0399/llame/issues/765)) use later.
In-Run steering shipped on 2026-11-09 and gives the delivery queue, the segments, and the
cross-process signals that this change builds on.

## What Changes

- **Background jobs.** A job belongs to a Chat and its owner. It has a handle
  `job://<executor>-<n>`, a state, named outputs, and a lifetime. It survives the end of the Run
  that started it.
- **`bash` in the background.** A host `bash` call returns `backgrounded` with a job handle when
  the model passes `async: true`, when the command has run 120 s in the foreground, or when a
  steer, an interrupt, or a job notice arrives. The command keeps its process.
- **`read` on a job.** `read job://bash-4` returns the job record. `read job://bash-4/stdout`
  returns one output, also while the job runs.
- **`wait` and `stop`.** Two new tools. `wait` blocks on listed jobs for at most 1 h and holds no
  worker: the Run moves to a new `awaiting_jobs` status and a queue job wakes it. `stop` ends
  listed jobs.
- **Job notices.** A settlement that no `wait` consumed becomes a pending item with producer
  `job`. A live Run gets it at its next step boundary. An idle Chat whose latest Run completed
  gets a new Run that the host starts. In every other case the notice waits for the next Run.
- **Owner controls.** The chat list reports running jobs, the sidebar shows a `background` state,
  and the Session details panel lists the jobs with stop controls.
- **BREAKING** (operator): `tools.callTimeoutSeconds` no longer stops a host `bash` command. A
  command moves to the background at the lesser of that value and the new
  `tools.bash.backgroundAfterSeconds` (120), and `tools.jobs.maxSeconds` (7,200) ends it.
- **BREAKING** (behavior): an interrupt no longer kills a host `bash` command; the command
  continues as a job. A steer no longer waits for a host `bash` command to finish.
- **BREAKING** (internal): the hardcoded `maxProcesses: 1` and the refusal
  `unavailable` / "Managed process limit reached." are replaced by `tools.bash.maxProcesses`
  (64) and the refusal `limit_reached`.

## Assumptions, confirmed with Leo

The full record is on
[#1657](https://github.com/leon0399/llame/issues/1657#issuecomment-6797748824). A name such as
"Grilling G1" refers to a decision of that record.

- **Grilling G0.** Two changes. This one covers host `bash`.
  [#1660](https://github.com/leon0399/llame/issues/1660) adds `ssh://` and `machine://` targets.
  A `monitor` tool is [#1661](https://github.com/leon0399/llame/issues/1661).
- **Grilling G1 to G7.** Chat ownership, the `job://` handle, named outputs, append-only output
  chunks flushed at 16 KiB or 1 s, an operator lifetime of 2 h with an opt-in exemption and no
  duration from the model, one per-worker fuse of 64, and the list of job endings.
- **Grilling G8, G9.** The three background triggers, and Stop: a Run cancellation kills a
  foreground command and leaves jobs running.
- **Grilling G10 to G13.** `wait(jobs[], timeout?)` returns on the first settlement, is capped
  at 1 h, ends on a steer, an interrupt, or a settlement outside its list, and holds no worker.
  `stop(jobs[])` is its own tool.
- **Grilling G14 to G18.** A notice is a `chat_deliveries` item with producer `job`. It acts as
  a steer in a live Run. The host starts a Run on an idle Chat with the settings of the Run that
  started the job, when the current configuration still admits them. A notice is held after a
  Run that was stopped, failed, or expired. A stopped or lost job never wakes the Chat. No cap
  applies to Runs that the host starts.
- **Grilling G19, G20.** The server reports the running-job count. The jobs list is a section
  of the Session details panel. The composer's Stop never stops a job.
- **Grilling GA1 to GA4.** Worker heartbeats in an infrastructure table, no jobs in a fork, the
  usual allowlist and permission path, and jobs that survive the cancellation of a waiting Run.

Assumptions that follow from those decisions and were not asked:

- A host message is stored as a `user` row with no sender and only `job` context items. The wire
  role stays `user`, as `context-injection` requires for every injected item.
- The number in `job://bash-7` is the Chat's artifact number, so the stored output is
  `artifact://bash-7`.
- A send or a promoted queue item takes the held notices into its user message. A Continue or a
  Regenerate gets them at its first step boundary.
- `wait` suspends the Run at once. It has no in-process grace period.
- The sidebar also shows `background` while the live Run is in `awaiting_jobs`.
- The fuse counts every managed `bash` process of the worker: foreground commands, jobs, and
  `ssh://` commands.
- The exemption flag is `unlimited: true`. A call that sets it is refused when
  `tools.jobs.allowUnlimited` is `false`.
- `wait` is `read_only`, so a Run in `read-only` mode can call it. `stop` is not.
- A dead worker is found only when something touches the Chat: a Run start, an admission, a
  `wait` timer, a `read`, or the chat list.
- A `bash` call with an `ssh://` or `machine://` `cwd` refuses `async` and `unlimited`, and keeps
  its present timeout and interrupt behavior until #1660.

## Deviation from the grilling record

Leo must confirm these three points.

1. **Grilling GA5: output files.** The record says that job output goes to files. This change
   keeps the pipes of the present executor and captures output in the worker. A command that
   writes to a file has no size bound unless the host kills it, and a bound that kills is a new
   behavior. The job row still records the host instance, the process id, the start time, and the
   tool call, so [#1662](https://github.com/leon0399/llame/issues/1662) needs no schema change.
   File-backed output moves with [#1627](https://github.com/leon0399/llame/issues/1627).
2. **Grilling G17: a job that the model stops.** The record says that such a job is reported at
   the next Run. This change reports it only in the result of the `stop` call, because that
   result is already in the transcript of the same Run. A job that the owner stops still gets a
   notice.
3. **Grilling G8: the call timeout.** The record says that `tools.callTimeoutSeconds` no longer
   applies to host `bash`. This change keeps it as an upper limit of the foreground bound. The
   reason is the canonical rule of `tool-calling` that the call timeout bounds every tool call
   and that a tool can only reduce it. A change of that rule needs a rewrite of a requirement
   with 20 scenarios. The effect: a call timeout above 120 s changes nothing for `bash`, and a
   call timeout below 120 s moves a command to the background earlier. It never stops the
   command.

## Capabilities

### New Capabilities

- `background-jobs`: the job record and its states, the `job://` locator, `wait`, `stop`, the
  lifetime, the worker bound to a job, host liveness, job notices and host messages, the owner
  API, and the web surfaces.

### Modified Capabilities

- `bash-execution`: MODIFIED `Alpha host bash uses the native executor gate` (two new input
  fields) and `Unknown command effects are never replayed automatically` (the foreground bound
  replaces the per-call timeout on the host). ADDED requirements for the background triggers, the
  `backgrounded` result, the process bound, and the tool description.
- `run-steering`: MODIFIED `A pending item records a producer and a sender`,
  `Steer delivers at the next step boundary`,
  `The items delivered at one boundary form one user message`,
  `Every tool declares an interrupt fate`, and `A cancelled call settles under its tool rules`.
  ADDED requirements for the `notice` mode.
- `durable-runs`: MODIFIED `One in-flight run per chat (single-flight)` (the job that admission
  reads) and `A run never stays stuck, enforced without a cross-tenant reaper` (the `wait`
  deadline job). ADDED requirements for `awaiting_jobs`.
- `context-injection`: MODIFIED `Co-occurring items have a total author-time order` (the `job`
  producer).
- `tool-calling`: ADDED requirements for the open `wait` call and for the tools that yield.
- `run-cancellation`: ADDED requirement for the cancellation of a waiting Run.
- `tool-artifacts`: ADDED requirement for the artifact of a job.
- `instance-config`: ADDED requirements for `tools.bash`, `tools.jobs`, and the foreground
  bound.
- `turn-actions`: ADDED requirement for a turn that a host message started.

### Deliberately unchanged

Each bullet names the reading under which the canonical text still holds.

- `bash-execution` / `Command results are bounded and explicit`: "Each bash call MUST enforce
  finite … duration" bounds the call. A host call returns at the foreground bound at the latest.
  The job lifetime bounds the command. The 50 ms drain after a proven stop also applies to a
  lifetime end.
- `tool-calling` / `Multi-step tool-calling run loop`: "MUST continue the same Run until the
  model gives a final answer" holds, because a Run in `awaiting_jobs` is the same Run and
  continues when it wakes.
- `tool-calling` / `No mid-run tool-state checkpointing`: its retry rules apply to a redelivered
  queue job. A wake is a new queue job and not a redelivery. A redelivered wake job follows the
  same rule: a recorded `native.attempt` in the current segment fails the Run as
  `outcome_unknown`.
- `tool-calling` / `Tool failure is an observation, not a crash`: "Tool execution SHALL be
  bounded by the global `tools.callTimeoutSeconds`" holds for the call. A host `bash` call
  returns at the foreground bound, which is never above that value. A `wait` call returns
  before it, because it suspends the Run.
- `tool-calling` / `Cooperative cancellation reaches tool execution`: the "effective per-call
  timeout" of host `bash` is its foreground bound. At that bound the call returns
  `backgrounded`, which is a structured result.
- `tool-calling` / `Termination settles in-flight tool activity`: a `backgrounded` call is
  settled. A job is not an open call.
- `run-steering` / `The queue pauses after a Run that does not complete`: its conversion rule
  names `steer` and `interrupt` items. A `notice` item keeps its mode and starts no Run until the
  owner acts.
- `run-steering` / `The owner lists and changes pending items`: `PATCH` names `queue` and `steer`
  items. A new requirement refuses it for a `notice` item.
- `run-steering` / `Stop interrupts when steers are pending`: a pending `notice` item is not a
  `steer` item, so Stop requests cancellation.
- `durable-runs` / `Workers drain gracefully on shutdown`: the drain finishes in-flight Runs. A
  new requirement ends the jobs of the worker.
- `ssh-locator` and `remote-machines`: no requirement changes. #1660 owns them.

## Impact

- **Database:** new tables `chat_jobs`, `chat_job_chunks`, and `worker_instances`; new columns
  on `runs`; a new `run_status` value; a restated live-notify function. Leo's instance keeps its
  chats.
- **API:** `GET /api/v1/chats/:chatId/jobs` and `PATCH /api/v1/chats/:chatId/jobs/:jobId`; a
  `runningJobs` field on the chat list item; a `host` flag on a message; new delivery fields.
  The OpenAPI document, the web client, and both live-protocol copies are regenerated.
- **Queue:** the `RunJob` payload gains an optional wake field. The queue protocol is
  regenerated.
- **Code:** `packages/bash-executor` (a handle that outlives the call), `apps/api/src/tools`
  (`bash`, `wait`, `stop`, the `job://` reader), `apps/api/src/runs` (suspension, wake, yield
  signals), `apps/api/src/chats` (admission, deliveries, host messages), `apps/web`.
  `apps/machine` keeps `executeManagedBash` unchanged.
- **Operators:** four new settings and one changed default behavior. Operator pages:
  `native-files.md`, `tool-call-permissions.md`, `tool-prompts.md`, `scaling.md`, and a new jobs
  page.
- **Superseded:** PR [#1299](https://github.com/leon0399/llame/pull/1299)
  (`bash-process-concurrency`) covers the same process bound.

## Non-Goals

- Jobs on `ssh://` and `machine://` (#1660), a `monitor` tool (#1661), jobs that survive a worker
  restart (#1662), cgroup limits (#1663), a server-side chat status (#1664), automatic retry of a
  failed Run (#1665), and a remote kill over `ssh://` (#1666).
- Child Runs as jobs (#765), a step checkpoint for crash recovery (#309), and a continuation
  across the 24 h job expiry (#1048).
- A cap on Runs that the host starts, and per-Chat or per-owner job caps.
- A fallback to instance defaults when the settings of the starting Run are no longer admitted.

## Acceptance

- A host `bash` call with `async: true` returns a handle, and `read`, `wait`, and `stop` work on
  it.
- A command that passes the foreground bound continues as a job and is not killed.
- A steer during a foreground command returns `backgrounded` and is delivered at that boundary.
- A settlement reaches a live Run exactly once, as a host-authored block with a bounded preview
  and an artifact locator.
- A Run that waits holds no queue job in the `active` state, and a settlement, a timeout, a
  steer, or a cancellation wakes it after a worker restart.
- A settlement on an idle Chat whose latest Run completed starts one Run.
- The Session details panel stops one job or all jobs, and the composer's Stop stops none.
- Another owner cannot read, wait on, stop, or list a job.
