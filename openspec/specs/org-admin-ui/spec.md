# org-admin-ui

## Purpose

The web app's management surface for organizations, units, and members (design.md D6): tree management, members panel, and spec-mandated domain-error UX.

## Requirements

### Requirement: Organizations overview
The web app SHALL provide an Organizations section listing every org unit visible to the signed-in user as trees (roots with nested children, ordered by path), with an affordance to create a new root organization. With no visible orgs it SHALL show an empty state explaining what an organization is and offering creation.

#### Scenario: First-run empty state
- **WHEN** a user with no org memberships opens the Organizations section
- **THEN** an empty state with a "create organization" action is shown instead of a blank list

#### Scenario: Visible trees render nested
- **WHEN** a user belonging to units in two different orgs opens the section
- **THEN** both trees render with children indented under parents

### Requirement: Unit management actions
For each unit the UI SHALL offer create-child, rename, move (choose a new parent from units the user administers, or root), and delete — issuing the corresponding API calls and reflecting the server's answer. Destructive or ownership-affecting actions (delete unit, revoke member, grant or transfer `owner`) SHALL require an explicit confirmation naming the consequence. The UI SHALL NOT locally re-implement authorization: actions may be offered and the server's 403 handled honestly.

#### Scenario: Delete requires confirmation
- **WHEN** a user triggers deletion of a unit
- **THEN** a confirmation dialog names the unit and states the memberships that will be removed before any request is sent

#### Scenario: Server denial surfaces honestly
- **WHEN** the API answers 403 to an attempted action
- **THEN** the UI explains the missing role (admin/owner on this unit or an ancestor) rather than failing silently or showing a generic error

### Requirement: Members panel
Selecting a unit SHALL show its roster (user, role badge) with controls to grant a membership (user id + role), change a role, and revoke — including the caller leaving the unit themselves. The panel SHALL display the caller's own effective role for the selected unit, marking it inherited when it comes from an ancestor.

#### Scenario: Inherited role is visible
- **WHEN** the caller's role on the selected unit is inherited from an ancestor
- **THEN** the panel shows the role with an "inherited from <unit>" marker

#### Scenario: Grant from the panel
- **WHEN** an admin submits the grant form with a user id and role
- **THEN** the roster refreshes showing the new member, or the server's error (409 duplicate, 404 unknown user, 403 forbidden) is shown inline

### Requirement: Domain error semantics in UX copy
The UI SHALL map the API's domain conflicts to specific, actionable copy: last-owner violations ("transfer ownership first"), duplicate membership ("already a member"), concurrent reorganization ("the tree changed — refreshed, try again" with an automatic query refetch).

#### Scenario: Last-owner conflict
- **WHEN** the sole owner attempts to leave their organization from the UI
- **THEN** the UI explains ownership must be transferred first and points at the role-change control

### Requirement: Design-system conformance
All new screens SHALL be composed from `@workspace/ui` primitives and semantic tokens per DESIGN.md — no ad-hoc colors, spacing, or one-off components.

#### Scenario: Review gate
- **WHEN** the org-admin screens are reviewed against DESIGN.md's Do/Don't (§10)
- **THEN** no ad-hoc color or non-token styling is present
