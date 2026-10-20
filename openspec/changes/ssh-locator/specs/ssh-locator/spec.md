## Purpose

A Run can use an `ssh://` locator to read files on a remote host and to run `bash` commands there. Nothing is installed on that host. The same permission and result contracts apply as for local native tools.

## ADDED Requirements

### Requirement: ssh locators are available only with an ssh section

The configuration MUST accept an optional `ssh` section under the closed published schema. If the configuration has no `ssh` section, the tool MUST refuse an `ssh://` locator with the unknown-scheme error, and no SSH process can start. If the configuration has the section, `ssh://` is operator-wide. Each authenticated user can use it if tool eligibility and permissions permit the Run of that user.

#### Scenario: Locator refused without configuration

- **WHEN** the configuration has no `ssh` section and the model calls `read` with `ssh://box/etc/hostname`
- **THEN** the tool returns the unknown-scheme `invalid_path` error, as before this change
- **AND** no SSH process starts

#### Scenario: Enabled locator is available to each eligible user

- **WHEN** the configuration has the `ssh` section and the Runs of two users have a `read` allow for `^ssh://box@box:22/`
- **THEN** the two Runs can read `ssh://box/etc/hostname`

### Requirement: SSH settings are validated at startup

The `ssh` section MUST accept only `knownHostsFile`, `identityFile`, and `configFile`. Each value is a path without interpolation. The loader MUST resolve each path relative to the configuration file and expand `~/`. The default `knownHostsFile` is `~/.ssh/known_hosts` of the worker user. The default `configFile` is `~/.ssh/config` of the worker user. If a field is not correct or is not known, startup MUST fail and show the name of the field.

#### Scenario: Interpolated path stops startup

- **WHEN** `ssh.identityFile` is `{env:KEY_PATH}`
- **THEN** startup fails and shows `ssh.identityFile`

#### Scenario: Empty section uses the SSH files of the worker user

- **WHEN** the configuration contains `ssh: {}`
- **THEN** the hub does a strict check of host keys against `~/.ssh/known_hosts` of the worker user
- **AND** the hub includes `~/.ssh/config` of the worker user

### Requirement: ssh connections use the llame SSH safety options

Each SSH process for an `ssh://` operation, also for the resolution of the destination, MUST use the generated configuration of remote Machines. The llame safety options come first, and the configured SSH configuration follows them. For each hop that ssh opens, host keys MUST come only from the pinned file, with strict checks. Batch mode, connect timeouts, and liveness timeouts MUST apply. The SSH agent MUST stay off. Each operation MUST use a different connection.

#### Scenario: Unpinned host is refused

- **WHEN** the model reads `ssh://10.0.0.9/etc/hostname` and the key of that host is not in the pinned file
- **THEN** the tool returns `ssh_unavailable` with reason `host_key_mismatch`
- **AND** no remote command runs

#### Scenario: Included configuration cannot make host-key checks weaker

- **WHEN** the included configuration sets `StrictHostKeyChecking accept-new` for `box`
- **THEN** a read of `ssh://box/etc/hostname` must have a pinned host key

#### Scenario: Alias and jump host come from the included configuration

- **WHEN** the included configuration resolves `box` through `ProxyJump bastion` and the two keys are pinned
- **THEN** `read ssh://box/etc/hostname` returns the file from `box` through `bastion`

### Requirement: ssh locators name a destination with strict spelling

The scheme MUST match in uppercase and in lowercase letters. The authority MUST have the form `[user@]host[:port]`. The host MUST be one of these, and its first character MUST NOT be `-`:

- A name or IPv4 literal: letters, digits, `.`, `_`, and `-`
- An IPv6 literal in brackets: hex digits, `:`, and `.`, with no zone.

For a host of a different form, also a host with `%`, the tool MUST return `invalid_path` before a process starts.

#### Scenario: Option-shaped host is refused before a process starts

- **WHEN** the model reads `ssh://-oProxyCommand=id/etc/hostname`
- **THEN** the tool returns `invalid_path`
- **AND** no SSH process starts

#### Scenario: IPv6 zone and percent sign in a host are refused

- **WHEN** the model reads `ssh://[fe80::1%25eth0]/etc/hostname` or `ssh://bo%78/etc/hostname`
- **THEN** the tool returns `invalid_path` and no SSH process starts

#### Scenario: Explicit user, port, and IPv6 literal are accepted

