# Spec Delta

## MODIFIED Requirements

### Requirement: Alpha host bash uses the native executor gate

When `tools.nativeExecutorId` is configured and `bash` is present in
`tools.allowed`, the model-facing `bash` tool SHALL be available on that native
host. The model supplies shell text, an optional working directory, and
optional additional environment variables; the host invokes `bash -c` as the
host OS user. When a Workspace is entered, an omitted `cwd` SHALL use the
Workspace root, and a relative `cwd` SHALL resolve from that root using lexical
path resolution like POSIX `path.posix.resolve` while preserving a trailing
separator; the executor SHALL receive exactly the projected absolute string,
including that trailing separator. Projection SHALL NOT perform realpath
resolution; symlinks inside the projected path SHALL be followed by the OS as
for any absolute path. For this requirement, "relative" means a value not
starting with `/` and without a `scheme:` prefix recognized by the shared
locator parser (case-insensitive `scheme://`). An unknown scheme SHALL remain
`invalid_path` rather than being treated as a relative directory. `..` MAY
resolve outside the root. An absolute `cwd` SHALL remain absolute. Without an
entered Workspace, the existing host working-directory behavior SHALL remain
unchanged. Each call SHALL start a fresh process: no per-call working-directory
override, variable, or shell state persists between calls. The tool description
SHALL state this and SHALL state that an omitted `cwd` uses the Workspace root
while entered and the host's default directory otherwise, and that a relative
`cwd` is resolved from the Workspace root without confinement, and that the
managed process bound belongs to the worker process and a call beyond it is
refused rather than queued. Workspace path resolution SHALL NOT perform shell
expansion on the submitted `cwd`.
The model SHALL NOT select an
executor, network mode, or permission mode, and SHALL NOT replace a base
environment variable. Bounded output, input, duration, and process limits
SHALL still apply, with the process bound scoped to the worker process. This
alpha path is explicit host authority, not
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

#### Scenario: Omitted working directory uses the Workspace root

- **WHEN** a Workspace with root `/work/project` is entered and the model calls `bash` without `cwd`
- **THEN** the command runs with `/work/project` as its working directory

#### Scenario: Relative working directory resolves from the Workspace root

- **WHEN** a Workspace with root `/work/project` is entered and the model calls `bash` first with `cwd: "packages/api"` and then with `cwd: "../shared"`
- **THEN** the first command runs with `/work/project/packages/api` as its working directory
- **AND** the second command runs with `/work/shared` as its working directory, outside the Workspace root

#### Scenario: Workspace working directory preserves a trailing separator

- **WHEN** a Workspace with root `/work/project` is entered and the model calls `bash` with `cwd: "packages/api/"`
- **THEN** the executor receives `/work/project/packages/api/` exactly, including the trailing separator
- **AND** the command runs with that directory as its working directory

#### Scenario: Unknown working-directory scheme is invalid

- **WHEN** a Workspace is entered and the model calls `bash` with `cwd: "vault://notes"`
- **THEN** the tool returns `invalid_path`
- **AND** no process starts or filesystem probe treats the value as a relative directory

## ADDED Requirements

### Requirement: The managed process bound belongs to the worker and refuses beyond it

When the worker process already holds its full set of managed bash processes, a
new call SHALL be refused before any process starts and before any attempt is
recorded. The bound SHALL be a property of the worker process and SHALL be
shared by every Run that worker executes, so a call in one Run is refused while
another holds the bound. The refusal SHALL name the bound as its cause, SHALL
state that a retry may succeed, and SHALL NOT carry the result reserved for a
missing native executor.

#### Scenario: Calls within the bound are admitted concurrently

- **WHEN** a step issues two bash calls and the worker holds fewer than its bound
- **THEN** both are admitted and each starts its own process
- **AND** each records its own attempt and result

#### Scenario: Exhausted bound refuses before the attempt

- **WHEN** the worker holds its bound of managed processes and another bash call arrives
- **THEN** the call is refused immediately with no process started and no attempt recorded
- **AND** the refused command does not start later on its own

#### Scenario: Refusal names the bound and permits a retry

- **WHEN** a call is refused because the worker holds its bound
- **THEN** the result identifies the process bound as the cause and states that a retry may succeed
- **AND** its classification differs from the one an unset `tools.nativeExecutorId` produces

#### Scenario: Runs on one worker share the bound

- **WHEN** two Runs execute concurrently on one worker and the first holds the bound
- **THEN** a bash call in the second Run is refused under the same bound
- **AND** it is admitted once a process of the first Run has ended
