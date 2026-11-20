## Context

See proposal.md, Why. The facts below were read from the code on `master` at `83f094448` and shape
the approach.

- **No executor interface exists.** The in-process executor is `ToolContext.nativeExecutorId` plus
  three libraries that tool modules call directly: `@workspace/native-file-tools`,
  `@workspace/git-executor`, and `@workspace/bash-executor`. `ExecutorGit`
  (`apps/api/src/machines/executor-git.service.ts`) is the only class with both a local and a
  Machine branch per method.
- **The Machine surface.** `MachineConnector` keeps one `MachineSession` per Machine per process,
  opens it on first use, closes it after 5 idle minutes, and reopens after an end
  (`machine-connector.service.ts`). `MachineTransport` spawns
  `ssh -F <generated> -T -- <destination> llame-machine serve --stdio`
  (`machine-transport.ts`).
- **The daemon.** `apps/machine` (version 0.0.1) ships the bundle `dist/llame-machine.cjs` with the
  subcommands `serve --stdio`, `roots add|remove|list`, and `--version`. One daemon process serves
  one stdio session. `hello` answers `{protocolVersion: 1, daemonVersion, roots, methods}`, and
  `methods` lists only the git methods (`serve.ts`). The daemon refuses every path outside the
  roots in `roots.json` with `path_not_registered` (`guard.ts`). The roots file lives in
  `machineConfigDir()`: `LLAME_MACHINE_CONFIG_DIR`, `$XDG_CONFIG_HOME/llame-machine`, or
  `~/.config/llame-machine` (`env.ts`).
- **Dual paths today.** File tools (`native-files.ts` and `machine-files.ts`), grep
  (`grep-ports.ts` and `grep-machine.ts`), git, Workspace MCP (`@workspace/mcp-workspace` and
  `machine-mcp-transport.ts`), instruction files (`instruction-files.ts` and
  `machine-instruction-scope.ts`), and Workspace skills (`NODE_SKILL_FILE_SYSTEM` and
  `machine-skill-sources.ts`) each have a host branch and a Machine branch. Host `bash` and jobs
  have no daemon counterpart, and daemon `proc.bash` refuses `async` (`bash.ts`).
- **Stored ids.** `chats.workspace_executor_id`, `checkouts.executor_id`,
  `project_repository_defaults.executor_id`, and `projects.default_executor_id` hold either the
  host id or `machine:<name>` (`machine-locator.ts`). `chats.workspace_root`, `checkouts.path`,
  and `checkouts.worktree_base` hold a bare host path or a `machine://` locator.
  `runs.worker_id` holds the host id, because only host entry pins a Run. `chat_jobs.executor` is
  the tool name and is not an executor id. `run_events` payloads and message parts hold paths in
  history.
- **Config.** `machines` is `{ssh, hosts: {<name>: {destination}}}` and refuses interpolation
  (`config-loader.ts`). `tools.nativeExecutorId` has no default and refuses a `machine:` prefix.
  Tool advertisement treats `nativeExecutorId`, Knowledge, skills, and `machines` as independent
  switches (`knowledge-tool-candidate-resolver.ts`).
- **Permission projection.** Only `read`, `edit`, and `write` `path`, and the Workspace projection
  of `path` and `cwd`, are normalized before matching (`locator-projection.ts`, `runner.ts`). The
  submitted `enter_workspace` path is matched as written. Each submitted text is judged first,
  then the projected text (`admit.ts`).
- **Context.** `chats.workspace_told` and `workspace_told_from` record the told root and the
  checkpoint epoch, so a Workspace snapshot is told again after compaction. The host and Machine
  snapshots are separate prompts (`workspace-snapshot.md`, `workspace-snapshot-machine.md`).
- **Tests.** API unit and integration tests use the in-memory peer
  (`testing/machine-protocol-peer.ts`). Only `machine-ssh.integration.test.ts` runs the real bundle,
  inside a Docker sshd box. `pnpm dev` does not build `apps/machine`.

## Goals / Non-Goals

**Goals:**

- One locator rule and one code path per family for every Machine, the host included.
- Every intermediate layer leaves the host working, with one authority per Machine.
- The Node daemon and the JSON-RPC wire carry the host until #1805 and #1806 replace them behind
  `MachineConnector`.

**Non-Goals:**

- A new executor interface. `MachineConnector` is the seam, and the Rust daemon replaces what is
  behind it.
- Any change to the frame format, multiplexing, heartbeat, or method set of the wire, other than
  the `hello` fields and the version bump.
- Moving installation resources (`kb://`, `skill://`, `artifact://`, operator skill directories,
  operator MCP servers, and prompt files) to a daemon (H6).