- **WHEN** the model reads `SSH://deploy@[2001:db8::1]:2222/etc/hostname` and the key of that host is pinned
- **THEN** the hub connects as `deploy` to `2001:db8::1` on port 2222

### Requirement: ssh locator users and ports have a strict form

The user MUST contain only letters, digits, `.`, `_`, and `-`. Its first character MUST NOT be `-`. The port MUST be 1 to 65535. For a user or port of a different form, also a password or an empty value, the tool MUST return `invalid_path` before a process starts.

#### Scenario: Shell metacharacter in a user is refused

- **WHEN** the model reads `ssh://a;id@box/etc/hostname`
- **THEN** the tool returns `invalid_path` and no SSH process starts

#### Scenario: Password in the authority is refused

- **WHEN** the model reads `ssh://root:secret@box/etc/hostname`
- **THEN** the tool returns `invalid_path` and tells that it does not accept passwords

### Requirement: ssh locator paths are absolute and decoded one time

The path after the authority MUST be absolute. The tool MUST decode percent escapes one time to UTF-8. The tool MUST return `invalid_path` for these:

- A literal `?`, `#`, backslash, or control character
- An encoded `/` or NUL
- A missing path.

The tool MUST remove a `read` selector as for local paths. Results MUST show the submitted locator, with a lowercase scheme and the path in canonical encoded form.

#### Scenario: Encoded name gives the same locator back

- **WHEN** the model reads `ssh://box/srv/a%23b.txt`
- **THEN** the tool reads the remote file `/srv/a#b.txt`, and the result locator is `ssh://box/srv/a%23b.txt`

#### Scenario: Missing path is refused

- **WHEN** the model reads `ssh://box`
- **THEN** the tool returns `invalid_path` and tells the model to give an absolute path

### Requirement: A bare ssh locator tells how to address hosts

For a `read` of `ssh://` or `ssh:///`, the tool MUST return the same message for each call. The message tells that the model can use each destination that OpenSSH resolves through the SSH configuration of the operator. It also tells that permissions select the permitted destinations. The tool MUST NOT start a process, and it MUST NOT show a list of hosts.

#### Scenario: Bare locator tells how to address hosts

- **WHEN** the model reads `ssh://` or `ssh:///`
- **THEN** the tool returns the message on addresses
- **AND** no SSH process starts

### Requirement: ssh destinations resolve to a canonical locator before permission evaluation

The hub MUST resolve the destination through local evaluation of the SSH configuration, and it MUST NOT connect for this step. A deadline and the cancellation of the call MUST apply to the resolution. The resolved locator is `ssh://<user>@<host>:<port><path>`. The user and the port are the resolved values, and default values are shown. The host is lowercase, with brackets for IPv6. The path is decoded one time, and `.`, `..`, and a final separator stay in the path.

#### Scenario: Default values are shown

- **WHEN** the model reads `ssh://edge-1.lan/etc/hosts` and the included configuration sets no `User` or `Port` for it
- **THEN** the resolved locator is `ssh://<worker user>@edge-1.lan:22/etc/hosts`

#### Scenario: Configuration that is not valid stops the call before a connection

- **WHEN** the local evaluation of the SSH configuration fails or is longer than its deadline
- **THEN** the tool returns `ssh_unavailable` with reason `config`, and the hub does not try to connect

#### Scenario: Cancellation during resolution

- **WHEN** the call is cancelled while the hub resolves the destination
- **THEN** the resolution stops, and the hub does not try to connect

### Requirement: Permission rules match the resolved ssh locator

For `read`, permission rules MUST match the locator without its selector. For `bash`, permission rules MUST match the `cwd`. The hub MUST evaluate rejects on the submitted text before the resolution, and then on the resolved text. A match in one of the two MUST refuse the call.

The hub MUST use the resolved text to evaluate the allow. All-fields rejects MUST also find the resolved text. The connection MUST use the resolved user, host, and port.

#### Scenario: Alias cannot go around an address reject

- **WHEN** a `read` reject matches `^ssh://[^/]*@10\.0\.0\.5:` and the included configuration maps the alias `prod` to `HostName 10.0.0.5`
- **AND** the model reads `ssh://prod/etc/hosts`
- **THEN** the hub refuses the call before a connection

#### Scenario: Submitted-text reject refuses before resolution

- **WHEN** a `bash` reject matches `^ssh://prod/` on `cwd` and the model calls `bash` with `cwd: "ssh://prod/srv"`
- **THEN** the hub refuses the call and does not resolve the destination

