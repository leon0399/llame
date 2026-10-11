## Why

The admin org-unit tree gives every row `tabIndex={0}`
(`apps/web/app/(admin)/admin/organizations/components/org-tree-row.tsx`), so a
keyboard user tabs through every visible unit, then through each row's
chevron and four hover-revealed action buttons. Enter or Space selects a row,
and arrow keys do nothing. Issue #177 asks for the WAI-ARIA Authoring Practices
(APG) tree pattern instead: one roving tab stop, arrow-key navigation, focus
that follows the roving index, and a keyboard path to the row actions. PR #176
deferred it because making only the tab stop rove would leave every other row
unreachable.

The move dialog's parent picker (`MoveTargetList` in
`org-unit-dialog-parts.tsx`) is a hand-rolled `role="listbox"` of `<button
role="option">` rows. It has no arrow-key navigation and no filter, so every
candidate is a separate Tab stop. Issue #190 item 1 asks to adopt the
repository's `Command` (cmdk) list, as the model selector does.

## What Changes

- The tree becomes a single Tab stop: the selected row. Moving keyboard focus
  to a row selects it, so the selected-unit footer follows the keyboard.
- Up and Down move between visible rows. Right expands a collapsed parent, or
  moves to the first child of an expanded one. Left collapses an expanded
  parent, or moves to the parent row. Home and End go to the first and last
  visible rows. Arrow keys do not wrap. Type-ahead is deferred.
- Expand/collapse chevrons leave the Tab sequence; pointer users still click
  them. The selected row's add-child, rename, move, and delete actions stay
  reachable by Tab from that row, and other rows' actions leave the Tab
  sequence.
- When the selected row stops rendering (an ancestor collapses, or the unit is
  deleted or moved out of view), selection moves to its nearest rendered
  ancestor row, or to the first row. A moved unit's ancestors are those at its
  new position. If the vanished row held focus, focus follows.
- A unit dialog opened from a row action returns focus, when it closes, to the
  control that opened it. If that control is gone, focus goes to the selected
  row, and if no units remain, to the New organization button.
- The move picker becomes a `Command` list with a filter input focused on
  open. Up, Down, Home, and End move the highlighted candidate, and the
  highlighted candidate is the chosen new parent (selection follows focus).
  Filtering matches unit names, keeps hierarchy order, and shows each match's
  ancestor path. With no match, nothing is chosen and Move is disabled. The
  unit and its descendants still never appear.

## Assumptions (for confirmation on review)

- Selection follows focus in the tree. The footer is a read-only view, so
  selecting has no side effect and the APG allows selection to follow focus in
  a single-select tree. Enter and Space still select.
- The row actions are reached by Tab from the selected row, not through
  keyboard shortcuts (F2, Delete) or a context menu. Tab is discoverable and
  reuses the existing focus-within reveal; shortcuts would need new UI to
  advertise them.
- Type-ahead in the tree is deferred, not rejected. The APG recommends it for
  every tree, and only `*` is optional. It is still left out here because #177
  does not ask for it, and the move picker's filter already covers finding a
  unit by name. The spec does not forbid it, so a later change can add it
  without amending these requirements.
- In the move picker, Enter does not submit the move. Committing a structural
  change takes the Move button, so a keystroke in the filter cannot reparent a
  unit by accident.
- Typing in the picker's filter makes the first match the chosen parent, and
  clearing the filter makes the first option ("make root") the chosen parent.
  That is `Command`'s own behavior, and Move stays disabled whenever the
  choice equals the current parent.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `org-admin-ui`: the "Selected-unit footer is visible from first paint"
  scenario of "Organizations overview" adds keyboard focus as a way to move the
  selection. New requirements cover the single roving Tab stop, APG arrow
  navigation, selection continuity when the selected row stops rendering,
  focus return after unit dialogs, keyboard reach of row actions, and the
  move picker's filterable keyboard list.

## Impact

- `apps/web/app/(admin)/admin/organizations/components/`: `org-tree.tsx`
  (roving selection, focus handling, dialog focus targets), `org-tree-row.tsx`
  (tab indices, key handling, focus selects), a new keyboard-navigation module
  (`org-tree.tsx` is at 464 of the 500-line `max-lines` cap),
  `org-tree-utils.ts` and its unit tests, `org-unit-dialogs.tsx` (focus
  targets), and `org-unit-dialog-parts.tsx` (picker on `Command`).
- Stories: `org-tree.stories.tsx` and `org-unit-dialogs.stories.tsx`, which
  #1222 and #1230 of the #860 jsdom-to-story stack add. They are not on
  `master` yet (design D9).
- No API, data, or dependency change: `cmdk` 1.1.1 and `@base-ui/react` 1.6.0
  are already installed through `@workspace/ui`.
- The product E2E `e2e/web/org-units/org-units.spec.ts` clicks row actions and
  picks a move target by option name with an empty filter. Both keep working,
  and it runs as a regression check.
- `CHANGELOG.md`.

## Non-Goals

- #190 item 2, the dialogs' per-section vertical padding versus shadcn
  `DialogContent`'s uniform `p-6`/`gap-4`. It is a design-fidelity call.
- #190 item 3, a visible "Name" label in the rename dialog. It is a product
  call.
- Tree type-ahead (APG-recommended; deferred to a follow-up issue), `*`
  (expand all siblings), multi-select, and drag-and-drop.
- Moving focus to a newly created unit after create-child or create-root.
- Changing which units the picker offers or how the server authorizes a move.

## Acceptance

- Tab enters the tree once, on the selected row. Every row is reachable with
  arrow keys, Home, and End, and Right and Left expand, collapse, and move
  between parent and child as the APG specifies.
- From the selected row, Tab reaches its four actions, then leaves the tree.
  Keyboard delete on a non-leaf opens the leaf-first explainer without a
  request.
- Collapsing an ancestor of the selected row, Collapse all, deleting the
  selected unit, and moving it under a collapsed parent each leave a selected,
  focusable row. A dialog closing never drops focus to the document body.
- In the move dialog, the filter has focus on open. Arrow keys change the
  chosen parent, typing narrows the candidates without breaking hierarchy
  order, and a filter with no match disables Move.
- #177 closes when the implementation layer merges. #190 stays open for
  items 2 and 3.
