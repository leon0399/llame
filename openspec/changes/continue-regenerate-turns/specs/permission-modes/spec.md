## MODIFIED Requirements

### Requirement: The accepted mode is fixed on its Run

A Run MUST store the mode that the API accepted with the request that created the Run. That
request is a chat send or a follow-up request from `turn-actions`. The stored mode MUST NOT change
during the life of the Run. A later configuration change, retry, recovery attempt, or change to
the composer selection MUST NOT change it. A follow-up Run MUST NOT change the mode of an earlier
Run. A Run that the system created before this capability MUST read as `default`.

`RunResponse` and the context receipt response MUST always include `permissionMode` with the
accepted mode of the Run. These responses stay owner-scoped under the current Run and Chat
isolation.

#### Scenario: Run reports its accepted mode

- **WHEN** an owner reads a Run that the API accepted with `permissionMode: "bypass"`
- **THEN** its `RunResponse` and its context receipt response report `permissionMode: "bypass"`

#### Scenario: A queued Run keeps its mode across a configuration change

- **WHEN** the API accepts a Run with `bypass`, and the operator restarts the API with only `["default"]` before the Run ends
- **THEN** the reported `permissionMode` of the Run is still `bypass`

#### Scenario: A historical Run reads as default

- **WHEN** an owner reads a Run that the system created before this capability shipped
- **THEN** its `permissionMode` is `default`

#### Scenario: A follow-up Run has its own mode

- **WHEN** a Run with mode `default` failed, and the owner continues it with `permissionMode: "bypass"`
- **THEN** the Continue Run reports `bypass`
- **AND** the failed Run still reports `default`

#### Scenario: Another owner cannot read a Run's mode

- **WHEN** user B requests the Run of user A or its context receipt
- **THEN** the API returns the current not-found response and discloses no `permissionMode`
