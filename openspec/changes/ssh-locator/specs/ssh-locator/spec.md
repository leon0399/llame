## Purpose

Lets a Run read files on, and run `bash` commands in, a remote host addressed
by an `ssh://` locator, with nothing installed on that host, under the same
permission and result contracts as local native tools.

## ADDED Requirements

### Requirement: ssh locators exist only when the operator enables them

The configuration SHALL accept an optional `ssh` section under the closed published schema. When it is absent, an `ssh://` locator SHALL be refused as an unknown scheme exactly as today and no SSH process SHALL start. When present, `ssh://` SHALL be operator-wide: every authenticated user whose Run passes tool eligibility and permissions MAY use it.

#### Scenario: Locator refused without configuration

- **WHEN** the configuration has no `ssh` section and the model calls `read` with `ssh://box/etc/hostname`
- **THEN** the tool returns the existing unknown-scheme `invalid_path` error
- **AND** no SSH process is started

#### Scenario: Enabled locator is available to any eligible user

- **WHEN** the `ssh` section is present and two users' Runs both have a `read` allow for `ssh://box@box:22/`
- **THEN** both Runs can read from that host

### Requirement: SSH settings are validated at startup

The `ssh` section SHALL accept only `knownHostsFile`, `identityFile`, and `configFile`, each a path without interpolation, resolved relative to the configuration file with `~/` expanded. `knownHostsFile` SHALL default to the worker user's `~/.ssh/known_hosts` and `configFile` to the worker user's `~/.ssh/config`. An invalid field SHALL fail startup naming it.

#### Scenario: Interpolated path fails startup

- **WHEN** `ssh.identityFile` is `{env:KEY_PATH}`
- **THEN** startup fails naming `ssh.identityFile`

#### Scenario: Empty section uses the worker user's SSH files

- **WHEN** the configuration contains `ssh: {}`
- **THEN** host keys are checked strictly against the worker user's `~/.ssh/known_hosts` and the worker user's `~/.ssh/config` is included

### Requirement: ssh connections use llame's SSH safety options

Every SSH process an `ssh://` operation starts SHALL use the same generated configuration semantics as remote Machines: llame's safety options first, then the configured SSH configuration included. For every hop ssh itself opens, host keys SHALL come only from the pinned file with strict checking, with batch mode, no agent, no connection sharing, and connect and liveness timeouts.

#### Scenario: Unpinned host is refused

- **WHEN** the model reads `ssh://10.0.0.9/etc/hostname` and that host's key is not in the pinned file
- **THEN** the tool returns `ssh_unavailable` with reason `host_key_mismatch`
- **AND** no remote command runs

#### Scenario: Included configuration cannot weaken host-key checking

- **WHEN** the included configuration sets `StrictHostKeyChecking accept-new` for `box`
- **THEN** a read of `ssh://box/etc/hostname` still requires a pinned host key

#### Scenario: Alias and jump host come from the included configuration

- **WHEN** the included configuration resolves `box` through `ProxyJump bastion` and both keys are pinned
- **THEN** `read ssh://box/etc/hostname` returns the file from `box` through `bastion`

### Requirement: ssh locators name a strictly spelled destination

An `ssh://` authority SHALL be `[user@]host[:port]`. The host SHALL be a name or IPv4 literal of letters, digits, `.`, `_`, and `-`, or a bracketed IPv6 literal; the user SHALL use letters, digits, `.`, `_`, and `-`; neither SHALL start with `-`. The port SHALL be 1 to 65535. Anything else, including a password, SHALL be `invalid_path` before any process starts.

#### Scenario: Option-shaped host is refused before any process

- **WHEN** the model reads `ssh://-oProxyCommand=id/etc/hostname`
- **THEN** the tool returns `invalid_path`
- **AND** no SSH process is started

#### Scenario: Shell metacharacter in a user is refused

- **WHEN** the model reads `ssh://a;id@box/etc/hostname`
- **THEN** the tool returns `invalid_path` and no SSH process is started

#### Scenario: Password in the authority is refused

- **WHEN** the model reads `ssh://root:secret@box/etc/hostname`
- **THEN** the tool returns `invalid_path` stating that passwords are not accepted

#### Scenario: Explicit user, port, and IPv6 literal are accepted

- **WHEN** the model reads `ssh://deploy@[fe80::1]:2222/etc/hostname` and that host's key is pinned
- **THEN** the hub connects as `deploy` to `fe80::1` on port 2222

### Requirement: ssh locator paths are absolute and decoded once

The path after the authority SHALL be absolute. Percent escapes SHALL decode once to UTF-8; a literal `?`, `#`, backslash, or control character, an encoded `/` or NUL, and a missing path SHALL be `invalid_path`. A `read` selector SHALL split off as for local paths. A bare `ssh://` SHALL return a fixed message explaining how to address hosts and SHALL start no process.

#### Scenario: Encoded name round-trips

- **WHEN** the model reads `ssh://box/srv/a%23b.txt`
- **THEN** the remote file `/srv/a#b.txt` is read and the result locator spells it `ssh://box/srv/a%23b.txt`

