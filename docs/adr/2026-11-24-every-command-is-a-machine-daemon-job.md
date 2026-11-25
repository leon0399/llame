---
status: accepted
---

# Every command is a Machine daemon job

The Machine daemon runs each command addressed to its Machine as a job and knows
nothing of foreground, background, or waiting. The installation decides when a call stops
waiting and becomes a background job, and it records why. A job binds to its
Machine, the daemon's instance id, and a job id that the installation draws at
random, so a resent start returns the running job instead of a second command.

## Considered options

- Let the daemon move a foreground command to the background on a timer, on
  request, or when the connection drops. We rejected it because the daemon
  would then hold llame's wait policy, and every change to that policy would
  need a daemon upgrade on every Machine.
- Let the daemon choose the job id. We rejected it because a worker that dies
  between the start and its first database write would leave a job that
  nothing can find or release.

## Consequences

The installation persists the job id and its owner-scoped binding before it
sends the start, so every started job has a record that can settle and release
it. Job output lives in files on the Machine and is read by byte offset. The
daemon reports every job change on one stream per connection, starting with a
snapshot. A job is `lost` when its outcome is unknown: its daemon restarted,
could not prove that a stop ended the process group, or no longer knows it.
`chat_job_chunks` is deleted.

This was decided in
[Background jobs on every Machine](https://github.com/leon0399/llame/issues/1785).
The OpenSpec change [rust-machine-daemon](../../openspec/changes/rust-machine-daemon/proposal.md)
specifies the contract.