#### Scenario: Allow applies only to the resolved host

- **WHEN** the only `read` allow is `^ssh://deploy@edge-1\.lan:22/var/log/` and the model reads `ssh://deploy@edge-2.lan/var/log/syslog`
- **THEN** the hub refuses the call because no allow applies

#### Scenario: Local rule does not permit a remote path

- **WHEN** the only `read` allow is `^/var/log/` and the model reads `ssh://box/var/log/syslog`
- **THEN** the hub refuses the call because no allow applies

#### Scenario: Encoded spelling cannot go around a reject

- **WHEN** a `read` reject matches `/\.ssh/` and the model reads `ssh://box/root/%2Essh/id_ed25519`
- **THEN** the hub refuses the call

#### Scenario: Dot segments stay as written

- **WHEN** the only `read` allow is `^ssh://box@box:22/var/log/` and the model reads `ssh://box/var/log/../../etc/shadow`
- **THEN** the resolved locator keeps the `..` segments, and the allow matches, as for local and Machine paths

#### Scenario: All-fields reject finds the resolved address

- **WHEN** an all-fields `read` reject matches `10\.0\.0\.5` and the alias `prod` resolves to `10.0.0.5`
- **THEN** the hub refuses a read of `ssh://prod/etc/hosts`

### Requirement: Remote output starts after a per-call marker

Each remote script MUST write a random start marker on stdout and stderr before its work. Each call has a new marker. After its work, the script MUST write an end trailer with its status on stderr. The hub MUST discard the bytes before the start marker, and these bytes MUST NOT count for a bound. An operation is complete only when the hub gets the end trailer.

#### Scenario: Output from the login shell is not file content

- **WHEN** the startup file of the shell of the remote account writes text at each login
- **THEN** `read ssh://box/etc/hostname` returns only the content of the file

#### Scenario: Interrupted read is not a success

- **WHEN** the connection stops after the start marker and before the end trailer of a read
- **THEN** the tool returns `ssh_unavailable` with reason `session_lost`

### Requirement: Remote file reads are bounded UTF-8 text

For a read of a regular file, the hub MUST transfer a maximum of 1 MiB plus one byte of content. Above 1 MiB, the tool MUST return `file_too_large`. The tool MUST also return these errors:

- `invalid_utf8` for text that is not valid UTF-8
- `not_regular_file` for a FIFO, socket, or device, without an open operation on it
- `not_found` for a missing path
- The local error for a file that the user cannot read, if the remote user cannot read the file.

#### Scenario: Oversized file is refused

- **WHEN** the remote file is 2 MiB
- **THEN** the tool returns `file_too_large`, with the 1 MiB bound and `bash` as the method to examine the file
- **AND** the hub transfers a maximum of 1 MiB plus one byte of content

#### Scenario: Binary file is refused

- **WHEN** the model reads `ssh://box/usr/bin/ls`
- **THEN** the tool returns `invalid_utf8`

#### Scenario: FIFO does not stop the read

- **WHEN** the remote path is a FIFO
- **THEN** the tool returns `not_regular_file` and does not open the FIFO

#### Scenario: Empty file and symbolic link to a file

- **WHEN** the model reads an empty remote file, and then a symbolic link to a regular file
- **THEN** the read of the empty file returns empty content, and the read of the link returns the content of the target

### Requirement: Remote file reads number lines as local reads do

Selectors, line numbers, and result bounds MUST be the same as for a local read of the same text.

#### Scenario: Text file is read with a selector

- **WHEN** the model reads `ssh://box/etc/os-release:2-3`
- **THEN** the result contains lines 2 and 3, with the same line numbers as a local read

### Requirement: Remote directory reads use the local list form

For a read of a directory, the tool MUST show a list of the entries directly in the directory. The list MUST contain hidden entries, but not `.` and `..`. The header, the order, the form of each entry, and the selector rules MUST be the same as for a local directory. The list MUST give a mark to symbolic links and MUST NOT show their targets.

#### Scenario: Empty directory

- **WHEN** the remote directory is empty
- **THEN** the result is the same as for an empty local directory

#### Scenario: Symbolic link entry has a mark

- **WHEN** the remote directory contains a symbolic link
- **THEN** its entry has the local link mark and no target

### Requirement: Remote directory lists are bounded

