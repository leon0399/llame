# Design

## Context

See proposal.md for motivation. Facts were inspected on the remote-Machines
stack top and re-checked against `master` `c9c70488` after that stack merged;
the cited files are unchanged between the two. Facts that shape the approach:

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

More facts that constrain resolution and scripts (the `permissions/…` paths
are relative to `apps/api/src/tools/`):

- `evaluateToolPermission` and `previewToolPermission` are synchronous and
  run before the per-call timeout wrapper (`tools/runner.ts:360-398`);
  preview is called synchronously from `runs/run-execution.service.ts:1562,
2672, 2919`, and prompt imports never plan an unknown scheme
  (`prompt-imports.ts:238-247`). `bypass` mode evaluates no group
  (`apps/api/src/tools/permissions/admit.ts:11`). When Workspace projection
  changed an argument,
  `runner.ts:299` evaluates only the projected text.
- The evaluator never visits object keys (`permissions/value-selection.ts:43-46`),
  and `bash` accepts any `env` key (`tools/bash.ts:318`); local spawn passes
  keys as data. `admitManagedBash` holds the local `cwd` check, the input
  bound, the process slot, and the base-env refusal
  (`packages/bash-executor/src/execute.ts:67-136`), not redaction: a known
  result is redacted by `sanitizeKnownResult`
  (`packages/bash-executor/src/sanitize.ts:33`). `managedEnvironmentCollision`
  and `watchManagedChild` are not exported.
- `classifyLinkFailure` keeps an 8 KiB UTF-8 stderr head and matches
  `/permission denied/i` (`machines/machine-transport.ts:77-105`); its
  `sshDestination` wraps any destination containing `:` as `ssh://…`
  (`:176-178`).
- A local unreadable file or directory fails as `executor_unavailable`
  "File could not be read." (`packages/native-file-tools/src/read.ts:216-240`).

`ssh -G` on OpenSSH 8.9 (throwaway configs, verified in review rounds 1 and 2):

| Case                                                                          | Result                                                                  |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| alias with `User`/`Port`/`ProxyJump`                                          | printed as configured                                                   |
| no `User` / no `Port`                                                         | worker's local user name / `22`                                         |
| `%h` in `HostName`                                                            | expanded                                                                |
| host case in the output                                                       | lowercased in `hostname`                                                |
| `Host box` block, destination `BOX` or `Box`                                  | block not applied: literal host `box`, port `22`, worker user, no proxy |
| `Match exec`                                                                  | runs for each `ssh` invocation, the resolution and the connection       |
| unknown alias                                                                 | exit 0, resolved as a literal host name                                 |
| missing `Include`                                                             | ignored                                                                 |
| invalid option                                                                | exit 255                                                                |
| `CanonicalizeHostname yes` alone, unresolvable host                           | no DNS lookup, exit 0, literal host                                     |
| the same with `CanonicalizePermittedCNAMEs` or `CanonicalizeFallbackLocal no` | DNS lookup, exit 255 on a name that does not resolve                    |
| the same with `CanonicalDomains`                                              | DNS lookup, then fallback to the literal name with exit 0               |
| `ssh://[v6]:p` or `u@[v6]` destination                                        | usage error, or brackets kept in `hostname`                             |
| `-l u -p p -- 2001:db8::1`                                                    | correct user, host, port                                                |

## Goals / Non-Goals

**Goals:**

- One SSH safety configuration for both remote schemes.
- Nothing installed on the remote host.
- Permission decisions on the address the connection actually uses.

**Non-Goals:**

- A host registry, status table, or probe job for `ssh://` destinations.
- Reusing Machine sessions, roots, or Workspace parity.

## Decisions

### D1: Shared SSH module, separate `ssh` config section

Move the safety-block renderer, generated-file lifecycle, spawn seam, and
stderr classification out of `apps/api/src/machines` into a shared SSH module
that both Machines and `ssh://` call; Machine behavior is unchanged. The
Machine command tail and `sshDestination` stay in the Machine connector. The
module adds a one-shot runner for `ssh://`: byte-exact stdout up to a caller
bound, bounded stderr, marker handling (D4), deadline, and abort. Its
classifier extends the shared one with `config`, `client_missing`,
`session_lost`, and missing-interpreter branches, and matches authentication
failure as `Permission denied (` so remote error text cannot pose as it.

A top-level `ssh` section with the same three keys and defaults as
`machines.ssh` enables the locator, validated by the same loader functions.

Alternatives: read `machines.ssh` (couples enabling `ssh://` to declaring
Machines); a standalone transport copy (two host-key policies drift).

