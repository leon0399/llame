# workspace-entry Specification

## Purpose

Defines the owner-scoped Workspace binding for a Chat on its native host, including entry and exit, path projection, lifecycle checks, and context re-establishment across Runs.

## Requirements

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

### Requirement: Relative filesystem paths share one Workspace projection rule

While a Chat is bound, a relative filesystem path SHALL mean a value that does not start with `/` and does not have a `scheme:` prefix recognized by the shared locator parser, with recognized `scheme://` prefixes compared case-insensitively. Such a path SHALL resolve lexically from the canonical Workspace root like POSIX `path.posix.resolve`, preserving a submitted trailing separator. Projection SHALL not perform `realpath`; the executor SHALL receive exactly the resulting projected absolute string, and symlinks inside that projected path SHALL be followed by the operating system as for any absolute path. `..` MAY resolve outside the root, because Workspace is not a confinement boundary. The resulting absolute path SHALL be used for both execution and permission evaluation, and permission evaluation SHALL NOT match the submitted relative spelling. During an attempt, the working root SHALL live in one mutable attempt-scoped cell read by the runner and permission evaluator at dispatch; per-call copies of tool context SHALL NOT become independent sources of truth. An omitted bash working directory SHALL use the root as its effective directory for execution and permission evaluation. Absolute paths and recognized non-filesystem locators, including `kb://`, `skill://`, `media://`, and web locators, SHALL retain their existing interpretation. Unknown schemes SHALL remain `invalid_path`. Without a binding, relative native-file paths SHALL remain `invalid_path` and bash SHALL retain its existing default working directory. The bash command text SHALL retain its existing text-only permission matching and SHALL NOT be rewritten as a filesystem path. The `bash-execution` and `native-file-tools` requirements define the tool-specific argument and result behavior.

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

#### Scenario: A media locator is not a relative path

- **WHEN** a Chat bound to `/work/project` calls `read` with `media://0190f5e2-7c1a-7b3e-9d4f-2a6b8c0d1e2f`
- **THEN** Workspace projection leaves the locator unchanged and permission evaluation sees
  `media://0190f5e2-7c1a-7b3e-9d4f-2a6b8c0d1e2f`
- **AND** the read resolves the Run owner's media object rather than a path under `/work/project`

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

### Requirement: Workspace entry can create a worktree of the source clone

`enter_workspace` MUST accept an optional `worktree` object with only `name` and
`baseRef`. The submitted `path` MUST be a directory in the source clone, which
can be the main tree or a subdirectory of it. `git.inspect` MUST resolve the
submitted directory to the main tree. That main tree MUST be the source clone. A
successful call MUST create a worktree of it.

The call MUST bind the new worktree directory as the Workspace root, and MUST
record the worktree checkout and its lease. The result MUST name the root, the
branch, and the base commit.

#### Scenario: A local clone produces a worktree binding

- **WHEN** a Chat calls `enter_workspace` with `path` `/home/dev/src/llame` and
  `worktree: {}`
- **THEN** the call creates a directory under
  `/home/dev/src/.llame-worktrees/llame/`, starts a branch for it, and binds that
  directory as the Workspace root
- **AND** the result names the worktree root, the generated branch, and the base
  commit

#### Scenario: A successful call records the checkout and the lease

- **WHEN** a Chat calls `enter_workspace` with a source clone and the name
  `calm-otter-9f2c`
- **THEN** the owner has a worktree checkout at the new directory with branch
  `llame/calm-otter-9f2c`, whose parent is the main checkout of the source clone
- **AND** a lease for that checkout names the Chat

#### Scenario: A worktree call always switches the binding

- **WHEN** a Chat bound to `/home/dev/src/llame` calls `enter_workspace` with
  that path and `worktree`
- **THEN** the call creates a worktree and binds the new directory as a target
  root that differs from the current root
- **AND** the Workspace generation increases by one

### Requirement: Worktree names, branches, and base refs follow one rule

An omitted `name` MUST generate `<adjective>-<noun>-<4 hex>`, and the call MUST
use a supplied `name` as written. A `name` MUST NOT start with `-`, MUST NOT
contain a `.` or `..` segment, and MUST pass the git branch-name rules. The
directory slug MUST replace each `/` in the name with `-`. The branch MUST be
`llame/<name>`, or the name itself when it contains `/`. An omitted `baseRef`
MUST use the source HEAD. A `baseRef` MUST NOT start with `-`, and the call MUST
NOT fetch or use the network.

#### Scenario: An omitted name is generated

- **WHEN** a Chat calls `enter_workspace` with a source clone and no
  `worktree.name`
- **THEN** the call uses a generated name in the form
  `<adjective>-<noun>-<4 hex>`
