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
moves after 30 seconds. The move never stops the command. A move that fails stops
it, and a move that the database records more than 750 ms late leaves a normal
job and an unknown call result. SSH and Machine commands do not move.

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

## Pending delivery contract

`GET /api/v1/chats/:chatId/deliveries` identifies each item's `producer`.
Owner items retain their steer, interrupt and queue controls. A `job` item
uses mode `notice`, names its `job://` locator and `jobState`, and offers delete
only. The owner can withdraw it through the deliveries endpoint. Changing a
notice's mode or sending an owner notice returns HTTP 400 without mutation.
A withdrawn notice keeps its job's unique sender reference; withdrawal does
not stop the job.

Notice storage and its pending-item view are available, but job settlements do
not create notices yet. Settlement delivery is a separate integration.

Host-history privacy and model-order handling are available for stored host
rows. Owner-history responses identify them with `host: true`; ordinary owner,
assistant, tool and checkpoint rows carry `host: false`. This does not yet
activate notice-started Runs or their transcript presentation.

## Deploy workers

A job belongs to its Chat but runs only on the worker that spawned it. An
orderly shutdown refuses new commands and promotions, stops hosted work, and
stores captured output before the queue closes. A proven stop records
`cancelled` with stopper `worker`; an unproven stop is `lost`. A crash is found
at the next owner-scoped touch after four missed heartbeat intervals. No other
worker replays or adopts the command.

A completed, failed, or cancelled starting Run does not stop its jobs. Settlement
is stored independently; it does not currently start a new Run. Read the job
record or use the owner jobs API to inspect its terminal state.
