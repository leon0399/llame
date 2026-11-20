## MODIFIED Requirements

### Requirement: Workspace entry validates and authorizes both submitted and canonical paths

`enter_workspace` MUST accept only an absolute path or a `machine://` locator. It MUST reject any other path, or a path that contains NUL, as `invalid_path`. An absolute path resolves on the current Machine. Before any filesystem probe, the `enter_workspace` group MUST evaluate the submitted path in its projected form, the canonical locator on its Machine without symbolic-link resolution. That value MUST get an allow and MUST NOT match a reject.

Only after that decision allows the submitted path can the tool canonicalize the path on its Machine. The canonical target MUST be an existing directory. The group MUST then evaluate the canonical locator of that directory, which MUST also get an allow and MUST NOT match a reject. A rejection or a missing allow for either value MUST stop the entry. The system MUST record the canonical-path decision with policy provenance, as a derived-locator decision.

A successful entry result MUST contain the canonical root locator and the Workspace skill list. It MUST also state the state of each Workspace MCP server. It MUST state that a Workspace selects a working root but does not confine the authority of the Machine user.

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
- **THEN** the result identifies the canonical root locator, lists the Workspace skills, and reports the state of each Workspace MCP server
- **AND** the result states that a Workspace is not filesystem confinement and that operations keep the authority of the Machine user

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

### Requirement: Workspace tools require native authority, allowlisting, and their own permission gates

`enter_workspace` and `exit_workspace` MUST be available only when `tools.allowed` contains the id of each tool. Startup MUST fail when either tool is allowlisted and `machines.default` is absent. The `tools.permissions` group of each tool MUST evaluate every call of that tool. Allowlisting or the permission group of the other tool MUST NOT authorize it. `enter_workspace` MUST have the `execute_code` classification, because it can start processes on its Machine. `exit_workspace` MUST have the `write_low_risk` classification. A successful call MUST bind a configured Machine. A denied call MUST have no effect on the binding.

Each `tools.permissions` evaluation of this capability governs an attempt whose effective permission mode is `default`. These evaluations include each `enter_workspace` and `exit_workspace` call, the submitted and canonical paths of `enter_workspace`, and the binding re-check of each Run attempt. An attempt whose effective mode is `bypass` admits them without a group evaluation, as `tool-call-permissions` defines. Machine reachability, allowlisting, and directory existence MUST still apply.

#### Scenario: Missing native executor fails closed

- **WHEN** `enter_workspace` or `exit_workspace` is allowlisted and `machines.default` is absent
- **THEN** startup fails naming `machines.default`
- **AND** no Workspace binding is established, changed, or cleared

#### Scenario: Tool omitted from allowlist is unavailable

- **WHEN** the id of either Workspace tool is absent from `tools.allowed`
- **THEN** that tool is not advertised or executed
- **AND** the allowlist entry of the other Workspace tool does not make it available

#### Scenario: Permission group rejects entry

- **WHEN** `enter_workspace` is allowlisted but its own permission group rejects the submitted path
- **THEN** the call is refused
- **AND** the rejected call does not establish a Workspace binding

#### Scenario: Permission group rejects exit

- **WHEN** `exit_workspace` is allowlisted but its own permission group rejects the call
- **THEN** the call is refused
- **AND** that call does not clear the current binding

### Requirement: The Workspace binding is Chat-scoped and persists across Runs

A successful entry MUST bind one Chat to the canonical root locator and to the
name of its Machine. The bound root MUST persist across Runs until an
authorized exit, a successful switch, or a detach. A change of the bound root
MUST apply only to the current attempt of the Run. A superseded attempt MUST
NOT change the bound root. The fence MUST check the attempt before any
filesystem probe, client stop, client start, declaration change, or other side
effect.

Only the Run context of the owner changes the bound root, through
`enter_workspace`, `exit_workspace`, or a detach. The authenticated
chat-creation request of the owner can also establish the first bound root of
the Chat that it creates. A request that establishes the bound root MUST
increment the generation, as an entry that establishes a bound root does. An
owner fork copies the bound root, subject to the first-Run re-check of the
fork.

When it establishes the bound root, the request MUST use the same ordered path
decisions as `enter_workspace`. It MUST require `enter_workspace` in
`tools.allowed`. It MUST require a configured Machine that this process can
reach: its `machines.local` entry, or an entry with a `destination`. It MUST
use a permission mode that the process enables. A `read-only` request MUST
decide its paths as a `default` request does.

The Chat API of the owner MUST read the bound root and the checkout list of the
owner. The system MUST refuse any other principal a read or a change of it. The
Chat API response of the owner MUST expose the current canonical
`workspace_root` locator, or `null` for an unbound Chat. A non-owner MUST get
`404` for that Chat.

Public share projections and visitor forks MUST omit the bound root.
Owner-scoped data access MUST NOT let one owner read or change the bound root
of another owner.

Model input to `enter_workspace` MUST contain only `path` and an optional
`worktree` object. That object MUST contain only `name` and `baseRef`.
`exit_workspace` MUST accept no arguments from the model. Model input MUST NOT
select an owner, a Chat, a Machine through a field other than `path`, or a
permission mode.

