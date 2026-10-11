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
- **THEN** a unit is selected (the first rendered row by default; clicking a row or moving keyboard focus to it moves the selection) and a footer separated by a divider on a muted background shows the selected unit's breadcrumb path and the caller's effective role — marked direct or "inherited from" its source unit — alongside the disabled members-management placeholder (fast-follow)

## ADDED Requirements

### Requirement: The org tree is one roving Tab stop

The Organizations tree SHALL put exactly one row in the page's Tab sequence: the selected row. A row that itself receives focus, by keyboard, pointer, or focus restoration, SHALL become the selected row, and the selected-unit footer SHALL follow. Expand/collapse controls SHALL NOT be Tab stops and SHALL stay operable by pointer.

#### Scenario: Tab enters the tree on the selected row

- **WHEN** a keyboard user tabs from the toolbar into a tree whose selection is the default first row
- **THEN** focus lands on the first row, and one more Tab does not land on any other row or on an expand/collapse control

#### Scenario: Re-entering the tree returns to the selected row

- **WHEN** the user selects a row, tabs out of the tree, and tabs back in
- **THEN** focus lands on that same row

#### Scenario: A focused row becomes the selection

- **WHEN** a row receives focus by keyboard navigation, by a pointer click, or by focus being restored to it
- **THEN** it is the selected row, the footer shows its breadcrumb and effective role, and it is the only row in the Tab sequence

#### Scenario: Focus on a control inside a row does not select the row

- **WHEN** focus moves to an expand/collapse control or a row action of a row that is not selected
- **THEN** the selection does not change

#### Scenario: Chevrons remain pointer controls

- **WHEN** a pointer user clicks a row's expand/collapse control
- **THEN** the subtree expands or collapses as before, even though the control is not a Tab stop

### Requirement: Arrow keys navigate the org tree per the APG tree pattern

While a row itself has focus, the tree SHALL handle Up, Down, Right, Left, Home, and End per the WAI-ARIA APG tree pattern over the rendered rows, moving focus, and with it the selection, to the target row, and SHALL prevent page scrolling for a handled key. Navigation SHALL NOT wrap. A key pressed while focus is on a control inside a row SHALL keep that control's own behavior. The tree SHALL NOT provide type-ahead.

#### Scenario: Down and Up move between rendered rows

- **WHEN** the focused row is followed by a collapsed parent and then that parent's next sibling, and the user presses Down twice
- **THEN** focus moves to the collapsed parent and then to its next sibling, skipping the hidden subtree, and Up retraces the same rows

#### Scenario: Navigation stops at the ends

- **WHEN** the last rendered row has focus and the user presses Down, or the first rendered row has focus and the user presses Up
- **THEN** focus and selection stay where they are

#### Scenario: Right expands a collapsed parent without moving

- **WHEN** a collapsed row with children has focus and the user presses Right
- **THEN** the row expands, its children render, and focus stays on it

#### Scenario: Right on an expanded parent moves into its children

- **WHEN** an expanded row with children has focus and the user presses Right
- **THEN** focus moves to its first child row

#### Scenario: Right on a leaf does nothing

- **WHEN** a row without children has focus and the user presses Right
- **THEN** focus, selection, and expansion state do not change

#### Scenario: Left collapses an expanded parent without moving

- **WHEN** an expanded row with children has focus and the user presses Left
- **THEN** the row collapses, its subtree stops rendering, and focus stays on it

#### Scenario: Left on a child moves to its parent

- **WHEN** a leaf or collapsed child row has focus and the user presses Left
- **THEN** focus moves to the row it is nested under

#### Scenario: Left on a top-level row does nothing

- **WHEN** a collapsed or leaf row rendered at the top level has focus (a root organization, or a unit whose parent the caller cannot see) and the user presses Left
- **THEN** focus, selection, and expansion state do not change

#### Scenario: Home and End jump to the ends

- **WHEN** a row has focus and the user presses Home, then End
- **THEN** focus moves to the first rendered row, then to the last rendered row

#### Scenario: Enter and Space keep selecting

- **WHEN** a row has focus and the user presses Enter or Space
- **THEN** that row is the selected row, and the page does not scroll

#### Scenario: Keys on a row control keep their native behavior

- **WHEN** focus is on a row's action button or expand/collapse control and the user presses Enter or an arrow key
- **THEN** Enter activates that control without selecting the row, and the arrow key does not move tree focus

#### Scenario: Typing a character does not navigate

- **WHEN** a row has focus and the user types a letter
- **THEN** focus and selection do not change

### Requirement: The org tree keeps a rendered selection

When the selected row stops rendering, because an ancestor collapses (by its control, by Left, or by Collapse all), or because the unit is deleted, moved under a collapsed parent, or removed by a refresh, the selection and Tab stop SHALL move to its nearest still-rendered ancestor row, or to the first row when none renders. Re-expanding SHALL NOT move the selection back. If the vanished row held focus, focus SHALL move to the new selected row.

#### Scenario: Collapsing an ancestor selects the ancestor

- **WHEN** a nested row is selected and the user collapses one of its ancestors with that ancestor's expand/collapse control
- **THEN** the collapsed ancestor is the selected row and the Tab stop, and expanding it again leaves it selected

