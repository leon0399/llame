## MODIFIED Requirements

### Requirement: A Run's effective permission mode selects whether the policy is evaluated

Each execution attempt MUST have one effective permission mode. The system MUST resolve it once, when the attempt is claimed. The effective mode is `bypass` when the accepted mode of the Run is `bypass` and the `tools.permissionModes` of the process that executes the attempt enables `bypass`. The effective mode is `read-only` when the accepted mode of the Run is `read-only`, on every process. The effective mode is `default` in all other cases. A Run accepted with `bypass` on a process that does not enable `bypass` MUST execute in `default`.

In `default`, each requirement of this capability MUST apply without change.

In `read-only`, each evaluation of a permission group MUST occur exactly as in `default`. The read-only requirements of this capability add a ceiling before the call evaluation. The ceiling MUST NOT change any group evaluation.

In `bypass`, the system MUST NOT evaluate a permission group for that attempt at any point where this capability evaluates one. These points include the per-call admission of submitted and projected arguments. They also include each derived locator of a web read and each resolved web address. They also include the submitted and canonical paths of `enter_workspace`, and the per-attempt Workspace binding re-check. The system MUST admit each of those evaluations as an allow. In that attempt, this capability MUST NOT refuse anything through a group match, the reject veto, the no-allow rejection, or the invalid-field rejection. The same applies to the inspection-bound rejection, the omitted-policy rejection, and the recommended reject list. This capability MUST NOT produce a `permission_denied` result in that attempt.
The bypass list also includes the canonical-path evaluation of an instruction import when the canonical path differs from the resolved path. The system MUST admit it as an allow and MUST NOT evaluate the `read` group for it.

`bypass` MUST NOT relax any other gate. These gates MUST apply exactly as in `default`. They are `tools.allowed` availability and catalog admission, owner and tenant authorization with Knowledge Space ownership, and native locator validation. The same holds for Workspace path projection of executor arguments, the other Workspace re-check conditions, and the native recovery fence. It also holds for the web-read time, size, and redirect bounds, the Run step and call-timeout bounds, and MCP environment isolation.

#### Scenario: A rejected command runs under bypass

- **WHEN** the recommended policy is in force, the effective mode of an attempt is `bypass`, and Bash submits `git reset --hard HEAD`
- **THEN** the system admits and executes the call
- **AND** in a `default` attempt, B6 rejects the same call

#### Scenario: Omitted permissions admit every available call under bypass

- **WHEN** `tools.permissions` is omitted, `bypass` is enabled, and a `bypass` attempt calls an advertised tool
- **THEN** the system admits the call
- **AND** a tool that is not in `tools.allowed` stays unadvertised and does not execute

#### Scenario: Web-read hops and addresses are admitted under bypass

- **WHEN** the recommended policy is in force and a `bypass` attempt reads `http://169.254.169.254/latest/meta-data/`
- **THEN** F5a–F7 refuse neither the locator nor its address
- **AND** the web-read header, call, and body bounds still apply

#### Scenario: Workspace entry skips both path evaluations under bypass

- **WHEN** a `bypass` attempt calls `enter_workspace` for `/tmp/project`, E2 rejects that path, and the directory exists
- **THEN** the system admits the submitted path and the canonical path and binds the Workspace
- **AND** entry still requires `enter_workspace` in `tools.allowed`, a directory that exists, and the configured native executor

#### Scenario: A default attempt detaches a Workspace only bypass could enter

- **WHEN** a `bypass` Run bound a Workspace at `/tmp/project`, and the next `default` attempt re-checks it under a policy that rejects it
- **THEN** the system detaches the binding with reason `permission_rejected`
- **AND** a later `bypass` Run must call `enter_workspace` again to bind it

#### Scenario: Bypass cannot cross owners

- **WHEN** the `bypass` attempt of user A reads `kb://<user B's Space>/notes/a.md`
- **THEN** the per-call owner authorization refuses the read
- **AND** no content of user B gets to user A

#### Scenario: A worker that does not enable bypass applies its policy

- **WHEN** a worker whose `tools.permissionModes` is `["default"]` claims a Run accepted with `bypass`, and Bash submits `git reset --hard HEAD` under the recommended policy
- **THEN** the effective mode of the attempt is `default`, and B6 rejects the call with `permission_denied`

#### Scenario: Bypass admits an instruction-import canonical path

- **WHEN** a `bypass` attempt imports an instruction file whose canonical path differs from its resolved path
- **AND** the `read` group would reject the canonical path
- **THEN** the system admits the canonical-path evaluation and does not evaluate the `read` group
- **AND** the first page read call of the import carries a derived `canonical` decision, and the import continues