#### Scenario: Bare locator explains addressing

- **WHEN** the model reads `ssh://`
- **THEN** the tool returns a message stating that any destination OpenSSH resolves may be addressed and that permissions decide which are allowed
- **AND** no SSH process is started

#### Scenario: Missing path is refused

- **WHEN** the model reads `ssh://box`
- **THEN** the tool returns `invalid_path` asking for an absolute path

### Requirement: Permission rules match the resolved ssh locator

Before permission evaluation, the destination SHALL be resolved through local SSH configuration evaluation, without connecting, to the resolved locator `ssh://<user>@<hostname>:<port><path>` with the hostname lowercased and the path decoded once. `read` SHALL be matched without its selector and `bash` on its `cwd`. A reject matching the submitted or resolved text SHALL refuse; the allow SHALL be decided on the resolved text.

#### Scenario: Alias cannot bypass an address reject

- **WHEN** a `read` reject matches `^ssh://[^/]*@10\.0\.0\.5:` and the included configuration maps the alias `prod` to `HostName 10.0.0.5`
- **AND** the model reads `ssh://prod/etc/hosts`
- **THEN** the call is refused before any connection

#### Scenario: Allow is scoped to the resolved host

- **WHEN** the only `read` allow is `^ssh://deploy@edge-1\.lan:22/var/log/` and the model reads `ssh://deploy@edge-2.lan/var/log/syslog`
- **THEN** the call is denied as having no applicable allow

#### Scenario: Local rule does not admit a remote path

- **WHEN** the only `read` allow is `^/var/log/` and the model reads `ssh://box/var/log/syslog`
- **THEN** the call is denied as having no applicable allow

#### Scenario: Encoded spelling cannot bypass a reject

- **WHEN** a `read` reject matches `/\.ssh/` and the model reads `ssh://box/root/%2Essh/id_ed25519`
- **THEN** the call is refused

#### Scenario: Unresolvable destination makes no connection

- **WHEN** local SSH configuration evaluation fails for the submitted destination
- **THEN** the tool returns `ssh_unavailable` with reason `config` and no connection is attempted

### Requirement: Remote file reads are bounded UTF-8 text

A read of a regular file SHALL transfer at most 1 MiB plus one byte and SHALL return `file_too_large` above 1 MiB. A NUL byte or invalid UTF-8 SHALL return `invalid_utf8`; a FIFO, socket, or device SHALL return `not_regular_file` without reading it; a missing path SHALL return `not_found`. Selectors, line numbering, and result bounds SHALL match a local read of the same text.

#### Scenario: Text file is read with a selector

- **WHEN** the model reads `ssh://box/etc/os-release:2-3`
- **THEN** the result contains lines 2 and 3 numbered as a local read numbers them

#### Scenario: Oversized file is refused

- **WHEN** the remote file is 2 MiB
- **THEN** the tool returns `file_too_large` naming the 1 MiB bound and `bash` as the way to inspect it
- **AND** no more than 1 MiB plus one byte is transferred

#### Scenario: Binary file is refused

- **WHEN** the model reads `ssh://box/usr/bin/ls`
- **THEN** the tool returns `invalid_utf8`

#### Scenario: FIFO does not block

- **WHEN** the remote path is a FIFO
- **THEN** the tool returns `not_regular_file` without opening it

### Requirement: Remote directory reads are bounded listings

A read of a directory SHALL return its immediate entries, including hidden ones and excluding `.` and `..`, sorted bytewise, with directories marked by a trailing `/`. A listing SHALL contain at most 1,000 entries; a larger directory SHALL end with a line stating that more entries exist. A directory that cannot be listed SHALL fail rather than return an empty listing.

#### Scenario: Large directory is bounded

- **WHEN** the remote directory holds 50,000 entries
- **THEN** the result lists 1,000 entries and states that more exist

#### Scenario: Unreadable directory fails

- **WHEN** the remote login user cannot list the directory
- **THEN** the tool returns an error rather than an empty listing

### Requirement: Bash runs remotely through an ssh working directory

`bash` SHALL accept one `ssh://` path without a selector as `cwd` and run the command with `bash` on that host in that directory, as the remote login user. `env` entries SHALL reach the command without appearing in any process argument list; keys naming a managed base variable SHALL be refused as locally. The local output, input, duration, and process bounds SHALL apply, and the exit status SHALL be the command's.

#### Scenario: Command runs remotely in the given directory

- **WHEN** the model calls `bash` with `cwd: "ssh://box/tmp"` and `command: "pwd"`
- **THEN** the output is `/tmp` produced on `box`

#### Scenario: Environment stays out of argv

- **WHEN** the model calls `bash` with `cwd: "ssh://box/tmp"`, `env: { "TOKEN_HINT": "abc" }`, and `command: "printenv TOKEN_HINT; ps -eo args"`
- **THEN** the output contains `abc` from `printenv` and no process argument list contains `abc`

#### Scenario: Base variable cannot be replaced remotely

