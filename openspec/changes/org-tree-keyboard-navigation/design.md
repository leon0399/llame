## Context

See proposal.md for motivation. Current state, from `master` at `9a958cee`:

- `useOrgTreeNavigation` (`org-tree.tsx`) owns `selectedId` and the
  `collapsed` map and derives `rows = buildRows(units, collapsed)`, a flat,
  path-ordered list of rendered rows with `depth`, `hasChildren`, and `open`.
  `selected` falls back to `rows[0]` when `selectedId` is null or names a unit
  that no longer exists, but not when the unit exists and a collapse hides
  it. In that case the footer keeps naming a hidden unit.
- `TreeRowView` (`org-tree-row.tsx`) renders `role="treeitem"` with
  `tabIndex={0}`, `aria-level`, `aria-expanded`, and `aria-selected`. Enter or
  Space selects, guarded by `e.target === e.currentTarget` so that key
  handling never hijacks the chevron or action buttons inside the row. Those
  buttons are ordinary Tab stops; the actions appear on
  `group-hover/row` and `group-focus-within/row`. `RowActionButton` stops
  click propagation so that an action does not select its row.
- Nesting follows `effectiveParentId`: a unit whose parent the caller cannot
  see renders at depth 0. A row's tree parent is therefore the nearest
  preceding row at `depth - 1`, not necessarily `unit.parentId`.
- Dialogs are controlled (`open` state in `useOrgUnitDialogs`) and have no
  Base UI trigger. `DialogContent` and `AlertDialogContent` spread their props
  onto Base UI 1.6.0 `Popup`. Its `finalFocus` accepts a function, called on
  close, that returns the element to focus; the default is the element that
  had focus before opening.
- The org-unit mutations are optimistic. `useDeleteOrgUnit` removes the row
  in `onMutate`, and `useUpdateOrgUnit` re-parents it in `onMutate`, both while
  the dialog is still open. The dialog closes in the mutation's `onSuccess`.
  By the time it closes, the tree has already re-rendered without the row (or
  with the row under its new parent).
- `MoveTargetList` (`org-unit-dialog-parts.tsx`) renders `role="listbox"`
  with `<button role="option" aria-selected>` children: "make root" first,
  then `candidates` in path order, indented by `visibleAncestorChain` depth.
  The model selector and the command palette use `Command`
  (`packages/ui/src/components/command.tsx`, cmdk 1.1.1). The palette composes
  a custom `filter` over the re-exported `defaultFilter`.
- `org-tree.tsx` is 464 lines against the 500-line `max-lines` rule in
  `.oxlintrc.json`.

## Goals / Non-Goals

**Goals:** the requirements in `specs/org-admin-ui/spec.md`. They are
behavior-only and keep the existing tree markup (`role="tree"` over a flat
list of `treeitem`s carrying `aria-level`) and the existing visuals.

**Non-Goals:** those listed in proposal.md. Design-level exclusions:
`aria-activedescendant` focus management (the tree uses a roving
`tabIndex`), nesting `role="group"` containers, and a generic tree hook in
`@workspace/ui`. This is the repository's only tree; extracting a shared
primitive waits for a second consumer.

## Decisions

### D1. The selection is the roving index

The selected row is the tree's single Tab stop. It is the only row with
`tabIndex={0}`, and every other row has `-1`. A row's `onFocus`, guarded by
`e.target === e.currentTarget`, selects that row. That makes every way a row
gains focus (arrow key, click, `finalFocus`, focus rescue) select through one
path, and lets keyboard handlers move focus instead of setting state.

Alternative: a separate `activeId` for focus and `selectedId` for the footer,
where Enter commits the selection. Rejected: it doubles the state and creates
a footer that disagrees with focus, and the APG permits selection to follow
focus in a single-select tree when selecting has no side effect. Here the
footer is read-only.

### D2. Key handling is a pure function over `rows`

A new module `org-tree-keyboard.ts` (beside `org-tree-utils.ts`; it keeps
`org-tree.tsx` under the line cap) exports a pure resolver from
`(rows, focusedId, key)` to an intent: focus a row id, expand an id, collapse
an id, or nothing. Parent lookup is the nearest preceding row at
`depth - 1`. A top-level row has no parent. Children are rendered only when
the row is `open`, so the first child is the next row. The row's `onKeyDown`
applies the intent only when `e.target === e.currentTarget`. It calls
`preventDefault()` for every handled key, focuses the target row element
through a `Map<string, HTMLDivElement>` ref registry, or calls the existing
`openRow`/`toggleRow`. Every focus target is already rendered: Right moves to a
child only when the parent is open, and Left goes to a rendered parent. So
focus moves synchronously, with no effect or retry.

