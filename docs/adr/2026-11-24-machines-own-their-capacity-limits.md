---
status: proposed
---

# Machines own their capacity limits

Each Machine sets how many jobs it runs at once and how much output a job may
write to its disk. The installation sets no limit per Machine, because one
number cannot fit both a small box and hundreds of provisioned Machines. The
installation keeps the limits it promises the model: a job's lifetime, the
artifact size, and the output a tool result shows.

## Considered options

- Keep `tools.bash.maxProcesses` in the installation. We rejected it because
  it counted commands per worker process, so the real limit on a Machine grew
  with the number of workers.
- Default the running-job limit to the CPU count. We rejected it because idle
  dev servers and watchers count as jobs, so a 2-CPU box would refuse a third
  command while doing no work.

## Consequences

The default limit is 32 running jobs. It protects against a Run that starts
commands in a loop and does not control load. Load control through cgroups
belongs to
[resource limits for host commands through cgroups](https://github.com/leon0399/llame/issues/1663).
A resource limit on the box is not daemon-local call policy, which stays
excluded until
[local policy enforced by the Machine daemon](https://github.com/leon0399/llame/issues/1827)
decides it.
