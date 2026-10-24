# Spec Delta

## MODIFIED Requirements

### Requirement: The Workspace binding is Chat-scoped and persists across Runs

A successful entry MUST bind one Chat to the canonical root and to the native
executor identity from its trusted Run context. The binding MUST persist across
Runs until an authorized exit, a successful switch, or a detach. A binding
change MUST apply only to the current attempt of the Run. A superseded attempt
MUST NOT change the binding. Its fence MUST be checked before any filesystem
probe, client stop, client start, declaration change, or other side effect. Only
the owner's Run context changes the binding, through `enter_workspace`,
`exit_workspace`, or a detach. The owner's authenticated chat-creation request
also establishes the first binding of the Chat it creates. That binding MUST use
the same submitted and canonical path decisions. It MUST require
`enter_workspace` in `tools.allowed`. It MUST require a configured native
executor equal to the resolved local executor id, or a configured Machine. It
MUST use `default` or an enabled `bypass` permission mode. An owner fork copies
the binding, subject to the fork's first-Run re-check. Only the owner's Chat API
reads the binding. The owner's Chat API response MUST expose the current
canonical `workspace_root`, or `null` for an unbound Chat. A non-owner MUST
receive `404` for that Chat. Public share projections and visitor forks MUST
omit the binding. Owner-scoped data access MUST NOT let one owner read or change
another owner's binding. Model input to `enter_workspace` MUST contain only
`path` and an optional `worktree` object. That object MUST contain only `name`
and `baseRef`. `exit_workspace` MUST accept no model-supplied arguments. Model
input MUST NOT select an owner, a Chat, an executor, or a permission mode.

#### Scenario: Binding persists into a later Run

- **WHEN** a later Run for the same owner and Chat starts on the bound native
  executor, with no exit, switch, or detach between the Runs
- **THEN** the Chat's Workspace root stays bound across the Run boundary
- **AND** the later Run re-checks that binding before it uses it

#### Scenario: A chat-creation request establishes the first binding

- **WHEN** the owner creates a chat with a resolved location, every availability
  gate passes, and the request permission mode is `default` or an enabled
  `bypass`
- **THEN** the chat starts bound to the canonical root and the resolved executor
- **AND** a later Run re-checks that binding before it uses it

#### Scenario: A superseded attempt has no side effect

- **WHEN** a newer delivery of the same Run supersedes an attempt, and that
  attempt calls `enter_workspace` or `exit_workspace`
- **THEN** the fence rejects the call before it probes the path, changes the
  binding, changes the generation, or changes Workspace clients or declarations
- **AND** the binding reflects only the current attempt's effects

#### Scenario: Retry after a committed binding reaches the same state

- **WHEN** a queue retry repeats an `enter_workspace` call after the binding
  commit for that canonical root succeeded
- **THEN** the retry succeeds idempotently and keeps the same canonical root,
  executor identity, and effective Workspace state
- **AND** it creates no second binding and no duplicate Workspace clients

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
- **AND** it discloses neither the Chat's Workspace root nor its binding state

#### Scenario: Owner-scoped binding access rejects cross-owner reads and writes

- **WHEN** owner-scoped data access tries to read or update another owner's Chat
  binding
- **THEN** it sees no binding and cannot change the other owner's binding
- **AND** the other owner's current binding stays unchanged

#### Scenario: Shared projections omit the Workspace binding

- **WHEN** a public share projection or a visitor fork comes from a Chat with a
  Workspace binding
- **THEN** the projection and the fork expose neither `workspace_root` nor the
  binding state
- **AND** the share grants no access to the owner's binding

#### Scenario: Model input cannot select binding authority

- **WHEN** a model supplies owner, Chat, executor, or permission-mode fields in
  addition to `path` or `worktree` to `enter_workspace`, supplies a `worktree`
  field other than `name` or `baseRef`, or supplies arguments to
  `exit_workspace`
- **THEN** the extra fields or arguments are rejected as invalid input
- **AND** binding authority comes only from the owning Chat's trusted Run
  context or, for the first binding, its owner's chat-creation request
