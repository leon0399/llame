## ADDED Requirements

### Requirement: Bash on the host Machine of the worker runs in the worker

When the Machine of the resolved `cwd` is the `machines.local` of the process, `bash` MUST run the command in that process. The command runs as the host OS user. On any other Machine, `bash` MUST run through the Machine daemon. Registered roots MUST NOT confine a command in the process. This holds until background jobs run on every Machine.

#### Scenario: A host command runs in the worker

- **WHEN** `machines.local` is `devl`, the current Machine is `devl`, and the model calls `bash` with `command: "pwd"`
- **THEN** the worker process starts the command on `devl`

#### Scenario: Another Machine runs the command through its daemon

- **WHEN** `machines.local` is `devl` and the model calls `bash` with `cwd: "machine://gpu/srv/app"`
- **THEN** the `gpu` Machine daemon runs the command

#### Scenario: The host Machine of another worker runs through its daemon

- **WHEN** the current Machine is `devl`, `devl` has a `destination`, and the worker that runs the attempt has `machines.local` set to `gpu`
- **THEN** the command runs on `devl` through the `devl` Machine daemon over SSH

## MODIFIED Requirements

### Requirement: Alpha host bash uses the native executor gate

When `bash` is present in `tools.allowed`, the model-facing `bash` tool MUST be available. Startup MUST fail when `bash` is allowlisted and `machines.default` is absent. The model supplies shell text, an optional directory for the command, and optional additional environment variables. The model can also supply `async` and `unlimited`, which this capability and `background-jobs` define. The command runs as `bash -c` with the OS user of its Machine.

When a Workspace is entered, an omitted `cwd` MUST use the Workspace root. A relative `cwd` MUST resolve from that root with lexical path resolution, as POSIX `path.posix.resolve` does, and it MUST keep a trailing separator. The Machine MUST receive exactly the projected absolute path, with that trailing separator. Projection MUST NOT resolve real paths. The OS follows symbolic links inside the projected path as for any absolute path.

For this requirement, a relative value does not start with `/` and has no `scheme:` prefix that the shared locator parser knows (case-insensitive `scheme://`). An unknown scheme MUST stay `invalid_path`, and the tool MUST NOT treat it as a relative directory. `..` can resolve outside the root. An absolute `cwd` MUST stay absolute, on the current Machine. Without an entered Workspace, the command MUST run on the current Machine, and an omitted `cwd` MUST keep the default directory behavior of that Machine.

Each call MUST start a new process. A directory override, a variable, or a shell state of one call MUST NOT persist to the next call. The tool description MUST state this. It MUST state that an omitted `cwd` uses the Workspace root while a Workspace is entered, and the default directory of the current Machine otherwise.

It MUST state that a relative `cwd` resolves from the Workspace root without confinement. Workspace path resolution MUST NOT perform shell expansion on the submitted `cwd`. The model MUST NOT select a network mode or a permission mode, and it MUST NOT replace a base environment variable. The model selects a Machine only through `cwd`.

Bounded output, input, duration, and process limits MUST still apply. This alpha path is explicit Machine authority, not multi-tenant isolation. A later managed Sandbox and a separate permission proposal can make isolation and approval stronger without a change to the command and result contract.

#### Scenario: Missing native executor fails closed

- **WHEN** `bash` is in `tools.allowed` and `machines.default` is absent
- **THEN** startup fails naming `machines.default`
- **AND** no process starts

#### Scenario: Allowlist omit fails closed

- **WHEN** `bash` is absent from `tools.allowed`
- **THEN** bash is not advertised and not executed

#### Scenario: Model cannot widen execution

- **WHEN** command arguments carry a key other than the declared `command`, `cwd`, `env`, `async`, and `unlimited`
- **THEN** the call is refused as invalid input before it reaches a Machine
- **AND** no process starts

#### Scenario: Base environment cannot be replaced

- **WHEN** `env` names a base environment variable, `PATH` included
- **THEN** the tool rejects the call before the attempt is recorded
- **AND** the result names the key that collides

#### Scenario: Shell text runs via bash -c