- **AND** the branch is `llame/<generated name>`

#### Scenario: Generated names do not collide

- **WHEN** two worktree calls omit `name` for the same source clone
- **THEN** the second call generates a name different from the first
- **AND** the branch created by the second call does not exist before that call

#### Scenario: A name with a slash is a full branch

- **WHEN** a Chat calls `enter_workspace` with
  `worktree: { name: "feature/login" }`
- **THEN** the branch is `feature/login`
- **AND** the directory slug is `feature-login`

#### Scenario: An omitted base ref uses the source HEAD

- **WHEN** the source clone HEAD is `abc1234` and the call omits `baseRef`
- **THEN** the worktree starts at `abc1234`
- **AND** the call runs no fetch

#### Scenario: A base ref that looks like an option is rejected

- **WHEN** a Chat calls `enter_workspace` with `worktree: { baseRef: "--force" }`
- **THEN** the call returns `invalid_input`
- **AND** no git command starts

#### Scenario: A name that escapes the directory is rejected

- **WHEN** a Chat calls `enter_workspace` with `worktree: { name: ".." }`
- **THEN** the call returns `invalid_input`
- **AND** no directory and no branch is created

#### Scenario: A name that starts with a hyphen is rejected

- **WHEN** a Chat calls `enter_workspace` with `worktree: { name: "-upload" }`
- **THEN** the call returns `invalid_input`
- **AND** no git command starts

### Requirement: Worktree placement follows the source clone and its worktree base

The worktree directory MUST be
`<parent>/.llame-worktrees/<display name>/<slug>`. `<parent>` MUST be the parent
of the real path of the source clone. A `worktree_base` on the main checkout MUST replace
`<parent>/.llame-worktrees`. The call MUST canonicalize the directory by its
deepest ancestor that exists. The daemon MUST confirm that the real path of the
new directory equals the decided directory before any copy. A difference MUST
keep the new worktree and MUST fail as `copy_failed`, which the call reports as
`worktree_failed` with the known `leftDirectory`. When the daemon reports
success at a path whose real path differs from the decided directory, the call
MUST remove the new worktree and MUST fail as `worktree_failed`.

#### Scenario: The default placement uses the clone parent

- **WHEN** the source clone's main tree is `/home/dev/src/llame` and a
  Chat calls `enter_workspace` with that path and `worktree`
- **THEN** the worktree directory is
  `/home/dev/src/.llame-worktrees/llame/<slug>`
- **AND** no directory is created inside `/home/dev/src/llame`

#### Scenario: A worktree base replaces the worktree directory

- **WHEN** the main checkout of `/srv/work/llame` stores the `worktree_base`
  `/srv/trees` and a Chat calls `enter_workspace` with that `path` and `worktree`
- **THEN** the worktree is created under `/srv/trees/llame/`
- **AND** no directory is created under `/srv/work/.llame-worktrees`

#### Scenario: A subdirectory path places the worktree beside the clone

- **WHEN** a Chat calls `enter_workspace` with `path`
  `/home/dev/src/llame/apps/web` and `worktree`
- **THEN** the source clone is `/home/dev/src/llame`
- **AND** the worktree directory is under
  `/home/dev/src/.llame-worktrees/llame/`

#### Scenario: A symlinked worktree parent is decided on its canonical form

- **WHEN** `/home/operator/src/.llame-worktrees` is a symlink to
  `/tmp/elsewhere`, and a Chat calls `enter_workspace` with
  `/home/operator/src/llame` and `worktree: { name: "clear-field-0192" }`
- **THEN** the call decides `/tmp/elsewhere/llame/clear-field-0192` as the
  worktree directory
- **AND** the real path of the new directory equals that decided directory

#### Scenario: A moved root keeps the Worktree and reports the leftover

- **WHEN** the daemon finds that the real path of the new directory differs
  from the decided directory
- **THEN** it copies nothing and fails as `copy_failed`
- **AND** the call returns `worktree_failed` with the known `leftDirectory`
- **AND** the new worktree is retained and the Chat stays bound to its previous
  root

#### Scenario: A success at another path is removed

- **WHEN** the daemon reports success at a path whose real path differs from
  the decided directory
- **THEN** the call removes the new worktree
- **AND** the call fails as `worktree_failed`

### Requirement: An unregistered source clone is adopted on worktree entry

A `worktree` call MUST adopt a source clone that has no recorded checkout. It
MUST record a repository for the canonical remote, or one without a remote, and
a main checkout with origin `adopted`. Adoption MUST insert or reuse those rows
in the fenced transaction. A concurrent adopter MUST reuse the rows of the
winner. Adoption MUST NOT create a project link. A linked-worktree source MUST
use its main clone as source and parent.

