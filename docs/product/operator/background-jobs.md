---
summary: "Enable and bound host bash jobs, stop them through owner controls, and understand worker shutdown"
read_when:
  - you need to configure the lifetime or concurrency of background commands
  - you need to stop a job or deploy a worker that hosts jobs
behavior:
  - ../reference/tools/bash.md
  - ../reference/locators/job.md
  - ../reference/mutation-recovery.md
---

# Background jobs

## Enable host execution

Enable the host executor, allowlist `bash`, and admit the command through its
permission group as described in [native files](native-files.md). The same
permissions apply to a background command; `async` grants no extra authority.
A host command with `async: true` returns a `job://bash-<n>` locator while the
command continues. SSH and Machine commands reject background fields, including
an omitted working directory in a Machine Workspace.

## Bound jobs

```jsonc
{
  "tools": {
    "bash": { "maxProcesses": 64, "backgroundAfterSeconds": 120 },
    "jobs": { "maxSeconds": 7200, "allowUnlimited": false },
  },
}
```

`tools.bash.maxProcesses` is one worker's shared bound for foreground host
commands, host jobs, and SSH commands. A slot stays occupied until the command
settles, not merely until the tool returns its job locator.

`tools.bash.backgroundAfterSeconds` (default 120) is how long a foreground host
command runs before it moves to the background. The lesser of it and
`tools.callTimeoutSeconds` applies; with a call timeout of 30 seconds a command
moves after 30 seconds. The move never stops the command. A failed move stops
it. If the database takes longer to settle a move, the Run waits for its
authoritative result; a committed move returns the job. SSH and Machine
commands do not move.

`tools.jobs.maxSeconds` is measured from command start. It defaults to 7,200
seconds and accepts an integer of at least 60 or a whole-value interpolation
token. The model cannot provide a different duration. The worker stops a job at
its deadline; the state is `timed_out` only after proof that its process group is
empty, and `lost` when that proof fails.

`tools.jobs.allowUnlimited` defaults to `false`. Set it to `true` only when a
model may start jobs with no lifetime. An `unlimited: true` command is refused
before spawn when this setting is false. Change configuration by restarting
every API and worker process on the same file.

## Read and stop work

The model stops jobs with the [`stop`](../reference/tools/stop.md) tool. It needs
`stop` in `tools.allowed` beside `bash`, and its own `stop` group in
`tools.permissions`; the recommended portable map allows it. A `read-only` Run
refuses it.

The [job locator](../reference/locators/job.md) exposes the durable record and
bounded, redacted stdout and stderr. Increments are stored at 16 KiB or one
second after the first unflushed byte, so another worker can read them without
adopting the process. Job output keeps the credential set and artifact policy
of the starting Run.

The owner lists jobs with `GET /api/v1/chats/:chatId/jobs` and requests a stop
with `PATCH /api/v1/chats/:chatId/jobs/:jobId` and body
`{"state":"cancelled"}`. The response may still show `running`: it records a
request, and the hosting worker proves termination before settlement. Its
control listener acts after the transaction commits; the heartbeat re-checks
recorded requests after a lost signal. Deleting the Chat also stops its jobs.
The composer's Stop cancels the Run, not a job that already moved to the
background.

## Runtime boundary

Each winning job settlement creates one pending notice in the same transaction,
including a `lost` settlement found on touch. A notice joins pending `steer` and
`interrupt` items at the next ordered boundary of the currently executing Run;
only that Run receives the signal. A notice-only boundary delivery creates a
host trigger with user role, no sender, and no stored content. Its job context
is authored at dispatch, not saved in the trigger row. See the
[job locator](../reference/locators/job.md#pending-notices) and
[stop tool](../reference/tools/stop.md#behavior) for the reference contract.

An idle, unarchived Chat whose latest Run completed can start a host Run when a
job succeeds, fails, or times out. Settlement, the empty host trigger, Run,
notice attachment, and first queue job commit together. Pending notices share
that Run; the first pending notice supplies its model, effort, and permission
mode. If those settings are no longer available, the notices stay pending.

A lost or cancelled job starts no Run. Notices after a stopped or failed Run
wait for an owner send, queue promotion, mode change, or follow-up Run.
An owner send, queue promotion, or mode change adopts pending notices at
admission, including lost and cancelled results. A follow-up receives pending
notices at its first step boundary. A Run that ends before dispatch returns
its notices to pending. Continue can answer a host trigger after a failed host
Run. The `wait` tool is not active yet.

Host-history privacy and model-order handling are available for stored host
rows. Owner-history responses identify them with `host: true`; ordinary owner,
assistant, tool and checkpoint rows carry `host: false`. Host rows remain
excluded from title, preview, recency, public projection, and shared forks.

## Deploy workers

A job belongs to its Chat but runs only on the worker that spawned it. An
orderly shutdown refuses new commands and promotions, stops hosted work, and
stores captured output before the queue closes. A proven stop records
`cancelled` with stopper `worker`; an unproven stop is `lost`. A crash is found
at the next owner-scoped touch after four missed heartbeat intervals. No other
worker replays or adopts the command.

A completed, failed, or cancelled starting Run does not stop its jobs. Settlement
is stored independently; host startup follows the idle-Chat rules above. Read
the job record or use the owner jobs API to inspect its terminal state.
