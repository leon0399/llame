# Proposal

## Why

Exploring a server llame does not own (reading its configuration and logs,
checking service state) today means `bash` running `ssh` by hand. That call is
unbounded, matched by permissions only as opaque command text, and invisible
to the `read` group. Remote Machines (`openspec/changes/remote-machines`) solve
the project-work case but need the `llame-machine` daemon on the box; external
hosts, appliances, and boxes the operator will not install Node on stay out of
reach. Issue #936 asks for an `ssh://` locator that puts such reads and
commands under the same permission and result contracts as local ones, with
nothing installed on the far side.

## What Changes

- New optional `ssh` configuration section (`knownHostsFile`, `identityFile`,
  `configFile`). Without it, `ssh://` is refused as an unknown scheme exactly
  as today and no SSH process starts.
- New locator `ssh://[user@]host[:port]/<absolute path>` accepted by `read`
  and as the `bash` `cwd`. The authority is any destination OpenSSH resolves
  through the included SSH configuration, validated against a strict character
  set before any process starts. A bare `ssh://` returns a fixed explanation
  of how to address hosts.
- Connections reuse the remote-Machines SSH transport: a generated
  configuration whose safety options (pinned host keys, strict checking, batch
  mode, no agent, no connection sharing, timeouts) override the included
  configuration. One `ssh` process per operation.
- Permission rules match the resolved locator
  `ssh://<user>@<hostname>:<port><path>`, obtained from local SSH
  configuration evaluation without connecting. A reject matching the submitted
  or the resolved text refuses; the allow is decided on the resolved text.
- `read` returns UTF-8 text files up to 1 MiB, applying selectors on the hub,
  and bounded one-level directory listings. Larger, binary, and special files
  fail with typed errors.
- `bash` with an `ssh://` `cwd` runs the command through `bash` on that host,
  with `env` delivered outside argv and the local output, input, and duration
  bounds. A timeout or cancellation after the command starts reports
  `outcome_unknown`.
- Missing prerequisites (no POSIX `sh`, no `bash`) and connection failures
  (host key, authentication, unreachable) are typed refusals naming the cause.
- `edit` and `write` refuse `ssh://` as an unsupported operation;
  `enter_workspace` refuses it, and Workspace projection never produces it.
- The `read` and `bash` descriptions state remote host authority. The `bash`
  description also tells the model to set `cwd` instead of `cd` inside
  `command`: omit it or pass a relative one inside a Workspace, and pass an
  absolute one outside a Workspace.
- Operator page, `ssh://` locator reference, tool reference updates, and a
  dated CHANGELOG entry.

## Assumptions, confirmed with Leo

Decided in the 2026-10-19 design session for #936:

- `ssh://` is a locator separate from `machine://`, aimed at external service
  exploration; two locators for one box are accepted.
- Any destination OpenSSH can resolve, with the permission layer deciding
  which locators are approved; host listing is deferred (#1365).
- Aliases resolve to the canonical shape, and rules are evaluated on it.
- First change ships `read` and `bash` `cwd` only; `write`/`edit` deferred
  (#1368).
- POSIX hosts with a shell only; SFTP-only and Windows hosts deferred (#1367).
- Hosts are instance-wide, gated only by permission rules.
- The SSH transport is shared with remote Machines, and this change stacks on
  that work.
- Pinned `known_hosts` with strict host-key checking.
- Authority grammar is OMP's shape, restricted to a strict character set.
- Whole-file 1 MiB read cap; remote selectors deferred (#1364).
- `bash` must exist on the remote host; `env` travels in the stdin script.
- Simplest remote stop: end the local `ssh` and report `outcome_unknown`;
  proven stop deferred (#1369).
- One `ssh` spawn per operation; connection reuse deferred (#1366).
- `ssh://` never enters a Workspace.
- No separate host probe: failures are classified from the operation itself.
- Binary and non-UTF-8 files are refused; directory listings are bounded.
- The `bash` `cwd` prompt fix ships inside this change.

Follow from those decisions but were never asked:

- The `ssh` section is the opt-in; `bash` is offered when it is present even
  without `tools.nativeExecutorId`, as Machines do.
- Remote `env` keys may not replace the managed base names (`PATH`, `LANG`,
  `HOME`, `TMPDIR`, `USER`, `LOGNAME`, `TERM`), matching the local rule even
  though the remote base is the login environment.
- Results report the submitted locator, re-encoded canonically; the resolved
  text is only for permissions.
- A directory listing stops at 1,000 entries and says more exist.
- Error types: `ssh_unavailable` (with a reason) and `ssh_unsupported_host`
  are new; `file_too_large` is new; `not_found`, `not_regular_file`,
  `invalid_utf8`, `invalid_path`, and `unsupported_operation` are reused.

## Capabilities

### New Capabilities

- `ssh-locator`: operator-enabled `ssh://` locators for `read` and the `bash`
  `cwd`, their grammar and resolution, permission matching on the resolved
  text, bounded remote reads and commands, typed failures, and disclosure.

### Modified Capabilities

None. Like `remote-machines`, the new capability states how `ssh://`
locators extend local-only argument forms in `native-file-tools`,
`bash-execution`, `tool-call-permissions`, `workspace-entry`, and
`tool-calling`; their requirement text is unchanged.

## Impact

- `apps/api/src/instance-config` (schema, loader, `RawInstanceConfig`),
  `llame.config.schema.json`.
- `apps/api/src/machines/machine-ssh-config.ts` and `machine-transport.ts`:
  the generated configuration, spawn seam, and failure classification move to
  a shared SSH module used by both schemes.
- `apps/api/src/tools/native-files.ts` (`executeLocator` gains an `ssh`
  branch), `apps/api/src/tools/bash.ts`, `apps/api/src/tools/runner.ts` and
  `permissions/locator-projection.ts` (resolved projection),
  `apps/api/src/knowledge/knowledge-tool-candidate-resolver.ts` (offer
  `bash`), `apps/api/src/tools/workspace.ts` (refuse entry).
- `apps/api/src/prompts/tools/read.md` (replace the commented OMP bullet) and
  `bash.md`.
- Tests: unit tests for grammar, projection, and script output parsing;
  Testcontainers integration tests using the remote-Machines sshd fixture with
  a plain-login key.
- Docs: `docs/product/operator/ssh.md`, `docs/product/reference/locators/ssh.md`
  and the locator index, `docs/product/reference/tools/read.md` and `bash.md`,
  `docs/product/operator/native-files.md`, `SPEC.md` §13.7, `CHANGELOG.md`.

## Non-Goals

- `write`/`edit` over `ssh://`, remote selectors, host listing, SFTP or
  Windows hosts, connection reuse, and proven remote stop (#1364 to #1369).
- Workspace entry, instruction files, skills, or MCP over `ssh://`.
- Per-user host authorization.
- Search over remote directories; remote `rg`/`grep` through `bash` covers it.

## Acceptance

- With the `ssh` section configured and a pinned host key,
  `read ssh://box/etc/hostname` returns the remote file; `read ssh://box/etc`
  lists it; `bash({ cwd: "ssh://box/tmp", command: "pwd" })` prints `/tmp`
  from the remote host.
- A `read` reject on `ssh://box@10.0.0.5:22/` refuses the same file read
  through an alias that resolves to that address.
- An unpinned host, a host without `bash`, a 2 MiB file, and an
  option-shaped authority each fail with the typed error the spec names, and
  no remote command runs for the authority or host-key cases.
- Without the `ssh` section, `ssh://` is the existing unknown-scheme
  `invalid_path` and no SSH process starts.