A list MUST contain a maximum of 1,000 entries. If there are more entries, a line after the list MUST tell this. The transfer of names MUST keep each name as one entry. If the remote user cannot read the directory, the tool MUST return an error.

#### Scenario: Large directory is bounded

- **WHEN** the remote directory contains 50,000 entries
- **THEN** the result shows 1,000 entries and tells that there are more entries

#### Scenario: Name with a newline is one entry

- **WHEN** the remote directory contains an entry with a newline in its name
- **THEN** the list shows it as one entry, and the number of entries stays correct

#### Scenario: Directory that the user cannot read gives an error

- **WHEN** the remote login user cannot read the directory
- **THEN** the tool returns an error, and not an empty list

### Requirement: Bash runs on a remote host through an ssh working directory

As its `cwd`, `bash` MUST accept one `ssh://` path without a selector. The hub MUST run the command with `bash` in that directory on that host, as the remote login user. The stdin of the command is empty. If the hub cannot go into the `cwd`, it MUST refuse the call as for a local call, and no command can run. The local bounds for output, input, time, and processes MUST apply. The exit status is the status in the end trailer.

#### Scenario: Command runs on the remote host in the given directory

- **WHEN** the model calls `bash` with `cwd: "ssh://box/tmp"` and `command: "pwd"`
- **THEN** the output is `/tmp`, from `box`

#### Scenario: Remote exit status 255 belongs to the command

- **WHEN** the command is `exit 255`
- **THEN** the result shows exit status 255, and not a connection failure

#### Scenario: Missing working directory stops the command

- **WHEN** the model gives `cwd: "ssh://box/no/such/dir"`
- **THEN** the result is the local refusal for a `cwd` that the hub cannot use, with that value
- **AND** no command runs

#### Scenario: Selector on cwd is refused

- **WHEN** the model gives `cwd: "ssh://box/tmp:1-2"`
- **THEN** the tool returns `invalid_path`

#### Scenario: Remote cwd in a Machine Workspace

- **WHEN** the Chat is bound to a Machine Workspace and the model gives `cwd: "ssh://box/tmp"`
- **THEN** the command runs on `box` through `ssh://`, and not on the Machine

### Requirement: Remote bash environment entries are data

Each `env` key MUST match `[A-Za-z_][A-Za-z0-9_]*`. An `env` key MUST NOT be the name of a managed base variable. Keys and values MUST NOT contain NUL. If a call does not obey these rules, the hub MUST refuse it before a process starts. The command MUST get each permitted entry. No argument list of a process on the hub or on the host can contain the entry.

#### Scenario: Environment is not in argv

- **WHEN** the model calls `bash` with `cwd: "ssh://box/tmp"`, `env: { "TOKEN_HINT": "abc" }`, and `command: "printenv TOKEN_HINT; ps -eo args"`
- **THEN** the output contains `abc` from `printenv`, and no argument list of a process contains `abc`

#### Scenario: Shell text in a key is refused

- **WHEN** the model gives `env: { "X=1; id; Y": "v" }` with an `ssh://` `cwd`
- **THEN** the hub refuses the call before a process starts

#### Scenario: Remote call cannot replace a base variable

- **WHEN** the model gives `env: { "PATH": "/tmp" }` with an `ssh://` `cwd`
- **THEN** the hub refuses the call as for a local collision with a base variable
- **AND** no SSH process starts

### Requirement: Remote bash outcomes after start are never replayed

Before SSH starts, a remote `bash` call MUST record a native attempt, with the same owner rules as a local attempt. Only a failure of the pre-session type can give a known refusal. These failures are a missing client, a host key, authentication, a connect failure, or a missing interpreter. The tool MUST return `outcome_unknown` for each other end of the call after SSH starts. This includes a start marker without an end trailer.

#### Scenario: Timeout gives an unknown outcome

- **WHEN** a remote `sleep 600` is longer than the time bound
- **THEN** the result is `outcome_unknown`, and the Run continues

#### Scenario: Refused connection before start is a known refusal

- **WHEN** the host is not reachable
- **THEN** the result is `ssh_unavailable` with reason `unreachable`, and not `outcome_unknown`

#### Scenario: Cancellation during a session gives an unknown outcome

- **WHEN** the call is cancelled after SSH starts and before the hub gets the end trailer
- **THEN** the result is `outcome_unknown`

### Requirement: Missing remote prerequisites are named

The tool MUST return `ssh_unsupported_host` in these conditions:

