---
summary: "The stop tool: asks the host to end listed background jobs of the current Chat and reports their states"
read_when:
  - you need to know what a model's stop call changes and returns
  - you need to know how a late or refused stop is reported
spec: tool-calling
configured_by: ../../operator/background-jobs.md
---

# stop

## Purpose

`stop({ jobs })` ends running [background jobs](../locators/job.md) of the
current Chat. A job that already settled keeps its state.

## Arguments

| Field  | Meaning                                                                            |
| ------ | ---------------------------------------------------------------------------------- |
| `jobs` | 1 to 16 record locators such as `job://bash-4`; no output locator, no other scheme |

The scheme matches without case.

## Result

A success holds `jobs`, one entry per locator in input order: `job`, `state`,
and `stopped_by` when a stop ended the job (`assistant` for this tool). A
job that settled before the call keeps its state and stopper.

Every job is resolved in the owner's scope before any request is recorded. An
unknown job, or a job of another Chat or owner, makes the whole call
`not_found`, and no request is recorded for any listed job. A malformed or
output locator is `invalid_input`.

## Behavior

The call records one stop request for each running job and signals its hosting
worker, in one transaction. It then waits up to 5 seconds, shared by all jobs
of the call: this worker settles a job that it hosts directly, and a job of
another worker is read every 250 ms. A job still running when the wait ends is
reported as `running`. Its request is stored, so it ends once its worker proves
the stop. A worker that is dead settles its jobs as `lost`.

Host termination proof covers the job's managed process group. Detached
descendants that leave that group are outside the proof.

A successful recorded result consumes, atomically with its `tool.completed`
event, only the pending notices for jobs reported in settled states. The event
keeps the exact consumed notice ids as server-private metadata; they are not
part of the tool output. A job reported as `running` consumes no notice. A
Run cancelled before the result is persisted consumes none. If the stored
result is discarded, restoration returns only those exact previously consumed
notices that still exist; an owner-withdrawn notice is not recreated. Reading
a job never consumes its notice. See the
[job locator](../locators/job.md#pending-notices) for notice delivery and
context behavior.

A repeated call requests the stop again. `stop` records no native attempt.

The `execute_code` classification and the host-capability gate apply: the tool
needs a trusted host identity, its own `tools.allowed` entry, and its own
`tools.permissions` group, and a `read-only` Run refuses it.

## Errors

`not_found`, `invalid_input`, `executor_unavailable`, `permission_denied`, `cancelled`.

## Configured by

[background jobs](../../operator/background-jobs.md) and
[native files](../../operator/native-files.md).
