## ADDED Requirements

### Requirement: A Run's effective permission mode selects whether the policy is evaluated

Each execution attempt SHALL have an effective permission mode, resolved once when the attempt is claimed: `bypass` when the Run's accepted mode is `bypass` and the executing process's `tools.permissionModes` enables `bypass`, and `default` otherwise. An attempt whose Run was accepted with `bypass` on a process that does not enable it SHALL execute in `default`.

In `default`, every requirement of this capability SHALL apply unchanged.

In `bypass`, no permission group SHALL be evaluated for that attempt anywhere this capability evaluates one: the per-call admission of submitted and projected arguments, each derived locator of a web read, each resolved address of a web request, the submitted and canonical paths of `enter_workspace`, and the per-attempt Workspace binding re-check. Each of those evaluations SHALL instead be admitted as an allow. The group matching, reject veto, no-allow rejection, invalid-field rejection, inspection-bound rejection, omitted-policy rejection, and recommended reject list defined by this capability SHALL NOT refuse anything in that attempt, and no `permission_denied` result SHALL be produced by this capability.

`bypass` SHALL relax no other gate. `tools.allowed` availability and catalog admission, owner and tenant authorization (including Knowledge Space ownership), native locator validation, Workspace path projection of executor arguments, the other Workspace re-check conditions, the native recovery fence, web-read time, size, and redirect bounds, Run step and call-timeout bounds, and MCP environment isolation SHALL apply exactly as in `default`.

#### Scenario: A rejected command runs under bypass

- **WHEN** the recommended policy is in force, an attempt's effective mode is `bypass`, and Bash submits `git reset --hard HEAD`
- **THEN** the call is admitted and executes
- **AND** the same call in a `default` attempt is rejected by B6

#### Scenario: Omitted permissions admit every available call under bypass

- **WHEN** `tools.permissions` is omitted, `bypass` is enabled, and a `bypass` attempt calls an advertised tool
- **THEN** the call is admitted
- **AND** a tool absent from `tools.allowed` remains unadvertised and not executable

#### Scenario: Web-read hops and addresses are admitted under bypass

- **WHEN** the recommended policy is in force and a `bypass` attempt reads `http://169.254.169.254/latest/meta-data/`
- **THEN** neither the locator nor its address is refused by F5a–F7
- **AND** the web-read header, call, and body bounds still apply

#### Scenario: Workspace entry skips both path evaluations under bypass

- **WHEN** a `bypass` attempt calls `enter_workspace` for `/tmp/project`, which E2 rejects, and the directory exists
- **THEN** the submitted and canonical paths are both admitted and the Workspace is bound
- **AND** entry still requires `enter_workspace` in `tools.allowed`, an existing directory, and the configured native executor

#### Scenario: A default attempt detaches a Workspace only bypass could enter

- **WHEN** a Workspace bound at `/tmp/project` by a `bypass` Run is re-checked by the next `default` attempt under a policy that rejects it
- **THEN** the binding is detached with reason `permission_rejected`
- **AND** a later `bypass` Run must call `enter_workspace` again to bind it

#### Scenario: Bypass cannot cross owners