#### Scenario: An unregistered clone is adopted

- **WHEN** a Chat calls `enter_workspace` with `worktree` and the path
  `/home/dev/src/llame`, whose remote is `git@github.com:leon0399/llame.git`,
  and the owner has no record of that remote
- **THEN** the owner has a repository for `github.com/leon0399/llame`
- **AND** the owner has a main checkout for `/home/dev/src/llame` with origin
  `adopted`
- **AND** the worktree checkout refers to that main checkout

#### Scenario: A remote-less clone is adopted

- **WHEN** the source clone has no remote and the owner has no record of it
- **THEN** the call records a repository without a remote
- **AND** the main checkout has origin `adopted`

#### Scenario: A recorded remote is reused

- **WHEN** the owner already records the canonical remote of the source clone
- **THEN** the call uses that repository
- **AND** the call records no second repository for the same remote

#### Scenario: Adoption creates no project link

- **WHEN** adoption completes for a source clone
- **THEN** no project links the repository
- **AND** the owner's project list does not change

#### Scenario: A linked-worktree source uses its main clone

- **WHEN** the submitted `path` is a linked worktree of
  `/home/dev/src/llame`, and a Chat calls `enter_workspace` with it and
  `worktree`
- **THEN** the call uses `/home/dev/src/llame` as the source and the parent
- **AND** the new worktree directory is under
  `/home/dev/src/.llame-worktrees/llame/`

#### Scenario: Two concurrent calls adopt one clone once

- **WHEN** two Chats call `enter_workspace` with `worktree` on the same
  unregistered clone at the same time
- **THEN** the owner holds one repository and one main checkout for that clone
- **AND** both calls record their own worktree and bind it

### Requirement: Worktree creation failure leaves the binding unchanged

A worktree failure MUST NOT record a repository, a checkout, or a lease. The
bound root and its generation MUST NOT change. A source that is not a git
repository MUST fail as `worktree_failed`. A git failure or timeout MUST fail as
`worktree_failed` with the redacted git standard error. A failed environment copy
MUST fail as `worktree_failed` with a `message` that is a fixed reason phrase plus
at most one bounded relative path, never standard error, OS error text, manifest
lines, or file bytes. A `worktreeAdd` timeout MUST name the plan directory as a
possible `leftDirectory`, because the API cannot tell an add timeout from a copy
timeout. `path_not_registered` MUST be its only separate code. An offline Machine MUST fail as
`machine_unavailable`, and a daemon that reports another protocol version or
answers a git method with UNIMPLEMENTED MUST fail as
`machine_update_required`.

#### Scenario: A failed creation keeps the previous binding

- **WHEN** a bound Chat calls `enter_workspace` with `worktree` and git cannot
  create the directory
- **THEN** the call returns `worktree_failed` with the git standard error
- **AND** the Chat stays bound to its previous root with the same generation

#### Scenario: A failed creation records no row

- **WHEN** worktree creation fails
- **THEN** the owner has no new repository, no worktree checkout, and no lease
  for that directory

#### Scenario: Adoption followed by a failed creation records nothing

- **WHEN** an unregistered clone is adopted and the worktree creation that
  follows fails
- **THEN** the owner has no new repository and no new checkout
- **AND** the Chat stays bound to its previous root with the same generation

#### Scenario: A non-repository source fails

- **WHEN** a Chat calls `enter_workspace` with `worktree` and the source is not a
  git repository
- **THEN** the call returns `worktree_failed`
- **AND** no directory, repository, checkout, or lease is recorded

#### Scenario: An offline Machine fails

- **WHEN** a Chat calls `enter_workspace` with a Machine source and `worktree`,
  and the Machine is offline
- **THEN** the call returns `machine_unavailable`
- **AND** the bound root and its generation are unchanged

#### Scenario: An outdated daemon fails

- **WHEN** the Machine daemon reports another protocol version at the handshake
- **THEN** the call returns `machine_update_required`
- **AND** no git call runs, and the bound root and its generation are
  unchanged

#### Scenario: A daemon without the git method fails

- **WHEN** the Machine daemon answers a git request with UNIMPLEMENTED
- **THEN** the call returns `machine_update_required`
- **AND** no further git call runs, and the bound root and its generation are
  unchanged

#### Scenario: A timeout fails

- **WHEN** the worktree operation exceeds its timeout
- **THEN** the call returns `worktree_failed` with the plan directory as a possible `leftDirectory`
- **AND** the bound root and its generation are unchanged

#### Scenario: A retry after a fixed failure succeeds

- **WHEN** a later Run repeats the call after the owner fixes the directory
  permission