- **WHEN** the model calls `bash` with shell text
- **THEN** the Machine runs that text as `bash -c`
- **AND** the model does not pick a different configured tool basename

#### Scenario: Working directory is per call

- **WHEN** no Workspace is entered and the model supplies a `cwd` that resolves to a directory that exists on the current Machine
- **THEN** that command runs in that directory
- **AND** the next call without `cwd` runs in the default directory of the current Machine

#### Scenario: Unusable working directory does not run the command

- **WHEN** the supplied `cwd` does not resolve to a directory that the Machine can enter
- **THEN** no process starts and no attempt is recorded
- **AND** the result identifies the unusable value and states that the submitted `cwd` was not shell-expanded
- **AND** the result states how to list or create the directory

#### Scenario: Spawn failure after the attempt is recorded

- **WHEN** the attempt is recorded and the process still fails to start
- **THEN** the recorded result of the attempt is a known refusal, never `outcome_unknown`
- **AND** the Run continues

#### Scenario: Child environment is declared, not inherited

- **WHEN** a command prints its environment
- **THEN** the initial environment of the child holds exactly the declared base variables and the additions of the call
- **AND** that initial environment holds no unlisted variable of the llame process and no llame credential
- **AND** Bash, its launcher, or the runtime can add variables such as `PWD`, `SHLVL`, and `_` before the command prints its environment

#### Scenario: Omitted working directory uses the Workspace root

- **WHEN** a Workspace with root `machine://devl/work/project` is entered and the model calls `bash` without `cwd`
- **THEN** the command runs on `devl` in `/work/project`

#### Scenario: Relative working directory resolves from the Workspace root

- **WHEN** a Workspace with root `machine://devl/work/project` is entered and the model calls `bash` first with `cwd: "packages/api"` and then with `cwd: "../shared"`
- **THEN** the first command runs in `/work/project/packages/api`
- **AND** the second command runs in `/work/shared`, outside the Workspace root

#### Scenario: Workspace working directory preserves a trailing separator

- **WHEN** a Workspace with root `machine://devl/work/project` is entered and the model calls `bash` with `cwd: "packages/api/"`
- **THEN** the Machine receives `/work/project/packages/api/` exactly, with the trailing separator
- **AND** the command runs in that directory

#### Scenario: Unknown working-directory scheme is invalid

- **WHEN** a Workspace is entered and the model calls `bash` with `cwd: "vault://notes"`
- **THEN** the tool returns `invalid_path`
- **AND** no process starts, and no filesystem probe treats the value as a relative directory

#### Scenario: The background fields are accepted

- **WHEN** the model calls `bash` with `command` and `async: true`
- **THEN** the call passes input validation

### Requirement: A host command can start in the background

A `bash` call can run on the `machines.local` Machine of the process and set `async: true`. That call MUST start the command as a job of `background-jobs` and return `backgrounded` at once. `unlimited: true` MUST ask for a job with no lifetime, as `background-jobs` defines. The tool MUST refuse a `bash` call that sets `async` or `unlimited` on an `ssh://` directory or on another Machine.

The refusal MUST occur before any process starts. For a Machine, the tool MUST return the refusal text "`async` is unavailable for Machine `<name>` on this attempt. Run the command synchronously." The refusal MUST NOT name the worker.

#### Scenario: A build starts in the background

- **WHEN** the current Machine is the `machines.local` of the process and the model calls `bash` with `command: "make"` and `async: true`
- **THEN** the call returns `backgrounded` with a job locator before `make` exits

#### Scenario: A remote directory refuses async

- **WHEN** the model calls `bash` with an `ssh://` `cwd` and `async: true`
- **THEN** the call returns an error, and no process starts on either host

#### Scenario: Another Machine refuses async without a worker name

- **WHEN** `machines.local` is `gpu` and the model calls `bash` with `cwd: "machine://devl/srv/app"` and `async: true`
- **THEN** the call returns "`async` is unavailable for Machine `devl` on this attempt. Run the command synchronously."
- **AND** no process starts, and the result does not name `gpu`
