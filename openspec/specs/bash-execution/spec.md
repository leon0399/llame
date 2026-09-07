# bash-execution

## Purpose

Provides the managed-executor bash contract that shares a live file context with
the native file tools. Alpha host bash may run under the same
`tools.nativeExecutorId` gate as native file tools. A future managed Sandbox
adapter can replace the host process without changing the model command
contract. This capability is not tenant isolation.

## Requirements

### Requirement: Alpha host bash uses the native executor gate

When `tools.nativeExecutorId` is configured and `bash` is present in
`tools.allowed`, the model-facing `bash` tool SHALL be available on that native
host. The model supplies shell text only; the host invokes `bash -c` in a
trusted working directory. The model SHALL NOT select an executor, host path,
environment, network mode, or permission mode. Bounded output, input, duration,
and process limits SHALL still apply. This alpha path is explicit host
authority, not multi-tenant isolation. A later managed Sandbox and a separate
permission proposal MAY strengthen isolation and approval without changing the
command/result contract.

#### Scenario: Missing native executor fails closed

- **WHEN** `tools.nativeExecutorId` is unset
- **THEN** a bash request is unavailable
- **AND** no host process starts

#### Scenario: Allowlist omit fails closed

- **WHEN** `bash` is absent from `tools.allowed`
- **THEN** bash is neither advertised nor executed

#### Scenario: Model cannot widen execution

- **WHEN** command arguments attempt to select another path, executor, or policy
- **THEN** the managed executor rejects the unsupported selection
- **AND** it does not widen trusted execution context

#### Scenario: Shell text runs via bash -c

- **WHEN** the model calls `bash` with shell text
- **THEN** the host runs that text as `bash -c`
- **AND** the model does not pick a different configured tool basename

### Requirement: Bash and native file tools share one live directory

When attached to one executor context, bash and native `read`, `edit`, and
`write` SHALL observe the same working directory and current bytes. The host
SHALL NOT return a stale copy or silently switch directories. A future executor
adapter SHALL preserve this same-workspace result contract.

#### Scenario: Native edit is visible to bash

- **WHEN** native edit changes a file and the next bash command reads that path
- **THEN** bash observes the changed bytes
- **AND** it does not read a stale server-side copy

#### Scenario: Bash mutation is visible to native read

- **WHEN** bash changes a file and exits with a known result
- **THEN** the next native read observes the current bytes
- **AND** the result does not claim that Git or Knowledge submission occurred

#### Scenario: Mismatched executor fails closed

- **WHEN** the host cannot guarantee that bash and native file tools share one directory
- **THEN** the operation returns an unavailable result
- **AND** it does not substitute another path or executor

#### Scenario: Submit waits for a known workspace state

- **WHEN** Knowledge submit targets a workspace with an active bash command
- **THEN** submit waits for a known command result before staging
- **AND** an unknown command outcome fences submit and prevents a concurrent commit

### Requirement: Command results are bounded and explicit

Each bash call SHALL enforce finite input, duration, process, stdout, and stderr
bounds. The result SHALL contain a safe status, exit code when known, bounded
output, and truncation metadata when output is limited. It SHALL omit credentials,
raw stack traces, and unrelated host diagnostics.

#### Scenario: Oversized output is bounded

- **WHEN** a command produces more output than the configured result bound
- **THEN** the result contains a bounded prefix and explicit truncation metadata
- **AND** excess output is not sent to the model

#### Scenario: Non-zero exit is observable

- **WHEN** a command exits non-zero within its bounds
- **THEN** the result reports the non-zero status and bounded stderr
- **AND** it does not convert the command into a successful file or Knowledge effect

### Requirement: Unknown command effects are never replayed automatically

The host SHALL record an opaque command attempt and trusted command metadata
before starting execution. A command SHALL become a known result only after its
process tree and descendants are proven stopped. Timeout, host failure, failed
cancellation, or uncertain descendant termination SHALL produce terminal
`outcome_unknown`; the host SHALL NOT rerun that attempt automatically.

#### Scenario: Normal completion permits the next call

- **WHEN** the command exits and every descendant is proven stopped
- **THEN** the attempt records a known result
- **AND** the next approved file or bash operation may run in the same context

#### Scenario: Crash becomes unknown

- **WHEN** the host crashes after command start before completion is proven
- **THEN** recovery records `outcome_unknown`
- **AND** it does not rerun the command under another tool-call ID

#### Scenario: Failed cancellation fences the context

- **WHEN** cancellation cannot prove the process tree stopped
- **THEN** the result is `outcome_unknown`
- **AND** no later operation runs in that context until recovery proves safety
