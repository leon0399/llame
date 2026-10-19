# Design

## Context

See proposal.md for motivation. Facts at the inspected base
(`remote-machines-stack/status-bar`, `c258d586`) that shape the approach:

- Locator dispatch: `executeNative` decodes a `file:` alias, then
  `parsePathScheme` routes any `scheme://` to `executeLocator`
  (`apps/api/src/tools/native-files.ts:86-116`), which branches on `machine`,
  `kb`, `skill`, `media`, and `http(s)` and otherwise returns `invalid_path`
  "This path scheme is not available." (`:117-145`, `:528-533`). Skill
  locators refuse mutation with `unsupported_operation` (`:338-341`).
- Permission projection: `projectNativeFilePath` canonicalizes Machine, `kb`,
  `skill`, and web locators (`permissions/locator-projection.ts:103-148`);
  `runner.ts:283-330` refuses on a reject of the submitted or the projected
  text and decides the allow on the projected text. `bash` `cwd` is projected
  separately by `projectBashArguments` (`runner.ts:201-227`). All projection
  is synchronous text work today.
- SSH transport: `machine-ssh-config.ts:54-99` renders a `Host *` safety block
  (pinned `UserKnownHostsFile`, `GlobalKnownHostsFile none`,
  `StrictHostKeyChecking yes`, `BatchMode yes`, `IdentityAgent none`,
  `ForwardAgent no`, `ControlMaster no`, `ControlPath none`,
  `PermitLocalCommand no`, `UpdateHostKeys no`, connect and alive timeouts,
  optional `IdentityFile`) followed by `Include <configFile>`, written 0600 in
  a 0700 temporary directory (`:107-131`). `machine-transport.ts:184-213`
  spawns `ssh -F <file> -T -- <destination> llame-machine serve --stdio`;
  `:88-99` classifies stderr into `host_key_mismatch`, `auth_failed`,
  `unreachable`, and `session_lost`. Only the command tail and the framed
  session are Machine-specific.
- Config: `machines.ssh` has `knownHostsFile` (default `~/.ssh/known_hosts`),
  `identityFile`, `configFile`, resolved relative to the config file with
  `~/` expansion and no interpolation (`config-loader.ts:890-993`); the
  section is absent from `BUILT_IN_DEFAULTS` (`llame-config.ts:785-833`).
- `bash`: bounds 32,000 output, 8,000 input, 300,000 ms, one process
  (`tools/bash.ts:50-63`); a proven group stop is `timed_out`, an unproven one
  `outcome_unknown` (`packages/bash-executor/src/watch.ts:138-184`); the base
  environment names are `PATH LANG HOME TMPDIR USER LOGNAME TERM`
  (`packages/bash-executor/src/env.ts:1-47`). Local `bash` records a bound
  native attempt (`tools/bash.ts:276-308`); Machine calls record an unbound one
  (`tools/machine-call.ts:220-291`).
- Reads: 2,000 lines and 16,000 code units per result
  (`packages/native-file-tools/src/source-lines.ts:5-6`); local reads have no
  byte ceiling. `stream-read.ts` already has an in-memory line source for text
  in hand (`:494-498`). Error types `not_found`, `not_regular_file`,
  `invalid_utf8`, `invalid_path`, `invalid_selector` exist.
- Tool offer: `read` is always offered; `bash` only with
  `tools.nativeExecutorId` or Machines
  (`knowledge/knowledge-tool-candidate-resolver.ts:96-106`).
- Prompts: the `ssh://` bullet in `prompts/tools/read.md:92` is OMP text inside
  a `{{!-- --}}` comment; templates cannot condition on configuration
  (`instance-config/prompt-loader.ts:163-166,806-830`), so Machine wording is
  unconditional.
- Test fixture: `apps/api/src/testing/machine-sshd` runs a Debian sshd with
  `bash`, pinned per-container host keys, and a bastion; the box key is a
  forced command, so `ssh://` tests need their own plain-login key line.