## Decisions

### D1. The instance id and the static facts live in the daemon, and `hello` reports them

The daemon reads `instance.json` in `machineConfigDir()`. When the file is absent, the daemon
creates a UUID v4 with an exclusive create (`open` with `wx`) and reads the file again. Two
co-located children that start together therefore agree on one id. `hello` adds `instanceId`,
`buildId` (the bundle's content hash, written at build time), and `facts`: `os`, `arch`,
`kernel`, `cpuCount`, `totalMemoryBytes`, and `rootDisks` (total bytes per root, from `statfs`).
`llame-machine --version` prints the release, build id, protocol version, and instance id.

`PROTOCOL_VERSION` becomes 2. The hub requires the new fields, so a daemon at version 1 fails the
existing exact match with `incompatible_version`. Its operations return `machine_unavailable` with
that reason, as the canonical `remote-machines` handshake rule already states.

- Alternative: keep version 1 and make the fields optional. Rejected, because an old daemon would
  then pass the handshake without an id and skip the identity check.
- Alternative: a separate frozen bootstrap method on JSON-RPC. Rejected by H2, because the wire is
  replaced by #1806.

### D2. The installation binds a Machine name to one instance id

`machines_status` gains `instance_id` (uuid, nullable), `facts` (bounded jsonb), and
`facts_captured_at`. The first successful `hello` for a name writes `instance_id` with
`UPDATE ... WHERE instance_id IS NULL`. Every later `hello` compares. A different id ends the
session before any request. The session error is `MachineIdentityMismatchError`, the failure
reason is `identity_mismatch`, and tool results report `machine_identity_mismatch`. The reason
joins `MACHINE_FAILURE_REASONS` and the CHECK. The binding survives a removed config entry, so a
re-added name is still checked.

`pnpm --filter api machines:forget <name>` sets `instance_id` to null for one name and prints the
previous id (H17). It runs as the migration role, like the other `db:` scripts, because
`machines_status` is installation state with forced RLS.

- Alternative: a pinned id in config. Rejected by H17.

### D3. `machines.local`, `machines.default`, and boot validation

`MachinesConfig` becomes `{ssh?, local?, default?, hosts}`. `hosts.<name>.destination` becomes
optional. `local` and `default` accept a whole-value `{env:...}` token, resolved once at startup
and then checked against the name grammar. The other fields keep the no-interpolation rule.

Startup fails, and the error names the field, when:

1. `tools.nativeExecutorId` is present. The error names `machines.local`.
2. `machines.local` or `machines.default` names no entry in `hosts`.
3. An entry has neither a `destination` nor the name in this process's `machines.local`, and it is
   `machines.default`.
4. A native tool (`read`, `edit`, `write`, `grep`, `bash`, `enter_workspace`, `exit_workspace`,
   `stop`) is allowlisted and `machines.default` is absent.
5. A regex clause on a path parameter begins with `^/` (D7).

Condition 3 follows from Q41: every worker must serve an unbound Chat. A bound Chat on a Machine
that this process cannot reach detaches with `executor_mismatch` at the attempt (Q40), and it is
not a boot failure, because another worker can serve it.

### D4. The local child transport

`createMachineTransportFactory` returns a local child transport for the name in `machines.local`
and the SSH transport for every other entry. The local transport spawns
`LLAME_MACHINE_COMMAND serve --stdio` with `shell: false`. The variable is split on whitespace
into the executable and its leading arguments, so development can set
`node apps/machine/dist/llame-machine.cjs`. The default is `llame-machine` on `PATH`. The child
receives the base environment of `@workspace/bash-executor` (`PATH`, `LANG`, `TERM`, `HOME`,
`TMPDIR`, `USER`, `LOGNAME`) plus `LLAME_MACHINE_CONFIG_DIR`, `XDG_CONFIG_HOME`, and the
`SENTRY_*` variables when they are set. It never receives the rest of the worker environment, so
database and provider credentials stay out of the daemon and out of everything it starts.

This is the host form of the existing remote rule: a Machine resolves Workspace MCP interpolation
against its own environment, and no hub value reaches it. From layer 5, a host Workspace MCP
declaration that reads a variable only the worker defines becomes unavailable with the
unset-variable diagnostic. Today it resolves from llame's process environment (`mcp-tools`,
"Workspace interpolation can read llame's process environment"). This is recorded as H18 in the
proposal for Leo to confirm.

A spawn failure (`ENOENT`, `EACCES`) is `unreachable`. A child exit is `session_lost`. Both map to
the existing `machine_unavailable` results and status reasons. `MachineConnector` keeps its
session cache, idle close, reconnect, and per-Machine mutation chain unchanged, so a crashed child
restarts at the next call.

