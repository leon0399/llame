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

- **WHEN** the `ssh` section is present and two users' Runs both have a `read` allow for `^ssh://box@box:22/`
- **THEN** both Runs can read `ssh://box/etc/hostname`

### Requirement: SSH settings are validated at startup

The `ssh` section SHALL accept only `knownHostsFile`, `identityFile`, and `configFile`, each a path without interpolation, resolved relative to the configuration file with `~/` expanded. `knownHostsFile` SHALL default to the worker user's `~/.ssh/known_hosts` and `configFile` to the worker user's `~/.ssh/config`. An invalid or unknown field SHALL fail startup naming it.

#### Scenario: Interpolated path fails startup

- **WHEN** `ssh.identityFile` is `{env:KEY_PATH}`
- **THEN** startup fails naming `ssh.identityFile`

#### Scenario: Empty section uses the worker user's SSH files

- **WHEN** the configuration contains `ssh: {}`
- **THEN** host keys are checked strictly against the worker user's `~/.ssh/known_hosts` and the worker user's `~/.ssh/config` is included

### Requirement: ssh connections use llame's SSH safety options

Every SSH process an `ssh://` operation starts, including destination resolution, SHALL use the same generated configuration semantics as remote Machines: llame's safety options first, then the configured SSH configuration included. For every hop ssh itself opens, host keys SHALL come only from the pinned file with strict checking, with batch mode, no agent, no connection sharing, and connect and liveness timeouts.

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

The scheme SHALL match case-insensitively. The authority SHALL be `[user@]host[:port]`. The host SHALL be a name or IPv4 literal of letters, digits, `.`, `_`, and `-`, or a bracketed IPv6 literal of hex digits, `:`, and `.` without a zone; the user SHALL use letters, digits, `.`, `_`, and `-`; neither SHALL start with `-`. The port SHALL be 1 to 65535. Anything else, including a password or `%`, SHALL be `invalid_path` before any process starts.

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

#### Scenario: IPv6 zone and percent in a host are refused

- **WHEN** the model reads `ssh://[fe80::1%25eth0]/etc/hostname` or `ssh://bo%78/etc/hostname`
- **THEN** the tool returns `invalid_path` and no SSH process is started

#### Scenario: Explicit user, port, and IPv6 literal are accepted

- **WHEN** the model reads `SSH://deploy@[2001:db8::1]:2222/etc/hostname` and that host's key is pinned
- **THEN** the hub connects as `deploy` to `2001:db8::1` on port 2222

### Requirement: ssh locator paths are absolute and decoded once

The path after the authority SHALL be absolute. Percent escapes SHALL decode once to UTF-8; a literal `?`, `#`, backslash, or control character, an encoded `/` or NUL, and a missing path SHALL be `invalid_path`. A `read` selector SHALL split off as for local paths. Results SHALL report the submitted locator, with the scheme lowercased and the path re-encoded canonically.

#### Scenario: Encoded name round-trips

- **WHEN** the model reads `ssh://box/srv/a%23b.txt`
- **THEN** the remote file `/srv/a#b.txt` is read and the result locator spells it `ssh://box/srv/a%23b.txt`

#### Scenario: Missing path is refused

- **WHEN** the model reads `ssh://box`
- **THEN** the tool returns `invalid_path` asking for an absolute path

### Requirement: A bare ssh locator explains addressing

A `read` of `ssh://` or `ssh:///` SHALL return a fixed message stating that any destination OpenSSH resolves through the operator's SSH configuration may be addressed and that permissions decide which are allowed. It SHALL start no process and list no hosts.

#### Scenario: Bare locator explains addressing

- **WHEN** the model reads `ssh://` or `ssh:///`
- **THEN** the tool returns the fixed addressing message
- **AND** no SSH process is started

### Requirement: ssh destinations resolve to a canonical locator before permission evaluation

The destination SHALL be resolved through local SSH configuration evaluation, without connecting, under a bounded deadline and the call's cancellation. The resolved locator SHALL be `ssh://<user>@<host>:<port><path>`: user and port as resolved, defaults included; host lowercased, IPv6 bracketed; path decoded once with `.`, `..`, and trailing separators kept.

#### Scenario: Defaults are rendered explicitly

