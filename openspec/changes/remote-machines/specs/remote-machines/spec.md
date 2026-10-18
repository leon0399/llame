## Purpose

Lets a Run use operator-configured remote Machines, reached over SSH, with the
same native file, `bash`, Workspace, and Workspace MCP contracts it uses on the
local executor, while the hub keeps the Run loop and its credentials.

## ADDED Requirements

### Requirement: Machines exist only when the operator configures them

The configuration SHALL accept an optional `machines` section under the closed published schema. When it is absent, no Machine tool argument, route, status table read, or UI surface SHALL exist, and a `machine://` locator SHALL be refused as an unknown scheme exactly as today. Machines SHALL be operator-wide: every authenticated user whose Run passes tool eligibility and permissions MAY address them.

#### Scenario: Feature absent without configuration

- **WHEN** the configuration has no `machines` section and the model calls `read` with `machine://devl/etc/hostname`
- **THEN** the tool returns the existing unknown-scheme `invalid_path` error
- **AND** no SSH process is started and the settings Machines list is not offered

#### Scenario: Configured Machine is addressable by any eligible user

- **WHEN** two users' Runs both have `read` allowed for `machine://devl/...` and the configuration declares `devl`
- **THEN** both Runs can read from `devl`

### Requirement: Machine configuration is validated at startup

`machines.ssh.identityFile` and `machines.ssh.knownHostsFile` SHALL name the dedicated hub SSH identity and the pinned host-key file. `machines.hosts` SHALL map each Machine name to a `destination` and an optional ordered `proxyJump` list. Names SHALL be lowercase ASCII letters, digits, and hyphens, 1 to 63 characters. A missing or invalid field SHALL fail startup naming it, before the process serves requests or claims jobs.

#### Scenario: Invalid Machine name fails startup

- **WHEN** `machines.hosts` contains the key `Dev_L`
- **THEN** startup fails naming `machines.hosts.Dev_L`

#### Scenario: Missing pinned host keys fail startup

- **WHEN** `machines.hosts` declares a Machine but `machines.ssh.knownHostsFile` is absent
- **THEN** startup fails naming `machines.ssh.knownHostsFile`

### Requirement: The hub reaches a Machine only through pinned SSH

A worker SHALL reach a Machine by running the host's `ssh` client with the configured identity only, the pinned host-key file with strict checking, batch mode, no agent or X11 forwarding, the configured jump hosts in order, and the remote command `llame-machine serve --stdio`. A host key absent from or different to the pinned file SHALL fail the connection. No password or interactive prompt SHALL be attempted.

#### Scenario: Unpinned host key is refused

- **WHEN** the Machine's host key is not in the pinned file
- **THEN** the connection fails, the operation returns `machine_unavailable` with reason `unreachable`, and no request is sent

#### Scenario: Jump hosts are traversed in order

- **WHEN** `devl` declares `proxyJump: ["laptop1", "laptop2"]`
- **THEN** the SSH connection reaches `devl` through `laptop1` and then `laptop2`

### Requirement: The Machine session is versioned and multiplexed

Each SSH session SHALL begin with a handshake exchanging protocol versions. An incompatible version SHALL end the session; operations SHALL return `machine_unavailable` with reason `incompatible_version`, and status SHALL record both versions. One session SHALL carry concurrent operations and Workspace MCP channels as independent streams, so a failure on one stream does not end another.

#### Scenario: Incompatible daemon is reported, not used

- **WHEN** the daemon on `devl` speaks a protocol version the hub does not support
- **THEN** every `devl` operation returns `machine_unavailable` with reason `incompatible_version`
- **AND** the Machines list shows the hub and daemon versions

#### Scenario: Concurrent operations share one session

- **WHEN** a `bash` call is running on `devl` and the model reads a `devl` file in another tool call
- **THEN** both complete over the same session without waiting for each other

### Requirement: Registered roots bound every Machine address

The daemon SHALL accept a path only when its canonical form lies within a root registered on that Machine through the daemon's own command line. The hub SHALL have no operation that adds, changes, or removes a registered root. A path outside every registered root SHALL return `path_not_registered` before any file is opened or process started. Roots bound addresses, not processes: a command run in a root keeps the Machine OS user's authority.

#### Scenario: Path outside the roots is refused even when policy allows it

