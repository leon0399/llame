# workspace-entry Specification

## Purpose

Defines the owner-scoped Workspace binding for a Chat on its native host, including entry and exit, path projection, lifecycle checks, and context re-establishment across Runs.

## Requirements

### Requirement: Workspace tools require native authority, allowlisting, and their own permission gates

`enter_workspace` and `exit_workspace` SHALL be available only when `tools.nativeExecutorId` is configured and each tool's own id is present in `tools.allowed`. Every invocation SHALL be evaluated by that tool's own `tools.permissions` group; allowlisting or the other tool's permission group SHALL NOT authorize it. `enter_workspace` SHALL be treated as `execute_code` because it can start host processes, and `exit_workspace` SHALL be treated as `write_low_risk`. A successful invocation SHALL use the trusted native executor identity from its owning Chat's Run context. A denied invocation SHALL have no effect on the binding. Every `tools.permissions` evaluation this capability performs — including each `enter_workspace`/`exit_workspace` call, `enter_workspace`'s submitted and canonical paths, and each Run attempt's binding re-check — governs an attempt whose effective permission mode is `default`; an attempt whose effective mode is `bypass` admits it without evaluating a group, as `tool-call-permissions` defines, while native-executor authority, allowlisting, and directory existence apply unchanged.

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

`enter_workspace` SHALL accept only an absolute path and SHALL reject a non-absolute or NUL-containing path as `invalid_path`. Before any filesystem probe, it SHALL evaluate the submitted absolute path against the `enter_workspace` permission group; that submitted path SHALL independently obtain an allow and SHALL NOT match a reject. Only after that decision allows the submitted path SHALL it canonicalize the path and require the canonical target to be an existing directory. It SHALL then evaluate the canonical path, which SHALL independently obtain an allow and SHALL NOT match a reject. A rejection or missing allow for either value SHALL veto entry. The canonical-path decision SHALL be recorded with policy provenance like a derived-locator decision. A successful entry result SHALL include the canonical root, a statement that Workspace selects a working root but does not confine host authority, the Workspace skill list, and the state of each Workspace MCP server.

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

#### Scenario: Submitted path is evaluated before any filesystem probe

- **WHEN** the `enter_workspace` permission group rejects the submitted absolute path
- **THEN** the rejection is returned before canonicalization or any filesystem existence check
- **AND** the result does not disclose whether the submitted path exists

#### Scenario: Canonical path with no allow does not bind

- **WHEN** the submitted absolute path obtains an allow with no reject, its canonical target is an existing directory, and the canonical path matches no allow
- **THEN** entry returns `no_allow`
- **AND** no Workspace binding is established and no Workspace MCP server is started

### Requirement: Entry switches one binding and exit clears it

A successful `enter_workspace` on a bound Chat SHALL compare the canonical root with the current binding. At most one Workspace transition call SHALL take effect in a model step: the first `enter_workspace` or `exit_workspace` call executed in that step SHALL claim the transition slot, and each later transition call in that step SHALL return a non-fatal `workspace_transition_conflict` with no effect. If the canonical root differs, the switch SHALL replace the binding in one fenced compare-and-set transaction, with the fence checked before any effect. Old Workspace MCP clients SHALL be stopped only after that transaction commits, and old Workspace tool declarations, including any id re-added after an exit or switch, SHALL follow the in-Run addition rules defined by `tool-calling` before subsequent steps use the new binding. If the canonical root is already current, re-entry SHALL be a no-op success that returns the current state without restarting Workspace MCP clients or rereading Workspace configuration. An authorized `exit_workspace` SHALL clear the Chat binding, stop its Workspace MCP clients, and make its Workspace tool declarations unavailable according to `tool-calling`. A permission-denied switch or exit SHALL NOT perform those effects. `workspace_generation` SHALL increment only when an enter establishes or switches a binding, when an exit clears a binding, or on detach; same-root re-entry and exit on an unbound Chat SHALL leave it unchanged. Workspace MCP clients SHALL be keyed by Chat, canonical root, and generation. At every attempt start, the executing process SHALL stop clients it holds for that Chat whose key does not match the current binding and start clients for the matching key; exit, switch, and detach SHALL stop clients in that process, while another process SHALL discard stale clients at its next attempt or at the 30-minute idle timeout.

#### Scenario: Successful entry switches the current Workspace