- Alternative: one daemon per computer behind a socket (`attach --stdio`). Deferred by H1.

### D5. Executor ids are Machine names, and the migration rewrites stored rows

Every executor id is a Machine name. `machineExecutorId`, `parseMachineExecutorId`, and the
`machine:` prefix are deleted. Every stored root is a canonical `machine://<name>/<path>`
locator. The custom migration runs one transaction under the `NO FORCE ... FORCE` wrapping of
`apps/api/src/db/AGENTS.md` (P2):

1. For each of the four executor columns: `machine:<name>` becomes `<name>`. Any other value is
   kept. A kept value outside `^[a-z0-9-]{1,63}$` raises an exception that names the column and
   the value, so the migration fails and changes nothing.
2. `chats.workspace_root`, `checkouts.path`, and `checkouts.worktree_base`: a value that begins with
   `/` becomes `machine://<executor>/<value without its leading slash>`, with each path segment
   percent-encoded as `formatMachineLocator` does. A value that already begins with `machine://`
   is kept.
3. `chats.workspace_told` follows the same rule as `workspace_root`, so a bound Chat is not told
   its snapshot again only because of the migration.

`runs.worker_id`, `run_events`, message parts, and `chat_creation_records` are not rewritten. A
host id stays the same value, so `runs.worker_id` needs no change, and history keeps what was
recorded at the time.

The migration is forward-only. A rollback restores a database backup. The rows that name a Machine
that is not in the config are kept, and they detach with `executor_absent` at the next attempt, as
today.

- Alternative: an explicit mapping script. Rejected by H5.

### D6. One locator rule

`resolveLocator(path, context)` replaces the scheme dispatch in `native-files.ts`,
`workspace-path.ts`, `bash-target.ts`, `prompt-imports.ts`, and the grep scope parser. It returns
one of `machine(name, path)`, `installation(scheme, ...)`, `ssh(...)`, or a refusal:

- A bare absolute path, `file:/p`, `file:///p`, and `file://localhost/p` resolve to the current
  Machine.
- A relative path resolves against the Workspace root. It is refused without a bound Workspace, as
  today.
- `file://<other host>/p` is refused with a hint to use `machine://`.
- `machine://<name>/p` resolves to that Machine. `machine://` and `machine://<name>` keep their
  listing forms.

The current Machine is the Workspace's Machine, or `machines.default` when no Workspace is bound.
Results, permission projection, and binding all use `formatMachineLocator` for the canonical form.

### D7. Permission rules match normalized parameters

Before evaluation, the runner normalizes every path parameter (`read`, `edit`, `write` `path`,
`grep` scope, `enter_workspace` `path`, `exit_workspace` has none) and `bash` `cwd` to its
canonical locator through D6. A bare or relative path is matched only as its canonical locator,
as a relative path is today. A `file:` or `machine://` locator keeps today's two-text rule: a
reject that matches the submitted or the canonical text refuses, and the allow is decided on the
canonical text. Installation resources keep their existing canonical forms. `bash` `command` is
matched as written. A literal clause stays a substring match, so `"/opt/secret"` still matches
`machine://devl/opt/secret`. Only a regex anchored with `^/` on a path parameter fails startup,
because it can never match a canonical locator. The recommended policy in
`llame.config.jsonc.example` moves its `enter_workspace` allow and its E2 reject to
`^machine://[^/]+/...`.

### D8. Between layers, `machine://<local>` and the bare form share one authority

From layer 2, `resolveLocator` maps `machine://<machines.local>/p` and a bare `p` on the current
Machine, when that Machine is `machines.local`, to one target. Until the layer that moves its
family, that target is served by the in-process library (H12). Each later layer replaces the
in-process call for its family with a `MachineConnector.request` on the same target and deletes the
in-process branch. Root enforcement on the host therefore starts with files and grep (layer 3),
then git (layer 4), then Workspace MCP, instruction files, Workspace skills, and prompt imports
(layer 5). Each layer's `CHANGELOG.md` entry names the calls that start to fail with
`path_not_registered`.

### D9. `bash` routes by location

`bash-target.ts` resolves `cwd` through D6. When the target Machine is this process's
`machines.local`, `runHostBash` runs in process, with `async` and auto-backgrounding as today. Any
other Machine runs daemon `proc.bash`. A request for `async` on another Machine returns
"`async` is unavailable for Machine `<name>` on this attempt. Run the command synchronously."
(H15). The `bash` gate is `machines.local` in place of `nativeExecutorId`. Jobs keep their worker
binding.

### D10. The current-Machine snapshot

