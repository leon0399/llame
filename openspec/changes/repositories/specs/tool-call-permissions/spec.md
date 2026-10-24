# Spec Delta

## ADDED Requirements

### Requirement: Worktree entry decides the submitted path before any probe

With `worktree`, `enter_workspace` MUST decide the submitted `path` under the
`enter_workspace` group. That decision MUST precede any filesystem probe and any
git call. A reject, or no allow, on that decision MUST refuse the call as
`permission_denied`. The call MUST NOT then create a worktree, a checkout
record, or a binding. Under `bypass`, it MUST record that decision as a bypass
decision.

#### Scenario: A submitted path reject refuses creation

- **WHEN** the `enter_workspace` group rejects `/home/operator/src/llame`, and
  `enter_workspace` submits that path with `worktree`
- **THEN** the submitted-path decision is `reject`, and the call returns
  `permission_denied` before any filesystem probe or git call
- **AND** no source-clone decision is recorded, and the Workspace binding and
  its generation are unchanged

### Requirement: Worktree entry decides the source clone before any git call

After the submitted-path decision, `enter_workspace` MUST decide the canonical
form of the source clone under the `enter_workspace` group. It MUST record that
decision like a canonical decision, with its provenance. A reject, or no allow,
on either decision MUST refuse the call as `permission_denied` before any git
call. After that decision, one read-only `git.inspect` call can supply the
toplevel and the display name. No git call that writes can run before the
worktree-directory decision.

#### Scenario: A symlinked source refuses before any git call

- **WHEN** `/tmp/project` is a directory symlink to `/home/operator/.ssh`, the
  `enter_workspace` group rejects the credential path, and `enter_workspace`
  submits `/tmp/project` with `worktree`
- **THEN** the source-clone decision uses `/home/operator/.ssh` and returns
  `reject`
- **AND** the call returns `permission_denied` before any git call, and the
  Workspace binding and its generation are unchanged

#### Scenario: Inspection runs after the source-clone decision

- **WHEN** the worktree directory needs the clone toplevel and the display name
- **THEN** one read-only `git.inspect` call runs after the source-clone decision
- **AND** no git call that writes runs before the worktree-directory decision

### Requirement: Worktree entry decides the canonical worktree directory

The call MUST compute the worktree directory and canonicalize it by its deepest
existing ancestor. It MUST decide that canonical form under the
`enter_workspace` group as a further derived decision, recorded like the
canonical one. That decision MUST precede `git.worktreeAdd` and every write. A
reject, or no allow, on it MUST refuse the call as `permission_denied`, with no
worktree, checkout record, or binding. Under `bypass`, it MUST record that
decision as a bypass decision.

#### Scenario: A worktree directory reject refuses creation

- **WHEN** the `enter_workspace` group rejects every path that contains
  `\.llame-worktrees/`, and `enter_workspace` submits
  `/home/operator/src/llame` with `worktree: {"name": "clear-field-0192"}`
- **THEN** the derived decision for
  `/home/operator/src/.llame-worktrees/llame/clear-field-0192` is `reject`
- **AND** the call returns `permission_denied` before `git.worktreeAdd` and any
  write, and the Workspace binding and its generation are unchanged

#### Scenario: A symlinked worktree parent is decided on its canonical form

- **WHEN** `/home/operator/src/.llame-worktrees` is a directory symlink to
  `/tmp/elsewhere`, the `enter_workspace` group rejects `^/tmp/`, and
  `enter_workspace` submits `/home/operator/src/llame` with
  `worktree: {"name": "clear-field-0192"}`
- **THEN** the derived decision uses
  `/tmp/elsewhere/llame/clear-field-0192` and returns `reject`
- **AND** the call returns `permission_denied` before `git.worktreeAdd`

#### Scenario: Allows on every decision create the worktree

- **WHEN** the `enter_workspace` group allows `/home/operator/src/llame` and
  `/home/operator/src/.llame-worktrees/`, and `enter_workspace` submits
  `/home/operator/src/llame` with `worktree: {"name": "clear-field-0192"}`
- **THEN** the submitted-path and source-clone decisions are `allow`, and the
  derived decision for
  `/home/operator/src/.llame-worktrees/llame/clear-field-0192` records `allow`
  with its policy provenance
- **AND** one `git.worktreeAdd` call runs, and the Workspace binds the worktree
  directory

#### Scenario: Bypass records the worktree decisions

- **WHEN** a `bypass` attempt calls `enter_workspace` for
  `/home/operator/src/llame` with `worktree`, and the group would reject both
  paths
- **THEN** the submitted-path decision, the source-clone decision, and the
  derived worktree decision are all recorded with `allow`, reason
  `permission_mode_bypass`, the process's policy-instance ID, and no clause
  reference
- **AND** the worktree is created

### Requirement: Worktree creation verifies the decided path

After `git.worktreeAdd`, the real path of the new directory MUST equal the
decided worktree path. A difference MUST make the call remove the new worktree
and fail as `worktree_failed`. The Workspace binding and its generation MUST NOT
change.

#### Scenario: A realpath mismatch after creation removes the worktree

- **WHEN** `git.worktreeAdd` creates the directory and its real path differs
  from the decided path
- **THEN** the call removes the new worktree and returns `worktree_failed`
- **AND** the Workspace binding and its generation are unchanged