- **WHEN** a bound Chat successfully enters a different authorized directory
- **THEN** one fenced commit replaces the previous binding before old Workspace clients are stopped
- **AND** subsequent steps use the new canonical root rather than the old clients or declarations

#### Scenario: Same-root re-entry is a no-op

- **WHEN** a bound Chat enters a path whose canonical root equals its current Workspace root
- **THEN** the call succeeds and returns the current Workspace state
- **AND** it does not restart Workspace MCP clients or reread Workspace configuration
- **AND** `workspace_generation` remains unchanged

#### Scenario: Exit clears the current binding

- **WHEN** an authorized `exit_workspace` call runs on a bound Chat
- **THEN** the Chat has no Workspace binding for subsequent steps or Runs
- **AND** its Workspace MCP clients are stopped and its Workspace declarations are unavailable to subsequent calls in the attempt

#### Scenario: Exit on an unbound Chat is harmless

- **WHEN** an authorized `exit_workspace` call runs on a Chat with no Workspace binding
- **THEN** the call leaves the Chat unbound
- **AND** it does not create Workspace clients or declarations

#### Scenario: Enter then exit in one step reports a transition conflict

- **WHEN** one model step executes `enter_workspace` for canonical root A and then `exit_workspace`
- **THEN** the entry call claims the transition slot and establishes root A
- **AND** the exit call returns the non-fatal `workspace_transition_conflict` error without clearing the binding or causing another effect

#### Scenario: Enter then enter in one step reports a transition conflict

- **WHEN** one model step executes `enter_workspace` for canonical root A and then `enter_workspace` for canonical root B
- **THEN** the first entry claims the transition slot and establishes root A
- **AND** the second entry returns the non-fatal `workspace_transition_conflict` error without switching to root B or causing another effect

### Requirement: The Workspace binding is Chat-scoped and persists across Runs

A successful entry SHALL bind one Chat to the canonical root and the native executor identity supplied by its trusted Run context. The binding SHALL persist across Runs until an authorized exit, a successful switch, or a detach. A binding change SHALL take effect only for the Run's current attempt; a superseded attempt SHALL NOT change it, and its fence SHALL be checked before any filesystem probe, client stop, client start, declaration change, or other side effect. Only the owner's Run context, through `enter_workspace`, `exit_workspace`, or detach, changes the binding. An owner fork copies it subject to the fork's first-Run re-check. The owner's Chat API reads it. No other principal reads or changes it. The owner's Chat API response SHALL expose the current canonical `workspace_root`, or `null` when unbound. A non-owner SHALL receive `404` for that Chat, and public share projections and visitor forks SHALL omit the binding. Owner-scoped data access SHALL prevent one owner from reading or changing another owner's binding. Model input to `enter_workspace` SHALL contain only `path`, and `exit_workspace` SHALL accept no model-supplied arguments; model input SHALL NOT select an owner, Chat, executor, or permission mode.

#### Scenario: Binding persists into a later Run

- **WHEN** a later Run for the same owner and Chat starts on the bound native executor without an intervening exit, switch, or detach
- **THEN** the Chat's Workspace root remains bound across the Run boundary
- **AND** the later Run re-checks that binding before using it

#### Scenario: A superseded attempt has no side effect

- **WHEN** an attempt that has been superseded by a newer delivery of the same Run calls `enter_workspace` or `exit_workspace`
- **THEN** the fence rejects the call before it probes the path, changes the binding, changes the generation, or changes Workspace clients or declarations
- **AND** the binding reflects only the current attempt's effects

#### Scenario: Retry after a committed binding reaches the same state

- **WHEN** a queue retry repeats an `enter_workspace` call after the binding commit for that canonical root has already succeeded
- **THEN** the retry succeeds idempotently and leaves the same canonical root, executor identity, and effective Workspace state
- **AND** it does not create a second binding or duplicate Workspace clients

#### Scenario: Owner API exposes the canonical root or null

- **WHEN** the owner requests the Chat API response for a bound Chat and then for an unbound Chat
- **THEN** the `workspace_root` field contains the canonical absolute root for the bound Chat and `null` for the unbound Chat
- **AND** no submitted alias replaces the canonical value

#### Scenario: Non-owner API access returns not found

- **WHEN** another owner requests the Chat API response for a Chat they do not own
- **THEN** the response is `404`
- **AND** it does not disclose the Chat's Workspace root or binding state

#### Scenario: Owner-scoped binding access rejects cross-owner reads and writes