- **WHEN** the model passes `env: { "PATH": "/tmp" }` with an `ssh://` `cwd`
- **THEN** the call is refused as for a local base-variable collision and no SSH process is started

#### Scenario: Selector on cwd is refused

- **WHEN** the model passes `cwd: "ssh://box/tmp:1-2"`
- **THEN** the tool returns `invalid_path`

### Requirement: Remote bash outcomes after start are never replayed

A remote `bash` call SHALL record a native attempt before starting SSH, owned like a local attempt. When the deadline elapses, the call is cancelled, or the connection ends after the remote command started, the hub SHALL end its SSH process and SHALL return `outcome_unknown`. A failure before the remote command started SHALL be a known refusal, never `outcome_unknown`.

#### Scenario: Timeout is unknown

- **WHEN** a remote `sleep 600` exceeds the duration bound
- **THEN** the result is `outcome_unknown` and the Run continues

#### Scenario: Connection refused before start is a known refusal

- **WHEN** the host is unreachable
- **THEN** the result is `ssh_unavailable` with reason `unreachable`, not `outcome_unknown`

### Requirement: Missing remote prerequisites are named

When the remote host has no POSIX `sh`, an `ssh://` operation SHALL return `ssh_unsupported_host` naming the POSIX shell requirement. When `bash` is missing, a `bash` call SHALL return `ssh_unsupported_host` naming `bash`, while `read` on that host SHALL keep working. Connection failures SHALL return `ssh_unavailable` with reason `host_key_mismatch`, `auth_failed`, `unreachable`, `config`, or `client_missing`.

#### Scenario: Host without bash still reads

- **WHEN** the host has `sh` but no `bash`
- **THEN** `bash` with an `ssh://` `cwd` returns `ssh_unsupported_host` naming `bash`
- **AND** `read` of a file on that host succeeds

#### Scenario: Windows host is named unsupported

- **WHEN** the destination's login shell is Windows `cmd.exe`
- **THEN** `read` returns `ssh_unsupported_host` naming the POSIX shell requirement

#### Scenario: Authentication failure is typed

- **WHEN** the host rejects every offered key
- **THEN** the tool returns `ssh_unavailable` with reason `auth_failed`

### Requirement: ssh locators support only read and bash cwd

`edit` and `write` SHALL return `unsupported_operation` for an `ssh://` locator without starting a process. `enter_workspace` SHALL refuse an `ssh://` locator with `invalid_path`. Workspace path projection SHALL never produce an `ssh://` locator, and an explicit `ssh://` locator SHALL behave the same inside or outside any Workspace, including a Machine Workspace.

#### Scenario: Write is unsupported

- **WHEN** the model calls `write` with `ssh://box/tmp/x.txt`
- **THEN** the tool returns `unsupported_operation` and no SSH process is started

#### Scenario: Workspace entry is refused

- **WHEN** the model calls `enter_workspace` with `ssh://box/srv/app`
- **THEN** the tool returns `invalid_path` and the Chat stays outside a Workspace

#### Scenario: Explicit locator inside a Machine Workspace

- **WHEN** the Chat is bound to a Machine Workspace and the model reads `ssh://box/etc/hostname`
- **THEN** the file is read from `box` over `ssh://`, not from the Machine

### Requirement: ssh execution is disclosed as remote host authority

The `read` and `bash` descriptions SHALL state that `ssh://` operations run on the remote host as its login user with the instance's SSH identity, that every llame user with an applicable allow shares that authority, and that nothing isolates users on the remote host.

#### Scenario: Description states remote authority

- **WHEN** the `ssh` section is present and `bash` is offered
- **THEN** its description states that an `ssh://` `cwd` runs as the remote login user with the instance's SSH identity and no isolation between llame users

### Requirement: Hub-held state stays owner-isolated for ssh operations

Native attempts, results, and events for `ssh://` operations SHALL stay owner-scoped exactly as for local operations, regardless of how many users address the same host.

#### Scenario: Another owner's attempt is not visible

- **WHEN** user A runs `bash` with an `ssh://` `cwd` and user B queries native attempts and Run events through the API
- **THEN** B sees none of A's attempt rows, results, or events

### Requirement: ssh locators extend local-only argument forms

Where `native-file-tools`, `bash-execution`, `tool-call-permissions`, `workspace-entry`, or `tool-calling` restrict an argument to an absolute host path, or gate `bash` on the local native executor identity, `ssh://` locators SHALL be handled as specified here instead. The resolved destination SHALL count as part of the operator-authorized resource address. Local and Machine behavior SHALL be unchanged.

#### Scenario: Bash offered without a local executor

- **WHEN** the `ssh` section is present, `tools.nativeExecutorId` is absent, and `bash` is in `tools.allowed`
- **THEN** `bash` is offered, an `ssh://` `cwd` runs remotely, and a local `cwd` returns `executor_unavailable`

#### Scenario: Local behavior is unchanged

- **WHEN** the `ssh` section is present and the model reads an absolute local host path
- **THEN** the read behaves exactly as before this change
