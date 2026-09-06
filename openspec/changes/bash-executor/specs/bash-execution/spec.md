## Purpose

Provides bounded native command execution that shares a live file context with
the native file tools and can later be implemented by a managed Sandbox adapter.

## ADDED Requirements

### Requirement: Bash runs only in a trusted native executor context

The alpha `bash` tool SHALL execute with the trusted native host OS authority and
SHALL disclose that authority to the model and owner. The model SHALL NOT select
an executor, host path, environment, network mode, or permission mode. A call
without a trusted executor context SHALL fail closed. The tool SHALL NOT claim
multi-user isolation or Sandbox confinement.

#### Scenario: Native command runs with disclosed authority

- **WHEN** an authorized alpha host supplies a trusted executor context and the model calls bash
- **THEN** the command executes with that host authority
- **AND** the result identifies the native executor class and safe working-directory context

#### Scenario: Model cannot widen execution

- **WHEN** command arguments attempt to select another path, executor, or policy
- **THEN** the host rejects the unsupported selection
- **AND** it does not widen trusted execution context

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