- **WHEN** an owner-scoped data access attempts to read or update another owner's Chat binding
- **THEN** it observes no binding and cannot change the other owner's binding
- **AND** the other owner's current binding remains unchanged

#### Scenario: Shared projections omit the Workspace binding

- **WHEN** a public share projection or visitor fork is produced from a Chat with a Workspace binding
- **THEN** the projection and fork expose neither `workspace_root` nor the binding state
- **AND** sharing does not grant access to the owner's binding

#### Scenario: Model input cannot select binding authority

- **WHEN** a model supplies owner, Chat, executor, or permission-mode fields in addition to `path` to `enter_workspace`, or supplies arguments to `exit_workspace`
- **THEN** the extra authority fields or arguments are rejected as invalid input
- **AND** binding authority continues to come only from the owning Chat's trusted Run context

### Requirement: Each Run attempt re-checks the binding and detaches invalid state

Before a Run attempt resolves effective skill sources, `$skill` activation, Workspace MCP clients or catalog entries, the `workspace` item from `context-injection`, or the accepted-turn `instructions` load from `instruction-files`, it SHALL verify that the current native executor identity is present and matches the bound executor, that the stored root still resolves to the stored canonical root and is an existing directory, that the current `enter_workspace` permission group independently evaluates the stored canonical root as its `path` value under the third exception in `tool-call-permissions`, obtaining an allow and matching no reject, and that `enter_workspace` remains in `tools.allowed`. A failed check SHALL detach the binding immediately in its own owner-scoped transaction fenced by the Run's current delivery, rather than waiting for the completed-only terminal transaction. The transaction SHALL clear the binding, increment `workspace_generation`, and set nullable `workspace_detach_reason` to exactly one of `executor_mismatch`, `executor_absent`, `root_missing`, `root_moved`, `permission_rejected`, or `tool_not_allowed`. Detach SHALL stop Workspace MCP clients in the executing process, make Workspace tool declarations unavailable according to `tool-calling`, and stage a notice with the reason on the triggering user message. The `workspace` producer SHALL narrate the detach. The detaching attempt SHALL resolve no Workspace skill sources, perform no `$skill` activation or `skill://` resolution, stage no accepted-turn `instructions` item, and expose no Workspace tools; an already-frozen skill-catalog baseline may still list Workspace skills, and the next accepted turn's skill-catalog notice SHALL remove them. That producer SHALL consume the reason and clear `workspace_detach_reason` only when the narration's Run completes. A detached binding SHALL NOT be restored automatically; a new binding requires an explicit successful `enter_workspace` call.

#### Scenario: Executor mismatch or absence detaches the binding

- **WHEN** a Run attempt starts with no native executor identity or with an identity different from the one bound to the Chat
- **THEN** the attempt detaches the Workspace before using it
- **AND** the triggering user message receives a notice naming `executor_absent` or `executor_mismatch` as appropriate

#### Scenario: Missing or non-directory root detaches the binding

- **WHEN** a Run attempt starts and the bound root no longer exists as a directory
- **THEN** the attempt detaches the Workspace before using it
- **AND** the triggering user message receives a notice that names `root_missing`

#### Scenario: Root moved via symlink replacement detaches the binding

- **WHEN** the bound root path is replaced with a symlink to a different directory before a Run attempt starts, so its `realpath` no longer equals the stored canonical root
- **THEN** the attempt detaches the Workspace before using it
- **AND** the triggering user message receives a notice that names `root_moved`

#### Scenario: Current permission rejection detaches the binding

- **WHEN** the current `enter_workspace` permission group either matches a reject for the bound root or has no allow for it
- **THEN** the attempt detaches the Workspace before using it
- **AND** the triggering user message receives a notice that names `permission_rejected`

#### Scenario: Entry tool removal detaches the binding

- **WHEN** a Run attempt starts while a binding exists but `enter_workspace` is no longer in `tools.allowed`
- **THEN** the attempt detaches the Workspace before using it
- **AND** the triggering user message receives a notice that names `tool_not_allowed`

#### Scenario: Detach completes before Workspace sources and tools are resolved

- **WHEN** a binding fails any re-check during attempt preparation
- **THEN** the owner-scoped detach commit completes before effective skills, `$skill` activation, Workspace MCP clients or catalog entries, the `workspace` item, or the accepted-turn `instructions` load are resolved
- **AND** the attempt has no Workspace skill activation, `skill://` resolution, accepted-turn `instructions` item, or tools and narrates the detach reason; an already-frozen skill-catalog baseline may still list Workspace skills

