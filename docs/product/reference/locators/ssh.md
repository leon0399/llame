---
summary: "ssh:// locators: reads of files and one directory level on a host reached over the operator's SSH configuration"
read_when:
  - you are passing an ssh:// locator to read
  - you need to know what an ssh:// read returns or why it failed
spec: native-file-tools
configured_by: ../../operator/ssh.md
---

# ssh locators

**Experimental.** An `ssh://` locator reads a file or one directory level on a
host the operator's own SSH configuration reaches, with nothing installed on
that host. The behavior contract is the
[ssh-locator spec](../../../../openspec/changes/ssh-locator/specs/ssh-locator/spec.md);
the capability named above is the closest one already synced into
`openspec/specs`.

## Form

An ssh locator is `ssh://[user@]host[:port]/<absolute path>[:selector]`.

- The scheme matches in either case and is reported in lowercase.
- `host` is a name or IPv4 literal of `[A-Za-z0-9._-]`, or an IPv6 literal in
  brackets of hex digits, `:`, and `.`. It must not begin with `-`, and a zone
  (`%25eth0`) is refused.
- `user` matches `[A-Za-z0-9._-]` and must not begin with `-`. A password in
  the authority is refused.
- `port` is 1 to 65535. A written but empty port is refused rather than
  defaulted.
- The path is absolute. Its percent escapes decode once to UTF-8 under the
  [`file:` alias rules](host-path.md#form): a literal `?`, `#`, `\`, C0 control,
  or DEL, `%2F`, and `%00` are refused.
- `[:selector]` is the ordinary read selector (see [selectors](../selectors.md)),
  split off before the path decodes. In a path, write a literal `:`, `?`, `#`,
  or `%` as `%3A`, `%3F`, `%23`, or `%25`.

A result reports the submitted locator, re-encoded canonically: lowercase
scheme and host, a bracketed IPv6 literal, and the path encoded once. Nothing
here resolves a destination; a locator outside this grammar is `invalid_path`
before any process starts.

Two forms are an explanation rather than a path:

| Form      | Addresses                                                      |
| --------- | -------------------------------------------------------------- |
| `ssh://`  | the fixed message on how to address hosts; it never lists them |
| `ssh:///` | the same message                                               |

## Accepted by

| Tool              | Locator form | Mutable |
| ----------------- | ------------ | ------- |
| `read`            | path         | no      |
| `edit`, `write`   | none         | no      |
| `enter_workspace` | none         | no      |

`edit` and `write` refuse an ssh locator with `unsupported_operation` and no
effect, and `enter_workspace` refuses it with `invalid_path`; neither starts a
process. Remote `bash` is not part of this revision.

## Authority

An ssh read runs on the remote host as the login user that OpenSSH resolves for
the destination, over the operator's SSH configuration and the instance's own
SSH identity. There is no sandbox on that host and no isolation between llame
users: every user whose permissions admit the locator has the same remote
authority, and anything else that user may read on that host is reachable the
same way. Hub-held state stays owner-scoped, and an ssh read records no native
attempt because it changes nothing.

The address the connection uses is the address the permission decision saw: the
destination resolves through the local SSH configuration first, and the
connection binds that resolved user, hostname, and port while still passing the
submitted host to `ssh`, so `Host`-scoped identities and jump hosts apply.

## Behavior

Resolution is local and never connects: the hub evaluates the SSH configuration
for the submitted destination, and a failure or a deadline is `ssh_unavailable`
with reason `config`. Rejects run on the submitted text first, so a rejected
locator runs no `Match exec`; then the group is evaluated on the resolved text.
The connection is one `ssh` process with `sh -s` and the read script on stdin,
and each read draws a new marker:

- The script checks its preconditions, then prints the start marker. Every byte
  before it — login-shell startup output, banners — is discarded and counts
  against no bound.
- File content follows the marker; the end trailer on stderr ends the read. A
  marker with no trailer is `ssh_unavailable` with reason `session_lost`.
- A failed precondition prints a refusal instead: a missing path is
  `not_found`, a FIFO, socket, or device is `not_regular_file` and is never
  opened, and a path the login user cannot read is the local `executor_unavailable`
  "could not be read" result. A path inside a directory the login user cannot
  enter is the same "could not be read" result: the traversal fails before the
  leaf, as it does locally, and the path is not reported as missing.

A symbolic link at the leaf is followed: a link to a regular file reads the
target, and a link to a directory lists it. Selectors, line numbers, Markdown
handling, and the result bound are the hub's own, so they match a local read of
the same text. NUL is valid text, as locally.

## Bounds

A regular file transfers at most 1 MiB plus one byte; a larger file is
`file_too_large`. A directory list contains at most 1,000 entries. One
directory transfer collects at most the local 10,000-entry traversal budget
plus one, so a directory within that budget lists exactly what a local read
would list first, and one past it is `directory_too_large` with the local
message instead of a subset of its entries. One read shares the call's time
budget, capped at 60 seconds, and one `ssh` process per operation — there is no
connection reuse. A transfer that stops at its byte bound is an error, never a
shortened success.

## Listing

A directory read shows the entries directly in it, one level deep, with hidden
entries but not `.` and `..`. The header, ordering, entry form, and selector
rules are those of a [local directory listing](host-path.md#listing), except
that a symbolic link is marked `@` without its target — the target is a host
path the model did not address — and no child level is read. Past 1,000 entries
the list ends with a `… more entries exist` line and `truncated` is true. A
directory the login user cannot read is an error, never an empty list.

## Errors

`file_too_large` is specific to this scheme: no other read refuses a file at a
byte bound. `invalid_utf8`, `not_regular_file`, `not_found`,
`directory_too_large`, and `executor_unavailable` mean what they mean for a
local read of the same bytes.

`ssh_unavailable` carries one reason: `host_key_mismatch` for a hop whose key is
not in the pinned file, `auth_failed` for a credential refusal, `unreachable`
for a host that did not answer or refused the connection, `config` for a
configuration that does not evaluate, `client_missing` for a worker without an
`ssh` client, and `session_lost` for a read that stopped after its marker.

`ssh_unsupported_host` means the host cannot run an llame script: it has no
POSIX `sh` (the message names that requirement, and a Windows login shell is
this case), or its account ran something else instead — a forced command or
`nologin`. A malformed locator is `invalid_path`. Every other failure is the
shared native vocabulary in [read](../tools/read.md#errors).

## Configured by

The operator enables the locator with a top-level `ssh` section, pins every
hop's host key, and writes the permission rules; without that configuration
`ssh://` is an unknown scheme and no process starts. See
[SSH locators](../../operator/ssh.md). The `read` group gates each call, and a
rule is matched against the resolved locator
`ssh://<user>@<hostname>:<port><absolute path>`, so a local `^/` rule never
admits one.