#### Scenario: Binding persists into a later Run

- **WHEN** a later Run for the same owner and Chat starts on a worker that can reach the bound Machine
- **AND** no exit, switch, or detach occurs between the Runs
- **THEN** the Workspace root of the Chat stays bound across the Run boundary
- **AND** the later Run re-checks that bound root before it uses it

#### Scenario: A chat-creation request establishes the first binding

- **WHEN** the owner creates a chat with a resolved location, every availability
  gate passes, and the process enables the request permission mode
- **THEN** the chat starts bound to the canonical root locator and the name of
  its Machine
- **AND** the generation of the bound root increments by one, and a later Run
  re-checks that bound root before it uses it

#### Scenario: A superseded attempt has no side effect

- **WHEN** a newer delivery of the same Run supersedes an attempt, and that
  attempt calls `enter_workspace` or `exit_workspace`
- **THEN** the fence rejects the call before it probes the path, changes the
  bound root, changes the generation, or changes Workspace clients or
  declarations
- **AND** the bound root reflects only the effects of the current attempt

#### Scenario: Retry after a committed binding reaches the same state

- **WHEN** a queue retry repeats an `enter_workspace` call after the commit of
  the bound root for that canonical root succeeded
- **THEN** the retry succeeds without change and keeps the same canonical root,
  Machine name, and effective Workspace state
- **AND** it creates no second bound root and no duplicate Workspace clients

#### Scenario: Owner API exposes the canonical root or null

- **WHEN** the owner requests the Chat API response for a bound Chat, then for
  an unbound Chat
- **THEN** `workspace_root` holds the canonical `machine://` root for the bound
  Chat and `null` for the unbound Chat
- **AND** no submitted alias replaces the canonical value

#### Scenario: Non-owner API access returns not found

- **WHEN** another owner requests the Chat API response for a Chat that they do
  not own
- **THEN** the response is `404`
- **AND** it discloses neither the Workspace root of the Chat nor the state of
  its bound root

#### Scenario: Owner-scoped binding access rejects cross-owner reads and writes

- **WHEN** owner-scoped data access tries to read or update the bound root of
  the Chat of another owner
- **THEN** it sees no bound root and cannot change the bound root of the other
  owner
- **AND** the current bound root of the other owner stays unchanged

#### Scenario: Shared projections omit the Workspace binding

- **WHEN** a public share projection or a visitor fork comes from a Chat with a
  bound Workspace root
- **THEN** the projection and the fork expose neither `workspace_root` nor the
  state of the bound root
- **AND** the share grants no access to the bound root of the owner

#### Scenario: Model input cannot select binding authority

- **WHEN** a model supplies owner, Chat, executor, or permission-mode fields in
  addition to `path` or `worktree` to `enter_workspace`, supplies a `worktree`
  field other than `name` or `baseRef`, or supplies arguments to
  `exit_workspace`
- **THEN** the extra fields or arguments are rejected as invalid input
- **AND** authority over the bound root comes only from the trusted Run context
  of the Chat of the owner or from the chat-creation request of the owner

### Requirement: Each Run attempt re-checks the binding and detaches invalid state

A Run attempt MUST verify these conditions before it resolves skill sources, `$skill` activation, prompt imports, Workspace MCP, `workspace` items, or accepted-turn instructions:

- The configuration still declares the bound Machine.
- This process can reach the bound Machine: it is the `machines.local` of the process, or its entry has a `destination`.
- The stored root still resolves to the stored canonical root and is an existing directory.
- The current `enter_workspace` group evaluates the stored canonical root as its `path` value, under the third exception in `tool-call-permissions`. It gets an allow and no matching reject.
- `tools.allowed` still contains `enter_workspace`.

A Machine that is unreachable for a time is not a failed check. `remote-machines` states its behavior.

A failed check MUST detach the binding at once, in its own owner-scoped transaction under the fence of the current delivery of the Run. The detach MUST NOT wait for the terminal transaction of a completed Run. The transaction MUST clear the binding, increment `workspace_generation`, and set the nullable `workspace_detach_reason` to exactly one of `executor_mismatch`, `executor_absent`, `root_missing`, `root_moved`, `permission_rejected`, or `tool_not_allowed`. `executor_absent` names a Machine that the configuration no longer declares.

`executor_mismatch` names a Machine that this process cannot reach. Detach MUST stop Workspace MCP clients in the executing process. It MUST make Workspace tool declarations unavailable according to `tool-calling`. It MUST stage a notice with the reason on the triggering user message. The `workspace` producer MUST narrate the detach.

The detaching attempt MUST resolve no Workspace skill sources. It MUST perform no `$skill` activation, no `skill://` resolution, and no prompt imports. It MUST stage no prompt-import instruction triggers and no accepted-turn `instructions` item, and it MUST expose no Workspace tools. A skill-catalog baseline that is already frozen can still list Workspace skills, and the skill-catalog notice of the next accepted turn MUST remove them.

