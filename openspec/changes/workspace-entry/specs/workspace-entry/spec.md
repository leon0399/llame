## Purpose

Defines the owner-scoped Workspace binding for a Chat on its native host, including entry and exit, path projection, lifecycle checks, and context re-establishment across Runs.

## ADDED Requirements

### Requirement: Workspace tools require native authority, allowlisting, and their own permission gates

`enter_workspace` and `exit_workspace` SHALL be available only when `tools.nativeExecutorId` is configured and each tool's own id is present in `tools.allowed`. Every invocation SHALL be evaluated by that tool's own `tools.permissions` group; allowlisting or the other tool's permission group SHALL NOT authorize it. A denied invocation SHALL have no effect on the binding.

#### Scenario: Missing native executor fails closed

- **WHEN** `tools.nativeExecutorId` is unset
- **THEN** `enter_workspace` and `exit_workspace` are unavailable
- **AND** neither tool establishes, changes, or clears a Workspace binding

#### Scenario: Tool omitted from allowlist is unavailable

- **WHEN** either Workspace tool's id is absent from `tools.allowed`
- **THEN** that tool is not advertised or executed
- **AND** the other Workspace tool's allowlist entry does not make it available

#### Scenario: Permission group rejects entry

- **WHEN** `enter_workspace` is allowlisted but its own permission group rejects the submitted path
- **THEN** the call is refused
- **AND** the rejected call does not establish a Workspace binding

#### Scenario: Permission group rejects exit

- **WHEN** `exit_workspace` is allowlisted but its own permission group rejects the call
- **THEN** the call is refused
- **AND** the current binding is not cleared by that call

### Requirement: Workspace entry validates and authorizes both submitted and canonical paths

`enter_workspace` SHALL accept only an absolute path and SHALL reject a non-absolute or NUL-containing path as `invalid_path`. It SHALL canonicalize the path and require the canonical target to be an existing directory. Permission evaluation SHALL consider both the submitted path and the canonical path, and a rejection of either SHALL veto entry. A successful entry result SHALL include the canonical root, a statement that Workspace selects a working root but does not confine host authority, the Workspace skill list, and the state of each Workspace MCP server.

#### Scenario: Relative path is rejected

- **WHEN** the model calls `enter_workspace` with a relative `path`
- **THEN** the call returns `invalid_path`
- **AND** it does not establish a Workspace binding

#### Scenario: Non-directory target is rejected

- **WHEN** the model calls `enter_workspace` with an absolute path whose canonical target is not a directory
- **THEN** entry is refused
- **AND** the path is not established as the Chat's Workspace root

#### Scenario: Canonical path is reported with host authority

- **WHEN** the submitted absolute path resolves to an existing directory and both path permission checks allow entry
- **THEN** the result identifies the canonical absolute root, lists the Workspace skills, and reports each Workspace MCP server's state
- **AND** the result states that Workspace is not filesystem confinement and host operations retain host authority

#### Scenario: Symlink target rejection vetoes entry

- **WHEN** the submitted absolute path is a symbolic link whose canonical directory target is rejected by the `enter_workspace` permission group, even though the submitted spelling is allowed
- **THEN** entry is refused
- **AND** no binding to the submitted path or its canonical target is established

#### Scenario: Submitted path rejection vetoes entry

- **WHEN** the submitted absolute path is rejected by the `enter_workspace` permission group, even though its canonical target would be allowed
- **THEN** entry is refused
- **AND** the canonical target is not established as the Workspace root

### Requirement: Entry switches one binding and exit clears it

A successful `enter_workspace` on a bound Chat SHALL exit the old binding before establishing the new canonical root. Switching SHALL stop the old Workspace MCP clients and remove the old Workspace tool declarations from the running attempt before the new binding takes effect. An authorized `exit_workspace` SHALL clear the Chat binding, stop its Workspace MCP clients, and remove its Workspace tool declarations from the running attempt. A permission-denied switch or exit SHALL NOT perform those effects.

#### Scenario: Successful entry switches the current Workspace

- **WHEN** a bound Chat successfully enters a different authorized directory
- **THEN** the previous binding is exited before the new canonical root becomes current
- **AND** the previous Workspace clients and declarations are stopped or removed before subsequent steps use the new binding

#### Scenario: Exit clears the current binding

- **WHEN** an authorized `exit_workspace` call runs on a bound Chat
- **THEN** the Chat has no Workspace binding for subsequent steps or Runs
- **AND** its Workspace MCP clients are stopped and its Workspace declarations are removed from the running attempt

#### Scenario: Exit on an unbound Chat is harmless

- **WHEN** an authorized `exit_workspace` call runs on a Chat with no Workspace binding
- **THEN** the call leaves the Chat unbound
- **AND** it does not create Workspace clients or declarations

### Requirement: The Workspace binding is Chat-scoped and persists across Runs

A successful entry SHALL bind one Chat to the canonical root and the native executor identity supplied by its trusted Run context. The binding SHALL persist across Runs until an authorized exit, a successful switch, or a detach. A binding change SHALL take effect only for the Run's current attempt; a superseded attempt SHALL NOT change it. Only the owning user's Run context for that Chat SHALL supply the authority to read or change its binding. Model input to `enter_workspace` SHALL contain only `path`, and `exit_workspace` SHALL accept no model-supplied arguments; model input SHALL NOT select an owner, Chat, executor, or permission mode.

#### Scenario: Binding persists into a later Run

- **WHEN** a later Run for the same owner and Chat starts on the bound native executor without an intervening exit, switch, or detach
- **THEN** the Chat's Workspace root remains bound across the Run boundary
- **AND** the later Run re-checks that binding before using it