#### Scenario: Detach-then-fail retry stays unbound

- **WHEN** an attempt detaches a binding and then fails, and a retry finds that the executor, directory, and permission checks would now pass
- **THEN** the Chat remains unbound
- **AND** only a new successful `enter_workspace` call can establish a binding again

#### Scenario: Detach reason clears after completed narration

- **WHEN** the `workspace` producer narrates a staged detach reason and that narration's Run completes
- **THEN** `workspace_detach_reason` is cleared
- **AND** the detach reason remains available until that completed narration

### Requirement: Relative filesystem paths share one Workspace projection rule

While a Chat is bound, a relative filesystem path SHALL mean a value that does not start with `/` and does not have a `scheme:` prefix recognized by the shared locator parser, with recognized `scheme://` prefixes compared case-insensitively. Such a path SHALL resolve lexically from the canonical Workspace root like POSIX `path.posix.resolve`, preserving a submitted trailing separator. Projection SHALL not perform `realpath`; the executor SHALL receive exactly the resulting projected absolute string, and symlinks inside that projected path SHALL be followed by the operating system as for any absolute path. `..` MAY resolve outside the root, because Workspace is not a confinement boundary. The resulting absolute path SHALL be used for both execution and permission evaluation, and permission evaluation SHALL NOT match the submitted relative spelling. During an attempt, the working root SHALL live in one mutable attempt-scoped cell read by the runner and permission evaluator at dispatch; per-call copies of tool context SHALL NOT become independent sources of truth. An omitted bash working directory SHALL use the root as its effective directory for execution and permission evaluation. Absolute paths and recognized non-filesystem locators, including `kb://`, `skill://`, and web locators, SHALL retain their existing interpretation. Unknown schemes SHALL remain `invalid_path`. Without a binding, relative native-file paths SHALL remain `invalid_path` and bash SHALL retain its existing default working directory. The bash command text SHALL retain its existing text-only permission matching and SHALL NOT be rewritten as a filesystem path. The `bash-execution` and `native-file-tools` requirements define the tool-specific argument and result behavior.

#### Scenario: Relative native path projects from the Workspace root

- **WHEN** a bound Chat calls a native file tool with a relative filesystem path
- **THEN** the path is resolved lexically from the canonical Workspace root and the resulting absolute path is used for execution and permission evaluation
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

#### Scenario: Unknown schemes remain invalid paths

- **WHEN** a bound Chat supplies a locator with an unknown `scheme://` prefix to a native file tool
- **THEN** Workspace projection does not treat it as a relative filesystem path
- **AND** the tool returns `invalid_path`

#### Scenario: Trailing separator is preserved

- **WHEN** a bound Chat calls `read("app.ts/")` for a file under the Workspace root
- **THEN** the projected absolute path retains the trailing separator and the executor receives that exact string
- **AND** the result is `not_found` or invalid in the same way as the equivalent absolute path with a trailing separator

#### Scenario: Same-step read uses the prior root

- **WHEN** one model step issues `enter_workspace` or `exit_workspace` together with `read("f")`
- **THEN** the read is projected from the root committed before that step began
- **AND** a binding change takes effect for projection only from the next model step

### Requirement: In-Run Workspace transitions are narrated by tool results

`enter_workspace` and `exit_workspace` results SHALL narrate the Workspace state they produce, including the canonical root and the host-authority statement on entry. Narration across turns, detach reasons, and re-establishment after compaction SHALL follow the `workspace` producer defined by `context-injection`. Workspace state SHALL NOT be placed in the system prompt, and tool declarations added or removed by entry and exit SHALL follow `tool-calling`'s in-Run addition rules. A successful entry that establishes or switches the binding SHALL also trigger the `instruction-files` load for the canonical root, effective from the next model step of the same Run; a same-root re-entry, an exit, and a detach SHALL trigger no load and no removal notice.

#### Scenario: Tool results narrate in-Run entry and exit

- **WHEN** `enter_workspace` or `exit_workspace` changes the binding during a Run
- **THEN** its tool result narrates the resulting Workspace state
- **AND** the system prompt remains unchanged

#### Scenario: Entry loads the root's instruction chain

- **WHEN** `enter_workspace` establishes a binding during a Run and the root's directory chain contains instruction files not in effective context
- **THEN** the next model step of that Run carries one `instructions` item for them
- **AND** `exit_workspace` later in the Chat produces no instructions item