Alternative: put the logic inline in the row's key handler. Rejected: it can
only be tested through a browser, and the key-by-row-shape matrix (12
scenarios) is cheaper and more exhaustive as unit tests.

### D3. The selection adjusts during render when its row is not rendered

`useOrgTreeNavigation` stores the selection as `{ id, path }`. It records the
unit's id-path (`OrgUnitResponse.path`, ancestor ids `root/…/self` per
`org-units`) at selection time and refreshes it from `unitsById` while the
unit exists. During render, when `id` has no row in `rows`, it walks `path`
from the deepest ancestor upward to the first id that has a row, falling back
to `rows[0]`, and commits that as the new selection with React's adjust state
during render pattern. Guarded by "differs from the current id", it settles in
one extra render. Because the adjusted id is stored, expanding the ancestor
again does not move the selection back. One rule covers chevron collapse,
Left, Collapse all, delete, a move under a collapsed parent, and a refresh,
so the collapse handlers need no special cases.

Alternatives: compute the fallback at render without storing it, which
re-selects the hidden unit when it reappears and contradicts the spec; or
patch the selection inside every collapse and mutation handler, which misses
refresh-driven removals.

### D4. Focus rescue when the focused row unmounts

The tree keeps a `focusedRowId` ref. Row `onFocus` sets it, and `onBlur`
clears it unless the row element has already left the document. Browsers
differ on whether removing a focused element fires `blur`, so the design does
not depend on it. A layout effect keyed on `rows` focuses the selected row's
element when `focusedRowId` has no row and `document.activeElement` is
`document.body` (or null). While a dialog is open, focus is inside the dialog,
so the rescue stays idle and D5 applies instead.

### D5. Dialog focus return through `finalFocus`

When the tree opens a row-action dialog, it records the invoker
(`document.activeElement` if it is inside the tree, else null) with the dialog
state. Every row-action dialog component gains a `finalFocus` prop, passed to
its `DialogContent` or `AlertDialogContent`, which the tree supplies as
`() => invoker?.isConnected ? invoker : selectedRowElement() ??
newOrganizationButton`. The function runs at close. The optimistic
`onMutate` re-render has already happened by then, so D3 has already moved the
selection off a deleted or re-parented unit. Create-root keeps Base UI's
default, which returns focus to the New organization or Create organization
button that opened it.

Alternative: always focus the selected row. Rejected: Cancel would not return
to the invoking action, against the APG dialog guidance to return focus to the
invoker when it still exists.

### D6. Row actions stay in the Tab sequence only for the selected row

`RowActionButton` gets `tabIndex={selected ? 0 : -1}`, and `TreeRowExpander`
gets `tabIndex={-1}`. In DOM order, Tab from the selected row reaches its four
actions (Add child unit, Rename, Move, Delete) and then leaves the tree. The
existing `group-focus-within/row` reveal shows the actions. Click handling and
`stopPropagation` do not change. Buttons inside a `treeitem` are already
present today: ARIA 1.2 does not make `treeitem` children presentational,
and #1222's stories run the a11y addon over this markup.

Alternatives: keyboard shortcuts (F2 rename, Delete) or a context menu
(Shift+F10). Rejected: they need new UI to be discoverable and add a second
activation path for each action. The APG `treegrid` pattern was also
rejected: it gives Left and Right to cell movement, and it would restructure
the markup and the e2e queries.

### D7. Move picker on `Command`, with selection following the highlight

