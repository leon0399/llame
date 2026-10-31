---
summary: "The native bash tool: the model supplies shell text and the host, a Machine, or an ssh:// host runs it under the executor's OS user"
read_when:
  - you need to know how a bash call's cwd, environment, and output work
  - you need to know what happens when a bash attempt stops without a proven outcome
spec: bash-execution
configured_by:
  - ../../operator/native-files.md
  - ../../operator/ssh.md
---

# bash

## Purpose

Allowlisted `bash` shares the absolute-path native host gate: the model supplies
shell text and the host runs `bash -c` in the trusted bash working directory
(defaulting to the API process cwd). A `machine://` or `ssh://` `cwd` runs the
command on that remote host instead. It is not tenant isolation.

## Arguments

| Argument  | Meaning                                      |
| --------- | -------------------------------------------- |
| `command` | the shell text to run under `bash -c`        |
| `cwd`     | optional literal working directory           |
| `env`     | optional string-record environment additions |

## Result

The model reads plain text, not JSON: one status header `exit <code>`, continued
with `, <seconds> s` (one decimal) when the producer measured the command's wall
time from spawn to settlement, then stdout verbatim, then a `[stderr]` line and
the stderr when it is non-empty. A result with both streams empty says
`(no output)`. `[output cut at the bound]` marks output the executor bound cut,
and a bracketed cap notice can end the text; a result only the global result cap
shortened ends with its notice and no such marker. A stored result without a
wall time renders the bare header.

A failing command is a `command_failed` result whose message is the same text
shape, with the non-zero exit code. A stopped command is a `timed_out` result
whose message starts with `timed out` and the measured elapsed time in seconds,
and names no exit code: the process was stopped, not exited. A deadline that
ended the call before a command started names no time, because nothing
measured one. The stored result keeps the exit code, both bounded streams, the
`cut` flag its executor set, and the wall time, and carries no field naming the
operation or the executor.

## Behavior

`bash` accepts an optional literal `cwd` and string-record `env`. An absolute
`cwd` is used as given; a relative `cwd` resolves from the Workspace root while
a Workspace is entered and otherwise from the trusted bash working directory,
or, when none is configured, the working directory of the process that executes
the Run. When omitted, that same default directory is used. A `cwd` that
names a locator scheme is refused with `invalid_path` while a Workspace is
entered, except a [`machine://`](../locators/machine.md) locator, which runs the
command on that Machine with the same managed base and bounds. Inside a Machine
Workspace an omitted or relative `cwd` resolves on the Machine and a bare
absolute `cwd` is the Machine's own path. An
[`ssh://`](../locators/ssh.md) locator runs the command on that host as its
login user, whenever the operator enabled ssh locators; it is never projected,
so it addresses its own host inside any Workspace. The directory must be
enterable before the attempt is recorded, and no shell expansion is applied to
the argument. An `ssh://` directory is the exception: only the host can test it,
so that attempt is recorded first, and a directory its login user cannot enter
still gives the same `unavailable` refusal with the command not run.

The description tells the model to set the directory with `cwd` and not with a
`cd` in `command`: inside an entered Workspace it gives no `cwd` or one relative
to the Workspace root, and with no Workspace it gives an absolute `cwd`. The
guidance is advisory; a submitted `cd` runs as written and permission rules
match the `command` text as submitted.

Each call starts a fresh process, so its working directory, environment, and
shell state do not persist. The child receives the fixed managed base (`PATH`,
`LANG=C.UTF-8`, `HOME`, `TMPDIR`, `USER`, `LOGNAME` when set, and `TERM=dumb`)
plus the call's additions as its initial environment; base variables cannot be
replaced. Bash, its launcher, or the runtime may add variables such as `PWD`,
`SHLVL`, and `_` before a command prints its environment.

An `ssh://` command is the exception to that base: it starts from the remote
login shell's own environment and receives only the call's `env` additions. Each
key must be an identifier (`[A-Za-z_][A-Za-z0-9_]*`), a value holding NUL is
refused, and a managed base name is refused there too. The entries travel inside
the script on stdin, never on an `ssh` argv.

The shared model-facing neutralizer escapes reserved tool delimiters in the
copy sent to the model. Host `bash` can also discover a mounted Knowledge root
through ordinary filesystem commands; that is separate from the owner-scoped
`knowledge_search` and `kb://` capabilities.

## Bounds

Output is bounded by the configured bound and truncation is reported in the
result. A call is a fresh process with no state carried into the next one, and a
Machine call uses the same managed bounds. An `ssh://` command uses them too:
one `bash -s` process per call, the shared output bound, and the call's
remaining time.

## Errors

An unproven stop leaves the attempt `outcome_unknown` as a tool observation
while the Run continues; inspect the workspace before retrying. See
[mutation recovery](../mutation-recovery.md) for the durable attempt fence and
crash-recovery termination.

A Machine command fails with `machine_not_found` for an unconfigured Machine and
`machine_unavailable` before anything was sent; a command whose session is lost
after dispatch settles as `outcome_unknown` and the Machine terminates its
process group. See [machine](../locators/machine.md#errors).

An `ssh://` command that ends before its end trailer — timeout, cancellation,
or a dropped session — is `outcome_unknown` and is never replayed, because the
hub cannot prove the remote stop. Before the command starts, a refused
connection is `ssh_unavailable` with a reason, and a host without `bash` is
`ssh_unsupported_host`. A working directory the login user cannot enter is
`unavailable` and the command does not run. See
[ssh locators](../locators/ssh.md#errors).

## Configured by

[native files](../../operator/native-files.md) enables the host executor, the
`bash` entry, and the trusted bash working directory, and
[SSH locators](../../operator/ssh.md) enables an `ssh://` `cwd` without a local
executor. A call is gated by the `bash` permission group, described in
[tool-call permissions](../../operator/tool-call-permissions.md).
