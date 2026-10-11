## MODIFIED Requirements

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
- **THEN** a unit is selected (the first rendered row by default; clicking a row moves the selection) and a footer separated by a divider on a muted background shows the selected unit's breadcrumb path and the caller's effective role — marked direct or "inherited from" its source unit — alongside a "Manage members" control that opens the members panel for the selected unit

## ADDED Requirements

### Requirement: Members panel opens from the selected-unit footer

The selected-unit footer's "Manage members" control SHALL open and close a members panel for the selected unit, rendered directly after the footer and titled with the unit's name; the control SHALL report whether the panel is expanded. Only an open panel SHALL request a roster, and every opening SHALL request it, even when a roster cached for that unit is still fresh. Moving the selection to another unit, or the unit leaving the tree, SHALL close the panel, and only the control SHALL reopen it.

#### Scenario: Manage members opens the panel for the selected unit

- **WHEN** a user activates "Manage members" on the selected-unit footer
- **THEN** a members panel titled with the selected unit's name appears directly after the footer, the control reports it expanded, and the roster of that unit, and no other, is requested

#### Scenario: Manage members closes the panel

- **WHEN** the panel is open and the user activates "Manage members" again
- **THEN** the panel closes, the control reports it collapsed, and focus stays on the control

#### Scenario: Reopening the same unit requests the roster again

- **WHEN** the user opens the panel, closes it, and reopens it on the same unit within the app's 60-second query freshness window
- **THEN** the second opening sends a second roster request for that unit

#### Scenario: Selecting units sends no membership request

- **WHEN** the panel is closed and the user moves the selection across several units
- **THEN** the footer follows the selection and no membership request is sent

#### Scenario: Selecting another unit closes the panel

- **WHEN** the panel is open, with a user id typed into its grant form, and the user selects a different unit
- **THEN** the panel closes without sending a request, and reopening it for the new unit shows an empty grant form

#### Scenario: Returning to the unit does not reopen the panel

- **WHEN** the panel was opened on one unit, the user selects another unit, and then selects the first unit again
- **THEN** the panel stays closed and no further roster request is sent until the user activates "Manage members"

#### Scenario: Keyboard order follows the footer

- **WHEN** the panel is open and the user tabs forward from "Manage members"
- **THEN** focus moves into the panel before any control that follows the Organizations card

### Requirement: Members panel roster

The panel SHALL list the membership rows the API returns for the unit itself, each with the member's user id and a role control, and SHALL mark the caller's own row "(you)". Other rows SHALL offer Revoke; the caller's own row SHALL offer Leave instead. A `service_account` row SHALL show its role without a settable control. Rows SHALL wait for the caller's identity as well as the roster. The panel SHALL show loading, empty, and failed-load states rather than a blank list.

#### Scenario: Roster lists the unit's direct members

- **WHEN** the panel opens on a unit with direct members
- **THEN** each member row shows the user id and current role, the caller's row reads "(you)" and offers Leave, and every other row offers Revoke

#### Scenario: Service account role is not settable

- **WHEN** the roster includes a `service_account` membership
- **THEN** its row shows "Service account" as a non-interactive role, with no picker to change it

#### Scenario: Empty roster is explained

- **WHEN** the API returns no membership rows for the unit
- **THEN** the panel says no members are visible there yet

#### Scenario: Failed roster load is explained

- **WHEN** the roster request or the signed-in identity request fails
- **THEN** the panel shows the classified error and a Retry control in place of the roster, and Retry repeats the failed request

#### Scenario: Roster waits for the caller's identity

- **WHEN** the roster arrives while the signed-in identity request is still pending
- **THEN** the panel shows its loading state with no row and no Revoke or Leave control until the identity answers, and then marks the caller's row "(you)" with Leave

### Requirement: Grant from the members panel

The panel SHALL grant a membership from a user id and a role chosen among every role except `service_account`, defaulting to `member`. Granting `owner` SHALL first ask for confirmation naming the grantee and that an owner can delete the unit. A successful grant SHALL clear the form and refresh the roster and the tree; a failed grant SHALL show the server's classified error next to the form.

#### Scenario: Grant from the panel

- **WHEN** an admin submits the grant form with a user id and role
- **THEN** the roster refreshes showing the new member and the unit's member count in the tree increases, or the server's error (409 duplicate, 404 unknown user, 403 forbidden) is shown inline

#### Scenario: Duplicate grant is explained

- **WHEN** the user grants a role to someone who already has a membership on the unit
- **THEN** the panel shows "Already a member." next to the form and the existing member's role is unchanged

#### Scenario: Granting ownership asks first

- **WHEN** the user submits the grant form with the `owner` role
- **THEN** a confirmation names the grantee and that ownership includes deleting the unit, and no request is sent until the user confirms

#### Scenario: Blank user id sends nothing

- **WHEN** the user id field is empty or whitespace
- **THEN** Grant is disabled and no request is sent

### Requirement: Role change and departures from the members panel

