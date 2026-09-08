## MODIFIED Requirements

### Requirement: Alpha host bash uses the native executor gate

When `tools.nativeExecutorId` is configured and `bash` is present in
`tools.allowed`, the model-facing `bash` tool SHALL be available on that native
host. The model supplies shell text, an optional working directory, and
optional additional environment variables; the host invokes `bash -c` as the
host OS user. Each call SHALL start a fresh process: no working directory,
variable, or shell state persists between calls, and the tool description
SHALL state so. The model SHALL NOT select an executor, network mode, or
permission mode, and SHALL NOT replace a base environment variable. Bounded
output, input, duration, and process limits SHALL still apply. This alpha path
is explicit host authority, not multi-tenant isolation. A later managed Sandbox
and a separate permission proposal MAY strengthen isolation and approval
without changing the command/result contract.

#### Scenario: Missing native executor fails closed

- **WHEN** `tools.nativeExecutorId` is unset
- **THEN** a bash request is unavailable
- **AND** no host process starts

#### Scenario: Allowlist omit fails closed

- **WHEN** `bash` is absent from `tools.allowed`
- **THEN** bash is neither advertised nor executed

#### Scenario: Model cannot widen execution

- **WHEN** command arguments name an executor, a policy, or a base environment
  variable such as `PATH`
- **THEN** the managed executor rejects the call before any process starts
- **AND** the result names the rejected argument

#### Scenario: Shell text runs via bash -c

- **WHEN** the model calls `bash` with shell text
- **THEN** the host runs that text as `bash -c`
- **AND** the model does not pick a different configured tool basename

#### Scenario: Working directory is per call

- **WHEN** the model supplies a `cwd` that resolves to an existing directory
- **THEN** that command runs with that directory as its working directory
- **AND** the next call without `cwd` runs in the host's default directory

#### Scenario: Unusable working directory does not run the command

- **WHEN** the supplied `cwd` does not exist or is not a directory
- **THEN** no process starts
- **AND** the result states that the literal argument was not usable, that no
  shell expansion was applied to it, and how to list or create it

#### Scenario: Child environment is declared, not inherited

- **WHEN** a command prints its environment
- **THEN** it contains only the base variables and the call's own additions
- **AND** no credential or variable of the llame process appears

### Requirement: Bash and native file tools share one live directory

Bash and native `read`, `edit`, and `write` on one host SHALL operate on the
same live host filesystem as the same OS user. A bash mutation with a known
result SHALL be visible to the next native read, and a native mutation SHALL be
visible to the next bash command. The host SHALL NOT return a stale copy. A
future executor adapter SHALL preserve this same-filesystem result contract.

#### Scenario: Native edit is visible to bash

- **WHEN** native edit changes a file and the next bash command reads that path
- **THEN** bash observes the changed bytes
- **AND** it does not read a stale server-side copy

#### Scenario: Bash mutation is visible to native read

- **WHEN** bash changes a file and exits with a known result
- **THEN** the next native read observes the current bytes
- **AND** the result does not claim that Git or Knowledge submission occurred

#### Scenario: Mismatched executor fails closed

- **WHEN** a future executor adapter cannot guarantee that bash and native file
  tools observe one live filesystem
- **THEN** the operation returns an unavailable result
- **AND** it does not substitute another path or executor

#### Scenario: Submit waits for a known workspace state

- **WHEN** Knowledge submit targets a workspace with an active bash command
- **THEN** submit waits for a known command result before staging
- **AND** an unknown command outcome fences submit and prevents a concurrent commit

### Requirement: Command results are bounded and explicit

Each bash call SHALL enforce finite input, duration, process, stdout, and stderr
bounds. The result SHALL contain a safe status, exit code when known, bounded
output, and truncation metadata when output is limited. Output SHALL be
returned as the command produced it, cut at the bound; the host SHALL NOT
rewrite, reorder, or delete lines. Values the host knows to be secret SHALL be
redacted before the result leaves the host.

#### Scenario: Oversized output is bounded

- **WHEN** a command produces more output than the configured result bound
- **THEN** the result contains a bounded prefix and explicit truncation metadata
- **AND** excess output is not sent to the model

#### Scenario: Non-zero exit is observable

- **WHEN** a command exits non-zero within its bounds
- **THEN** the result reports the non-zero status and bounded stderr
- **AND** it does not convert the command into a successful file or Knowledge effect

#### Scenario: Paths and diagnostics survive

- **WHEN** a command prints absolute paths, a stack trace, or a line beginning
  with `Error:`
- **THEN** the result contains those lines verbatim within the bound

### Requirement: Unknown command effects are never replayed automatically

The host SHALL record the command attempt for the Run and tool call in the
durable Run event log before starting execution and SHALL record its result
after. A command SHALL become a known result only after its process tree and
descendants are proven stopped. A timeout whose process tree is proven stopped
SHALL be a known `timed_out` result carrying bounded partial output. An
unproven stop after timeout, cancellation, or host failure SHALL produce
terminal `outcome_unknown`. An `outcome_unknown` SHALL terminate the Run that
issued it and SHALL NOT affect any other Run. The host SHALL NOT rerun an
attempt automatically: a Run resumed on any host after an attempt without a
recorded result SHALL NOT re-execute it.

#### Scenario: Normal completion permits the next call

- **WHEN** the command exits and every descendant is proven stopped
- **THEN** the attempt records a known result
- **AND** the next approved file or bash operation may run in the same Run

#### Scenario: Proven-stopped timeout is known

- **WHEN** the deadline elapses and the process tree is proven stopped
- **THEN** the result is `timed_out` with the output produced before the kill
- **AND** the Run continues

#### Scenario: Unproven stop after timeout is unknown

- **WHEN** the deadline elapses and a descendant cannot be proven stopped
- **THEN** the result is `outcome_unknown`
- **AND** the Run terminates

#### Scenario: Crash becomes unknown

- **WHEN** the worker is lost after command start before a result is recorded
- **THEN** a resume on any worker does not re-execute the command
- **AND** the Run reports that a host command may have executed

#### Scenario: Failed cancellation fences the context

- **WHEN** cancellation cannot prove the process tree stopped
- **THEN** the result is `outcome_unknown`
- **AND** the Run terminates; no other Run is fenced

#### Scenario: Other Runs are unaffected

- **WHEN** one Run ends with `outcome_unknown`
- **THEN** a later bash call in another Run on the same host is admitted
- **AND** no operator or process restart is needed