- **WHEN** hub permission policy allows `machine://devl/home/me/.ssh/id_ed25519` but no registered root contains that path
- **THEN** `read` returns `path_not_registered` and the daemon opens no file

#### Scenario: Symbolic link escape is refused

- **WHEN** a registered root contains a symbolic link pointing outside every registered root and the model reads through it
- **THEN** the read returns `path_not_registered`

### Requirement: Machine locators name a configured Machine and an absolute path

A Machine locator SHALL have the form `machine://<name><absolute path>[:selector]`. The scheme and name SHALL be ASCII case-insensitive and canonicalized to lowercase. Path percent-escapes SHALL decode once to strict UTF-8 under the rules for `file:` aliases. An unconfigured name SHALL return `machine_not_found` without starting SSH. Results SHALL report the canonical Machine locator and SHALL NOT expose the SSH destination, jump hosts, or identity.

#### Scenario: Unknown Machine is refused locally

- **WHEN** the model reads `machine://nope/etc/hostname` and `nope` is not configured
- **THEN** the tool returns `machine_not_found` and no SSH process is started

#### Scenario: Result reports the canonical locator

- **WHEN** the model reads `MACHINE://DEVL/home/me/shop/README.md:1-5`
- **THEN** the result identifies `machine://devl/home/me/shop/README.md` and contains lines 1 through 5 as a local read would

### Requirement: Native file tools behave identically on a Machine

`read`, `edit`, and `write` SHALL accept Machine locators and SHALL produce the same results, selectors, listings, bounds, media handling, and errors as for the same file on the local executor. A Machine operation SHALL neither require nor bind the local native executor identity.

#### Scenario: Selector read matches local behavior

- **WHEN** the model reads `machine://devl/home/me/shop/src/app.ts:10-20`
- **THEN** the result equals what a local read of the same file content with `:10-20` returns, apart from the reported locator

#### Scenario: Directory listing matches local behavior

- **WHEN** the model reads `machine://devl/home/me/shop/`
- **THEN** the result is the depth-2 listing native reads produce for that directory

#### Scenario: Machine read on a worker without a local executor

- **WHEN** a worker has no `tools.nativeExecutorId` and the model reads a Machine locator
- **THEN** the read executes on the Machine and records no local executor binding

### Requirement: Machine mutations use the native effect fence

An `edit` or `write` on a Machine, and a `bash` call on a Machine, SHALL record the existing durable native attempt before dispatch and its result after. When the session is lost after dispatch and before a result, the operation SHALL settle as `outcome_unknown`. Every request SHALL carry its Run, attempt, tool call, delivery sequence, and deadline, and the daemon SHALL refuse a request whose deadline has passed.

#### Scenario: Session lost mid-edit is unknown, not retried

- **WHEN** the SSH session drops after an `edit` request is sent and before its result arrives
- **THEN** the tool call settles as `outcome_unknown` and the edit is not sent again

#### Scenario: Expired request is refused

- **WHEN** a request reaches the daemon after its deadline
- **THEN** the daemon refuses it without opening a file or starting a process

### Requirement: Bash runs on a Machine through its working directory

`bash` SHALL accept a Machine locator as `cwd` and run the command on that Machine in that directory. While the Chat is bound to a Machine Workspace, an omitted or relative `cwd` SHALL resolve on that Machine. Declared `env` entries SHALL be added to the daemon's environment. Output, input, duration, and process bounds SHALL apply as locally. Cancelling the call, its timeout, or losing the session SHALL terminate the command's process tree.

#### Scenario: Command runs remotely in the given directory

- **WHEN** the model calls `bash` with `cwd: "machine://devl/home/me/shop"` and `command: "pwd"`
- **THEN** the output is `/home/me/shop` produced on `devl`

#### Scenario: Lost caller kills the remote process tree

- **WHEN** the worker running a long `bash` call on `devl` exits
- **THEN** the daemon terminates that command's process tree and the call settles under the native fence rules

#### Scenario: Relative cwd inside a Machine Workspace

- **WHEN** the Chat is bound to `machine://devl/home/me/shop` and the model calls `bash` with `cwd: "packages/ui"`
- **THEN** the command runs on `devl` in `/home/me/shop/packages/ui`

### Requirement: Workspace entry accepts Machine locators

