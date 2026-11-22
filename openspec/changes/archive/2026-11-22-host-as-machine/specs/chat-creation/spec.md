## MODIFIED Requirements

### Requirement: Only an explicit executor, a named checkout, or a remembered default names an offline Machine

An explicit `executorId`, a named `checkoutId`, or a remembered default that names an offline Machine MUST answer `workspace.status` `machine_unavailable`. This rule MUST apply to every Machine, the host Machine included. The host Machine is offline when its Machine daemon cannot start or answer.

#### Scenario: An explicit offline executor answers machine_unavailable

- **WHEN** the request names the executor id of an offline Machine
- **THEN** the response is 201 with `workspace.status` `machine_unavailable`
- **AND** no worktree command starts and the message is not stored

#### Scenario: A named checkout on an offline Machine answers machine_unavailable

- **WHEN** the request names a `checkoutId` of a main checkout on an offline Machine
- **THEN** the response is 201 with `workspace.status` `machine_unavailable`
- **AND** no git call starts and the message is not stored

#### Scenario: A remembered default on an offline Machine answers machine_unavailable

- **WHEN** the remembered default for the link names an offline Machine and the request names no `executorId`
- **THEN** the response is 201 with `workspace.status` `machine_unavailable`

#### Scenario: An offline host Machine answers machine_unavailable

- **WHEN** the request names the executor id `devl`, `devl` is the `machines.local` of the process, and its Machine daemon cannot start
- **THEN** the response is 201 with `workspace.status` `machine_unavailable`
- **AND** the message is not stored

### Requirement: The Workspace step requires the entry gates

The step MUST require `enter_workspace` in `tools.allowed`. The process MUST be able to reach the resolved Machine: it is the `machines.local` of the process, or its entry has a `destination`. A missing allowlist entry MUST answer `bind_failed` with `code` `tool_not_allowed`. A Machine that this process cannot reach MUST answer `bind_failed` with `code` `executor_unavailable`.

#### Scenario: Workspace entry is not allowlisted

- **WHEN** `enter_workspace` is absent from `tools.allowed` and the location resolves
- **THEN** the response is 201 with `workspace.status` `bind_failed` and `code` `tool_not_allowed`
- **AND** the chat stays filed and unbound and the message is not stored

#### Scenario: No native executor is configured

- **WHEN** the location resolves to the Machine `devl`, `devl` has no `destination`, and `devl` is not the `machines.local` of the process
- **THEN** the response is 201 with `workspace.status` `bind_failed` and `code` `executor_unavailable`