Picking a role other than `owner` SHALL change the member's role at once; picking `owner` SHALL first ask for confirmation. Revoke and Leave SHALL ask for confirmation naming the consequence. The roster SHALL show a role change or removal only after the API confirms it. A failed action SHALL show the classified error in its open confirmation, or in the member's row when it needed none. Every success SHALL refresh the tree and footer.

#### Scenario: Role change applies after the server confirms

- **WHEN** the user picks a non-owner role for a member and the API accepts it
- **THEN** the member's row shows the new role, and the role control stays disabled until the API answers

#### Scenario: Making an owner asks first

- **WHEN** the user picks `owner` for a member
- **THEN** a confirmation names the member and that ownership includes deleting the unit, and the role changes only after the user confirms and the API accepts it

#### Scenario: Revoke removes the member after confirmation

- **WHEN** the user confirms revoking another member and the API accepts it
- **THEN** the confirmation closes, the member's row disappears, the unit's member count in the tree decreases, and focus moves to the members panel

#### Scenario: Last owner cannot leave

- **WHEN** the sole owner of a root organization confirms Leave on their own row
- **THEN** the confirmation stays open with the last-owner explanation, which says to transfer ownership first through another member's role control, and the caller's row and role are unchanged

#### Scenario: Last owner cannot step down

- **WHEN** the sole owner of a root organization picks a non-owner role on their own row and the API answers 409
- **THEN** the caller's row shows the last-owner explanation and keeps the `owner` role

#### Scenario: Transfer ownership, then leave

- **WHEN** the sole owner of a root organization they created makes another member owner and then confirms Leave on their own row
- **THEN** both requests succeed, the caller's row disappears, the organization stays in the tree because its creator still sees it, the roster shows its empty state, and the footer shows no role for the caller

#### Scenario: Leaving a unit that disappears from view

- **WHEN** a caller who did not create a unit leaves it while holding no other membership on its path, so they can no longer see it
- **THEN** the unit leaves the tree, the panel closes, and focus moves to the newly selected row

#### Scenario: Leaving the last visible unit

- **WHEN** a caller who created no unit leaves the only unit they can see
- **THEN** the tree shows its empty state, the panel closes, and focus moves to the empty state's "Create organization" control

#### Scenario: Footer and tree follow a change to the caller's own role

- **WHEN** the caller changes their own role on the selected unit and the API accepts it
- **THEN** the footer's role text and the unit's direct-role badge show the new role without a reload

### Requirement: Membership denials name the required role

When the API answers 403 to a membership write, the panel SHALL explain the role the write needs. A write that grants or sets `owner`, or that changes or revokes a member the panel's roster shows as `owner`, SHALL be explained as needing `owner` on the unit or an ancestor; any other denied membership write SHALL be explained as needing `admin` or `owner` there. A denied write SHALL leave the roster as it was.

#### Scenario: Admin cannot grant ownership

- **WHEN** a caller whose best role on the path is `admin` confirms granting `owner` and the API answers 403
- **THEN** the panel explains that only an owner on this unit or an ancestor can grant ownership, and no member is added

#### Scenario: Admin cannot remove an owner

- **WHEN** a caller whose best role on the path is `admin` confirms revoking an `owner` and the API answers 403
- **THEN** the confirmation stays open explaining that only an owner can change or remove an owner, and the owner's row stays in the roster

#### Scenario: Admin cannot demote an owner

- **WHEN** a caller whose best role on the path is `admin` picks a non-owner role for an `owner` row and the API answers 403
- **THEN** the owner's row explains that only an owner can change or remove an owner, and keeps the `owner` role

#### Scenario: Member without admin rights is denied

- **WHEN** a caller with no admin-tier role on the path confirms revoking another member whose role is not `owner`, and the API answers 403
- **THEN** the confirmation explains that admin or owner access on this unit or an ancestor is needed, and the member's row stays in the roster

### Requirement: Members panel authority stays with the API

The panel SHALL NOT hide, disable, or pre-judge a membership action from the caller's displayed role, because that role is nearest-wins reporting while the datastore authorizes additively along the path. Every write SHALL act as the signed-in caller, whom the API derives from the session; requests SHALL carry no field naming the acting user. The panel SHALL show only rows the API returns.

#### Scenario: A deeper low role does not hide management

- **WHEN** a caller holds `admin` on a root and `viewer` directly on its child, and opens the panel on the child
- **THEN** the footer reports `viewer`, the panel still offers the grant form, role controls, and Revoke, and a grant of `member` succeeds

#### Scenario: Writes carry no acting identity

- **WHEN** the panel sends a grant, role change, revoke, or leave
- **THEN** the request names only the target unit, the target member, and the role, and the API resolves the acting user from the session

#### Scenario: A roster the API withholds stays empty

- **WHEN** a caller sees a unit only as its creator, holding no membership on its path, and opens its panel
- **THEN** the API returns no rows and the panel shows its empty state, exposing no member of that unit