#### Scenario: A superseded attempt cannot change the binding

- **WHEN** an attempt that has been superseded by a newer delivery of the same Run calls `enter_workspace` or `exit_workspace`
- **THEN** the call does not establish, change, or clear the Chat's binding
- **AND** the binding reflects only the current attempt's effects

#### Scenario: Another owner cannot read or change the binding

- **WHEN** a Run belonging to a different owner attempts to inspect, enter, or exit the first owner's Chat binding
- **THEN** it cannot read or change that binding
- **AND** its result does not disclose the other owner's Workspace root

#### Scenario: Model input cannot select binding authority

- **WHEN** a model supplies owner, Chat, executor, or permission-mode fields in addition to `path` to `enter_workspace`, or supplies arguments to `exit_workspace`
- **THEN** the extra authority fields or arguments are rejected as invalid input
- **AND** binding authority continues to come only from the owning Chat's trusted Run context

### Requirement: Each Run attempt re-checks the binding and detaches invalid state

Before a Run attempt uses a binding, it SHALL verify that the current native executor identity is present and matches the bound executor, that the canonical root still exists as a directory, and that the current `enter_workspace` permission group still allows the root. Failure of any check SHALL detach the binding completely, stop its Workspace MCP clients, remove its Workspace tool declarations, and stage a notice with the detach reason on the triggering user message. A detached binding SHALL NOT be restored automatically; a new binding requires an explicit successful `enter_workspace` call.

#### Scenario: Executor mismatch or absence detaches the binding

- **WHEN** a Run attempt starts with no native executor identity or with an identity different from the one bound to the Chat
- **THEN** the attempt detaches the Workspace before using it
- **AND** the triggering user message receives a notice that names the executor-mismatch or missing-executor reason

#### Scenario: Missing or non-directory root detaches the binding

- **WHEN** a Run attempt starts and the bound root no longer exists as a directory
- **THEN** the attempt detaches the Workspace before using it
- **AND** the triggering user message receives a notice that names the missing-root reason

#### Scenario: Current permission rejection detaches the binding

- **WHEN** a Run attempt starts and the current `enter_workspace` permission group rejects the bound root
- **THEN** the attempt detaches the Workspace before using it
- **AND** the triggering user message receives a notice that names the permission-rejection reason

#### Scenario: Retry does not restore a detached binding

- **WHEN** an attempt detaches a binding and a later retry or Run finds that the executor, directory, and permission checks would now pass
- **THEN** the Chat remains unbound
- **AND** only a new successful `enter_workspace` call can establish a binding again

### Requirement: Relative filesystem paths share one Workspace projection rule

While a Chat is bound, a supported relative filesystem path SHALL resolve from the canonical Workspace root by resolving the submitted relative path against that root and normalizing its path segments; `..` MAY resolve outside the root, because Workspace is not a confinement boundary. The resulting absolute path SHALL be used for both execution and permission evaluation, and permission evaluation SHALL NOT match the submitted relative spelling. An omitted bash working directory SHALL use the root as its effective directory for execution and permission evaluation. Absolute paths and non-filesystem locators, including `kb://`, `skill://`, and web locators, SHALL retain their existing interpretation. Without a binding, relative native-file paths SHALL remain `invalid_path` and bash SHALL retain its existing default working directory. The bash command text SHALL retain its existing text-only permission matching and SHALL NOT be rewritten as a filesystem path. The `bash-execution` and `native-file-tools` requirements define the tool-specific argument and result behavior.

#### Scenario: Relative native path projects from the Workspace root

- **WHEN** a bound Chat calls a native file tool with a relative filesystem path
- **THEN** the path is resolved from the canonical Workspace root and the resulting absolute path is used for execution and permission evaluation
- **AND** permission evaluation does not match the submitted relative spelling

#### Scenario: Parent segments are not confined

- **WHEN** a bound Chat supplies a relative path containing parent segments that resolves outside the Workspace root
- **THEN** projection produces the resulting absolute path outside that root
- **AND** the Workspace binding does not itself confine the host operation to the root

#### Scenario: Omitted bash directory uses the Workspace root

- **WHEN** a bound Chat calls bash without a `cwd`
- **THEN** the command executes with the Workspace root as its effective working directory
- **AND** permission evaluation sees that same absolute directory

#### Scenario: No binding preserves existing relative-path behavior

- **WHEN** a Chat without a Workspace binding supplies a relative native-file path or omits bash `cwd`
- **THEN** the relative native-file path returns `invalid_path` and bash uses its existing default working directory
- **AND** no Workspace root is inferred

#### Scenario: Non-filesystem locators are unchanged

- **WHEN** a bound Chat uses an absolute path or a `kb://`, `skill://`, or web locator
- **THEN** Workspace projection does not reinterpret the locator
- **AND** its existing locator-specific behavior remains in effect

### Requirement: In-Run Workspace transitions are narrated by tool results

`enter_workspace` and `exit_workspace` results SHALL narrate the Workspace state they produce, including the canonical root and the host-authority statement on entry. Narration across turns, detach reasons, and re-establishment after compaction SHALL follow the `workspace` producer defined by `context-injection`. Workspace state SHALL NOT be placed in the system prompt, and tool declarations added or removed by entry and exit SHALL follow `tool-calling`'s in-Run addition rules.

#### Scenario: Tool results narrate in-Run entry and exit

- **WHEN** `enter_workspace` or `exit_workspace` changes the binding during a Run
- **THEN** its tool result narrates the resulting Workspace state
- **AND** the system prompt remains unchanged
