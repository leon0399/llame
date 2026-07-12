# org-admin-ui

## Purpose

The web app's management surface for organizations, units, and members: the dedicated Administration area, real org-unit tree management, and spec-mandated domain-error UX. The members panel is temporarily withdrawn (an owner-accepted regression) — a sequenced fast-follow change re-homes it into the Administration area and re-adds its requirement.

## Requirements

### Requirement: Organizations overview

The web app SHALL provide instance administration in a **dedicated Administration area, separate from personal `/settings`**, reachable from a dedicated rail entry rendered as its own group at the **bottom of the primary rail, directly above the user-profile block** (per AppShell.dc.html — not among the main nav items, and with **no** user-menu entry; desktop-only, rendered disabled on mobile rather than hidden), with its own section nav (Organizations, plus visible "soon" placeholders for Users & accounts, Model providers, Connectors, Policies, and Audit log). Within it, the Organizations section SHALL render every org unit visible to the signed-in user as **navigable trees** — roots with nested children ordered by path — with visible connector guide lines, per-node expand/collapse, a node-type indicator (`organization`/`group`/`team`/`department`), an affordance to create a new root organization, and a collapse/expand-all control. With no visible orgs it SHALL show an empty state explaining what an organization is and offering creation.

#### Scenario: Admin area is distinct from personal settings

- **WHEN** a user opens Administration from the bottom-of-rail entry
- **THEN** they land in an area with its own section nav, and personal `/settings` no longer hosts an Organizations card

#### Scenario: Rail entry placement matches the shell design

- **WHEN** the primary rail renders on desktop
- **THEN** Administration appears as its own group directly above the user-profile block — not among the main nav items — and the user/profile menu contains no Administration entry

#### Scenario: Former settings route redirects

- **WHEN** a user navigates to the former `/settings/organizations` (including a deep link)
- **THEN** they are redirected to the corresponding Administration route

#### Scenario: Mobile renders a disabled entry

- **WHEN** a user on mobile views the primary sidebar
- **THEN** the Administration item is present but disabled (not hidden), consistent with the app's disabled-placeholder convention

#### Scenario: First-run empty state

- **WHEN** a user with no org memberships opens the Organizations section
- **THEN** an empty state with a "create organization" action is shown instead of a blank list

#### Scenario: Tree renders with real hierarchy affordances

- **WHEN** a unit has children
- **THEN** its row shows an expand/collapse control and connector lines to its children, and each node shows its type icon; collapsing hides the subtree

#### Scenario: Node surfaces membership at a glance

- **WHEN** the tree is displayed
- **THEN** each node shows its member count, and the caller's **direct** role on that unit (when any) is shown distinctly from a role inherited from an ancestor

#### Scenario: Selected-unit footer is visible from first paint

- **WHEN** the tree renders with at least one visible unit
- **THEN** a unit is selected (the first rendered row by default; clicking a row moves the selection) and a footer separated by a divider on a muted background shows the selected unit's breadcrumb path and the caller's effective role — marked direct or "inherited from" its source unit — alongside the disabled members-management placeholder (fast-follow)

### Requirement: Unit management actions

For each unit the UI SHALL offer create-child, rename, move (choose a new parent from units the user administers, or root), and delete — issuing the corresponding API calls and reflecting the server's answer. The UI SHALL NOT locally re-implement authorization: actions may be offered and the server's 403 handled honestly. In addition, the UI SHALL reflect two structural invariants **pre-emptively**, so users do not hit an avoidable server error, and destructive or ownership-affecting actions SHALL require an explicit confirmation naming the consequence.

#### Scenario: Delete on a non-leaf is explained, not attempted

- **WHEN** a user invokes delete on a unit that still has child units
- **THEN** the UI explains units are deleted leaf-first and directs them to move or delete the children first, without sending a delete request that would 4xx

#### Scenario: Move picker excludes illegal targets

- **WHEN** a user opens the move picker for a unit
- **THEN** the unit itself and all of its descendants are absent from the candidate parents, "make root" is offered, and candidates are presented with their hierarchy visible

#### Scenario: Delete requires confirmation naming the consequence

- **WHEN** a user confirms deletion of a leaf unit
- **THEN** a confirmation dialog names the unit and the memberships that will be removed before any request is sent

#### Scenario: Server denial surfaces honestly

- **WHEN** the API answers 403 to an attempted action
- **THEN** the UI explains the missing role (admin/owner on this unit or an ancestor) rather than failing silently or showing a generic error

### Requirement: Administration entry and create-root gating (instance-gating seam)

Access to the Administration area and its actions SHALL rely on server-side authorization as it exists today — every unit action is already RLS-enforced and returns 403 when unauthorized, and the area exposes no data beyond what those guards already permit. Creating a root organization is, by current policy design, available to every authenticated user (self-hosted bootstrap); the create-root affordance SHALL be structured so that, when an instance-level authorization signal exists (the `#158` admin-bootstrap / `root_org_creation` policy — **not yet built**), it gates the affordance without a client-side reimplementation of the rule. The UI SHALL NOT fabricate a client-only "instance admin" check that the server does not enforce.

#### Scenario: Gating binds when the signal lands

- **WHEN** the instance-level `root_org_creation` signal becomes available
- **THEN** the create-root affordance is gated by it (hidden or disabled for users without the right), sourced from the server, not client logic

#### Scenario: No fabricated client gate meanwhile

- **WHEN** the `#158` signal does not exist
- **THEN** the Administration area and create-root are reachable per today's server rules, and any server denial on other actions (e.g. child-create without admin) is surfaced honestly

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
