---
summary: "The native zsh tool: the model supplies Zsh shell text and the current Machine or another Machine runs it as that Machine user"
read_when:
  - you need to know how a zsh call's cwd, environment, and output work
  - you need to know why a zsh call fails on a Machine
spec: bash-execution
configured_by:
  - ../../operator/native-files.md
---

# zsh

## Purpose

Allowlisted `zsh` runs shell text as `zsh -f -c` on the target Machine, so the
tool the model calls and the dialect it writes agree. An operator allowlists it
instead of, or beside, [`bash`](bash.md). A bare or relative `cwd` resolves on
the current Machine; a `machine://` `cwd` runs the command on that Machine
instead. It is not tenant isolation.

## Arguments

| Argument    | Meaning                                                                     |
| ----------- | --------------------------------------------------------------------------- |
| `command`   | the Zsh shell text to run under `zsh -f -c`                                 |
| `cwd`       | optional literal working directory                                          |
| `env`       | optional string-record environment additions                                |
| `async`     | optional boolean; start a host command as a background job                  |
| `unlimited` | optional boolean; request no job lifetime, only when the operator allows it |

## Result

The result text, the stream bounds, the artifact parts, and the failure shape
are the ones [`bash`](bash.md#result) documents. A saved stream is still named
`artifact://bash-<n>/<stream>`, because the job locator is the job's, not the
shell's.

## Behavior

The command runs in the shell the tool names: `bash` runs `bash -c` and `zsh`
runs `zsh -f -c`. `-f` sets `NO_RCS`, so no startup file is read: neither
`/etc/zshenv` nor `~/.zshenv` runs, and an alias, function, or option they set
is unavailable. Without `-f`, `zsh -c` would read them and break the
fresh-process contract that keeps one call from depending on the last.

The managed base environment, the `cwd` rules, the background-job rules, the
interrupt behavior, the credential redaction, and the bounds are the ones
[`bash`](bash.md#behavior) documents. The shell a call names changes only which
program runs its text.

An `ssh://` working directory is refused: an ssh command runs `bash` on the
remote host, so a `zsh` call that names one fails with `invalid_input` and names
`bash` instead.

## Bounds

The stream, job, and process bounds are the ones [`bash`](bash.md#bounds)
documents. A `zsh` call shares the worker process count with `bash` calls.

## Errors

The daemon refuses a shell it cannot run with `unavailable`, naming the shell.
An unknown shell reaches the model as `invalid_input`, and the call starts no
process. Every other error is the one [`bash`](bash.md#errors) documents.

## Configured by

[native files](../../operator/native-files.md) enables the `zsh` entry, and
[Machines](../../operator/machines.md) declares the current Machine. A call is
gated by the `zsh` permission group, described in
[tool-call permissions](../../operator/tool-call-permissions.md).