- **THEN** the call creates the worktree
- **AND** the bound root is the new directory

#### Scenario: A copy failure carries a fixed message

- **WHEN** the environment copy fails on `config/secret.env` after git creates the directory
- **THEN** the call returns `worktree_failed` with no `code`
- **AND** `message` is a fixed reason phrase plus `config/secret.env`, with no standard error, OS error text, manifest line, or file bytes
- **AND** the Chat stays bound to its previous root with the same generation

### Requirement: Worktree entry is fenced and atomic

The checkout, lease, adopted rows, and bound root MUST commit in one transaction
under the same fence. The worker MUST append a `native.attempt` with the
`worktree` operation before `git.worktreeAdd`. It MUST append that attempt's
`native.result` in the same transaction. A redelivered Run with a
`native.attempt` MUST fail as `outcome_unknown`. A fence loss MUST answer
`executor_unavailable` with `leftDirectory`. A crash before the commit MUST
leave no checkout, lease, adopted row, or bound root.

#### Scenario: A worker crash after the add fails the Run as unknown

- **WHEN** a worker crashes after `git.worktreeAdd` succeeds and before the
  transaction commits
- **THEN** a redelivery of that Run fails as `outcome_unknown` without a replay
  of its loop, per the `tool-calling` rule
- **AND** it creates no second worktree and records no checkout, no lease, and
  no change of the bound root

#### Scenario: A fence loss after the add answers executor_unavailable

- **WHEN** the fence is lost after `git.worktreeAdd` succeeds
- **THEN** the call returns `executor_unavailable` with `leftDirectory` that holds
  the remaining directory
- **AND** it records no checkout, no lease, and no change of the bound root

#### Scenario: A crash before the commit records no row

- **WHEN** the worker stops before the transaction commits
- **THEN** the owner holds no checkout and no lease for the new directory
- **AND** the bound root and its generation are unchanged

#### Scenario: A lost Machine link reports an unknown outcome

- **WHEN** the Machine link drops after the daemon received `git.worktreeAdd`
- **THEN** the call returns `outcome_unknown` and records no row
- **AND** the bound root and its generation are unchanged, and `leftDirectory`
  names the directory when known

#### Scenario: A superseded attempt creates no worktree

- **WHEN** the attempt is superseded before `git.worktreeAdd`
- **THEN** the fence check refuses the call
- **AND** no directory, no checkout, no lease, and no change of the bound root
  results

### Requirement: Worktree entry completes its environment copy before commit

A Worktree entry MUST complete the `worktree-includes` copy before it commits
the Checkout, lease, adopted rows, and bound root. It MUST preserve the selected
Checkout root separately from the main Checkout used for git creation and
parenting. A copy failure MUST leave the previous bound root and generation
unchanged.

#### Scenario: A linked source supplies files without a parent change

- **WHEN** entry creates a Worktree from a linked source with a different local `.env` from main
- **THEN** the new Worktree receives the linked source's selected `.env`
- **AND** the recorded parent and placement follow the existing main-Checkout rules

#### Scenario: A partial copy keeps the old Workspace

- **WHEN** an entry copy fails after git creates the destination
- **THEN** entry returns `worktree_failed` with the known `leftDirectory`
- **AND** the previous bound root and generation remain unchanged
- **AND** no new Checkout, lease, or adopted rows commit

### Requirement: The Worktree attempt covers checkout and environment copy

The existing Worktree native attempt MUST precede git checkout and environment
copy. The operation MUST preserve existing fence checks and durable results.
Recovery MUST NOT repeat checkout or copy after an uncertain recorded attempt.
A lost Machine connection MUST preserve `outcome_unknown` and the known
`leftDirectory`. The durable result of a known failure MUST preserve
`leftDirectory`, so a redelivered Run keeps it.

#### Scenario: A crash during copy does not replay its effects

- **WHEN** the worker crashes after the Worktree native attempt and during a partial copy
- **THEN** redelivery follows the existing unknown-outcome recovery contract
- **AND** it repeats neither checkout nor file copy

#### Scenario: A lost connection preserves the leftover locator

- **WHEN** the Machine connection ends after checkout but before the copy result arrives
- **THEN** entry returns `outcome_unknown` with the known `leftDirectory`
- **AND** it commits no successful binding or Checkout

#### Scenario: The durable result keeps the leftover locator

- **WHEN** a known failure returns a `leftDirectory` and the attempt settles
- **THEN** the durable `native.result` holds that `leftDirectory`
- **AND** a redelivered Run returns it

#### Scenario: Plain entry does not copy files

- **WHEN** entry binds an existing directory without a `worktree` request
- **THEN** it does not process `.worktreeinclude`