- **WHEN** user A's `bypass` attempt reads `kb://<user B's Space>/notes/a.md`
- **THEN** the existing per-call owner authorization refuses the read
- **AND** no content from user B reaches user A

#### Scenario: A worker that does not enable bypass applies its policy

- **WHEN** a Run accepted with `bypass` is claimed by a worker whose `tools.permissionModes` is `["default"]`, and Bash submits `git reset --hard HEAD` under the recommended policy
- **THEN** the attempt's effective mode is `default` and the call is rejected by B6 with `permission_denied`

### Requirement: Bypassed evaluations are recorded as bypass decisions

Every evaluation that `bypass` admits SHALL still produce a trusted decision recorded wherever this capability records a decision of that kind: the call decision on `tool.requested` before any `tool.started` event or executor dispatch, each derived-locator decision of a web read, and the canonical-path decision of `enter_workspace`. A bypass decision SHALL carry the executing process's policy-instance ID, the decision `allow`, the static reason `permission_mode_bypass`, and no clause reference. Because an address record is kept only for a refused address, a `bypass` attempt SHALL produce no address record. Bypass decisions SHALL follow the existing privacy rules for decision metadata: owner-scoped, excluded from model replay, public shares, exports, and search, and carried through completion, abort settlement, and durable transcript reconstruction.

#### Scenario: A bypassed call records its reason

- **WHEN** a `bypass` attempt executes a Bash call
- **THEN** its tool activity and stored tool-part metadata record `allow` with reason `permission_mode_bypass`, the process's policy-instance ID, and no clause reference
- **AND** the record is durable before the call starts

#### Scenario: A bypassed redirect hop is recorded

- **WHEN** a `bypass` attempt's web read follows a redirect
- **THEN** the hop is recorded as a derived-locator decision with reason `permission_mode_bypass`

#### Scenario: Bypass decisions survive reload privately

- **WHEN** the owner reloads a chat containing a bypassed call
- **THEN** the stored tool part retains its `permission_mode_bypass` decision
- **AND** model replay, public shares, exports, and search receive no decision metadata

## MODIFIED Requirements

### Requirement: Execution policy is frozen per process and reevaluated after restart

Each API or worker process SHALL load and compile one immutable effective policy at startup. Configuration changes SHALL require restarting the affected installation processes. Each new invocation SHALL use its executor process's policy, including invocations from Runs queued or started under an earlier policy. The same SHALL hold for the process's enabled permission modes: a process SHALL read `tools.permissionModes` once at startup, and an attempt's effective permission mode SHALL be resolved against the enabled modes of the process that executes it, including for Runs accepted under an earlier configuration. Invocation policy SHALL remain independent of attempt-local tool membership and system-prompt receipts: a policy rejection SHALL not remove a tool from that attempt's catalog. Each fresh attempt SHALL still resolve the executing worker's current catalog, and no historical declaration snapshot SHALL be restored.

Stored completed effects and observations SHALL remain historical facts. The existing Run-level native recovery fence SHALL retain precedence over authorizing any new execution, in every permission mode; this capability SHALL NOT add per-call resumption or known-result recovery: a policy reject SHALL NOT disguise an already possible effect. Read-only re-execution permitted by the existing recovery contract SHALL pass the restarted process's policy before dispatch, or, in an attempt whose effective mode is `bypass`, SHALL be recorded as a bypass decision before dispatch.

#### Scenario: Editing config without restart has no effect

- **WHEN** the operator edits permissions while a worker remains running
- **THEN** that worker continues using its startup policy

#### Scenario: Queued Run encounters a new reject after restart

- **WHEN** a Run was queued under an allow, the operator changes the policy to reject, and the worker restarts before the call executes
- **THEN** the call receives `permission_denied` under the new process policy
- **AND** its original tool declaration remains unchanged

#### Scenario: Recovery cannot hide an uncertain native effect

- **WHEN** a native attempt may have executed before a crash and the restarted policy now rejects that call
- **THEN** the existing native recovery fence settles the recovered Run without reexecution, including its existing `outcome_unknown` result when applicable
- **AND** it does not reexecute or replace uncertainty with a claim that execution was prevented

#### Scenario: Withdrawing bypass takes effect on restart

- **WHEN** a Run accepted with `bypass` is still queued and the operator removes `bypass` from `tools.permissionModes` and restarts the worker
- **THEN** the Run's next attempt executes with effective mode `default` under the worker's policy

#### Scenario: Bypass does not override the recovery fence

- **WHEN** a native attempt of a `bypass` Run may have executed before a crash
- **THEN** the existing native recovery fence settles the recovered Run without reexecution, exactly as in `default`