Prior art (research notes in `docs/research`, cited in the #936 thread):

| Product          | Transport                   | Files                              | Remote stop         | Host keys                 |
| ---------------- | --------------------------- | ---------------------------------- | ------------------- | ------------------------- |
| OMP `ssh://`     | system `ssh`, ControlMaster | `head -c 1MiB+1`, `ls -1Ap`, shell | local kill only     | `accept-new`              |
| Hermes / Loki    | system `ssh`, ControlMaster | `sed`/`cat`/`base64`               | local kill only     | `accept-new`              |
| OpenClaw sandbox | system `ssh`, per call      | remote Python helper               | channel close       | strict, configurable      |
| Orca rung D      | `ssh2` + system `ssh`       | SFTP                               | relay process sweep | known_hosts + trust store |
| Ansible `smart`  | system `ssh`, ControlMaster | sftp → scp → `dd`                  | n/a                 | OpenSSH                   |

Verified locally (OpenSSH 8.9): `ssh -G` evaluates `Match exec` blocks while
resolving a destination, without connecting.

## Goals / Non-Goals

**Goals:**

- One SSH safety configuration for both remote schemes.
- Nothing installed on the remote host.
- Permission decisions on the address ssh will actually connect to.

**Non-Goals:**

- A host registry, status table, or probe job for `ssh://` destinations.
- Reusing Machine sessions, roots, or Workspace parity.

## Decisions

### D1: Shared SSH module, separate `ssh` config section

Move the safety-block renderer, temporary-file lifecycle, spawn seam,
destination formatting, and stderr classification out of `apps/api/src/machines`
into a shared SSH module that both Machines and `ssh://` call. The Machine
command tail stays in the Machine connector. A top-level `ssh` section with
the same three keys and defaults as `machines.ssh` enables the locator; it is
validated by the same loader functions.

Alternatives: read `machines.ssh` (couples enabling `ssh://` to declaring
Machines); a standalone copy of the transport (two host-key policies drift).

### D2: Authority and path grammar

`ssh://[user@]host[:port]/<path>`: host is a DNS name or IPv4 literal of
`[A-Za-z0-9._-]` not starting with `-`, or a bracketed IPv6 literal of hex
digits, `:`, and `.`; user is `[A-Za-z0-9._-]` not starting with `-`; port is
1 to 65535. A password, an empty user or port, or any other character is
`invalid_path` before any process starts. The strict set keeps model text
out of `%h`/`%u` expansions in operator `Match exec` and `ProxyCommand`
(CVE-2023-51385 class) regardless of the worker's OpenSSH version. The path
follows the `machine://` path rules: absolute, `%XX` decoded once to UTF-8,
no literal `?`, `#`, backslash, or control character, no encoded `/` or NUL;
a `read` selector splits off as for local paths. Bare `ssh://` (or
`ssh:///`) returns a fixed explanation and starts nothing.

Alternative: OMP's leading-`-` check only; it leaves injection safety to the
OpenSSH version.

### D3: Resolution for permissions through `ssh -G`

Before permission evaluation, the hub runs `ssh -F <generated> -G -- <destination>`
and reads `user`, `hostname`, and `port`. The resolved locator is
`ssh://<user>@<hostname lowercased>:<port><decoded path>`, IPv6 bracketed.
`read` rules see it without the selector; `bash` rules see it as the `cwd`.
The reject-either/allow-resolved rule of `runner.ts:283-330` applies. A
failed resolution is `ssh_unavailable` (reason `config`) and no connection is
made. Execution connects with the submitted destination so the included
configuration's `ProxyJump` and identities apply.

This is the first projection that spawns a process. It is local evaluation,
but it runs operator `Match exec` commands and may perform DNS lookups when
the included configuration enables `CanonicalizeHostname`; the operator page
states both.

Alternatives: lexical matching of the submitted text (an alias bypasses an
address reject); connecting to the resolved address (drops `Host`-scoped
`ProxyJump` and identities from the included configuration).

### D4: Remote scripts on stdin, with a start marker

Every operation is `ssh -F <generated> -T -- <destination> sh -s`
(reads) or `... bash -s` (`bash`), with a fixed script and its arguments
written to stdin, then stdin closed. Paths and values are single-quoted by one
helper; no model text reaches the remote argv. The script prints a fixed start
marker on stderr before doing anything else; the hub strips it. No marker:
the operation never started, and the failure is classified from stderr and
exit status as a typed refusal. Marker seen: the remote work started, and the
result follows D5 or D6.

- `sh` missing (exit 127 with the login shell's "not found") or Windows
  shell output → `ssh_unsupported_host` naming a POSIX shell.
- `bash` missing → `ssh_unsupported_host` naming `bash`.
- `host_key_mismatch`, `auth_failed`, `unreachable` from the shared
  classifier, and a missing `ssh` client → `ssh_unavailable` with that reason.

Alternative: a separate probe with a cached capability record (OMP). It costs
an extra connection per host per worker and needs invalidation.

### D5: Reads

The read script classifies the path with `test -d`/`test -f`/`test -e`,
then streams `head -c 1048577` for a regular file or a bounded one-level
listing for a directory. The hub refuses more than 1,048,576 bytes with
`file_too_large`, a NUL byte or invalid UTF-8 with `invalid_utf8`, a special
file with `not_regular_file`, and a missing path with `not_found`. Selectors
apply on the hub to the text in hand through the existing in-memory line
source, so numbering, windows, and result bounds match local reads. A
directory lists names sorted in the C locale with a `/` marker for
directories, at most 1,000 entries, then a line stating more exist. Reads
record no native attempt.

Alternative: `cat` and size checks on the hub (unbounded transfer).

### D6: `bash`

`cwd` must be one `ssh://` path without a selector. The script runs
`cd -- <cwd> || exit`, exports each `env` entry, then evaluates the command
text. `env` keys that name a managed base variable are refused as locally.
The command's stdin is the closed script stream. The hub applies the local
output and input bounds, the 300 s budget, and the one-process admission
bound. The call records an unbound native attempt before the spawn, as
Machine `bash` does. Exit status is the command's. A timeout, cancellation,
or ssh exit after the start marker ends the local `ssh` and returns
`outcome_unknown`; a proven stop is #1369.

### D7: Offer, Workspaces, and disclosure

The candidate resolver offers `bash` when the `ssh` section is present.
`enter_workspace` refuses `ssh://` with `invalid_path`; Workspace projection
never produces it, and inside a Machine Workspace an explicit `ssh://`
locator is unaffected. `edit` and `write` return `unsupported_operation`.
`read.md` and `bash.md` state, unconditionally as for Machines, that
`ssh://` reaches a remote host as its login user with the instance's SSH
identity and no isolation between llame users. `bash.md` also gains the `cwd`
guidance: inside a Workspace omit `cwd` or pass a relative one; outside,
pass an absolute `cwd`; never `cd` inside `command`.

## Threats

- **T1. Model-chosen destinations.** Any destination the instance's keys
  authenticate to is addressable; the permission rules and the pinned
  `known_hosts` are the gates. The recommended portable policy
  (`read: allow: true`) admits every pinned host; the operator page gives
  host-scoped allows.
- **T2. Injection through the authority.** D2's character set and the `--`
  separator keep model text out of ssh options and `%h`/`%u` expansions.
- **T3. Operator configuration side effects.** `ssh -G` runs `Match exec`
  commands for every attempted locator, including ones a rule later rejects.
- **T4. Remote orphans.** A timed-out command can keep running on the remote
  host until it next writes or exits; reported as `outcome_unknown`.
- **T5. No isolation between users.** All users act with one SSH identity.
  Hub-held native attempts stay owner-scoped.
- **T6. Included configuration.** As for Machines: `ProxyCommand`, identities,
  and `SendEnv` from the included file apply as written.

## Risks / Trade-offs

- [Handshake per operation] → Accepted; measured before #1366.
- [1 MiB cap below local behavior] → Error names `bash` as the path for large
  files; #1364 lifts it.
- [Alias resolved twice, config edited between] → The included file is
  operator-owned; accepted and documented.
- [Size] → Three implementation layers, each estimated near the budget;
  re-estimated at each boundary.

## Migration Plan

Additive. Without the `ssh` section nothing changes. The Machines refactor in
D1 moves code without changing behavior; the Machine integration suite is its
regression evidence. Rollback removes the section.

## Open Questions

- Whether Debian's and Alpine's "command not found" texts suffice for D4's
  `sh`/`bash` classification, or the marker exit code alone is enough; settled
  by the integration fixture.