#### Scenario: Read-only stays read-only on a process that does not enable it

- **WHEN** a worker whose `tools.permissionModes` is `["default"]` claims a Run accepted with `read-only`, and the model calls `bash`
- **THEN** the effective mode of the attempt is `read-only`
- **AND** the call gets `permission_denied` with reason `permission_mode_read_only`

#### Scenario: Read-only evaluates an admitted call as default

- **WHEN** the recommended policy is in force and a `read-only` attempt reads `/home/me/.ssh/id_ed25519`
- **THEN** F1 rejects the call with reason `explicit_reject`, as in a `default` attempt

## ADDED Requirements

### Requirement: A read-only attempt admits only reads and plain Workspace transitions

A `read-only` attempt MUST admit a tool call only in three cases. The tool has the `read_only` classification. The call is an `exit_workspace` call. The call is an `enter_workspace` call without a `worktree` argument. The attempt MUST reject every other call. This rule applies to each MCP call. An admitted call MUST then obtain a decision from the operator policy as in `default`.

#### Scenario: Write and execution tools are rejected

- **WHEN** a `read-only` attempt calls `bash`, `edit`, or `write`, and the operator policy allows each call
- **THEN** each call gets `permission_denied` with reason `permission_mode_read_only` and does not start

#### Scenario: An MCP tool is rejected

- **WHEN** a `read-only` attempt calls an allowlisted MCP tool, and the operator policy allows it
- **THEN** the call gets `permission_denied` with reason `permission_mode_read_only` and does not start

#### Scenario: A read tool still needs the policy

- **WHEN** a `read-only` attempt calls `grep`, and the `grep` group of the operator policy has no allow
- **THEN** the call gets `permission_denied` with reason `no_allow`

#### Scenario: Plain Workspace entry is admitted

- **WHEN** a `read-only` attempt calls `enter_workspace` for a directory that exists, without `worktree`, and the operator policy allows both paths
- **THEN** the system binds the Workspace

### Requirement: A read-only rejection is recorded before the policy is evaluated

The system MUST decide the read-only ceiling before any other admission step for the call. Thus no SSH host resolution and no permission group occur for a rejected call. A rejected call MUST get the static reason `permission_mode_read_only`. The decision MUST carry the policy-instance ID of the process and no clause reference. The system MUST record it where it records a `default` call decision.

#### Scenario: The ceiling reason wins over a policy reject

- **WHEN** a `read-only` attempt calls `bash` with `git reset --hard HEAD` under the recommended policy
- **THEN** the call decision records `reject` with reason `permission_mode_read_only` and no clause reference
- **AND** the decision does not name B6, although B6 matches the command

#### Scenario: A remote command is rejected before host resolution

- **WHEN** a `read-only` attempt calls `bash` with `cwd` `ssh://devbox/repo`
- **THEN** the call gets `permission_denied` with reason `permission_mode_read_only`
- **AND** the system resolves no SSH host configuration for the call

#### Scenario: The rejection text is fixed

- **WHEN** a `read-only` attempt receives a `permission_mode_read_only` rejection
- **THEN** the result message is exactly `Tool call rejected before execution. This Run permits only reads and Workspace entry or exit without a worktree. Do not retry this call, disguise the same action through different commands or tools, or delegate it to another agent. In-run approval is unavailable. Continue with other permitted work; if this action is required, explain the blocked step to the user.`
- **AND** the message names no permission mode and no setting

#### Scenario: The decision survives a reload privately

- **WHEN** the owner reloads a chat that contains a call that the ceiling rejected
- **THEN** the stored tool part keeps the `permission_mode_read_only` decision
- **AND** model replay, public shares, exports, and search receive no decision metadata

### Requirement: A read-only attempt rejects worktree entry

A `read-only` attempt MUST reject an `enter_workspace` call that carries a `worktree` argument. This rule applies to a host path and to a `machine://` path. The rejection MUST occur before any filesystem probe, git command, `native.attempt`, or binding change.

#### Scenario: A worktree entry changes nothing

- **WHEN** a `read-only` attempt calls `enter_workspace` with `path` `/repo` and `worktree` `{ "name": "fix" }`
- **THEN** the call gets `permission_denied` with reason `permission_mode_read_only`
- **AND** no worktree directory, git reference, checkout row, or binding change exists after the call

#### Scenario: A worktree entry to an absent directory gets the mode reason

- **WHEN** a `read-only` attempt calls `enter_workspace` with `worktree` and a `path` that does not exist
- **THEN** the call gets `permission_denied` with reason `permission_mode_read_only`, not an error for an absent directory
