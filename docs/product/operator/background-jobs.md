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
    "bash": { "maxProcesses": 64 },
    "jobs": { "maxSeconds": 7200, "allowUnlimited": false },
  },
}
```

`tools.bash.maxProcesses` is one worker's shared bound for foreground host
commands, host jobs, and SSH commands. A slot stays occupied until the command
settles, not merely until the tool returns its job locator.

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
