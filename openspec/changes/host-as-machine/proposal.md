## Why

Every native operation on the API host branches between an in-process executor and the Machine
protocol ([#1627](https://github.com/leon0399/llame/issues/1627)). `ExecutorGit` checks
`target.machine === undefined` per method, and file tools, grep, instruction files, Workspace
skills, and Workspace MCP each carry a host path and a Machine path. Each new capability is written
and tested twice. The host has no version negotiation, and it cannot be confined later without
confining the worker that holds database and provider credentials. While a Chat is bound to a
Machine Workspace, the host is reachable only through the `file:` alias, and `bash` cannot reach it
at all ([#1363](https://github.com/leon0399/llame/issues/1363)).

This change makes the host an ordinary Machine and runs cutover layers 1-4 of
[Cutover: delete the in-process executor or keep a fallback](https://github.com/leon0399/llame/issues/1784#issuecomment-7044937891)
through today's Node Machine daemon and JSON-RPC wire. The Rust daemon and the gRPC contract later
replace both behind `MachineConnector`
([#1805](https://github.com/leon0399/llame/issues/1805),
[#1806](https://github.com/leon0399/llame/issues/1806)), so call sites move once. Feature issue:
[#1831](https://github.com/leon0399/llame/issues/1831).

The decisions come from the wayfinder map
[the way to one executor contract with Sandboxes](https://github.com/leon0399/llame/issues/1778)
and one grilling session. The ADRs that record the reasoning:

- [Host tools run through the Machine daemon](../../../docs/adr/2026-11-20-host-tools-run-through-the-machine-daemon.md)
- [Paths are machine-local, and permission rules match canonical locators](../../../docs/adr/2026-11-20-paths-are-machine-local.md)
- [A frozen bootstrap service beside an exactly matched Machine protocol](../../../docs/adr/2026-11-20-machine-daemon-frozen-bootstrap-service.md)

This change adds three ADRs from the grilling session:

- [The host Machine serves only its registered roots](../../../docs/adr/2026-11-20-host-machine-serves-only-registered-roots.md)
  (H3)
- [Installation resources stay in the installation](../../../docs/adr/2026-11-20-installation-resources-stay-in-the-installation.md)
  (H6)
- [The host Machine daemon child gets a base environment](../../../docs/adr/2026-11-20-host-daemon-child-gets-a-base-environment.md)
  (H18, `proposed` until Leo confirms)

The other H decisions sequence work or can be reversed cheaply, so they have no ADR. H4 is the
closest call. Relaxing it later costs one boot check, so it is recorded in design D3.

## What Changes

- **The host is a Machine.** The host is an ordinary `machines.hosts` entry. `machines.local` names
  the entry of the serving process, and `machines.default` names the current Machine of an unbound
  Chat. Both accept `{env:...}`, so co-located API and worker processes share one config file and
  a worker on another computer overrides `machines.local`. An entry's SSH `destination` becomes
  optional, so a host entry can be local only. **BREAKING**: `tools.nativeExecutorId` is deleted,
  and a config that still sets it fails startup and names `machines.local` as its replacement.
- **Boot validation.** Startup fails when `machines.local` or `machines.default` names no entry,
  when a native tool is allowlisted without `machines.default`, and when `machines.default` is
  neither this process's `machines.local` nor an entry with a `destination`. **BREAKING** for a
  Knowledge-only process that allowlists `read`: it must now declare a Machine.
- **Local child stdio.** For its `machines.local` entry, a process spawns
  `llame-machine serve --stdio` as a child, with the command taken from `LLAME_MACHINE_COMMAND`
  (default `llame-machine` on `PATH`). Other entries keep SSH stdio. The API starts without a host
  daemon. A host call then reports the existing Machine-unavailable states and never falls back to
  in-process execution.
- **Machine identity.** Each daemon creates a persistent instance id once in its state directory
  and reports it in `hello`, with static facts: release version, build id, OS, architecture,
  kernel, CPU count, total RAM, and total disk per root. The protocol version becomes 2, under the
  existing exact match. The installation binds each Machine name to the first instance id it
  meets and refuses a different one with `machine_identity_mismatch`. After a legitimate
  replacement, the operator runs `pnpm --filter api machines:forget <name>`, and the next contact
  binds the new id.
- **Locators.** Bare absolute paths, relative paths, `file:///...`, `file://localhost/...`, and
  `file:/...` resolve on the current Machine. A `file://` URI with another host is refused with a
  hint to use `machine://`. `machine://<name>/...` is the only machine-absolute form, and it
  reaches every Machine from any Workspace, the host included, also as a `bash` `cwd`. Every tool
  result and permission decision records the canonical `machine://` locator. **BREAKING**: host
  results report `machine://<host>/...` instead of a bare path.
- **Current Machine.** In a bound Chat, the current Machine is the Workspace's Machine. In an
  unbound Chat, it is `machines.default`, the same on every worker. The Workspace snapshot always
  names the current Machine. It is sent again when the current Machine differs from the one last
  told, and after each compaction. The unavailable and recovered items follow the current Machine,
  bound or unbound.
- **Permission rules.** A rule matches the tool's own parameters after normalization. For path
  parameters and `bash` `cwd`, the normalized value is the canonical locator. **BREAKING**: a bare
  `^/...` regex on a path parameter fails startup and names the rule. Allow and reject keep one
  language.
- **Stored ids.** One forward-only migration strips the `machine:` prefix from executor ids and
  rewrites bare host roots to `machine://<id>/...`. A host id keeps its value, so the operator
  names the host entry after the old `tools.nativeExecutorId`. An id outside the Machine name
  grammar fails the migration and names the id. Run events and message parts keep their recorded
  paths.
- **Host roots.** The host daemon serves only its registered roots, as every Machine does.
  **BREAKING**: a host path outside the roots fails with `path_not_registered` once its family
  moves to the daemon. An operator who wants the previous reach runs `llame-machine roots add /`.
- **Cutover.** File tools and grep, then git and worktrees through `ExecutorGit`, then Workspace MCP,
  instruction files, Workspace skills, and prompt imports move to the daemon, one family per layer.
  Each layer deletes that family's in-process host path, including for development and tests.
- **Host `bash` stays in process.** Host `bash` and background jobs keep running in the worker
  until [Background jobs on every Machine](https://github.com/leon0399/llame/issues/1785) is
  decided. When the `cwd` resolves on this process's `machines.local`, in-process `bash` runs and
  `async` works. On another Machine, daemon `proc.bash` runs synchronously, and `async` is refused
  with a hint that does not name the worker.

## Assumptions, confirmed with Leo

Settled decisions from closed tickets:

- [#1780](https://github.com/leon0399/llame/issues/1780#issuecomment-6991993244) Q21-Q24: SSH stdio
  stays remote, the host uses local child stdio, execution outlives a connection, `attach --stdio`
  starts or finds the daemon, no in-process fallback, and a persistent instance id.
- [#1781](https://github.com/leon0399/llame/issues/1781#issuecomment-6992970095) Q25-Q34: exact
  protocol match, a frozen bootstrap service, capabilities describe the box, two failure codes, an
  unchanging tool catalog, and one `machine://` listing line per Machine.
- [#1783](https://github.com/leon0399/llame/issues/1783#issuecomment-7044863376) Q35-Q41: the config,
  locator meaning, the current Machine and its reminder, normalized permission rules, the stored-id
  migration, the host from a Machine Workspace, and split deploys.
- [#1784](https://github.com/leon0399/llame/issues/1784#issuecomment-7044937891) Q42-Q44: delete the
  in-process executor, cut over to today's Node daemon first, and five layers.

Decisions from the grilling session of 2026-11-20, cited as H:

- **H1 (B).** Instance id now, attach later. The host spawns `serve --stdio` per process, and
  co-located processes report the same instance id because they share the state directory.
  `attach --stdio`, the local daemon socket, and execution that outlives a connection wait for
  layer 5 or the Rust daemon.
- **H2 (A).** `hello` gains the instance id and the static facts. There is no frozen bootstrap
  service and no schema-fingerprint check on the JSON-RPC wire. `machine_capability_missing` is
  added only where an operation in layers 1-4 needs it, and none does.
- **H3 (A).** The host daemon enforces registered roots, as every Machine does.
- **H4 (A).** `machines.local` and `machines.default` accept `{env:...}`, `destination` is
  optional, and `machines.default` is required when a native tool is allowlisted.
- **H5 (A).** The migration keeps a host id as the Machine name, verbatim.
- **H6 (A).** `kb://`, `skill://`, `artifact://`, operator skill directories, operator MCP servers,
  and prompt files stay installation resources served in process. Only host-path dispatch is
  deleted.
- **H7 (A).** `bash` routes by location: in process for this process's `machines.local`, daemon
  `proc.bash` elsewhere.
- **H8 (A).** `pnpm dev` and the integration suites build `apps/machine` first, and set
  `LLAME_MACHINE_COMMAND` to the built bundle.
- **H9 (A).** The Workspace snapshot names where tools resolve paths, in both the bound and unbound
  states, and never names the worker.
- **H10.** `file:/abs` stays, because RFC 8089 section 2 allows the `local-path` form.
- **H11 (A).** The `remote-machines` capability becomes `machines`.
- **H12 (B).** Between layers, each Machine keeps one authority: `machine://<local>/...` and the
  bare form are served in process until the layer that moves their family.
- **H13 (A).** A new feature issue, [#1831](https://github.com/leon0399/llame/issues/1831), covers
  layers 1-4. #1627 stays open for layer 5.
- **H14 (A).** The unavailable and recovered narration follows the current Machine.
- **H15 (A).** An `async` refusal off the local Machine names the Machine and not the worker.
- **H16 (A).** SPEC.md has no separate host executor. Section 13.9 records the one exception, host
  `bash` and background jobs.
- **H17 (A).** An operator command, `pnpm --filter api machines:forget <name>`, deletes the stored
  binding of a Machine name. The next contact then binds the new instance id.

Assumptions that follow and that Leo did not object to:

- Co-located API and worker processes each run their own daemon child. Both report one instance id,
  so they are one host Machine.
- A Chat bound to a Machine that has no `destination` and is not this process's `machines.local`
  detaches with `executor_mismatch`, as Q40 states.
- `stop` is advertised whenever `bash` is, because a job can run on any worker that hosts its
  Machine.
- The model-facing `machine://` listing includes the host Machine and shows one line per Machine:
  name, reachable, update required, OS, and architecture. The Machine status API returns the static
  facts with their capture time, and the settings view shows OS, architecture, and daemon version.

## Unresolved

- **H18.** The host daemon child receives only a base environment (design D4), so from layer 5 a
  host Workspace MCP declaration can no longer interpolate a variable that only the worker
  defines. This keeps database and provider credentials out of the daemon and matches the remote
  Machine rule. The alternative is to pass the full worker environment, which keeps today's
  behavior and gives every host Workspace MCP server a path to those credentials. The deltas assume
  the base environment. Leo to confirm.
- **H19.** The deltas show that H4 A costs more than the grilling round stated. Canonical scenarios
  describe four deployments without a host executor: Knowledge only (`native-files.md`, "Native
  tools are admitted by Knowledge root alone"), web and media `read` only ("Read is admitted by the
  allowlist alone"), skill-only `grep`, and `ssh://`-only `bash` ("Bash is offered without a local
  executor"). Under H4 A each of them fails startup until it declares a Machine. The deltas follow
  H4 A and rewrite those scenarios. The alternative is H4 B for these tools: `machines.default` stays
  optional, and a bare path in an unbound Chat fails with `executor_unavailable`. Leo to confirm
  H4 A with this cost, or switch.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `remote-machines`: the host as a configured Machine, `machines.local` and `machines.default`, the
  local child transport and its base environment, the instance id, the handshake facts,
  `machine_identity_mismatch` and `machines:forget`, the listing line, one locator rule, canonical
  locators in results, the host in Workspace skills, Workspace MCP, and instruction files, and one
  requirement that maps host-path wording in other capabilities to the current Machine. The
  finalize layer moves the capability to `machines` (H11).
- `native-file-tools`: the central locator requirement serves every path on the current Machine
  through its daemon, and the web-locator requirement drops its `^/` example.
- `grep-tool`: host scopes run through `fs.grep`, and `grep` is advertised whenever it is
  allowlisted.
- `tool-call-permissions`: path parameters project to canonical locators, a `^/` path regex fails
  startup, an allow for one Machine does not admit another, and the recommended policy is rewritten
  in canonical form.
- `workspace-entry`: the gate is `machines.default`, the binding stores the Machine name, and the
  re-check detaches on `executor_absent` or `executor_mismatch` as Q40 states.
- `repositories`: every checkout stores a Machine name and a canonical locator, and git runs only
  through a Machine daemon.
- `instruction-files`: the host chain starts at the containing registered root.
- `context-injection`: the Workspace snapshot names the current Machine, also when unbound, and
  never names the worker.
- `bash-execution`: `bash` routes by the Machine of its `cwd`, and `async` works only on the
  `machines.local` Machine.
- `chat-creation`: the host Machine can be offline, and the Workspace step needs a reachable
  Machine.
- `tool-calling`: native tools are advertised whenever allowlisted, because startup guarantees
  `machines.default`.
- `tool-artifacts`: artifact files stay on the `machines.local` Machine, and the notice says so.
- `ssh-locator`: scenarios no longer depend on `tools.nativeExecutorId` or a `^/` rule.

Deliberately unchanged, with the reading under which each holds. "Host-path wording in other
capabilities names the current Machine" in `remote-machines` gives that reading:

- `prompt-imports`: a bare or `file:` target resolves as native `read` resolves it, so it follows
  the current Machine. "A native executor is available" means the current Machine is reachable.
- `agent-skills`, `mcp-tools`: the `remote-machines` requirements for Workspace skills and Workspace
  MCP now name the host Machine. The `mcp-tools` interpolation rule resolves against the executing
  process, which is the Machine daemon (H18).
- `instance-config`: `machines` is validated in `remote-machines`, and `tools.nativeExecutorId` was
  never part of the setting surface.
- `background-jobs`: `chat_jobs.executor` holds the tool name, not an executor id, and jobs stay
  bound to the worker that started them.
- `native-file-tools` "Write creates or explicitly replaces", "Reads through symbolic links report
  the real path", and the image, PDF, and media requirements: their reported paths become canonical
  locators through the mapping requirement. Their Knowledge, web, and media rules do not change.
- `repositories` "Checkout registration inspects the path on its executor" and "Registration and
  removal obey the host access policy": a bare path in an API request resolves on
  `machines.default`, and decisions record canonical locators.

## Impact

- **Daemon:** `apps/machine` gains the instance id, the static facts, and protocol version 2.
  `packages/machine-protocol` gains the `hello` fields and `machine_identity_mismatch`.
- **API:** `MachineConnector` gains a local child transport, the config loader gains
  `machines.local` and `machines.default`, and the host branches of `native-files.ts`, `grep.ts`,
  `ExecutorGit`, the instruction and skill scopes, Workspace MCP, and prompt imports are deleted
  layer by layer. The tool prompts `read.md`, `edit.md`, `write.md`, `grep.md`, `bash.md`,
  `enter_workspace.md`, and `exit_workspace.md` and the Workspace snapshot prompts change.
- **Database:** one migration rewrites `chats`, `checkouts`, `project_repository_defaults`, and
  `projects`. `machines_status` gains the instance id and the facts.
- **Web:** the Machines settings section shows OS, architecture, and daemon version.
- **Development and tests:** `pnpm dev` and the integration suites build `apps/machine` before they
  start. Integration tests spawn a real daemon child. Unit tests keep the in-memory protocol peer.
- **Docs:** `SPEC.md`, the glossary, the operator runbooks (`machines.md`, `native-files.md`,
  `chat-creation.md`, `repositories.md`, `knowledge.md`, `ssh.md`, `web-read.md`, `skills.md`),
  the tool reference pages, and `CHANGELOG.md`, each in the layer that ships the behavior.

## Non-Goals

- The Rust daemon, the gRPC contract, `llame-machine attach --stdio`, and a local daemon socket.
- The frozen bootstrap service and the CI schema-fingerprint rule.
- Execution that outlives a connection, and host `bash` and background jobs through the daemon
  ([#1785](https://github.com/leon0399/llame/issues/1785)).
- Host Sandboxes and daemon-local policy
  ([#1827](https://github.com/leon0399/llame/issues/1827)).
- Upgrading a configured Machine daemon from llame
  ([#1815](https://github.com/leon0399/llame/issues/1815)).
- Live load and usage facts, and capabilities such as Sandbox mechanisms or tools found.

## Acceptance

- A process with `machines.local: "devl"` serves `read /etc/hostname` in an unbound Chat through
  its daemon child, and the result path is `machine://devl/etc/hostname`.
- A Chat bound to a remote Machine Workspace reads `machine://devl/...` and runs `bash` with
  `cwd: "machine://devl/..."` on the host.
- A config with `tools.nativeExecutorId` or a `^/` path regex fails startup with an error that
  names the key or the rule.
- After the migration, a Chat bound to the old host Workspace stays bound to
  `machine://<old id>/...`, and a Machine checkout's executor drops its `machine:` prefix.
- A daemon whose instance id differs from the one bound to its Machine name is refused with
  `machine_identity_mismatch`, and no tool call reaches it.
- With no host daemon available, the API starts, and a host read fails with
  `machine_unavailable`, never in process.
- A host read outside the registered roots fails with `path_not_registered`.
- No host-path branch of file tools, grep, git, Workspace MCP, instruction files, Workspace
  skills, or prompt imports remains, and integration tests exercise the host through a real
  daemon child.