- **WHEN** the model reads `ssh://edge-1.lan/etc/hosts` and the included configuration sets no `User` or `Port` for it
- **THEN** the resolved locator is `ssh://<worker user>@edge-1.lan:22/etc/hosts`

#### Scenario: Broken configuration makes no connection

- **WHEN** local SSH configuration evaluation fails or exceeds its deadline
- **THEN** the tool returns `ssh_unavailable` with reason `config` and no connection is attempted

#### Scenario: Cancellation during resolution

- **WHEN** the call is cancelled while the destination is resolving
- **THEN** resolution stops and no connection is attempted

### Requirement: Permission rules match the resolved ssh locator

`read` SHALL be matched without its selector and `bash` on its `cwd`. Rejects SHALL be evaluated on the submitted text before resolution and on the resolved text after it; either match SHALL refuse. The allow SHALL be decided on the resolved text. All-fields rejects SHALL see the resolved text. The connection SHALL use the resolved user, host, and port.

#### Scenario: Alias cannot bypass an address reject

- **WHEN** a `read` reject matches `^ssh://[^/]*@10\.0\.0\.5:` and the included configuration maps the alias `prod` to `HostName 10.0.0.5`
- **AND** the model reads `ssh://prod/etc/hosts`
- **THEN** the call is refused before any connection

#### Scenario: Submitted-text reject refuses before resolution

- **WHEN** a `bash` reject matches `^ssh://prod/` on `cwd` and the model calls `bash` with `cwd: "ssh://prod/srv"`
- **THEN** the call is refused and the destination is not resolved

#### Scenario: Allow is scoped to the resolved host

- **WHEN** the only `read` allow is `^ssh://deploy@edge-1\.lan:22/var/log/` and the model reads `ssh://deploy@edge-2.lan/var/log/syslog`
- **THEN** the call is denied as having no applicable allow

#### Scenario: Local rule does not admit a remote path

- **WHEN** the only `read` allow is `^/var/log/` and the model reads `ssh://box/var/log/syslog`
- **THEN** the call is denied as having no applicable allow

#### Scenario: Encoded spelling cannot bypass a reject

- **WHEN** a `read` reject matches `/\.ssh/` and the model reads `ssh://box/root/%2Essh/id_ed25519`
- **THEN** the call is refused

#### Scenario: Dot segments are matched as written

- **WHEN** the only `read` allow is `^ssh://box@box:22/var/log/` and the model reads `ssh://box/var/log/../../etc/shadow`
- **THEN** the resolved locator keeps the `..` segments and the allow matches, as for local and Machine paths

#### Scenario: All-fields reject sees the resolved address

- **WHEN** an all-fields `read` reject matches `10\.0\.0\.5` and the alias `prod` resolves to `10.0.0.5`
- **THEN** a read of `ssh://prod/etc/hosts` is refused

### Requirement: Remote output starts after a per-call marker

Each remote script SHALL emit a per-call random start marker on stdout and stderr before its work and an end trailer carrying its status on stderr after it. Bytes before the start marker SHALL be discarded and SHALL count toward no bound. An operation SHALL be complete only when the end trailer is received.

#### Scenario: Login shell noise is not file content

- **WHEN** the remote account's shell startup file prints text on every login
- **THEN** `read ssh://box/etc/hostname` returns exactly the file's content

#### Scenario: Interrupted read is not a success

- **WHEN** the connection ends after the start marker and before the end trailer of a read
- **THEN** the tool returns `ssh_unavailable` with reason `session_lost`

### Requirement: Remote file reads are bounded UTF-8 text

A read of a regular file SHALL transfer at most 1 MiB plus one byte of content and SHALL return `file_too_large` above 1 MiB. Invalid UTF-8 SHALL return `invalid_utf8`; a FIFO, socket, or device SHALL return `not_regular_file` without being opened; a missing path SHALL return `not_found`; an unreadable file SHALL fail as a local unreadable file does. Selectors, numbering, and result bounds SHALL match a local read of the same text.

#### Scenario: Text file is read with a selector

- **WHEN** the model reads `ssh://box/etc/os-release:2-3`
- **THEN** the result contains lines 2 and 3 numbered as a local read numbers them

#### Scenario: Oversized file is refused