`enter_workspace` SHALL accept a Machine locator. The submitted and canonical locators SHALL each be evaluated by the `enter_workspace` permission group. On success the Chat SHALL be bound to the canonical Machine locator and the executor identity `machine:<name>`, and relative native and `bash` paths SHALL resolve on that Machine. `exit_workspace` SHALL succeed whether or not the Machine is reachable.

#### Scenario: Entry binds the Machine Workspace

- **WHEN** the model calls `enter_workspace` with `machine://devl/home/me/shop`
- **THEN** the binding is `machine://devl/home/me/shop` with executor `machine:devl`
- **AND** a later relative `read` of `README.md` reads `machine://devl/home/me/shop/README.md`

#### Scenario: Exit works while the Machine is offline

- **WHEN** the Chat is bound to a `devl` Workspace and `devl` is unreachable
- **THEN** `exit_workspace` clears the binding

### Requirement: Machine Workspaces load instruction files and skills from the Machine

Entering or switching to a Machine Workspace SHALL load the instruction-file chain and Workspace skill sources from the Machine with the same discovery, ordering, bounds, and disclosure as a local Workspace, using Machine locators in place of host paths.

#### Scenario: Repository instructions apply on a Machine

- **WHEN** the model enters `machine://devl/home/me/shop` and `/home/me/shop/AGENTS.md` exists on `devl`
- **THEN** that file is loaded into the instruction chain as it would be for a local Workspace

### Requirement: Workspace MCP servers of a Machine Workspace run from the Machine

The Machine SHALL read the Workspace MCP files and resolve their interpolation against its own environment and filesystem. It SHALL start stdio servers and open HTTP servers itself, so URLs resolve from the Machine's network. The hub SHALL send only a server name, never a command, URL, or header. The MCP protocol client, admission, shadowing, permissions, and redaction SHALL remain on the hub as for a local Workspace.

#### Scenario: Localhost means the Machine

- **WHEN** a Machine Workspace's `.mcp.json` declares `"storybook": { "type": "http", "url": "http://localhost:6006/mcp" }` and Storybook runs on `devl`
- **THEN** the server's tools are offered as they would be locally, reached through `devl`'s `localhost`

#### Scenario: Hub secrets do not reach the Machine

- **WHEN** a Machine Workspace's `.mcp.json` uses `{env:OPENAI_API_KEY}` and only the hub defines that variable
- **THEN** that server is unavailable with the unset-variable diagnostic and no hub value is sent to `devl`

#### Scenario: Machine-resolved secrets stay redacted

- **WHEN** a server's header is resolved on `devl` from `{env:REPO_TOKEN}`
- **THEN** the resolved value is redacted from declarations, results, diagnostics, and receipts as for a local Workspace server

### Requirement: Machine Workspace MCP lifetime follows local Workspace rules

Machine Workspace MCP clients SHALL be keyed by Chat, executor, canonical root, and Workspace generation, and SHALL start, stop, idle out, and discard stale keys as local Workspace clients do. Stopping a client SHALL terminate its server process on the Machine. A lost channel SHALL be treated as a crashed server: calls fail in the current Run and the server returns at a later attempt once reachable.

#### Scenario: Channel loss behaves like a crashed server

- **WHEN** `devl` becomes unreachable during a Run that declared a `devl` Workspace server's tools
- **THEN** further calls to those tools in that Run fail with `machine_unavailable`
- **AND** the next attempt does not offer them until `devl` is reachable again

### Requirement: Permission rules match canonical Machine locators

Every Machine operation SHALL be matched by its permission group as the canonical Machine locator text, with a `read` selector removed, including `bash` `cwd` and both `enter_workspace` spellings. A rule written for a local host path SHALL NOT admit a Machine locator, and a Machine rule SHALL NOT admit another Machine.

#### Scenario: Local rule does not admit a remote path

- **WHEN** the only `read` allow is `^/home/me/` and the model reads `machine://devl/home/me/notes.md`
- **THEN** the call is denied as having no applicable allow

#### Scenario: Machine rule is scoped to its Machine

- **WHEN** the only `read` allow is `^machine://devl/home/me/` and the model reads `machine://gpu/home/me/notes.md`
- **THEN** the call is denied

### Requirement: An unreachable Machine does not detach its Workspace

