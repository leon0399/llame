# remote-machines Specification

## Purpose

Lets a Run use operator-configured remote Machines, reached over SSH, with the
same native file, `bash`, Workspace, and Workspace MCP contracts it uses on the
local executor, while the hub keeps the Run loop and its credentials.

## Requirements

### Requirement: Machines exist only when the operator configures them

The configuration can contain a `machines` section under the closed published schema. When the section is absent, no Machine exists. No Machine tool argument, route, status read, or UI surface then exists, and `machine://` is an unknown scheme. The host is a Machine only when `machines.hosts` declares it. Machines are operator-wide: every authenticated user whose Run passes tool eligibility and permissions can address them. These rules MUST apply to every Machine, the host Machine included.

#### Scenario: Feature absent without configuration

- **WHEN** the configuration has no `machines` section and allowlists no native tool
- **THEN** `GET /api/v1/machines` returns no Machine and the settings Machines list is not offered
- **AND** no SSH process or daemon child starts

#### Scenario: Configured Machine is addressable by any eligible user

- **WHEN** two users' Runs both have `read` allowed for `machine://devl/...` and the configuration declares `devl`
- **THEN** both Runs can read from `devl`

### Requirement: Machine configuration is validated at startup

`machines.hosts` MUST map each Machine name to an entry. An entry can have a `destination`: an SSH host alias or `[user@]host[:port]`, without a leading `-`, whitespace, `%`, a shell metacharacter, or interpolation. `machines.local` and `machines.default` can each be a Machine name or one whole-value `{env:...}` token, and the token MUST resolve to a name. The optional `machines.ssh.knownHostsFile` (default the worker user's `~/.ssh/known_hosts`), `identityFile`, and `configFile` name the pinned host keys, a llame identity, and the SSH configuration to include. Names MUST match `[a-z0-9-]{1,63}`.

Startup MUST fail and name the field in each of these cases:

- A field is not valid.
- `machines.local` or `machines.default` names no entry.
- `machines.default` is not the `machines.local` of this process and has no `destination`.
- A native tool is allowlisted and `machines.default` is absent.
- `tools.nativeExecutorId` is present.

#### Scenario: Invalid Machine name fails startup

- **WHEN** `machines.hosts` contains the key `Dev_L`
- **THEN** startup fails naming `machines.hosts.Dev_L`

#### Scenario: Option-shaped destination fails startup

- **WHEN** a destination is `-oProxyCommand=sh`
- **THEN** startup fails naming that Machine's `destination`

#### Scenario: A destination's port is the port connected to

- **WHEN** `gpu`'s destination is `me@gpu.lan:2222`
- **THEN** the hub connects as `me` to `gpu.lan` on port 2222

#### Scenario: Omitted ssh settings use the worker user's SSH files

- **WHEN** `machines.hosts` declares a Machine with a `destination` and `machines.ssh` is absent
- **THEN** host keys are checked strictly against the worker user's `~/.ssh/known_hosts` and the worker user's `~/.ssh/config` is included

#### Scenario: Executor identity cannot impersonate a Machine

- **WHEN** the configuration sets `tools.nativeExecutorId`
- **THEN** startup fails naming `tools.nativeExecutorId` and `machines.local` as its replacement

#### Scenario: The local Machine name comes from the environment

- **WHEN** `machines.local` is `{env:LLAME_MACHINE}` and the worker environment sets `LLAME_MACHINE` to `gpu`
- **THEN** that worker hosts the entry `gpu`

#### Scenario: An unreachable default Machine fails startup

- **WHEN** `machines.default` is `devl`, the entry `devl` has no `destination`, and this process sets `machines.local` to `gpu`
- **THEN** startup fails naming `machines.default`

#### Scenario: A native tool needs a default Machine

- **WHEN** `read` is allowlisted and `machines.default` is absent
- **THEN** startup fails naming `machines.default`

### Requirement: llame's SSH safety options override the included SSH configuration

The hub SHALL connect with a generated SSH configuration that sets its safety options first and then includes the configured SSH configuration, defaulting to the worker user's. For every hop ssh itself opens the safety options SHALL win: host keys only from the pinned file with strict checking, no global known-hosts file, batch mode, no agent, no connection sharing, and connect and liveness timeouts. Aliases, jump hosts, users, ports, and identities SHALL come from the included configuration.

#### Scenario: Unpinned jump-host key is refused

- **WHEN** the included configuration routes `devl` through `bastion` and `bastion`'s host key is not in the pinned file
- **THEN** the connection fails with reason `host_key_mismatch` and no request is sent

#### Scenario: Included configuration cannot weaken host-key checking

- **WHEN** the included configuration sets `StrictHostKeyChecking accept-new` and `ControlMaster auto` for `devl`
- **THEN** the connection still requires a pinned host key and shares no connection

#### Scenario: Alias and bastion come from the included configuration

- **WHEN** `devl`'s destination is the alias `box`, which the included configuration resolves through a bastion with its own identity
- **THEN** the hub reaches `devl` through that bastion

#### Scenario: Black-holed hop fails within the bound

- **WHEN** a hop silently drops packets
- **THEN** the connection attempt fails within the configured connect timeout with reason `unreachable`

#### Scenario: A ProxyCommand hop is outside the guarantees

- **WHEN** the included configuration reaches `devl` through `ProxyCommand ssh gateway -W %h:%p`
- **THEN** that command runs as written, and the safety options govern only the connection ssh makes to `devl` through it

### Requirement: Registered roots bound every Machine address

The daemon SHALL accept a path only when it lies within a root registered in the daemon's configuration on that Machine, checked lexically before any probe and again on the canonical form of the path or its nearest existing ancestor, and re-verified after opening. A refusal SHALL return `path_not_registered` with fixed text, whether or not the target exists. Listings SHALL hide link targets outside the roots. Roots bound addressing only: they are not a security boundary.

#### Scenario: Path outside the roots is refused even when policy allows it

- **WHEN** hub permission policy allows `machine://devl/home/me/.ssh/id_ed25519` but no registered root contains that path
- **THEN** `read` returns `path_not_registered` and the daemon opens no file

#### Scenario: Symbolic link escape is refused

- **WHEN** a registered root contains a symbolic link pointing outside every registered root and the model reads or creates a file through it
- **THEN** the operation returns `path_not_registered`

#### Scenario: Refusal does not reveal existence

- **WHEN** the model reads an absent path and an existing path, both outside the roots
- **THEN** both return the identical `path_not_registered` result

### Requirement: Machine locators name a configured Machine and an absolute path

A Machine locator SHALL have the form `machine://<name><absolute path>[:selector]`. Scheme and name SHALL be case-insensitive and canonicalized to lowercase. The selector SHALL split before percent-escapes decode once to strict UTF-8 under the `file:` alias rules. Results SHALL report the canonical locator, re-encoding only characters the grammar requires, and SHALL NOT expose the SSH route or identity. An unconfigured name SHALL return `machine_not_found` without SSH.

#### Scenario: Unknown Machine is refused locally

- **WHEN** the model reads `machine://nope/etc/hostname` and `nope` is not configured
- **THEN** the tool returns `machine_not_found` and no SSH process is started

#### Scenario: Result reports the canonical locator

- **WHEN** the model reads `MACHINE://DEVL/home/me/shop/README.md:1-5`
- **THEN** the result identifies `machine://devl/home/me/shop/README.md` and contains lines 1 through 5 as a local read would

#### Scenario: Reported locator round-trips

- **WHEN** a result reports a locator for a file whose name contains `#`
- **THEN** submitting that reported locator addresses the same file

### Requirement: Machine results report Machine locators, not host paths

Every path that a Machine operation returns MUST be a canonical Machine locator. This includes real paths, listing headers, link targets, mutation paths, and error messages, on every Machine, the host Machine included. The hub MUST map a bare absolute path, a `file:` locator, and an absolute `bash` `cwd` to the locator on the current Machine. The hub MUST do this before permission evaluation and execution.

#### Scenario: Listing shows Machine locators

- **WHEN** the model lists `machine://devl/home/me/shop/`
- **THEN** the header and every link target inside the roots are Machine locators

#### Scenario: Bare absolute path maps to the Machine Workspace

- **WHEN** the Chat is bound to `machine://devl/home/me/shop` and the model reads `/home/me/shop/README.md`
- **THEN** the call is evaluated and executed as `machine://devl/home/me/shop/README.md`

#### Scenario: Local rule cannot admit a mapped path

- **WHEN** the only `read` allow is `^machine://gpu/home/me/`, the Chat is bound to a `devl` Workspace, and the model reads `/home/me/notes.md`
- **THEN** the call is denied as having no applicable allow for `machine://devl/home/me/notes.md`

#### Scenario: Host results report the host Machine locator

- **WHEN** the host Machine is `devl`, no Workspace is bound, `machines.default` is `devl`, and the model reads `/etc/hostname`
- **THEN** the result path is `machine://devl/etc/hostname`

### Requirement: Native file tools behave identically on a Machine

`read`, `edit`, and `write` MUST accept Machine locators. They MUST give the same contents, selectors, listings, bounds, media handling up to the existing media size cap, and error types on every Machine. Each path in a result MUST be a Machine locator. An operation on a Machine MUST NOT need the process to host that Machine.

#### Scenario: Selector read matches local behavior

- **WHEN** the model reads `machine://devl/home/me/shop/src/app.ts:10-20`
- **THEN** the result equals a read of the same file content with `:10-20` on another Machine, apart from reported locators

#### Scenario: Large image is readable

- **WHEN** the model reads a 5 MiB PNG on `devl` with a vision-capable model
- **THEN** the image is attached as a read of the same file on the host Machine attaches it

#### Scenario: Machine tools on a worker without a local executor

- **WHEN** a worker has no `machines.local`, `machines.default` is `devl` with a `destination`, and `read`, `edit`, `write`, `bash`, and `enter_workspace` are allowlisted
- **THEN** those tools are offered, and bare paths in an unbound Chat operate on `devl`

### Requirement: Machine mutations use the native effect fence

`edit`, `write`, and `bash` on a Machine SHALL record the durable native attempt before dispatch and its result after. A failure before dispatch SHALL return `machine_unavailable`; a file mutation whose session is lost after dispatch and before its result SHALL settle as `outcome_unknown`. A daemon-held bash job SHALL instead follow the binding and reconciliation rules of `background-jobs`.

Each mutating RPC other than `McpService.OpenSession` SHALL carry an installation-drawn idempotency key. The field SHALL be `request_id`, except `JobService.CreateJob`, whose persisted `job_id` SHALL be its key. The tool call id SHALL travel as `x-llame-tool-call-id`, and trace context as `sentry-trace` and `baggage`. The deadline SHALL be the gRPC timeout. Run, attempt, and delivery sequence SHALL stay in the durable native attempt record and SHALL NOT be sent to the daemon.

#### Scenario: Session lost mid-edit is unknown, not retried

- **WHEN** the SSH session drops after an `edit` request is sent and before its result arrives
- **THEN** the tool call settles as `outcome_unknown` and the edit is not sent again

#### Scenario: Unreachable Machine before dispatch is unavailable

- **WHEN** the session cannot be opened before an `edit` is sent
- **THEN** the call returns `machine_unavailable` and records no unknown outcome

#### Scenario: Exhausted budget is refused

- **WHEN** a request reaches the daemon after its time budget is spent
- **THEN** the daemon refuses it without opening a file or starting a process

### Requirement: Workspace entry accepts Machine locators

`enter_workspace` MUST accept a Machine locator or a bare absolute path that names an existing directory. A bare path MUST resolve on the current Machine. The `enter_workspace` group MUST evaluate the submitted and the canonical locators. Success MUST bind the canonical locator and the Machine name as executor. Relative paths MUST then resolve on that Machine. `exit_workspace` MUST succeed whether or not the Machine is reachable.

#### Scenario: Entry binds the Machine Workspace

- **WHEN** the model calls `enter_workspace` with `machine://devl/home/me/shop`
- **THEN** the binding is `machine://devl/home/me/shop` with executor `devl`
- **AND** a later relative `read` of `README.md` reads `machine://devl/home/me/shop/README.md`

#### Scenario: Exit works while the Machine is offline

- **WHEN** the Chat is bound to a `devl` Workspace and `devl` is unreachable
- **THEN** `exit_workspace` clears the binding

#### Scenario: A bare path enters a Workspace on the current Machine

- **WHEN** no Workspace is bound, `machines.default` is `devl`, and the model calls `enter_workspace` with `/home/me/shop`
- **THEN** the binding is `machine://devl/home/me/shop` with executor `devl`

### Requirement: Machine instruction files are discovered within the containing root

The hub MUST discover the instruction-file chain of each Machine target, the host Machine included. The chain MUST start at the registered root that contains the target and end at the target. The hub MUST read the chain through the Machine daemon. The chain MUST keep the ordering, bounds, and disclosure of `instruction-files`, with Machine locators as labels. Entry, file-tool targets, and prompt imports MUST start the load on every Machine.

#### Scenario: Repository instructions apply on a Machine

- **WHEN** the model enters `machine://devl/home/me/shop` and `/home/me/shop/AGENTS.md` exists on `devl`
- **THEN** that file is loaded into the instruction chain

#### Scenario: Ancestors above the root are not read

- **WHEN** `/home/me/shop` is the registered root and `/home/me/AGENTS.md` exists on `devl`
- **THEN** `/home/me/AGENTS.md` is not loaded

### Requirement: Machine Workspace skills come from the Machine

The hub MUST read the skill sources of a Workspace from its Machine at Run preparation, the host Machine included. The catalog MUST keep the discovery, bounds, and snapshot rules of `agent-skills`. The activation or read of a Workspace skill MUST read its files from that Machine. Operator skill directories MUST stay installation resources.

#### Scenario: Repository skill is offered on a Machine

- **WHEN** a Machine Workspace contains `.agents/skills/deploy/SKILL.md`
- **THEN** the `deploy` skill is offered and its files are read from `devl` on activation

#### Scenario: Host Workspace skills come from the host Machine daemon

- **WHEN** the Chat is bound to a Workspace on the host Machine `devl` that contains `.agents/skills/deploy/SKILL.md`
- **THEN** the hub reads the skill files through the `devl` daemon

### Requirement: Workspace MCP servers of a Machine Workspace run from the Machine

The Machine MUST read the Workspace MCP files of a Workspace on it, the host Machine included. The Machine MUST resolve interpolation against its own environment and filesystem. The Machine MUST start stdio servers and open HTTP servers itself, with the HTTP safeguards of the hub. The hub MUST send only a server name, never a command, URL, or header. The protocol client, admission, shadowing, permissions, and redaction MUST stay on the hub.

#### Scenario: Localhost means the Machine

- **WHEN** a Machine Workspace's `.mcp.json` declares `"storybook": { "type": "http", "url": "http://localhost:6006/mcp" }` and Storybook runs on `devl`
- **THEN** the server's tools are offered, reached through `devl`'s `localhost`

#### Scenario: Hub secrets do not reach the Machine

- **WHEN** a Machine Workspace's `.mcp.json` uses `{env:OPENAI_API_KEY}` and only the hub defines that variable
- **THEN** that server is unavailable with the unset-variable diagnostic and no hub value is sent to `devl`

#### Scenario: Worker secrets do not reach a host Workspace server

- **WHEN** a Workspace on the host Machine uses `{env:OPENAI_API_KEY}` in `.mcp.json` and only the worker environment sets it
- **THEN** that server is unavailable with the unset-variable diagnostic

### Requirement: Machine-resolved secrets are redacted on the hub

Opening a Machine Workspace server SHALL return the protected values of the exact definition started, including values learned later such as an HTTP session identifier, and the hub SHALL treat them as secrets on arrival. They SHALL be redacted from declarations, results, diagnostics, stderr, receipts, and persisted errors as for a local Workspace server.

#### Scenario: Machine-resolved header stays redacted

- **WHEN** a server's header is resolved on `devl` from `{env:REPO_TOKEN}`
- **THEN** the resolved value is redacted everywhere a local Workspace server's protected value is redacted

#### Scenario: Config change between discovery and start cannot leak

- **WHEN** `.mcp.json` changes on `devl` after server discovery and before the server starts
- **THEN** the hub redacts using the protected values of the definition actually started

### Requirement: Machine Workspace MCP lifetime follows local Workspace rules

Machine Workspace MCP clients SHALL be keyed by Chat, executor, canonical root, and Workspace generation, and SHALL start, stop, idle out, and discard stale keys as local Workspace clients do. Stopping a client SHALL terminate its server on the Machine. A lost channel SHALL be treated as a crashed server: in-flight and later calls in that Run fail, and the server returns at a later attempt once reachable.

#### Scenario: Channel loss behaves like a crashed server

- **WHEN** `devl` becomes unreachable during a Run that declared a `devl` Workspace server's tools
- **THEN** further calls to those tools in that Run fail with `machine_unavailable`
- **AND** the next attempt does not offer them until `devl` is reachable again

### Requirement: Permission rules match canonical Machine locators

The hub MUST match every Machine operation as its canonical locator text, on every Machine, the host Machine included. The hub MUST decode the path once, keep `.`, `..`, and trailing separators, and remove a `read` selector. This includes `bash` `cwd`, both `enter_workspace` spellings, and Workspace skill reads. A reject that matches the submitted text, the canonical text, or the projected path MUST refuse. The projected path is the decoded path without the scheme and the Machine name. The hub MUST decide an allow on the canonical text.

#### Scenario: Encoded spelling cannot bypass a reject

- **WHEN** a `read` reject matches `/.ssh/` and the model reads `machine://devl/home/me/%2Essh/id_ed25519`
- **THEN** the call is refused

#### Scenario: Root-anchored local rule does not admit a remote path

- **WHEN** a `read` allow is the regex `^/home/me/`
- **THEN** startup fails and names that rule, so the rule admits no path on any Machine

#### Scenario: Machine rule is scoped to its Machine

- **WHEN** the only `read` allow is `^machine://devl/home/me/` and the model reads `machine://gpu/home/me/notes.md`
- **THEN** the call is denied

### Requirement: An unreachable Machine does not detach its Workspace

When the current Machine is unreachable, the binding MUST stay. Only operations on that Machine MUST fail, with `machine_unavailable`. The hub MUST decide reachability once per attempt. The model and the owner MUST get one narrated unavailability transition and one recovery transition, also in an unbound Chat whose default Machine is unreachable. A Machine that the operator removes from the configuration MUST detach as `executor_absent`, narrated as a removed Machine.

#### Scenario: Chat keeps working while its Machine is offline

- **WHEN** the Chat is bound to a `devl` Workspace, `devl` is unreachable, and the model reads an HTTPS URL and `machine://gpu/srv/app/README.md`
- **THEN** both reads succeed while a relative read fails with `machine_unavailable`

#### Scenario: Unavailability is narrated once

- **WHEN** two consecutive Runs start while `devl` stays unreachable
- **THEN** only the first records an unavailability transition

#### Scenario: Recovery is narrated once

- **WHEN** `devl` becomes reachable again before a later Run
- **THEN** that Run records one recovery transition and relative paths resolve on `devl` without re-entry

#### Scenario: Removed Machine detaches

- **WHEN** the operator removes `devl` from configuration while a Chat is bound to it
- **THEN** that Chat's next Run detaches the Workspace with reason `executor_absent` and narrates that the Machine was removed

#### Scenario: An unreachable default Machine is narrated in an unbound Chat

- **WHEN** no Workspace is bound, `machines.default` is `devl`, and `devl` is unreachable at the start of a Run
- **THEN** that Run records one unavailability transition for `devl`
- **AND** a bare-path read fails with `machine_unavailable`

### Requirement: Machine status is derived from contact and visible

The hub MUST record these data for each Machine:

- the first and last successful contact, and the last failure,
- the versions and the instance id,
- the static facts with their capture time, and the registered roots.

The failure reason MUST be one of `unreachable`, `host_key_mismatch`, `auth_failed`, `incompatible_version`, `session_lost`, or `identity_mismatch`.

The status MUST be online when the last contact is within the inactivity window and after the last failure. The hub MUST retry in the background. A process MUST probe and record status only for an entry that it can reach: its `machines.local` entry or an entry with a `destination`.

#### Scenario: Offline Machine shows its failure reason

- **WHEN** `devl`'s host key no longer matches the pinned file
- **THEN** the Machines list shows `devl` offline with reason `host_key_mismatch` and its last-seen time

#### Scenario: A worker that cannot reach a host entry records nothing

- **WHEN** the entry `devl` has no `destination` and a worker with `machines.local` set to `gpu` runs the probe
- **THEN** that worker records no contact and no failure for `devl`

#### Scenario: Crashed holder does not leave a Machine online

- **WHEN** the process that last contacted `devl` crashes and no process reaches `devl` within the inactivity window
- **THEN** `devl` is reported offline

### Requirement: Machine status changes are pushed to connected clients

Every status change SHALL be pushed to every connected signed-in client over the live WebSocket as `machine.upserted`, carrying the Machine exactly as `GET /api/v1/machines` lists it, so clients keep the stored list current without polling. A Machine pruned because the operator removed it from the configuration SHALL be pushed as `machine.deleted` with its name.

#### Scenario: A status change reaches every connected client

- **WHEN** the probe records a new contact or failure for `devl`
- **THEN** every connected client receives one `machine.upserted` message with `devl`'s current status, last seen, failure reason, versions, and roots
- **AND** a client applies it to the list it already holds instead of refetching

### Requirement: Authenticated users can see Machines and their Workspace's Machine status

Authenticated users MUST see a read-only Machines list. Each Machine MUST show its name, status, last seen, failure reason, versions, registered roots, and static facts with their capture time. The session details sidebar of a bound Chat MUST show the Machine name and its online or offline state. SSH destinations, jump hosts, identities, and instance ids MUST NOT appear in a user-facing or model-facing surface. A request without an authenticated identity MUST NOT read Machine status.

#### Scenario: Session details shows an offline Machine

- **WHEN** the owner opens a Chat bound to a `devl` Workspace while `devl` is offline
- **THEN** the session details sidebar shows the Workspace on `devl` as offline

#### Scenario: Route details are not disclosed

- **WHEN** a user reads the Machines list or the model reads bare `machine://`
- **THEN** no SSH destination, jump-host name, identity path, or instance id appears

#### Scenario: Unauthenticated status read is refused

- **WHEN** a request without an authenticated identity reads Machine status
- **THEN** it is refused and no row is returned

### Requirement: Machine listings are addressable

A `read` of bare `machine://` MUST list each configured Machine, the host Machine included, on one line. Each line MUST give the name, whether the Machine is reachable, whether its daemon needs an update, its OS, and its architecture. A `read` of `machine://<name>` without a path MUST list the registered roots of that Machine as Machine locators. `machine://<name>/` MUST address the absolute path `/`. `edit` and `write` MUST reject the two listing forms without effect.

#### Scenario: Model discovers registered roots

- **WHEN** the model reads `machine://devl`
- **THEN** the result lists each registered root of `devl` as a `machine://devl/...` locator

#### Scenario: The Machine listing includes the host Machine

- **WHEN** the host Machine is `devl`, `gpu` is a remote Machine, and the model reads `machine://`
- **THEN** the result has one line for `devl` and one line for `gpu`
- **AND** each line gives the name, reachability, update state, OS, and architecture

### Requirement: Machine execution is disclosed as remote host authority

Tool descriptions and Workspace narration MUST state these facts for every Machine, the host Machine included. Machine operations run as the OS user of the Machine with no Sandbox. Registered roots bound addressing only, and that user can change them. They MUST also state that a Machine that hub users share gives no isolation between them.

#### Scenario: Narration states host authority

- **WHEN** the model enters a Workspace on any Machine
- **THEN** the Workspace narration names the Machine and states that commands run with the authority of that Machine user

### Requirement: Hub-held Chat state stays owner-isolated on shared Machines

Workspace bindings, Workspace MCP clients and declarations, native attempts, results, and database rows SHALL stay owner-scoped exactly as for local Workspaces when several owners use one Machine. Files and processes on the Machine itself SHALL have no isolation between owners.

#### Scenario: Shared Machine does not leak another owner's hub state

- **WHEN** users A and B each bind a Chat to a Workspace on `devl` with a Workspace server named `repo`
- **THEN** each Chat sees only its own binding, declarations, and results, and B's API cannot read A's binding

### Requirement: Machine daemons answer typed git methods

The installation's git operations MUST map to `stead.machine.v1.GitService`:
`git.inspect` to `GetRepository`, `git.locate` to `LocateRepository`,
`git.state` to `GetStatus`, `git.worktreeAdd` to `CreateWorktree`,
`git.worktreeList` to `ListWorktrees`, and `git.worktreeRemove` to
`DeleteWorktree`. Other capabilities name the operations, and their results
keep the names those capabilities define. `LocateRepository` MUST start no git
process. `GetStatus` MUST take the git entry that the installation admitted and
MUST fail without starting git when that entry is no longer the nearest `.git`
entry of the path. Each method MUST take one typed request. Git MUST get an argument
array. A caller value that starts with `-` MUST fail before git starts with the
typed `invalid_input` failure in the response, as the `GitService` response
defines it. Other
caller values MUST follow `--end-of-options` or `--` where the subcommand
accepts one. A path MUST be absolute. A failed command MUST return a typed
failure with the git standard error.

#### Scenario: Repository is inspected

- **WHEN** the hub calls `git.inspect` on a Machine directory that holds a clone
- **THEN** the result carries the clone toplevel, `commonDir`, the `linked` flag, and the main worktree path for a linked worktree
- **AND** the result carries each remote name and URL, the branch, and the head commit

#### Scenario: Linked worktree is inspected

- **WHEN** the hub calls `git.inspect` on a directory that is a linked worktree
- **THEN** the result reports `linked` as true and the main worktree path
- **AND** `commonDir` names the git directory that the worktree shares with its main clone

#### Scenario: Input cannot reach a shell

- **WHEN** the hub asks for a branch named `a;touch /tmp/x` and a directory named `$(id)`
- **THEN** the daemon passes each value as one argument and starts no shell
- **AND** no file named `/tmp/x` appears

#### Scenario: Option-like value is invalid input

- **WHEN** the hub passes `baseRef` `--force` to `git.worktreeAdd`
- **THEN** the daemon returns `invalid_input` as a typed failure
- **AND** it starts no git command

#### Scenario: Git failure carries the standard error

- **WHEN** `git.worktreeAdd` names a branch that another checkout already uses
- **THEN** the daemon returns a typed failure with the git standard error text
- **AND** no worktree directory appears

#### Scenario: Locate starts no git process

- **WHEN** the hub calls `git.locate` on a Machine directory inside a clone
- **THEN** the result names the nearest `.git` entry as a Machine locator
- **AND** the daemon starts no git process

#### Scenario: State refuses a changed git entry

- **WHEN** the nearest `.git` entry of a path changed after an earlier `git.locate` and the hub calls `git.state` on that path
- **THEN** `GetStatus` returns a typed failure and starts no git process

### Requirement: Machine git calls run in a sanitized environment

The daemon MUST run every git call with `GIT_TERMINAL_PROMPT=0`, `LC_ALL=C`, and
`GIT_OPTIONAL_LOCKS=0`. It MUST disable repository hooks and the file-system
monitor for every call. It MUST end a call that passes its timeout.

#### Scenario: Credential prompt cannot block the daemon

- **WHEN** a git command asks for credentials on the terminal
- **THEN** the sanitized environment disables the prompt and git exits with an
  error
- **AND** the daemon returns that error as a typed failure

#### Scenario: Call timeout ends a stuck command

- **WHEN** a git command on an unresponsive file system passes the call timeout
- **THEN** the daemon ends the command and returns a typed failure

#### Scenario: Repository configuration runs no hook

- **WHEN** the target repository sets `core.fsmonitor` to a command and installs
  a `post-checkout` hook
- **THEN** `git.worktreeAdd` on that repository runs neither the command nor the
  hook
- **AND** the worktree is created

### Requirement: Worktree directories on a Machine lie inside a registered root

Before any git call, the daemon MUST apply the registered-root check of
"Registered roots bound every Machine address" to the worktree directory. That
check MUST use the nearest ancestor that exists of a directory that does not
exist yet. A refusal MUST return `path_not_registered` and start no git command.

#### Scenario: Worktree directory outside the roots is refused

- **WHEN** the hub asks for a worktree at a directory that no registered root
  contains
- **THEN** the daemon returns `path_not_registered`
- **AND** it starts no git command

#### Scenario: Symbolic link cannot widen a root

- **WHEN** a registered root holds a symbolic link to a directory outside every
  root and a git method targets a path through that link
- **THEN** the daemon returns `path_not_registered`

### Requirement: Machine git results report locators and rewritten errors

Every path field of a git result shown to an owner or model MUST be a Machine locator. The daemon MUST return absolute host paths and raw standard error. The installation MUST rewrite each registered-root prefix to the Machine locator form before the result leaves the installation for its caller. A failure result MUST carry that rewritten text.

#### Scenario: Results report Machine locators

- **WHEN** `git.inspect` succeeds on `/home/me/shop` on `devl`
- **THEN** the result reports the toplevel as `machine://devl/home/me/shop`
- **AND** no host path appears in any path field

#### Scenario: Standard error reports locators

- **WHEN** `git.worktreeAdd` on `devl` fails because
  `/home/me/.llame-worktrees/shop/x` already exists
- **THEN** the typed failure reports that path as
  `machine://devl/home/me/.llame-worktrees/shop/x`
- **AND** the failure text carries no bare host path for a registered root

### Requirement: Machine git discovery stays inside the registered root

`git.locate` MUST search only from the path up to the outermost registered root
that holds it. It MUST read nothing above that root. When no `.git` entry exists
in that range, it MUST return `no_repository_in_root`, not `not_a_repository`.
A path that is not a directory MUST return `root_missing`.

#### Scenario: A repository above the registered root is not found

- **WHEN** the registered root is `/srv/app`, the path is `/srv/app/web`, and the only `.git` entry is `/srv/.git`
- **THEN** `git.locate` returns `no_repository_in_root`
- **AND** the daemon reads nothing above `/srv/app`

### Requirement: Machine git state refuses repository data outside the registered roots

Before git starts, `git.state` MUST resolve the git directory, the common
directory, and each object alternate, with nested alternates. When one is
outside the registered roots, it MUST return `outside_registered_root` and
start no git process. This check does not cover git configuration files.

#### Scenario: An outside common directory is refused

- **WHEN** a worktree `.git` file inside `/srv/app` points to a git directory under `/home/me/repo`, outside every registered root
- **THEN** `git.state` returns `outside_registered_root`
- **AND** no git process starts

### Requirement: The host is a configured Machine

The host MUST be an ordinary entry in `machines.hosts`. `machines.local` MUST name the entry of the computer that runs the process. The process MUST discover the host daemon with a child that runs `attach --print-socket` and connect to the reported Unix socket. Every other Machine MUST use SSH discovery and Unix-socket forwarding. The command MUST come from `LLAME_MACHINE_COMMAND`. When it is unset, the process MUST run the repository build at `apps/machine/dist/<target>/llame-machine`, where `LLAME_MACHINE_BIN_DIR` replaces `apps/machine/dist` when set. `attach` MUST exit with status 78 when the running daemon reports another instance id than the one its own configuration directory holds; the installation MUST report that exit as `machine_identity_mismatch`. A discovery command that fails otherwise, such as an SSH forced command that still runs a daemon without `attach --print-socket`, MUST make the Machine unavailable with reason `unreachable`.

#### Scenario: The host is reached through a child process

- **WHEN** `machines.local` is `devl` and the model reads `machine://devl/etc/hostname`
- **THEN** the process starts `llame-machine attach --print-socket` as a child and reads the file through the daemon socket
- **AND** no SSH process starts

#### Scenario: Another worker reaches the host over SSH

- **WHEN** the entry `devl` has a `destination` and a worker with `machines.local` set to `gpu` reads `machine://devl/etc/hostname`
- **THEN** that worker reads the file through SSH to `devl`

#### Scenario: The child and the SSH login share one daemon configuration

- **WHEN** the entry `devl` has a `destination`, and the worker on `devl` starts its child with another configuration directory than the SSH login uses, while both share one state directory
- **THEN** the `attach` of the second path exits with status 78 and that path gets `machine_identity_mismatch`
- **AND** the operator documentation requires one configuration directory for both paths

#### Scenario: A crashed child starts again at the next call

- **WHEN** the discovery child for `devl` fails before a connection is established and the model then reads a file on `devl`
- **THEN** the process starts a new discovery child for that read

### Requirement: The default Machine is the current Machine of an unbound Chat

`machines.default` MUST name the Machine that serves an unbound Chat. The operator MUST configure the same default for every worker. A worker that does not host the default Machine MUST reach it through its `destination`. The snapshot of each attempt names the Machine that the attempt used, so a divergence is visible.

#### Scenario: An unbound Chat uses the default Machine

- **WHEN** `machines.default` is `devl`, no Workspace is bound, and the model reads `/etc/hostname`
- **THEN** the tool reads `machine://devl/etc/hostname`

#### Scenario: A divergent default is narrated

- **WHEN** one worker resolves `machines.default` to `devl`, another resolves it to `gpu`, and both serve attempts of one unbound Chat
- **THEN** each attempt carries a `workspace` snapshot that names the Machine that it used

#### Scenario: Two workers serve one unbound Chat on one Machine

- **WHEN** `machines.default` is `devl`, one worker hosts `devl`, and another worker serves the next attempt of the same unbound Chat
- **THEN** both attempts read and write files on `devl`

### Requirement: Host operations never fall back to in-process execution

The API MUST start when the host Machine daemon cannot start. Each operation on the host Machine MUST then fail with the existing Machine-unavailable results. The process MUST NOT run that operation in process. This includes host `bash`.

#### Scenario: A missing daemon fails the call

- **WHEN** `LLAME_MACHINE_COMMAND` names a program that does not exist and the model reads `/etc/hostname` on the host Machine
- **THEN** the read returns `machine_unavailable`
- **AND** no file is read in process

#### Scenario: The API starts without a host daemon

- **WHEN** the host Machine daemon cannot start
- **THEN** the API starts and the Machines list shows the host Machine offline with reason `unreachable`

### Requirement: The host Machine daemon receives only a base environment

The process MUST start the host Machine daemon child with only these variables when they are set: `PATH`, `LANG`, `TERM`, `HOME`, `TMPDIR`, `USER`, `LOGNAME`, `LLAME_MACHINE_CONFIG_DIR`, `LLAME_MACHINE_STATE_DIR`, `XDG_CONFIG_HOME`, `XDG_STATE_HOME`, `SENTRY_DSN`, `SENTRY_ENVIRONMENT`, and `SENTRY_RELEASE`. It MUST NOT pass other variables of the worker environment. A command that `LLAME_MACHINE_COMMAND` names can set more variables for the daemon, under operator control.

This decision bounds the environment only. The daemon still runs as the OS user of the worker, with that user's file access. A stdio server that it starts can read the worker environment through `/proc/<pid>/environ`. An operator who must keep hub credentials out of host Workspaces names a wrapper in `LLAME_MACHINE_COMMAND` that starts the daemon as a separate OS user. The [base-environment decision](../../../docs/adr/2026-11-20-host-daemon-child-gets-a-base-environment.md) records this limitation.

#### Scenario: A database credential does not reach the daemon

- **WHEN** the worker environment sets `POSTGRES_URL` and the process starts the host Machine daemon
- **THEN** the daemon environment does not contain `POSTGRES_URL`
- **AND** no process that the daemon starts inherits it

#### Scenario: A Sentry token does not reach the daemon

- **WHEN** the worker environment sets `SENTRY_AUTH_TOKEN` and `SENTRY_DSN`
- **THEN** the daemon environment contains `SENTRY_DSN` and does not contain `SENTRY_AUTH_TOKEN`

### Requirement: Each Machine daemon reports a persistent instance id

Each Machine daemon MUST create an instance id once and keep it in its configuration directory. Two daemons that start at the same time with one directory MUST report the same id. The bootstrap service MUST report the id, the release version, the build id, and the protocol version. The protocol version MUST be the integer in `packages/machine-protocol/proto/protocol.json`, and the hub MUST accept only an exact match.

#### Scenario: Two first starts agree on one id

- **WHEN** two daemon processes start at the same time with an empty configuration directory
- **THEN** both report the same instance id

#### Scenario: A daemon with another protocol version is not used

- **WHEN** `GetInfo` reports a protocol version other than the installation's
- **THEN** every operation on that Machine fails with `machine_update_required`

#### Scenario: A version 1 daemon is not used

- **WHEN** the SSH forced command of `devl` still runs a protocol version 1 daemon, which has no `attach --print-socket`
- **THEN** discovery fails and the Machines list shows `devl` offline with reason `unreachable`
- **AND** no main-service request is sent

#### Scenario: A daemon without unit-letter selectors is not used

- **WHEN** the SSH forced command of `devl` still runs a protocol version 2 daemon, which has no `L` selector forms and no `attach --print-socket`
- **THEN** discovery fails and the Machines list shows `devl` offline with reason `unreachable`
- **AND** no main-service request is sent

### Requirement: The installation binds each Machine name to one instance id

At the first successful bootstrap for a Machine name, the hub MUST record its instance id before the session accepts a main-service request. When a later bootstrap reports a different id, the hub MUST end the session before any main-service request. Each operation on that Machine MUST then return `machine_identity_mismatch`. When the hub cannot read or write the binding, the session MUST fail with `machine_unavailable`. The binding MUST stay when the operator removes the entry or the status is pruned.

An incompatible protocol version or UNIMPLEMENTED method MUST make the installation report `machine_update_required`. The daemon MUST NOT send either `machine_update_required` or `machine_identity_mismatch` as an `ErrorReason`; these decisions belong to the installation. `GetInfo` MUST remain callable before those checks, but no main-service call may precede them.

#### Scenario: A second computer under one name is refused

- **WHEN** `devl` is bound to one instance id and a daemon with another id answers for `devl`
- **THEN** the hub sends no main-service request to that daemon
- **AND** every `devl` operation returns `machine_identity_mismatch`
- **AND** the Machines list shows `devl` offline with reason `identity_mismatch`

#### Scenario: A removed and re-added name keeps its binding

- **WHEN** the operator removes `devl` from the configuration, the hub prunes its status, and the operator adds `devl` again with another computer
- **THEN** the first handshake of that computer gets `machine_identity_mismatch`

#### Scenario: An unreadable binding fails closed

- **WHEN** the database is unreachable at a handshake for `devl`
- **THEN** the session fails with `machine_unavailable` and no main-service request reaches the daemon

#### Scenario: Co-located processes share one host Machine

- **WHEN** an API process and a worker process on one computer both set `machines.local` to `devl` and each starts its own discovery child
- **THEN** both children discover the same daemon socket, both bootstrap handshakes report the same instance id, and both processes use `devl`

#### Scenario: A wrong local name is refused before host bash

- **WHEN** a worker on computer A sets `machines.local` to `gpu`, `gpu` is bound to the instance id of computer B, and the model calls `bash` on `gpu`
- **THEN** the call returns `machine_identity_mismatch`
- **AND** no command starts on computer A

### Requirement: An operator command rebinds a Machine name

`pnpm --filter api machines:forget <name>` MUST remove the instance id that the hub recorded for that Machine name. It MUST print the removed id. The next successful handshake for that name MUST then record the new id.

#### Scenario: A reinstalled Machine is accepted again

- **WHEN** the operator reinstalls `devl`, its new daemon reports a new instance id, and the operator runs `pnpm --filter api machines:forget devl`
- **THEN** the next handshake for `devl` records the new id and operations on `devl` succeed

### Requirement: One locator rule addresses every Machine

A bare absolute path, a relative path, `file:/path`, `file:///path`, and `file://localhost/path` MUST resolve on the current Machine. A relative path MUST also need a bound Workspace. A `file://` locator with any other host MUST return `invalid_path` with a hint to use `machine://`. `machine://<name>/path` MUST be the only form that names a Machine, the host Machine included.

#### Scenario: A file locator follows the current Machine

- **WHEN** the Chat is bound to `machine://gpu/srv/app` and the model reads `file:///etc/hostname`
- **THEN** the tool reads `machine://gpu/etc/hostname`

#### Scenario: A file locator with another host is refused

- **WHEN** the model reads `file://devl/etc/hostname`
- **THEN** the tool returns `invalid_path` with a hint to use `machine://devl/etc/hostname`

#### Scenario: The host is reachable from a Machine Workspace

- **WHEN** the Chat is bound to `machine://gpu/srv/app`, the host Machine is `devl`, and the model reads `machine://devl/home/me/notes.md`
- **THEN** the tool reads the file on `devl`

#### Scenario: Installation resources do not follow the current Machine

- **WHEN** the Chat is bound to `machine://gpu/srv/app` and the model reads `kb://<space>/index.md`
- **THEN** the tool reads the Knowledge file as it does in an unbound Chat

### Requirement: Host-path wording in tool capabilities names the current Machine

This rule covers `native-file-tools`, `grep-tool`, `bash-execution`, `workspace-entry`, `instruction-files`, `prompt-imports`, and `repositories`. There, "host path" and "local path" for a tool argument mean a path on the current Machine. "Native host", "native executor", and "trusted host executor" MUST mean the current Machine through its daemon. "Local executor" means the `machines.local` Machine.

#### Scenario: A host path argument resolves on the current Machine

- **WHEN** `prompt-imports` resolves an absolute host target in a Chat bound to `machine://gpu/srv/app`
- **THEN** the target resolves on `gpu`

#### Scenario: A missing executor condition means no local Machine

- **WHEN** a scenario in those capabilities states that the process has no `tools.nativeExecutorId`
- **THEN** it holds for a process that has no `machines.local`

### Requirement: Tool results in those capabilities report Machine locators

A result in the capabilities of the previous requirement that reports an absolute or host path MUST report its canonical `machine://` locator. Installation configuration, such as prompt files and operator MCP commands, and non-disclosure rules MUST keep their meaning: the filesystem of the serving process.

#### Scenario: A host-path result is a Machine locator

- **WHEN** a capability states that a result reports the absolute path used, and the model reads `/work/project/a.md` on the current Machine `devl`
- **THEN** the result reports `machine://devl/work/project/a.md`

#### Scenario: A prompt file path stays private

- **WHEN** a model entry sets `systemPromptFile` to an absolute path
- **THEN** the API process reads that file from its own filesystem
- **AND** no Machine daemon reads it, and no surface discloses the path

### Requirement: The handshake calls the bootstrap service

A Machine connection MUST call `BootstrapService.GetInfo` first, check the
reported protocol version, and bind the instance id to the Machine name.
Only after those checks succeed may it call `MachineService.ListRoots`,
`MachineService.GetLimits`, or another main-service method. Discovery MUST use
`llame-machine attach --print-socket`; the installation MUST connect to the
reported Unix socket directly for the host or through an SSH socket forward.

#### Scenario: The host is reached through attach

- **WHEN** the API connects to the host Machine
- **THEN** it starts `llame-machine attach --print-socket` as a child and calls `GetInfo` first