- **WHEN** the remote file is 2 MiB
- **THEN** the tool returns `file_too_large` naming the 1 MiB bound and `bash` as the way to inspect it
- **AND** no more than 1 MiB plus one byte of content is transferred

#### Scenario: Binary file is refused

- **WHEN** the model reads `ssh://box/usr/bin/ls`
- **THEN** the tool returns `invalid_utf8`

#### Scenario: FIFO does not block

- **WHEN** the remote path is a FIFO
- **THEN** the tool returns `not_regular_file` without opening it

#### Scenario: Empty file and symlinked file

- **WHEN** the model reads an empty remote file, and then a symlink to a regular file
- **THEN** the first returns empty content and the second returns the target's content

### Requirement: Remote directory reads are bounded listings

A directory read SHALL list immediate entries only, including hidden ones and excluding `.` and `..`, with the local listing's header, ordering, entry rendering, and selector rules; symbolic links SHALL be marked without their targets. At most 1,000 entries SHALL be listed, then a line stating more exist. Names SHALL be transferred unambiguously. A directory that cannot be listed SHALL fail.

#### Scenario: Large directory is bounded

- **WHEN** the remote directory holds 50,000 entries
- **THEN** the result lists 1,000 entries and states that more exist

#### Scenario: Name containing a newline is one entry

- **WHEN** the remote directory holds an entry whose name contains a newline
- **THEN** the listing shows it as one entry and the entry count is unaffected

#### Scenario: Empty directory

- **WHEN** the remote directory is empty
- **THEN** the result is the local empty-directory listing

#### Scenario: Unreadable directory fails

- **WHEN** the remote login user cannot list the directory
- **THEN** the tool returns an error rather than an empty listing

#### Scenario: Symlink entry is marked

- **WHEN** the remote directory holds a symbolic link
- **THEN** its entry carries the local link marker and no target

### Requirement: Bash runs remotely through an ssh working directory

`bash` SHALL accept one `ssh://` path without a selector as `cwd` and run the command with `bash` there, as the remote login user, with stdin empty. A `cwd` that cannot be entered SHALL be refused as locally, with no command run. The local output, input, duration, and process bounds SHALL apply, and the exit status SHALL be the one the end trailer carries.

#### Scenario: Command runs remotely in the given directory

- **WHEN** the model calls `bash` with `cwd: "ssh://box/tmp"` and `command: "pwd"`
- **THEN** the output is `/tmp` produced on `box`

#### Scenario: Remote exit status 255 is the command's

- **WHEN** the command is `exit 255`
- **THEN** the result reports exit status 255, not a connection failure

#### Scenario: Missing working directory runs nothing

- **WHEN** the model passes `cwd: "ssh://box/no/such/dir"`
- **THEN** the result is the local unusable-working-directory refusal naming that value and no command runs

#### Scenario: Selector on cwd is refused

- **WHEN** the model passes `cwd: "ssh://box/tmp:1-2"`
- **THEN** the tool returns `invalid_path`

#### Scenario: Remote cwd inside a Machine Workspace

- **WHEN** the Chat is bound to a Machine Workspace and the model passes `cwd: "ssh://box/tmp"`
- **THEN** the command runs on `box` over `ssh://`, not on the Machine

### Requirement: Remote bash environment entries are data

`env` keys SHALL match `[A-Za-z_][A-Za-z0-9_]*` and SHALL NOT name a managed base variable; keys and values SHALL contain no NUL. A violating call SHALL be refused before any process starts. Accepted entries SHALL reach the command without appearing in any process argument list on either host.

#### Scenario: Environment stays out of argv

- **WHEN** the model calls `bash` with `cwd: "ssh://box/tmp"`, `env: { "TOKEN_HINT": "abc" }`, and `command: "printenv TOKEN_HINT; ps -eo args"`
- **THEN** the output contains `abc` from `printenv` and no process argument list contains `abc`

#### Scenario: Shell text in a key is refused

- **WHEN** the model passes `env: { "X=1; id; Y": "v" }` with an `ssh://` `cwd`
- **THEN** the call is refused before any process starts

#### Scenario: Base variable cannot be replaced remotely

- **WHEN** the model passes `env: { "PATH": "/tmp" }` with an `ssh://` `cwd`
- **THEN** the call is refused as for a local base-variable collision and no SSH process is started

