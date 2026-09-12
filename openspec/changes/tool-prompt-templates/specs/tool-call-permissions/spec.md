## MODIFIED Requirements

### Requirement: Execution policy is frozen per process and reevaluated after restart

Each API or worker process SHALL load and compile one immutable effective policy at startup. Configuration changes SHALL require restarting the affected installation processes. Each new invocation SHALL use its executor process's policy, including invocations from Runs queued or started under an earlier policy. Invocation policy SHALL remain independent of attempt-local tool membership and system-prompt receipts: a policy rejection SHALL not remove a tool from that attempt's catalog. Each fresh attempt SHALL still resolve the executing worker's current catalog, and no historical declaration snapshot SHALL be restored.

Stored completed effects and observations SHALL remain historical facts. The existing Run-level native recovery fence SHALL retain precedence over authorizing any new execution; this capability SHALL NOT add per-call resumption or known-result recovery: a policy reject SHALL NOT disguise an already possible effect. Read-only re-execution permitted by the existing recovery contract SHALL pass the restarted process's policy before dispatch.

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