When the bound Machine is unreachable, the binding SHALL persist and only operations targeting that Machine SHALL fail, with `machine_unavailable`. Every other tool SHALL keep working. The model and owner SHALL receive one narrated unavailability transition and one recovery transition. A Machine removed from configuration SHALL detach the binding as `executor_absent`.

#### Scenario: Chat keeps working while its Machine is offline

- **WHEN** the Chat is bound to a `devl` Workspace, `devl` is unreachable, and the model reads an HTTPS URL and `machine://gpu/srv/app/README.md`
- **THEN** both reads succeed while a relative read fails with `machine_unavailable`

#### Scenario: Recovery is narrated once

- **WHEN** `devl` becomes reachable again before a later Run
- **THEN** that Run's context records one recovery transition and relative paths resolve on `devl` without re-entry

#### Scenario: Removed Machine detaches

- **WHEN** the operator removes `devl` from configuration while a Chat is bound to it
- **THEN** that Chat's next Run detaches the Workspace with reason `executor_absent`

### Requirement: Machine status is derived from contact and visible

The hub SHALL record per Machine the first and last successful contact, the last failure with its reason and identifiable failing hop, the daemon and protocol versions, and the registered roots. Status SHALL be online when the last contact is within the inactivity window and later than the last failure, otherwise offline. The hub SHALL retry unreachable Machines in the background.

#### Scenario: Offline Machine names its failing hop

- **WHEN** `laptop2` in `devl`'s route is unreachable
- **THEN** the Machines list shows `devl` offline with failing hop `laptop2` and its last-seen time

#### Scenario: Crashed holder does not leave a Machine online

- **WHEN** the process that last contacted `devl` crashes and no process reaches `devl` within the inactivity window
- **THEN** `devl` is reported offline

### Requirement: Owners can see Machines and their Workspace's Machine status

Authenticated users SHALL see a read-only Machines list with each Machine's name, status, last seen, failing hop, daemon version, and registered roots. A Chat bound to a Machine Workspace SHALL show the Machine name and its online or offline state in its Workspace indicator. The SSH destination, jump hosts, and identity SHALL NOT be shown.

#### Scenario: Workspace indicator shows offline Machine

- **WHEN** the owner opens a Chat bound to a `devl` Workspace while `devl` is offline
- **THEN** the Workspace indicator shows the Workspace on `devl` as offline

### Requirement: Machine listings are addressable

A `read` of bare `machine://` SHALL list configured Machines with their status. A `read` of `machine://<name>/` SHALL list that Machine's registered roots as Machine locators. `edit` and `write` SHALL reject both forms without effect.

#### Scenario: Model discovers registered roots

- **WHEN** the model reads `machine://devl/`
- **THEN** the result lists each registered root of `devl` as a `machine://devl/...` locator

### Requirement: Machine execution is disclosed as remote host authority

Tool descriptions and Machine Workspace narration SHALL state that Machine operations run as the Machine's OS user without sandboxing, bounded by registered roots for addressing only. Machine state SHALL never be described as isolation.

#### Scenario: Narration states host authority

- **WHEN** the model enters a Machine Workspace
- **THEN** the Workspace narration names the Machine and states that commands run with that Machine user's authority

### Requirement: Machine use preserves owner isolation of Chat state

Workspace bindings, Workspace MCP clients, native attempts, and results SHALL stay owner-scoped exactly as for local Workspaces, even when several owners use the same Machine. One owner's Chat SHALL NOT observe another owner's binding, Workspace MCP declarations, call state, or results on a shared Machine.

#### Scenario: Shared Machine does not leak another owner's Workspace

- **WHEN** users A and B each bind a Chat to a Workspace on `devl` with a Workspace server named `repo`
- **THEN** each Chat sees only its own binding, declarations, and results, and B's API cannot read A's binding

### Requirement: Machine locators extend local-only argument forms

Where `workspace-entry`, `native-file-tools`, `bash-execution`, `instruction-files`, or `mcp-tools` restrict an argument or root to an absolute host path or bind authority to the local native executor identity, a Machine locator SHALL additionally be accepted as specified here, and the Machine name SHALL count as part of the operator-authorized resource address, not as executor selection by the model. Local behavior SHALL be unchanged.

#### Scenario: Local Workspace behavior is unchanged

- **WHEN** the configuration declares Machines and the model enters an absolute local host path
- **THEN** entry, relative paths, instruction files, and Workspace MCP behave exactly as before this change