### Requirement: Remote bash outcomes after start are never replayed

A remote `bash` call SHALL record a native attempt, owned like a local one, before starting SSH. Only a failure classified as pre-session (missing client, host key, authentication, connect failure, missing interpreter) SHALL be a known refusal. A timeout, cancellation, or connection end while SSH runs without a typed pre-session classification, and any start marker without an end trailer, SHALL return `outcome_unknown`.

#### Scenario: Timeout is unknown

- **WHEN** a remote `sleep 600` exceeds the duration bound
- **THEN** the result is `outcome_unknown` and the Run continues

#### Scenario: Connection refused before start is a known refusal

- **WHEN** the host is unreachable
- **THEN** the result is `ssh_unavailable` with reason `unreachable`, not `outcome_unknown`

#### Scenario: Cancellation during a running session is unknown

- **WHEN** the call is cancelled after SSH started and before the end trailer arrives
- **THEN** the result is `outcome_unknown`

### Requirement: Missing remote prerequisites are named

Without a POSIX `sh`, an `ssh://` operation SHALL return `ssh_unsupported_host` naming that requirement; an account that runs no llame script (forced command, no login shell) SHALL return `ssh_unsupported_host` saying so. Without `bash`, a `bash` call SHALL return `ssh_unsupported_host` naming `bash`, and `read` SHALL keep working. Connection failures SHALL be `ssh_unavailable` with reason `host_key_mismatch`, `auth_failed`, `unreachable`, `config`, `client_missing`, or `session_lost`.

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

#### Scenario: Write and edit are unsupported

- **WHEN** the model calls `write` or `edit` with `ssh://box/tmp/x.txt`
- **THEN** the tool returns `unsupported_operation` and no SSH process is started

#### Scenario: Workspace entry is refused

- **WHEN** the model calls `enter_workspace` with `ssh://box/srv/app`
- **THEN** the tool returns `invalid_path` and the Chat stays outside a Workspace

#### Scenario: Explicit locator inside a Machine Workspace

- **WHEN** the Chat is bound to a Machine Workspace and the model reads `ssh://box/etc/hostname`
- **THEN** the file is read from `box` over `ssh://`, not from the Machine

### Requirement: ssh execution is disclosed as remote host authority

The `read` and `bash` descriptions SHALL state that `ssh://` operations run on the remote host as its login user with the instance's SSH identity, that every llame user with an applicable allow shares that authority, and that nothing isolates users on the remote host.

#### Scenario: Read description states remote authority

- **WHEN** `read` is offered
- **THEN** its description names the `ssh://` form, its bounds, and that it runs as the remote login user with the instance's SSH identity and no isolation between llame users

#### Scenario: Bash description states remote authority

- **WHEN** the `ssh` section is present and `bash` is offered
- **THEN** its description states that an `ssh://` `cwd` runs as the remote login user with the instance's SSH identity and no isolation between llame users

### Requirement: Hub-held state stays owner-isolated for ssh operations

Native attempts, results, and events for `ssh://` operations SHALL stay owner-scoped exactly as for local operations, regardless of how many users address the same host.

#### Scenario: Another owner's attempt is not visible

- **WHEN** user A runs `bash` with an `ssh://` `cwd` and user B queries native attempts and Run events through the API
- **THEN** B sees none of A's attempt rows, results, or events

### Requirement: ssh locators extend local-only argument forms

Where `native-file-tools`, `bash-execution`, `tool-call-permissions`, `workspace-entry`, or `tool-calling` restrict an argument to a host path, gate `bash` on the local executor, forbid the model selecting an executor, define directory listings, or limit projection to text parsing, `ssh://` locators SHALL be handled as specified here. Local and Machine behavior SHALL be unchanged.

#### Scenario: Bash offered without a local executor

- **WHEN** the `ssh` section is present, `tools.nativeExecutorId` is absent, and `bash` is in `tools.allowed`
- **THEN** `bash` is offered, an `ssh://` `cwd` runs remotely, and a local `cwd` returns `executor_unavailable`

#### Scenario: Local behavior is unchanged

- **WHEN** the `ssh` section is present and the model reads an absolute local host path
- **THEN** the read behaves exactly as before this change
