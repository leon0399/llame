# Spec Delta

## MODIFIED Requirements

### Requirement: The Workspace binding is Chat-scoped and persists across Runs

A successful entry MUST bind one Chat to the canonical root and to the native
executor identity from its trusted Run context. The bound root MUST persist
across Runs until an authorized exit, a successful switch, or a detach. A change
of the bound root MUST apply only to the current attempt of the Run. A
superseded attempt MUST NOT change the bound root. The fence MUST check the
attempt before any filesystem probe, client stop, client start, declaration
change, or other side effect.

Only the owner's Run context changes the bound root, through `enter_workspace`,
`exit_workspace`, or a detach. The owner's authenticated chat-creation request
can also establish the first bound root of the Chat that it creates. A request
that establishes the bound root MUST increment the generation, as an entry that
establishes a bound root does. An owner fork copies the bound root, subject to
the fork's first-Run re-check.

When it establishes the bound root, the request MUST use the same ordered path
decisions as `enter_workspace`. It MUST require `enter_workspace` in
`tools.allowed`. It MUST require a configured native executor equal to the
resolved local executor id, or a configured Machine. It MUST use `default` or an
enabled `bypass` permission mode.

The owner's Chat API MUST read the bound root and the owner's checkout list. The
system MUST refuse any other principal a read or a change of it. The owner's
Chat API response MUST expose the current canonical `workspace_root`, or `null`
for an unbound Chat. A non-owner MUST receive `404` for that Chat.

Public share projections and visitor forks MUST omit the bound root.
Owner-scoped data access MUST NOT let one owner read or change another owner's
bound root.

Model input to `enter_workspace` MUST contain only `path` and an optional
`worktree` object. That object MUST contain only `name` and `baseRef`.
`exit_workspace` MUST accept no model-supplied arguments. Model input MUST NOT
select an owner, a Chat, an executor, or a permission mode.

#### Scenario: Binding persists into a later Run

- **WHEN** a later Run for the same owner and Chat starts on the bound native
  executor, with no exit, switch, or detach between the Runs
- **THEN** the Chat's Workspace root stays bound across the Run boundary
- **AND** the later Run re-checks that bound root before it uses it

#### Scenario: A chat-creation request establishes the first binding

- **WHEN** the owner creates a chat with a resolved location, every availability
  gate passes, and the request permission mode is `default` or an enabled
  `bypass`
- **THEN** the chat starts bound to the canonical root and the resolved executor
- **AND** the generation of the bound root increments by one, and a later Run
  re-checks that bound root before it uses it

#### Scenario: A superseded attempt has no side effect

- **WHEN** a newer delivery of the same Run supersedes an attempt, and that
  attempt calls `enter_workspace` or `exit_workspace`
- **THEN** the fence rejects the call before it probes the path, changes the
  bound root, changes the generation, or changes Workspace clients or
  declarations
- **AND** the bound root reflects only the current attempt's effects

#### Scenario: Retry after a committed binding reaches the same state

- **WHEN** a queue retry repeats an `enter_workspace` call after the commit of
  the bound root for that canonical root succeeded
- **THEN** the retry succeeds idempotently and keeps the same canonical root,
  executor identity, and effective Workspace state
- **AND** it creates no second bound root and no duplicate Workspace clients

#### Scenario: Owner API exposes the canonical root or null

- **WHEN** the owner requests the Chat API response for a bound Chat, then for
  an unbound Chat
- **THEN** `workspace_root` holds the canonical absolute root for the bound Chat
  and `null` for the unbound Chat
- **AND** no submitted alias replaces the canonical value

#### Scenario: Non-owner API access returns not found

- **WHEN** another owner requests the Chat API response for a Chat they do not
  own
- **THEN** the response is `404`
- **AND** it discloses neither the Chat's Workspace root nor the state of its
  bound root

#### Scenario: Owner-scoped binding access rejects cross-owner reads and writes

- **WHEN** owner-scoped data access tries to read or update the bound root of
  another owner's Chat
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
- **AND** authority over the bound root comes only from the trusted Run context of the owner's Chat or from the owner's chat-creation request
