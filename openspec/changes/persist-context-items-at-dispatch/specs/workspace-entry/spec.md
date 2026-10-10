## MODIFIED Requirements

### Requirement: Each Run attempt re-checks the binding and detaches invalid state

Before a Run attempt resolves effective skill sources, `$skill` activation, prompt imports, Workspace MCP clients or catalog entries, the `workspace` item from `context-injection`, or the accepted-turn `instructions` load from `instruction-files`, it SHALL verify that the current native executor identity is present and matches the bound executor, that the stored root still resolves to the stored canonical root and is an existing directory, that the current `enter_workspace` permission group independently evaluates the stored canonical root as its `path` value under the third exception in `tool-call-permissions`, obtaining an allow and matching no reject, and that `enter_workspace` remains in `tools.allowed`. A failed check SHALL detach the binding immediately in its own owner-scoped transaction fenced by the Run's current delivery, rather than waiting for the completed-only terminal transaction. The transaction SHALL clear the binding, increment `workspace_generation`, and set nullable `workspace_detach_reason` to exactly one of `executor_mismatch`, `executor_absent`, `root_missing`, `root_moved`, `permission_rejected`, or `tool_not_allowed`. Detach SHALL stop Workspace MCP clients in the executing process, make Workspace tool declarations unavailable according to `tool-calling`, and stage a notice with the reason on the triggering user message. The `workspace` producer SHALL narrate the detach. The detaching attempt SHALL resolve no Workspace skill sources, perform no `$skill` activation or `skill://` resolution or prompt imports, stage no prompt-import instruction triggers or accepted-turn `instructions` item, and expose no Workspace tools; an already-frozen skill-catalog baseline may still list Workspace skills, and the next accepted turn's skill-catalog notice SHALL remove them. That producer SHALL consume the reason and clear `workspace_detach_reason` in the dispatch transaction that persists the narrating item on the triggering user message, whatever the Run's later outcome; an attempt that ends before that transaction commits leaves the reason set. A detached binding SHALL NOT be restored automatically; a new binding requires an explicit successful `enter_workspace` call.
A `prompt-imports` item persisted by an earlier attempt of the Run SHALL remain on the user message and replay unchanged as stored text, without being re-read or removed; a non-detaching retry SHALL rebuild prompt-import triggers from its persisted resolved paths.
An accepted-turn `instructions` item persisted by an earlier attempt of the Run SHALL likewise remain on the user message and replay unchanged as stored text on a detaching retry, without being re-read or removed; the detaching retry SHALL load no further accepted-turn instructions.

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
- **AND** the attempt has no Workspace skill activation, `skill://` resolution, newly loaded accepted-turn `instructions` item, or tools and narrates the detach reason; an already-frozen skill-catalog baseline may still list Workspace skills

#### Scenario: Detach-then-fail retry stays unbound

- **WHEN** an attempt detaches a binding and then fails, and a retry finds that the executor, directory, and permission checks would now pass
- **THEN** the Chat remains unbound
- **AND** only a new successful `enter_workspace` call can establish a binding again

#### Scenario: Detach reason clears after completed narration

- **WHEN** the `workspace` producer narrates a staged detach reason and the dispatch transaction persists that narrating item on the triggering user message
- **THEN** `workspace_detach_reason` is cleared in that transaction, whether or not the Run later completes
- **AND** the detach reason remains available until that narration is persisted

#### Scenario: A failed Run's detach narration is not repeated

- **WHEN** a Run persisted a detach narration at dispatch and then failed, was cancelled, or expired
- **THEN** the narration remains on the triggering user message
- **AND** the next Run narrates no second notice for the same detach

#### Scenario: Detaching attempt without a persisted item leaves markers as prose

- **WHEN** the Workspace binding re-check fails during attempt preparation, the prompt contains an import marker, and no `prompt-imports` item from an earlier attempt of the Run is persisted
- **THEN** the attempt detaches before resolving prompt imports, performs no prompt import, and stages no prompt-import instruction trigger
- **AND** the marker remains prose for that attempt

#### Scenario: A persisted prompt-imports item replays on a detaching retry

- **WHEN** an earlier attempt persisted a `prompt-imports` item and a retry detaches before prompt imports run
- **THEN** the item remains on the user message and replays unchanged as stored text, without being re-read or removed
- **AND** no new prompt imports occur and no prompt-import instruction triggers are staged

#### Scenario: A persisted accepted-turn instructions item replays on a detaching retry

- **WHEN** an earlier attempt persisted an accepted-turn `instructions` item and a retry detaches before the accepted-turn `instructions` load
- **THEN** the item remains on the user message and replays unchanged as stored text, without being re-read or removed
- **AND** the retry loads no further accepted-turn instructions
