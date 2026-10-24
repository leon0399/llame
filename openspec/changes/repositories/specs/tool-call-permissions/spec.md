## ADDED Requirements

### Requirement: Worktree entry decides the source clone and the worktree path

With `worktree`, `enter_workspace` MUST first decide the submitted `path` as the
submitted-path decision under the `enter_workspace` group. It MUST then compute
the worktree directory and decide it under the same group as a derived
`canonical` decision. Both decisions MUST precede any git call. A reject, or no
allow, on either decision MUST refuse the call. It MUST NOT then create a
worktree, a checkout record, or a binding. Under bypass, it MUST record both
decisions as bypass decisions.

#### Scenario: A worktree path reject refuses creation

- **WHEN** the `enter_workspace` group rejects every path that contains
  `\.llame-worktrees/`, and `enter_workspace` submits `/home/operator/src/llame`
  with `worktree: {"name": "clear-field-0192"}`
- **THEN** the derived `canonical` decision for
  `/home/operator/src/.llame-worktrees/llame/clear-field-0192` is `reject`
- **AND** the call returns `permission_denied` before any git call, and no
  worktree checkout is recorded and no Workspace binding exists

#### Scenario: A source clone reject refuses creation

- **WHEN** the `enter_workspace` group rejects `/home/operator/src/llame`, and
  `enter_workspace` submits that path with `worktree`
- **THEN** the submitted-path decision is `reject`, and the call returns
  `permission_denied` before any filesystem probe or git call
- **AND** no derived `canonical` decision is recorded, and no worktree
  checkout and no Workspace binding exist

#### Scenario: Allows on both decisions create the worktree

- **WHEN** the `enter_workspace` group allows `/home/operator/src/llame` and
  `/home/operator/src/.llame-worktrees/`, and `enter_workspace` submits
  `/home/operator/src/llame` with `worktree: {"name": "clear-field-0192"}`
- **THEN** the submitted-path decision is `allow`, and the derived `canonical`
  decision for `/home/operator/src/.llame-worktrees/llame/clear-field-0192`
  records `allow` with its policy provenance
- **AND** one git worktree call runs, and the Workspace binds the worktree
  directory

#### Scenario: Bypass records both worktree decisions

- **WHEN** a `bypass` attempt calls `enter_workspace` for
  `/home/operator/src/llame` with `worktree`, and the group would reject both
  paths
- **THEN** the submitted-path decision and the derived `canonical` decision are
  both recorded with `allow`, reason `permission_mode_bypass`, the process's
  policy-instance ID, and no clause reference
- **AND** the worktree is created