`workspace-snapshot.md` is deleted. One snapshot prompt renders both states. The told value
becomes `<machine>\n<root or empty>`, so a change of `machines.default` re-tells an unbound Chat at
its next attempt. After compaction, `workspace_told_from` re-tells it, as today. The unavailable and
recovered items key on the current Machine, and their unbound text drops "this Workspace".
The exact wording is in the `context-injection` delta.

### D11. Tool advertisement

`admitsHostCapability` no longer reads a host identity. Startup fails when a native tool is
allowlisted without `machines.default` (D3), so every allowlisted native tool is advertised. `stop`
is advertised with `bash`. The catalog stays the same on every worker of one config. The
`machines.local` field differs per worker, and it never affects advertisement.

### D12. Development and tests

`apps/api/turbo.json` makes `dev`, `test:integration`, and `test:coverage` depend on
`machine#build`. The dev script sets `LLAME_MACHINE_COMMAND` to
`node ../machine/dist/llame-machine.cjs` and `LLAME_MACHINE_CONFIG_DIR` to
`.llame-dev/machine-host`, and `pnpm db:up` writes a roots file there that registers the
repository root and the operating system's temporary directory. Integration tests that exercise
the host spawn the real bundle through `LLAME_MACHINE_COMMAND` with a per-test
`LLAME_MACHINE_CONFIG_DIR` fixture. Unit tests keep the in-memory peer and drive the local
transport through the same `MachineTransport` interface.

### D13. The capability rename

The deltas live under `specs/remote-machines/` so that each MODIFIED requirement keeps its
identity. The finalize layer syncs the deltas, moves `openspec/specs/remote-machines` to
`openspec/specs/machines`, and updates every link to the old path in specs and docs, as one
mechanical movement measured with rename detection.

- Alternative: an ADDED `machines` capability with every requirement and a REMOVED
  `remote-machines`. Rejected, because it hides each requirement's change behind a full copy.

### D14. Host-path wording in other capabilities

About a dozen capabilities say "host path", "native executor", or "local executor" in requirements
whose behavior does not change. Rewriting each into STE only to change those words would add about
60k characters of delta that reviewers must check for drift. The `remote-machines` requirement
"Host-path wording in other capabilities names the current Machine" maps those words instead, as
the removed "Machine locators extend local-only argument forms" did for Machines. Only
requirements whose rules conflict with this change are MODIFIED. The proposal lists the rest with
the reading under which each holds. A later STE pass of each capability can replace the wording.

## Risks / Trade-offs

- [An operator upgrades without a host entry named after the old `nativeExecutorId`] → every bound
  host Chat detaches with `executor_absent`. The startup error for `tools.nativeExecutorId` names
  the old value and says that the host entry must carry it. The `CHANGELOG.md` entry says the
  same.
- [Host roots refuse paths that worked before] → each layer's notes name the newly refused calls,
  and `llame-machine roots add /` restores the previous reach.
- [A Knowledge-only process now needs a Machine] → accepted with H4. The startup error names
  `machines.default`.
- [A host id and a Machine name collide after the prefix strip, such as host `docker` and
  `machine:docker`] → both rows then name one Machine. The migration cannot read config, so it
  cannot refuse this. The identity check refuses the second computer at its first contact.
- [A copied state directory carries the instance id] → the check catches misconfiguration, not
  impersonation, as Q24 states.
- [Per-call overhead] → about 1 ms per call and 234 ms per handshake on this daemon (#1782). The
  session cache pays the handshake once per process per 5 idle minutes.
- [Host `bash` and the host file tools are two authorities on one computer until layer 5] → they
  share one filesystem, because `machines.local` names the worker's own computer. Root
  enforcement does not apply to host `bash`, and the `bash-execution` delta says so.
- [Daemon children inherit the worker environment] → D4 strips the credential variables before
  the spawn, and a focused test proves that a database URL does not reach the child.

## Migration Plan

1. Layer 1 deploys the daemon with protocol version 2. Every remote Machine needs the new daemon
   before the API upgrade, or it reports "update required".
2. Layer 2 deploys the config change and the migration together. The operator first adds the host
   entry named after the old `tools.nativeExecutorId`, sets `machines.local` and
   `machines.default`, removes `tools.nativeExecutorId`, and rewrites `^/` path rules to
   `^machine://[^/]+/`.
3. Layers 3-5 need no config change. Before layer 3, the operator registers host roots with
   `llame-machine roots add`.

Rollback before layer 2 is a redeploy. From layer 2, a rollback restores the database backup taken
before the migration.

## Revision history

- v1, 2026-11-20: initial draft after the grilling session H1-H17.