The `ssh` section also accepts `identityAgent` (`SSH_AUTH_SOCK`, which OpenSSH
reads from the worker's environment, or a literal socket path). Set, it
replaces `IdentityAgent none` in the `ssh://` generated configuration only;
`ForwardAgent no` stays, and Machines keep `IdentityAgent none`. Leo chose it on
2026-10-21 so a personal instance can use the operator's agent keys. The cost:
every key in that agent authenticates to every model-chosen destination that
passes the permission rules and the pinned host keys, so the operator page
pairs it with a dedicated `knownHostsFile` and host-scoped allows.

### D2: Authority and path grammar

`ssh://[user@]host[:port]/<path>`, scheme case-insensitive. Host: a name or
IPv4 literal of `[A-Za-z0-9._-]` not starting with `-`, or a bracketed IPv6
literal of hex digits, `:`, and `.` with no zone. User: `[A-Za-z0-9._-]` not
starting with `-`. Port 1 to 65535. A password, `%`, an empty user or port, or
any other character is `invalid_path` before any process starts. The strict
set keeps model text out of `%h`/`%u` expansions in operator `Match exec` and
`ProxyCommand` (CVE-2023-51385 class) whatever OpenSSH the worker has. The
path follows the `machine://` rules (absolute, `%XX` decoded once to UTF-8,
no literal `?`, `#`, backslash, or control character, no encoded `/` or NUL);
a `read` selector splits off as for local paths. `ssh://` and `ssh:///` return
a fixed explanation and start nothing.

The host is lowercased before the resolution and the connection, because
OpenSSH matches a `Host` block against the raw destination with case: with a
`Host box` block, the destination `BOX` skips the block and resolves as the
literal host `box` with the default port, the worker user, and no jump. A
model-chosen spelling can then reach a destination other than the alias that
the allow names. Lowercase first means a lowercase alias always applies, and a
`Host BOX` block never does; the operator page says to write aliases in
lowercase.

Every ssh invocation passes the destination as the bare host (IPv6
unbracketed) after `--`, with `-l <user>` and `-p <port>` only when written;
`sshDestination` is not reused, because OpenSSH rejects `ssh://[v6]:p` and
keeps brackets in `u@[v6]`.

### D3: Resolution, admission order, and binding

`runTool` gains an asynchronous step before `evaluateToolPermission`:

1. Parse the locator (`read` path or `bash` `cwd`). Grammar errors stop here.
2. Evaluate rejects on the submitted arguments with the locator field replaced
   by the submitted text (for `read`, the selector removed). The other
   arguments — `bash`'s `command` and `env` — stay as submitted. A match
   refuses; nothing is resolved, so a rejected locator runs no `Match exec`.
3. Run `ssh -F <generated> -G [-l u] [-p p] -- <host>` with a 5 s deadline,
   the call's abort signal, and a 64 KiB output bound. Read `user`,
   `hostname`, `port`. Failure or deadline is `ssh_unavailable` reason
   `config`; abort is the cancelled result. The included configuration can
   make this step resolve DNS (`CanonicalizePermittedCNAMEs`,
   `CanonicalDomains`, or `CanonicalizeFallbackLocal no` with
   `CanonicalizeHostname`), and a name that does not resolve is this same
   `config` failure. Resolution also runs in `bypass` mode, because execution
   binds to it.
4. Evaluate the group on the same arguments with the locator field replaced by
   the resolved locator
   `ssh://<user>@<hostname>:<port><decoded path>` (IPv6 bracketed, `.`, `..`,
   and trailing separators kept), so rejects and the allow both see it,
   including all-fields rejects. `ssh://` gets its own two-pass branch and
   does not go through Workspace projection, so `runner.ts:299` does not skip
   the submitted text.
5. Execution connects with `-o HostName=<hostname> -o Port=<port>
-o User=<user> -- <host>`, where `<host>` is the lowercase host that step 3
   resolved, so the checked address is the address used, and `Host`-scoped
   `ProxyJump` and identities from the included configuration match the same
   name in both steps. A `Match host` criterion does not: OpenSSH tests it
   against `HostName` when one is set, so it sees the submitted name in step 3
   and the resolved address in step 5. The address stays pinned either way;
   only the route or identity a `Match host` block selects can differ, so the
   operator page tells operators to scope jump hosts and identities with
   `Host`.

The synchronous preview path treats `ssh://` as refused; no current preview
caller can produce one.

Alternatives: lexical matching of the submitted text (an alias bypasses an
address reject); connecting to the resolved address as the destination (drops
`Host`-scoped settings); re-resolving at connect time (`Match exec` conditions
can change the answer).

### D4: Remote scripts on stdin with markers

Every operation runs `ssh ... -T -- <host> sh -s` (reads) or `... bash -s`
(`bash`) and writes a fixed script and its single-quoted arguments to stdin,
then closes it; no model text reaches the remote argv. The whole script is one
`{ ...; }` group, so the shell parses it before running anything. Each call
draws a random nonce:

- The script prints `<nonce>:start` on stdout and stderr once its
  preconditions hold. The hub discards everything before it, so login-shell
  startup output is neither content nor charged to a content bound. Those
  bytes have their own 64 KiB allowance (`SSH_READ_NOISE_BYTES`): the stdout
  bound is the content limit plus that allowance, and a transfer that reaches
  the bound is an unfinished read, never truncated content.
- On exit it prints `<nonce>:end:<status>` on stderr. A result is complete only
  with that trailer; its status is authoritative, so a remote `exit 255` is
  not mistaken for an ssh failure.
- A failed precondition prints `<nonce>:refuse:<kind>` instead of the start
  marker (D5, D6).

Without a start marker, classification is from the client: spawn `ENOENT`
(`client_missing`), host-key failure, `Permission denied (`, connect
failure or timeout, exit 127 with the login shell's "not found" for `sh` or
`bash`, or Windows shell text, each a typed refusal. A transfer that reaches
its stdout bound before the marker is an unfinished read (`executor_unavailable`,
"The remote read did not finish"). Any other pre-marker failure is
`ssh_unsupported_host` ("the remote account ran no llame script"), covering
forced commands and `nologin`. A start marker without a trailer is
`session_lost` for `read` and `outcome_unknown` for `bash`; for `bash` this
also covers a deadline or a cancellation that stopped the local `ssh` before
the marker reached the hub, because the script may already have run. Only the
pre-spawn check in `runTool` reports a known cancellation.

stderr keeps a bounded head plus, when the caller asks for one, a bounded
tail. The head and the tail are adjacent in the stream, so they join with no
separator: a marker or trailer split across the head bound stays whole. Only
bytes the tail dropped are an overflow. `bash` keeps `3 × outputBound` bytes
and `read` keeps the noise bound, so a chatty command or a noisy login shell
still delivers its trailer.

Alternative: a separate probe with a cached capability record (OMP); it costs
an extra connection per host per worker and needs invalidation.

### D5: Reads

Preconditions, before the start marker: `test -e` (else `unreadable` when the
nearest existing ancestor of the path is a directory without search
permission — a path inside a directory the user cannot enter fails the
traversal, not the leaf — and `not_found` otherwise), then for a directory `test -r && test -x` (else refuse
`unreadable`), for a non-regular file refuse `not_regular_file` without
opening it, for an unreadable file refuse `unreadable`. `unreadable` maps to
the local `executor_unavailable` "could not be read" result.

- Regular file: `head -c 1048577`. More than 1 MiB is `file_too_large`;
  invalid UTF-8 is `invalid_utf8` (NUL is valid, as locally). Selectors apply
  on the hub through the existing in-memory line source, so numbering,
  windows, and bounds match local reads.
- Directory: a glob loop over `*`, `.[!.]*`, `..?*` prints each existing entry
  as a type letter (`d`, `l`, `f`) and its name, NUL-terminated, stopping
  after the local traversal budget plus one (10,001) entries. The hub sorts
  that set in the local order first, and only then applies the 1,000-entry
  limit: an unsorted subset would drop a directory or hidden entry that the
  local order puts first. A set above the budget (10,001 collected entries)
  fails closed with the local `directory_too_large` error and the collected
  count, as a local over-budget directory does, rather than a shortened list.
  Within the budget the hub renders the local listing formatter and slicing,
  one level deep, links marked without targets (the `kb://` listing
  precedent), keeping the first 1,000 and then a "more entries exist" line.
  NUL termination keeps newline-bearing names one entry. The stdout bound is
  the directory transfer bound plus the noise allowance (about 2.6 MB),
  separate from the 1 MiB file bound; a transfer that stops at the bound is an
  unfinished read, never a shortened list.

Reads record no native attempt.

Alternatives: `ls -1Ap | head` (exit 141 on a large directory, empty success
on an unreadable one, newline names split); a two-level listing matching the
local budget (unbounded remote traversal for the first iteration).

### D6: `bash`

`cwd` must be one `ssh://` path without a selector. `env` keys must match
`[A-Za-z_][A-Za-z0-9_]*`, must not name a managed base variable, and keys and
values must hold no NUL; violations are refused by the admission before the
destination resolves, so no process starts. A `command` that holds NUL is
refused for the same reason: `bash -s` drops NUL, so `r\0m` would run as `rm`
after a reject that only saw the submitted text. The script runs
`cd -- <cwd>` as a precondition (failure prints `<nonce>:refuse:cwd`, mapped
to the local unusable-working-directory result with no command run), prints
the start markers, then runs
`( export KEY=<single-quoted value>; ...; eval <single-quoted command> ) </dev/null`
and prints the end trailer with that subshell's status. Each marker carries
the literal quoted nonce, never a shell variable, so an `env` key named `p`
or `s` cannot change a frame or the directory the script entered.

`packages/bash-executor` exports the base-variable check and the output
sanitizer for reuse; the process slot is the same one local `bash` uses, so a
worker runs one `bash` at a time whatever its target. The local output bound
and the 300 s budget apply. The input bound applies to the text of the model
(`command`, `cwd`, `env`) exactly as for a local call, not to the generated
script, which carries the framing and the quoting the model did not write.
The call records an unbound native attempt before spawning SSH, as Machine
`bash` does; its branch sits before the local executor gate in `tools/bash.ts`,
including inside a Machine Workspace, where an explicit `ssh://` `cwd` is no
longer `invalid_path`. After that durable write the call checks the deadline
and the abort signal again; a stop found there is recorded on the attempt as a
known result and no `ssh` starts.

A timeout or cancellation once SSH runs ends the local `ssh`: `outcome_unknown`
unless a typed pre-session failure is already classified. Proven remote stop
is #1369.

### D6a: Prompt imports

An `ssh://` marker plans as a `direct` prompt-import target, like `skill://`
and web: no probe (a probe would cost a connection) and no synchronous
pre-evaluation (resolution is asynchronous). The single `read` goes through
`runTool`, so it gets the two-pass admission, the audit events, and the
resolved-connection binding of a model call. The system read context carries
the SSH client for this. A denied or failed target is named as not imported.

### D7: Offer, Workspaces, and descriptions

The candidate resolver offers `bash` when the `ssh` section is present.
`enter_workspace` refuses `ssh://` with `invalid_path`, and Workspace
projection never produces it. `edit` and `write` return
`unsupported_operation`. `read.md` and `bash.md` state, unconditionally as for
Machines, that `ssh://` runs as the remote login user with the instance's SSH
identity and no isolation between llame users. `bash.md` gains the
working-directory guidance required by the `bash-execution` delta.

## Threats

- **T1. Model-chosen destinations.** Any destination the instance's keys
  authenticate to is addressable; permission rules and the pinned
  `known_hosts` are the gates. A whole-tool `read: allow: true` admits every
  pinned host; the operator page gives host-scoped allows.
- **T2. Injection.** D2's character set, `--`, `-l`/`-p`, single-quoted
  arguments on stdin, and D6's key grammar keep model text out of ssh options,
  `%h`/`%u` expansions, and remote shell syntax outside `command`.
- **T3. Operator configuration side effects.** Resolution runs `Match exec`
  commands for every locator that passes the submitted-text rejects, including
  ones the resolved text then rejects, and the connection runs them again, so
  an operator command runs twice for one operation. Resolution resolves DNS
  only when the included configuration sets `CanonicalizePermittedCNAMEs`,
  `CanonicalDomains`, or `CanonicalizeFallbackLocal no` with
  `CanonicalizeHostname`.
- **T4. Remote orphans.** A timed-out command can keep running remotely until
  it next writes or exits; reported as `outcome_unknown`.
- **T5. No isolation between users.** All users act with one SSH identity;
  hub-held native attempts stay owner-scoped.
- **T6. Included configuration.** As for Machines, `ProxyCommand`, identities,
  and `SendEnv` from the included file apply as written.

## Risks / Trade-offs

- [Handshake per operation] → Accepted; measured before #1366.
- [1 MiB cap below local behavior] → The error names `bash`; #1364 lifts it.
- [Listing differs from local: one level, 1,000 entries, no link targets] →
  Stated in the spec and the locator reference. A directory above the local
  traversal budget fails as a local one does, so no listing is ever a
  re-ordered subset.
- [`..` kept in the resolved text admits `/var/log/../../etc/shadow` under a
  `/var/log/` allow] → Same as local and Machine projection; the operator page
  shows the anchored reject.
- [Size] → Five implementation layers, each estimated near the budget from the
  Machine layers' measured size; re-estimated at each boundary.

## Migration Plan

Additive. Without the `ssh` section nothing changes. D1's move keeps Machine
behavior; the Machine suites, with import-path changes only, are its
regression evidence. Rollback removes the section.

## Open Questions

- Exact Windows and Alpine "not found" texts for D4's pre-marker
  classification; settled by fixtures without changing the contract.
