---
summary: "The native bash tool: the model supplies shell text and the host runs it under the executor's OS user"
read_when:
  - you need to know how a bash call's cwd, environment, and output work
  - you need to know what happens when a bash attempt stops without a proven outcome
spec: bash-execution
configured_by:
  - ../../operator/native-files.md
---

# bash

## Purpose

Allowlisted `bash` shares the absolute-path native host gate: the model supplies
shell text and the host runs `bash -c` in the trusted bash working directory
(defaulting to the API process cwd). It is not tenant isolation.

## Arguments

| Argument  | Meaning                                      |
| --------- | -------------------------------------------- |
| `command` | the shell text to run under `bash -c`        |
| `cwd`     | optional literal working directory           |
| `env`     | optional string-record environment additions |

## Result

Command stdout and stderr are returned as produced up to the configured bound,
with truncation reported.

## Behavior

`bash` accepts an optional literal `cwd` and string-record `env`. An absolute
`cwd` is used as given; a relative `cwd` resolves from the Workspace root while
a Workspace is entered and from the trusted bash working directory or the API
cwd otherwise. When omitted, that same default directory is used. A `cwd` that
names a locator scheme is refused with `invalid_path` while a Workspace is
entered. The directory must be enterable before the attempt is recorded, and no
shell expansion is applied to the argument.

Each call starts a fresh process, so its working directory, environment, and
shell state do not persist. The child receives the fixed managed base (`PATH`,
`LANG=C.UTF-8`, `HOME`, `TMPDIR`, `USER`, `LOGNAME` when set, and `TERM=dumb`)
plus the call's additions as its initial environment; base variables cannot be
replaced. Bash, its launcher, or the runtime may add variables such as `PWD`,
`SHLVL`, and `_` before a command prints its environment.

The shared model-facing neutralizer escapes reserved tool delimiters in the
copy sent to the model. Host `bash` can also discover a mounted Knowledge root
through ordinary filesystem commands; that is separate from the owner-scoped
`knowledge_search` and `kb://` capabilities.

## Bounds

Output is bounded by the configured bound and truncation is reported in the
result. A call is a fresh process with no state carried into the next one.

## Errors

An unproven stop leaves the attempt `outcome_unknown`; see
[mutation recovery](../mutation-recovery.md) for the fence and the worker-crash
limit on the process-group quarantine.

## Configured by

[native files](../../operator/native-files.md) enables the host executor, the
`bash` entry, and the trusted bash working directory. A call is gated by the
`bash` permission group, described in
[tool-call permissions](../../operator/tool-call-permissions.md).
