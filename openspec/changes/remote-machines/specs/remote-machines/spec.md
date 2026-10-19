## Purpose

Lets a Run use operator-configured remote Machines, reached over SSH, with the
same native file, `bash`, Workspace, and Workspace MCP contracts it uses on the
local executor, while the hub keeps the Run loop and its credentials.

## ADDED Requirements

### Requirement: Machines exist only when the operator configures them

The configuration SHALL accept an optional `machines` section under the closed published schema. When it is absent, no Machine tool argument, route, status read, or UI surface SHALL exist, and a `machine://` locator SHALL be refused as an unknown scheme exactly as today. Machines SHALL be operator-wide: every authenticated user whose Run passes tool eligibility and permissions MAY address them.

#### Scenario: Feature absent without configuration

- **WHEN** the configuration has no `machines` section and the model calls `read` with `machine://devl/etc/hostname`
- **THEN** the tool returns the existing unknown-scheme `invalid_path` error
- **AND** no SSH process is started and the settings Machines list is not offered

#### Scenario: Configured Machine is addressable by any eligible user

- **WHEN** two users' Runs both have `read` allowed for `machine://devl/...` and the configuration declares `devl`
- **THEN** both Runs can read from `devl`

### Requirement: Machine configuration is validated at startup

`machines.hosts` SHALL map each Machine name to a `destination`: an SSH host alias or `[user@]host[:port]`, without a leading `-`, whitespace, `%`, or shell metacharacter, and without interpolation. Optional `machines.ssh.knownHostsFile` (default the worker user's `~/.ssh/known_hosts`), `identityFile`, and `configFile` name the pinned host keys, a llame identity, and the SSH configuration to include. Names SHALL match `[a-z0-9-]{1,63}`. An invalid field SHALL fail startup naming it.

#### Scenario: Invalid Machine name fails startup

- **WHEN** `machines.hosts` contains the key `Dev_L`
- **THEN** startup fails naming `machines.hosts.Dev_L`

#### Scenario: Option-shaped destination fails startup

- **WHEN** a destination is `-oProxyCommand=sh`
- **THEN** startup fails naming that Machine's `destination`

#### Scenario: Omitted ssh settings use the worker user's SSH files

- **WHEN** `machines.hosts` declares a Machine and `machines.ssh` is absent
- **THEN** host keys are checked strictly against the worker user's `~/.ssh/known_hosts` and the worker user's `~/.ssh/config` is included

#### Scenario: Executor identity cannot impersonate a Machine

- **WHEN** `tools.nativeExecutorId` begins with `machine:`
- **THEN** startup fails naming `tools.nativeExecutorId`

### Requirement: llame's SSH safety options override the included SSH configuration

The hub SHALL connect with a generated SSH configuration that sets its safety options first and then includes the configured SSH configuration, defaulting to the worker user's. For every hop the safety options SHALL win: host keys only from the pinned file with strict checking, no global known-hosts file, batch mode, no agent, no connection sharing, and connect and liveness timeouts. Aliases, jump hosts, users, ports, and identities SHALL come from the included configuration.

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

### Requirement: The Machine session is versioned and multiplexed

Each session SHALL begin with a handshake exchanging protocol versions; an incompatible version SHALL end it with reason `incompatible_version`. One session SHALL carry concurrent operations and Workspace MCP channels as independent streams. Stream identifiers SHALL never be reused within a session, and frames for unknown or closed streams SHALL be dropped. A missed liveness heartbeat SHALL end the session on both sides.

#### Scenario: Incompatible daemon is reported, not used

- **WHEN** the daemon on `devl` speaks a protocol version the hub does not support
- **THEN** every `devl` operation returns `machine_unavailable` with reason `incompatible_version`
- **AND** the Machines list shows the hub and daemon versions

#### Scenario: Concurrent operations share one session

- **WHEN** a `bash` call is running on `devl` and the model reads a `devl` file in another tool call
- **THEN** both complete over the same session without waiting for each other

#### Scenario: Late frame cannot answer another stream

- **WHEN** a frame arrives for a stream that has closed
- **THEN** it is dropped and delivered to no other stream

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

Every path a Machine operation returns, including real paths, listing headers, link targets, mutation paths, and error messages, SHALL be a canonical Machine locator. While a Chat is bound to a Machine Workspace, a bare absolute path or absolute `bash` `cwd` SHALL be mapped to that Machine's locator before permission evaluation and execution; a `file:` alias still addresses the local executor.

#### Scenario: Listing shows Machine locators

- **WHEN** the model lists `machine://devl/home/me/shop/`
- **THEN** the header and every link target inside the roots are Machine locators

#### Scenario: Bare absolute path maps to the Machine Workspace

- **WHEN** the Chat is bound to `machine://devl/home/me/shop` and the model reads `/home/me/shop/README.md`
- **THEN** the call is evaluated and executed as `machine://devl/home/me/shop/README.md`

#### Scenario: Local rule cannot admit a mapped path

- **WHEN** the only `read` allow is `^/home/me/`, the Chat is bound to a `devl` Workspace, and the model reads `/home/me/notes.md`
- **THEN** the call is denied as having no applicable allow for `machine://devl/home/me/notes.md`

### Requirement: Native file tools behave identically on a Machine

`read`, `edit`, and `write` SHALL accept Machine locators and SHALL produce the same contents, selectors, listings, bounds, media handling up to the existing media size cap, and error types as for the same file on the local executor, with paths reported as Machine locators. Machine operations SHALL NOT require or bind the local native executor identity.

#### Scenario: Selector read matches local behavior

- **WHEN** the model reads `machine://devl/home/me/shop/src/app.ts:10-20`
- **THEN** the result equals what a local read of the same file content with `:10-20` returns, apart from reported locators

#### Scenario: Large image is readable

- **WHEN** the model reads a 5 MiB PNG on `devl` with a vision-capable model
- **THEN** the image is attached as a local read of the same file would attach it

#### Scenario: Machine tools on a worker without a local executor

- **WHEN** a worker has no `tools.nativeExecutorId`, Machines are configured, and `read`, `edit`, `write`, `bash`, and `enter_workspace` are allowlisted
- **THEN** those tools are offered and operate on Machine locators while local host paths still return `executor_unavailable`

### Requirement: Machine mutations use the native effect fence

`edit`, `write`, and `bash` on a Machine SHALL record the durable native attempt before dispatch and its result after. A failure before dispatch SHALL return `machine_unavailable`; a session lost after dispatch and before a result SHALL settle as `outcome_unknown`. Requests SHALL carry Run, attempt, tool call, delivery sequence, and a relative time budget measured on the Machine's monotonic clock.

#### Scenario: Session lost mid-edit is unknown, not retried

- **WHEN** the SSH session drops after an `edit` request is sent and before its result arrives
- **THEN** the tool call settles as `outcome_unknown` and the edit is not sent again

#### Scenario: Unreachable Machine before dispatch is unavailable

- **WHEN** the session cannot be opened before an `edit` is sent
- **THEN** the call returns `machine_unavailable` and records no unknown outcome

#### Scenario: Exhausted budget is refused

- **WHEN** a request reaches the daemon after its time budget is spent
- **THEN** the daemon refuses it without opening a file or starting a process

### Requirement: Bash runs on a Machine through its working directory

`bash` SHALL accept a Machine locator as `cwd` and run on that Machine there; in a Machine Workspace an omitted or relative `cwd` SHALL resolve on that Machine. The environment SHALL be the managed base environment plus declared `env` entries, as locally. Local bounds SHALL apply. Cancellation, the time budget, a missed heartbeat, or session loss SHALL terminate the command's process group.

#### Scenario: Command runs remotely in the given directory

- **WHEN** the model calls `bash` with `cwd: "machine://devl/home/me/shop"` and `command: "pwd"`
- **THEN** the output is `/home/me/shop` produced on `devl`

#### Scenario: Lost caller kills the remote process group

- **WHEN** the worker running a long `bash` call on `devl` exits or its network path is lost
- **THEN** the daemon terminates that command's process group and the call settles under the native fence rules

#### Scenario: Relative cwd inside a Machine Workspace

- **WHEN** the Chat is bound to `machine://devl/home/me/shop` and the model calls `bash` with `cwd: "packages/ui"`
- **THEN** the command runs on `devl` in `/home/me/shop/packages/ui`

### Requirement: Workspace entry accepts Machine locators

`enter_workspace` SHALL accept a Machine locator naming an existing directory. The submitted and canonical locators SHALL each be evaluated by the `enter_workspace` group. Success SHALL bind the canonical locator and executor `machine:<name>` without binding the Run to a local executor, and relative paths SHALL then resolve on that Machine. `exit_workspace` SHALL succeed whether or not the Machine is reachable.

#### Scenario: Entry binds the Machine Workspace

- **WHEN** the model calls `enter_workspace` with `machine://devl/home/me/shop`
- **THEN** the binding is `machine://devl/home/me/shop` with executor `machine:devl`
- **AND** a later relative `read` of `README.md` reads `machine://devl/home/me/shop/README.md`

#### Scenario: Exit works while the Machine is offline

- **WHEN** the Chat is bound to a `devl` Workspace and `devl` is unreachable
- **THEN** `exit_workspace` clears the binding

### Requirement: Machine instruction files are discovered within the containing root

For a Machine target, the instruction-file chain SHALL be discovered from the registered root containing it down to the target, through the Machine, with the local chain's ordering, bounds, and disclosure and with Machine locators as labels. Entry, Machine file-tool targets, and Machine prompt imports SHALL trigger loading as their local counterparts do.

#### Scenario: Repository instructions apply on a Machine

- **WHEN** the model enters `machine://devl/home/me/shop` and `/home/me/shop/AGENTS.md` exists on `devl`
- **THEN** that file is loaded into the instruction chain as it would be for a local Workspace

#### Scenario: Ancestors above the root are not read

- **WHEN** `/home/me/shop` is the registered root and `/home/me/AGENTS.md` exists on `devl`
- **THEN** `/home/me/AGENTS.md` is not loaded

### Requirement: Machine Workspace skills come from the Machine

A Machine Workspace's skill sources SHALL be read from the Machine at Run preparation with the local catalog's discovery, bounds, and snapshot rules. Activating or reading a Machine Workspace skill SHALL read its files from the Machine.

#### Scenario: Repository skill is offered on a Machine

- **WHEN** a Machine Workspace contains `.agents/skills/deploy/SKILL.md`
- **THEN** the `deploy` skill is offered and its files are read from `devl` on activation

### Requirement: Workspace MCP servers of a Machine Workspace run from the Machine

The Machine SHALL read the Workspace MCP files and resolve interpolation against its own environment and filesystem, start stdio servers, and open HTTP servers itself with the hub's HTTP safeguards. The hub SHALL send only a server name, never a command, URL, or header. The protocol client, admission, shadowing, permissions, and redaction SHALL stay on the hub.

#### Scenario: Localhost means the Machine

- **WHEN** a Machine Workspace's `.mcp.json` declares `"storybook": { "type": "http", "url": "http://localhost:6006/mcp" }` and Storybook runs on `devl`
- **THEN** the server's tools are offered as they would be locally, reached through `devl`'s `localhost`

#### Scenario: Hub secrets do not reach the Machine

- **WHEN** a Machine Workspace's `.mcp.json` uses `{env:OPENAI_API_KEY}` and only the hub defines that variable
- **THEN** that server is unavailable with the unset-variable diagnostic and no hub value is sent to `devl`

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

Every Machine operation SHALL be matched as its canonical locator text with the path decoded once and `.`, `..`, and trailing separators kept, with a `read` selector removed, including `bash` `cwd`, both `enter_workspace` spellings, and Machine skill reads. A reject matching the submitted or canonical text SHALL refuse; an allow SHALL be decided on the canonical text.

#### Scenario: Encoded spelling cannot bypass a reject

- **WHEN** a `read` reject matches `/.ssh/` and the model reads `machine://devl/home/me/%2Essh/id_ed25519`
- **THEN** the call is refused

#### Scenario: Root-anchored local rule does not admit a remote path

- **WHEN** the only `read` allow is `^/home/me/` and the model reads `machine://devl/home/me/notes.md`
- **THEN** the call is denied as having no applicable allow

#### Scenario: Machine rule is scoped to its Machine

- **WHEN** the only `read` allow is `^machine://devl/home/me/` and the model reads `machine://gpu/home/me/notes.md`
- **THEN** the call is denied

### Requirement: An unreachable Machine does not detach its Workspace

When the bound Machine is unreachable, the binding SHALL persist and only operations targeting that Machine SHALL fail, with `machine_unavailable`. Reachability SHALL be decided once per attempt. The model and owner SHALL receive one narrated unavailability transition and one recovery transition. A Machine removed from configuration SHALL detach as `executor_absent`, narrated as a removed Machine.

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

### Requirement: Machine status is derived from contact and visible

The hub SHALL record per Machine the first and last successful contact, the last failure with a reason from `unreachable`, `host_key_mismatch`, `auth_failed`, `incompatible_version`, or `session_lost`, versions, and registered roots. Status SHALL be online when last contact is within the inactivity window and after the last failure. The hub SHALL retry in the background.

#### Scenario: Offline Machine shows its failure reason

- **WHEN** `devl`'s host key no longer matches the pinned file
- **THEN** the Machines list shows `devl` offline with reason `host_key_mismatch` and its last-seen time

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

Authenticated users SHALL see a read-only Machines list with each Machine's name, status, last seen, failure reason, versions, and registered roots. A Chat bound to a Machine Workspace SHALL show the Machine name and online or offline state in its session details sidebar. SSH destinations, jump hosts, and identities SHALL NOT appear in any user- or model-facing surface. Requests without an authenticated identity SHALL NOT read Machine status.

#### Scenario: Session details shows an offline Machine

- **WHEN** the owner opens a Chat bound to a `devl` Workspace while `devl` is offline
- **THEN** the session details sidebar shows the Workspace on `devl` as offline

#### Scenario: Route details are not disclosed

- **WHEN** a user reads the Machines list or the model reads bare `machine://`
- **THEN** no SSH destination, jump-host name, or identity path appears

#### Scenario: Unauthenticated status read is refused

- **WHEN** a request without an authenticated identity reads Machine status
- **THEN** it is refused and no row is returned

### Requirement: Machine listings are addressable

A `read` of bare `machine://` SHALL list configured Machines with their status. A `read` of `machine://<name>` without a path SHALL list that Machine's registered roots as Machine locators. `machine://<name>/` SHALL address the absolute path `/`. `edit` and `write` SHALL reject the two listing forms without effect.

#### Scenario: Model discovers registered roots

- **WHEN** the model reads `machine://devl`
- **THEN** the result lists each registered root of `devl` as a `machine://devl/...` locator

### Requirement: Machine execution is disclosed as remote host authority

Tool descriptions and Machine Workspace narration SHALL state that Machine operations run as the Machine's OS user without sandboxing, that registered roots bound addressing only and can be changed by that user, and that a shared Machine provides no isolation between hub users.

#### Scenario: Narration states host authority

- **WHEN** the model enters a Machine Workspace
- **THEN** the Workspace narration names the Machine and states that commands run with that Machine user's authority

### Requirement: Hub-held Chat state stays owner-isolated on shared Machines

Workspace bindings, Workspace MCP clients and declarations, native attempts, results, and database rows SHALL stay owner-scoped exactly as for local Workspaces when several owners use one Machine. Files and processes on the Machine itself SHALL have no isolation between owners.

#### Scenario: Shared Machine does not leak another owner's hub state

- **WHEN** users A and B each bind a Chat to a Workspace on `devl` with a Workspace server named `repo`
- **THEN** each Chat sees only its own binding, declarations, and results, and B's API cannot read A's binding

### Requirement: Machine locators extend local-only argument forms

Where `workspace-entry`, `native-file-tools`, `bash-execution`, `instruction-files`, `agent-skills`, `prompt-imports`, `context-injection`, `tool-calling`, `tool-call-permissions`, or `mcp-tools` restrict an argument or root to an absolute host path, or gate on the local native executor identity, Machine locators and `machine:` executors SHALL be handled as specified here instead. The Machine name SHALL count as part of the operator-authorized resource address. Local behavior SHALL be unchanged.

#### Scenario: Local Workspace behavior is unchanged

- **WHEN** the configuration declares Machines and the model enters an absolute local host path
- **THEN** entry, relative paths, instruction files, and Workspace MCP behave exactly as before this change
