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

A stream that does not fit its inline share keeps its first lines, one
`[lines <a>-<b> omitted; …]` line, and its last lines. When the Run can read
artifacts, that line names the stored part
(`read artifact://bash-<n>/stdout:<a>-<b>`) and the text ends with
`[full result: artifact://bash-<n>/stdout (<lines> lines)]` (`1 line` for one);
both streams that
do not fit are named in one notice. A failed write, or a Run that cannot read
artifacts, renders `[lines <a>-<b> omitted; full result not stored]` instead
and names no locator. The global result cap never shortens a `bash` result: the
tool's own preview is its inline bound.

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

Each stream is bounded at the operator-configured byte bound
([native files](../../operator/native-files.md)) on the llame host and for an
`ssh://` command, whose buffers take that byte count as it is. A Machine keeps
the 32,000-unit stream bound of the Machine protocol. A cut stream is reported
as `[output cut at the bound]`.

When the Run can read artifacts and the write succeeds, a stream over its inline
share is stored as one artifact part named `stdout` or `stderr` in one artifact,
so the model reads the rest through `artifact://bash-<n>/<stream>`. The streams
that do not fit share the inline budget equally, and a quarter of each share is
the head. The artifact holds the executor's captured stream, after redaction, in
bytes, and is marked incomplete when the byte bound cut it; a stream that parses
as JSON is stored with the JSON content type.

A call is a fresh process with no state carried into the next one. A Machine
call shares the managed base, input, time, and process bounds but keeps its own
32,000-unit stream bound. An `ssh://` command shares the host bounds: one
`bash -s` process per call, the same stream bound, and the call's remaining
time.

## Credential redaction

Every bounded stream, its stored artifact parts, and the stored result pass
through one redaction routine before the result leaves the API, replacing each
occurrence of a configured credential with `[REDACTED]`. The set is derived once
at API/worker startup from the instance configuration and stays in that
process: neither an `ssh://` host nor a Machine ever receives it.

The set covers credential fields whole; the credential-shaped leaves of a JSON
document a member substitution selects from, with their JSON-escaped spellings;
`POSTGRES_URL`, its password, and `PGPASSWORD`; substitutions in provider and
remote MCP headers and in stdio MCP `command`, `args`, and `env` values; the
userinfo and credential-shaped query values of provider and remote MCP URLs, as
written and percent-decoded; and literal header values under a credential-shaped
name. A stdio MCP `command` or `args` interpolation is therefore redacted from
bash output, so a non-secret interpolated there (for example `{env:HOME}`) is
replaced too; write it literally. Other query values and a URL's endpoint stay
unredacted.

The bound is applied on raw positions. The host and an `ssh://` capture keep a
lookahead of the longest member past the byte bound, so a member that starts
before the bound is found whole and leaves a marker. When llame itself cut the
capture (a capture or transport limit, or a timeout), the incomplete member
prefix at the cut is dropped rather than shown. A Machine keeps no lookahead, so
a member its 32,000-unit bound cut is dropped without a marker. A command that
exits on its own keeps any partial value it printed itself.

Matching is exact substring replacement, so an encoded or split form (`base64`,
`cut`, or a value assembled from pieces) is not matched. Native `read`/`grep`,
another tool's result, and a Workspace's own `.mcp.json` secrets are outside
this set. The set is a boot snapshot: a credential rotated after startup is not
a member until the next API/worker start. An 8-character floor applies only to
the database password, `PGPASSWORD`, and a URL userinfo username, so a shorter
one printed on its own is not redacted and the database password is redacted
only inside the whole `POSTGRES_URL`. Every other member counts at any nonblank
length, so a short or common value in a credential position over-redacts; write
non-secrets literally. Non-credential configuration values such as
`knowledge.root` or a port are not members and survive redaction.

Redaction blocks accidental verbatim echo only. It does not stop a model that
intends to exfiltrate through encoded or split output; the permission policy and
process isolation remain the controls for that.

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