#### Scenario: Collapse all selects the top-level ancestor

- **WHEN** a nested row is selected and the user activates Collapse all
- **THEN** the selected row's top-level ancestor is selected and is the Tab stop, and focus stays on the toolbar control

#### Scenario: Expand all keeps the selection

- **WHEN** the user activates Expand all
- **THEN** the selected row does not change

#### Scenario: Deleting the selected unit selects its parent

- **WHEN** the selected leaf unit is deleted
- **THEN** its parent row is selected, or, when the deleted unit was top-level, the first rendered row is

#### Scenario: A removed focused row hands focus to the new selection

- **WHEN** the row holding focus stops rendering because the unit list changed underneath it
- **THEN** focus moves to the row that is now selected instead of falling to the document body

### Requirement: Unit dialogs return focus to the tree

When a rename, move, delete, delete-explainer, or create-child dialog closes, whether by success, Cancel, or Escape, focus SHALL return to the control that opened it if that control is still rendered, otherwise to the selected row, and otherwise, when no unit remains, to the New organization button. Focus SHALL NOT fall to the document body.

#### Scenario: Cancel returns focus to the opening action

- **WHEN** the user opens Rename from the selected row's action with the keyboard and cancels
- **THEN** focus is on that row's Rename action

#### Scenario: Deleting the selected unit returns focus to its parent

- **WHEN** the user deletes the selected leaf unit from its row action and the delete succeeds
- **THEN** focus is on its parent row, which is selected

#### Scenario: Moving a unit out of view returns focus to its new ancestor

- **WHEN** the user moves the selected unit under a collapsed parent
- **THEN** focus is on the nearest rendered ancestor of the unit's new position, which is selected

#### Scenario: Deleting the last unit returns focus to New organization

- **WHEN** the only remaining unit is deleted
- **THEN** focus is on the New organization button

### Requirement: Row actions are keyboard reachable

The selected row's add-child, rename, move, and delete actions SHALL be reachable by Tab from that row, in that order, before focus leaves the tree, and SHALL be visible while focused. Other rows' actions SHALL NOT be Tab stops. Each action SHALL behave as it does for a pointer user, including the leaf-first delete explainer.

#### Scenario: Tab walks the selected row's actions, then leaves

- **WHEN** the selected row has focus and the user presses Tab five times
- **THEN** focus visits Add child unit, Rename, Move, and Delete for that row, then leaves the tree, and Shift+Tab walks back to the row

#### Scenario: Other rows' actions are skipped

- **WHEN** the user tabs through the page
- **THEN** no action of a row other than the selected one receives focus

#### Scenario: Keyboard delete on a non-leaf explains instead of deleting

- **WHEN** the selected row has children and the user activates its Delete action with the keyboard
- **THEN** the leaf-first explainer opens and no delete request is sent

### Requirement: The move picker is a filterable keyboard list

The move dialog's parent picker SHALL focus a filter input on open and offer a list where Up, Down, Home, and End move the highlighted candidate. The highlighted candidate SHALL be the chosen new parent, exposed as the selected option; Move SHALL be enabled only when a choice differs from the current parent. Enter SHALL NOT submit the move. Hovering SHALL NOT change the choice; clicking SHALL.

#### Scenario: Picker opens on the current parent

- **WHEN** the user opens Move for a unit
- **THEN** the filter input has focus, the unit's current parent is the selected option ("make root" for a root organization, and no option when the caller cannot see the parent), and Move is disabled

#### Scenario: Arrow keys change the chosen parent

- **WHEN** the user presses Down in the open picker
- **THEN** the next candidate becomes the selected option and Move is enabled, and pressing Move sends that candidate as the new parent

#### Scenario: Enter does not submit

- **WHEN** the user presses Enter in the picker
- **THEN** no move request is sent and the dialog stays open

#### Scenario: Pointer hover does not change the choice

- **WHEN** a pointer moves over a candidate without clicking
- **THEN** the selected option does not change, and clicking that candidate makes it the selected option

### Requirement: Move picker filtering keeps the hierarchy legible

Typing in the move picker's filter SHALL narrow the candidates to units whose name matches, plus "make root" when its label matches, keeping hierarchy order, and SHALL make the first match the chosen parent. While a filter is active each match SHALL show its ancestor path. The unit and its descendants SHALL never appear. With no match the picker SHALL say so, and no candidate SHALL be chosen.

#### Scenario: Filter narrows in hierarchy order

- **WHEN** the user types part of a unit name that several candidates share
- **THEN** only matching candidates are listed, in the same relative order as the unfiltered list, each with its ancestor path, and the first is the selected option

#### Scenario: Filter never reveals excluded units

- **WHEN** the user types the name of the unit being moved or of one of its descendants
- **THEN** neither appears among the candidates

#### Scenario: No match disables Move

- **WHEN** the filter matches no candidate
- **THEN** the picker shows a no-matching-units message, no option is selected, and Move is disabled

#### Scenario: Clearing the filter restores the full list

- **WHEN** the user clears the filter
- **THEN** every candidate is listed with its depth indentation and without ancestor paths, and "make root", the first option, is the selected option