- The host has no POSIX `sh`. The message names this requirement.
- The account runs no llame script, for example a forced command or no login shell. The message tells this.
- The host has no `bash`, for a `bash` call. The message names `bash`, and `read` continues to work.

#### Scenario: Host without bash can do reads

- **WHEN** the host has `sh` but no `bash`
- **THEN** `bash` with an `ssh://` `cwd` returns `ssh_unsupported_host`, and the message names `bash`
- **AND** a `read` of a file on that host is a success

#### Scenario: Windows host is unsupported

- **WHEN** the login shell of the destination is Windows `cmd.exe`
- **THEN** `read` returns `ssh_unsupported_host`, and the message names the POSIX shell requirement

### Requirement: ssh connection failures have a reason

For a connection failure, the tool MUST return `ssh_unavailable` with one of these reasons: `host_key_mismatch`, `auth_failed`, `unreachable`, `config`, `client_missing`, or `session_lost`.

#### Scenario: Authentication failure has a type

- **WHEN** the host refuses each key that the hub gives
- **THEN** the tool returns `ssh_unavailable` with reason `auth_failed`

### Requirement: ssh locators support only read and bash cwd

For an `ssh://` locator, `edit` and `write` MUST return `unsupported_operation`, and no process can start. `enter_workspace` MUST refuse an `ssh://` locator with `invalid_path`. The projection of Workspace paths MUST NOT make an `ssh://` locator. An `ssh://` locator MUST operate the same in a Workspace and when no Workspace is entered. This also applies to a Machine Workspace.

#### Scenario: Write and edit are unsupported

- **WHEN** the model calls `write` or `edit` with `ssh://box/tmp/x.txt`
- **THEN** the tool returns `unsupported_operation`, and no SSH process starts

#### Scenario: Workspace entry is refused

- **WHEN** the model calls `enter_workspace` with `ssh://box/srv/app`
- **THEN** the tool returns `invalid_path`, and the Chat stays without a Workspace

#### Scenario: Explicit locator in a Machine Workspace

- **WHEN** the Chat is bound to a Machine Workspace and the model reads `ssh://box/etc/hostname`
- **THEN** the tool reads the file from `box` through `ssh://`, and not from the Machine

### Requirement: ssh operations are disclosed as remote host authority

The `read` description and the `bash` description MUST tell these facts:

- An `ssh://` operation runs on the remote host as its login user, with the SSH identity of the instance.
- Each llame user with an applicable allow has the same authority.
- No function isolates the users on the remote host.

#### Scenario: Read description tells the remote authority

- **WHEN** `read` is available to the model
- **THEN** its description names the `ssh://` form and its bounds
- **AND** it tells that the read runs as the remote login user, with the SSH identity of the instance and no isolation between llame users

#### Scenario: Bash description tells the remote authority

- **WHEN** the configuration has the `ssh` section and `bash` is available to the model
- **THEN** its description tells that an `ssh://` `cwd` runs as the remote login user
- **AND** it tells that the command uses the SSH identity of the instance, with no isolation between llame users

### Requirement: Hub state for ssh operations stays isolated for each owner

Native attempts, results, and events for `ssh://` operations MUST have the same owner scope as for local operations. This rule MUST apply when many users use the same host.

#### Scenario: Attempt of a different owner is not visible

- **WHEN** user A runs `bash` with an `ssh://` `cwd`, and user B reads native attempts and Run events through the API
- **THEN** B gets none of the attempt rows, results, or events of A

### Requirement: ssh locators extend local-only argument forms

The `native-file-tools`, `bash-execution`, `tool-call-permissions`, `workspace-entry`, and `tool-calling` capabilities contain local-only rules. For `ssh://` locators, this capability MUST replace these rules:

- An argument is a host path.
- `bash` is available only with the local executor.
- The model does not select an executor.
- Directory lists.
- Projection is a text parse only.

Local behavior and Machine behavior MUST stay the same.

#### Scenario: Bash is offered without a local executor

- **WHEN** the configuration has the `ssh` section and no `tools.nativeExecutorId`, and `bash` is in `tools.allowed`
- **THEN** `bash` is available to the model, and a command with an `ssh://` `cwd` runs on the remote host
- **AND** a local `cwd` returns `executor_unavailable`

#### Scenario: Local behavior stays the same

- **WHEN** the configuration has the `ssh` section and the model reads an absolute local host path
- **THEN** the read operates as before this change
