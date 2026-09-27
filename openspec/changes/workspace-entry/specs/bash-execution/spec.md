## MODIFIED Requirements

### Requirement: Alpha host bash uses the native executor gate

When `tools.nativeExecutorId` is configured and `bash` is present in
`tools.allowed`, the model-facing `bash` tool SHALL be available on that native
host. The model supplies shell text, an optional working directory, and
optional additional environment variables; the host invokes `bash -c` as the
host OS user. When a Workspace is entered, an omitted `cwd` SHALL use the
Workspace root, and a relative `cwd` SHALL resolve from that root using normal
path-resolution semantics; `..` MAY resolve outside the root. An absolute
`cwd` SHALL remain absolute. Without an entered Workspace, the existing host
working-directory behavior SHALL remain unchanged. Each call SHALL start a
fresh process: no per-call working-directory override, variable, or shell state
persists between calls. The tool description SHALL state this and SHALL state
that an omitted `cwd` uses the Workspace root while entered and the host's
default directory otherwise, and that a relative `cwd` is resolved from the
Workspace root without confinement. Workspace path resolution SHALL NOT
perform shell expansion on the submitted `cwd`. The model SHALL NOT select an
executor, network mode, or permission mode, and SHALL NOT replace a base
environment variable. Bounded output, input, duration, and process limits
SHALL still apply. This alpha path is explicit host authority, not
multi-tenant isolation. A later managed Sandbox and a separate permission
proposal MAY strengthen isolation and approval without changing the
command/result contract.

#### Scenario: Missing native executor fails closed

- **WHEN** `tools.nativeExecutorId` is unset
- **THEN** a bash request is unavailable
- **AND** no host process starts

#### Scenario: Allowlist omit fails closed

- **WHEN** `bash` is absent from `tools.allowed`
- **THEN** bash is neither advertised nor executed

#### Scenario: Model cannot widen execution

- **WHEN** command arguments carry any key other than the declared `command`,
  `cwd`, and `env`
- **THEN** the call is refused as invalid input before it reaches the executor
- **AND** no process starts

#### Scenario: Base environment cannot be replaced

- **WHEN** `env` names a base environment variable, `PATH` included
- **THEN** the executor rejects the call before the attempt is recorded
- **AND** the result names the colliding key

#### Scenario: Shell text runs via bash -c

- **WHEN** the model calls `bash` with shell text
- **THEN** the host runs that text as `bash -c`
- **AND** the model does not pick a different configured tool basename

#### Scenario: Working directory is per call

- **WHEN** no Workspace is entered and the model supplies a `cwd` that resolves to an existing directory
- **THEN** that command runs with that directory as its working directory
- **AND** the next call without `cwd` runs in the host's default directory

#### Scenario: Omitted working directory uses the Workspace root

- **WHEN** a Workspace with root `/work/project` is entered and the model calls `bash` without `cwd`
- **THEN** the command runs with `/work/project` as its working directory

#### Scenario: Relative working directory resolves from the Workspace root

- **WHEN** a Workspace with root `/work/project` is entered and the model calls `bash` first with `cwd: "packages/api"` and then with `cwd: "../shared"`
- **THEN** the first command runs with `/work/project/packages/api` as its working directory
- **AND** the second command runs with `/work/shared` as its working directory, outside the Workspace root

#### Scenario: Unusable working directory does not run the command

- **WHEN** the supplied `cwd` does not resolve to an enterable directory
- **THEN** no process starts and no attempt is recorded
- **AND** the result identifies the unusable working-directory value and states that the submitted `cwd` was not shell-expanded (Workspace-relative projection, when applicable, is path resolution only), and how to list or create it

#### Scenario: Spawn failure after the attempt is recorded

- **WHEN** the attempt is recorded and the process still fails to start
- **THEN** the attempt's recorded result is a known refusal, never
  `outcome_unknown`
- **AND** the Run continues

#### Scenario: Child environment is declared, not inherited

- **WHEN** a command prints its environment
- **THEN** the initial environment passed to the child contains exactly the
  declared base variables and the call's own additions
- **AND** no unlisted variable of the llame process, and no llame credential,
  is inherited into that initial environment
- **AND** Bash, its launcher, or the runtime can add variables such as `PWD`,
  `SHLVL`, and `_` before the command prints its environment