`MoveTargetList` becomes `Command` (`label="New parent"`, which keeps the
listbox's accessible name), `CommandInput`, `CommandList`, `CommandEmpty`
("No matching units"), and one `CommandItem` per option. Each item has
`value` set to the unit id, or a fixed sentinel for "make root" (ids are
UUIDs), and `keywords` set to `[name]`.

- **Selection.** Controlled `value`/`onValueChange` maps the highlight onto
  `parentId`, so cmdk's `aria-selected` (which marks the highlighted item)
  means the chosen parent, as the existing `Move` story asserts. An empty
  value means nothing is chosen, and Move is disabled.
- **Pointer.** `disablePointerSelection` stops hover from changing the
  choice; a click still selects.
- **Filtering.** The `filter` callback scores
  `defaultFilter(keywords.join(" "), search) > 0 ? 1 : 0`. It matches names
  rather than ids, and the binary score keeps path order under cmdk's stable
  sort.
- **Ancestor path.** A controlled `CommandInput` value tells the item renderer
  when a filter is active, so it can show the `visibleAncestorChain`
  breadcrumb.
- **Initial focus.** The move dialog passes `initialFocus` (a ref to the
  filter input) to `DialogContent`. The input already comes first in DOM
  order, ahead of the close button, but the ref makes the spec's "filter has
  focus on open" independent of that order.

Spike, from reading the cmdk 1.1.1 `dist/index.mjs`:

- A controlled `value` is respected on mount, because the first-item
  auto-select runs only when the value is empty.
- A search change selects the first matching item, or emits `""` when nothing
  matches.
- Sorting calls `Array.prototype.sort` on DOM order with a score comparator,
  so equal scores keep their order.
- An item click calls `setState("value")` and then `onSelect`, while pointer
  move is skipped under `disablePointerSelection`.
- Enter on the root `preventDefault()`s and dispatches the item select, so it
  cannot submit a surrounding form.
- cmdk also takes Home and End in the input. The model selector accepts the
  same behavior.

Alternative: keep cmdk's native model, where the highlight is separate from a
committed choice marked with a check, as in the model selector. Rejected: the
committed choice would carry no selected state for screen readers, and the
dialog already has an explicit commit (Move).

### D8. Testing

- **Unit tests** (`org-tree-keyboard.test.ts`, the same project as
  `org-tree-utils.test.ts`) cover the D2 resolver for every key and row shape
  in the spec, including a top-level row whose parent the caller cannot see,
  and the D3 ancestor walk: a deleted unit, a moved unit, and no rendered
  ancestor.
- **`org-tree.stories.tsx`** gets real keyboard stories using `userEvent.tab`
  and `userEvent.keyboard` against the real component and fetch stub: roving
  Tab stop, Up/Down/Home/End, Right/Left, row-action Tab walk and keyboard
  delete explainer, selection after chevron collapse and Collapse all, dialog
  focus return (Cancel, delete of the selected leaf with exact
  `sentRoutes()`, move under a collapsed parent, last-unit delete), and the
  focus rescue. The rescue story uses a render wrapper that drops a unit on a
  `window` event dispatched from `play`, because dispatching an event does not
  move focus.
- **`org-unit-dialogs.stories.tsx`** gets `MoveKeyboard`, `MoveFilter`,
  `MoveNoMatch`, and `MoveEnterDoesNotSubmit`. `Move` and `MoveCancel` keep
  their assertions.
- **Mutation evidence:** at least two temporary component mutations, each
  failing a named story.
- `e2e/web/org-units/org-units.spec.ts` runs unchanged as a regression check.
  Its `getByRole("option", { name, exact: true })` still matches, because
  ancestor paths render only while a filter is active.

### D9. Delivery base

The stories this plan extends exist only on #1222 (`test/org-tree-story`,
base `master`) and #1230 (`test/org-unit-dialogs-story`), layers of the #860
jsdom-to-story stack. The `keyboard` layer is created only after both have
merged to `master` and the proposal branch is rebased onto that `master` with
`$gh-stack`. It does not stack on the #860 stack: #1230 sits on several
unrelated layers, and stacking would tie this change's review and merge to
them. Until then, `master` still carries `org-tree.test.tsx` and
`org-unit-dialogs.test.tsx` in jsdom, so new render tests there would be
moved again. The proposal layer itself touches no file in those PRs.

## Risks / Trade-offs

- [Selection following focus updates the footer on every arrow press] →
  The footer is a pure render from loaded data, with no request.
- [The Tab sequence has five tree stops (row and four actions), not one] →
  It is bounded, against one Tab stop per visible row plus a chevron and four
  actions each today, and it keeps the actions discoverable.
- [cmdk owns Home and End inside the filter input, so the text caret cannot
  jump] → The model selector already makes this trade-off, and the filter is a
  short name fragment.
- [Typing in the filter changes the chosen parent] → The choice is always
  the visible selected option, and Move stays disabled when it equals the
  current parent. Nothing is sent before Move.
- [Render-phase state adjustment could loop] → It is guarded by "the
  computed id differs from the stored one", and the walk is a pure function
  tested in unit tests.
- [Story tests and the Vitest pointer resting at (0,0) over hover-revealed
  actions] → Assert focus-revealed visibility, not hover, and keep the tree
  away from the origin where hover would matter.
- [Merged statement coverage dips on story-only paths (the #860 V8→istanbul
  duplicate statements)] → Report statements, lines, branches, and functions
  together, with mutation evidence.

## Migration Plan

Client-only, with no data, API, or configuration change. Rollback is a revert
of the `keyboard` layer.