That producer MUST consume the reason and clear `workspace_detach_reason` in the dispatch transaction that persists the narrating item. This MUST occur whatever the later outcome of the Run. An attempt that ends before that transaction commits leaves the reason set. A detached binding MUST NOT return without a new action. A new binding requires an explicit successful `enter_workspace` call.

A `prompt-imports` item from an earlier attempt of the Run MUST stay on the user message. It MUST replay unchanged as stored text, without a new read or a removal. A retry that does not detach MUST rebuild prompt-import triggers from its persisted resolved paths. On a detaching retry, the items that an earlier attempt stored on the triggering user message MUST stay there unchanged and in place.

This includes an accepted-turn `instructions` item. They MUST replay as stored text, without a new read or a removal. The detaching retry MUST stage no new accepted-turn `instructions` item, as any detaching attempt does. It MUST store its detach narration after the stored items in its own dispatch transaction.

#### Scenario: Executor mismatch or absence detaches the binding

- **WHEN** a Run attempt starts, and the configuration no longer declares the bound Machine or this worker cannot reach it
- **THEN** the attempt detaches the Workspace before it uses it
- **AND** the triggering user message receives a notice that names `executor_absent` or `executor_mismatch`

#### Scenario: Missing or non-directory root detaches the binding

- **WHEN** a Run attempt starts and the bound root no longer exists as a directory
- **THEN** the attempt detaches the Workspace before it uses it
- **AND** the triggering user message receives a notice that names `root_missing`

#### Scenario: Root moved via symlink replacement detaches the binding

- **WHEN** a symbolic link to a different directory replaces the bound root path before a Run attempt starts
- **AND** its `realpath` no longer equals the stored canonical root
- **THEN** the attempt detaches the Workspace before it uses it
- **AND** the triggering user message receives a notice that names `root_moved`

#### Scenario: Current permission rejection detaches the binding

- **WHEN** the current `enter_workspace` permission group matches a reject for the bound root or has no allow for it
- **THEN** the attempt detaches the Workspace before it uses it
- **AND** the triggering user message receives a notice that names `permission_rejected`

#### Scenario: Entry tool removal detaches the binding

- **WHEN** a Run attempt starts while a binding exists but `tools.allowed` no longer contains `enter_workspace`
- **THEN** the attempt detaches the Workspace before it uses it
- **AND** the triggering user message receives a notice that names `tool_not_allowed`

#### Scenario: Detach completes before Workspace sources and tools are resolved

- **WHEN** a binding fails any re-check during attempt preparation
- **THEN** the owner-scoped detach commit completes first
- **AND** effective skills, `$skill` activation, Workspace MCP, the `workspace` item, and the accepted-turn `instructions` load resolve after it
- **AND** the attempt has no Workspace skill activation, no `skill://` resolution, no newly loaded accepted-turn `instructions` item, and no Workspace tools, and it narrates the detach reason. A skill-catalog baseline that is already frozen can still list Workspace skills

#### Scenario: Detach-then-fail retry stays unbound

- **WHEN** an attempt detaches a binding and then fails, and a retry finds that the Machine, directory, and permission checks now pass
- **THEN** the Chat stays unbound
- **AND** only a new successful `enter_workspace` call can establish a binding again

#### Scenario: Detach reason clears after completed narration

- **WHEN** the `workspace` producer narrates a staged detach reason and the dispatch transaction persists that narrating item on the triggering user message
- **THEN** `workspace_detach_reason` is cleared in that transaction, whether or not the Run later completes
- **AND** the detach reason stays available until that narration is persisted

#### Scenario: A failed Run's detach narration is not repeated

- **WHEN** a Run persisted a detach narration at dispatch and then failed, was cancelled, or expired
- **THEN** the narration stays on the triggering user message
- **AND** the next Run narrates no second notice for the same detach

#### Scenario: Detaching attempt without a persisted item leaves markers as prose

- **WHEN** the Workspace binding re-check fails during attempt preparation, and the prompt contains an import marker
- **AND** no `prompt-imports` item from an earlier attempt of the Run is persisted
- **THEN** the attempt detaches before it resolves prompt imports, performs no prompt import, and stages no prompt-import instruction trigger
- **AND** the marker stays prose for that attempt

#### Scenario: A persisted prompt-imports item replays on a detaching retry

- **WHEN** an earlier attempt persisted a `prompt-imports` item and a retry detaches before prompt imports run
- **THEN** the item stays on the user message and replays unchanged as stored text, without a new read or a removal
- **AND** no new prompt imports occur and no prompt-import instruction triggers are staged

#### Scenario: A persisted accepted-turn instructions item replays on a detaching retry

- **WHEN** an earlier attempt persisted an accepted-turn `instructions` item and a retry detaches before the accepted-turn `instructions` load
- **THEN** the item stays on the user message unchanged and in place and replays as stored text, without a new read or a removal
- **AND** the retry stages no new accepted-turn `instructions` item
- **AND** the dispatch transaction of the retry stores its detach narration after the stored items
