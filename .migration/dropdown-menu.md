# dropdown-menu

2026-07-21 · golden pair via URL (base-nova) · Migrated to `@base-ui/react/menu`; Content is Portal>Positioner>Popup, `asChild` shims on Trigger + Item collapse the consumer sweep to zero component edits. A cross-cutting `data-[state=*]` styling-hook sweep is split into a follow-up commit (see below).

## Changed

- **`packages/ui/src/components/dropdown-menu.tsx`** — rewritten onto `@base-ui/react/menu`:
  - `DropdownMenuContent` → `Portal > Positioner > Popup`; `align`/`alignOffset`/`side`/`sideOffset` are Positioner props. `DropdownMenuSubContent` composes `DropdownMenuContent`.
  - Renames: `Label` → `GroupLabel`, `Sub` → `SubmenuRoot`, `SubTrigger` → `SubmenuTrigger`, `ItemIndicator` → `CheckboxItemIndicator`/`RadioItemIndicator`. `data-[state=open]`/`data-[disabled]`/`data-[inset]` → Base UI `data-open`/`data-popup-open`/`data-disabled`/`data-inset`.
  - `asChild`→`render` compat shim on **`DropdownMenuTrigger`** (used by all 7 consumers + stories) and **`DropdownMenuItem`** (used once, `app-sidebar-user` wrapping a `<Link>`).
  - Dropped undefined base-nova classes `cn-menu-target`/`cn-menu-translucent`; `IconPlaceholder` → lucide `CheckIcon`/`ChevronRightIcon`. Base UI anchor vars `--available-height`/`--transform-origin` replace the `--radix-*` ones.
  - **Deliberate deviation from base-nova:** dropped `w-(--anchor-width)` (kept `min-w-32`). base-nova constrains the menu to trigger width; several consumers open menus from full-width rows (e.g. the sidebar user row), where anchor-width would stretch the menu undesirably. Content-sized menus match the prior Radix behavior. Flagged for Leo.
  - RadioItem keeps its right-aligned CheckIcon indicator — this was our prior owner fork and base-nova now ships the same shape (no longer a divergence). `CheckboxItem` drops the unused `indeterminate` typing (no consumer used it; Base UI's `checked` is boolean).
  - Kept all component/prop JSDoc + typed interfaces. Leftover scan clean (`radix-ui\|@radix-ui\|IconPlaceholder\|cn-menu` → none).
- **`packages/ui/src/components/dropdown-menu.stories.tsx`** — docs URLs `radix`→`base`. Base UI's menu opens **asynchronously** (portal), so `screen.getByRole("menu")` immediately after a click → `await screen.findByRole("menu")` (10 sites). Three plays that click an item during the popup's brief enter/re-open animation (Submenu, Checkboxes, Radio Group) use a `userEvent.setup({ pointerEventsCheck: 0 })` instance — Base UI blocks pointer events on the popup mid-animation; a real user clicks after it settles. Stories pass **11/11**; consumer stories avatar + button-group pass 19/19.

Typecheck green: `@workspace/ui` and `web` both exit 0.

## Left alone

- **Consumer `data-[state=open]` styling hooks** (highlight a trigger/row while its menu is open) are **not** part of this commit — see the follow-up sweep below. They are visual-only, fail no test and no typecheck, so this commit is green in isolation.
- **Visual baselines** (`__screenshots__/dropdown-menu.stories.tsx.visual/*`) left as the stale radix-era "before"; base-nova restyle (ring, radius, spacing). Re-baseline is Leo's panel step.

## Behavior changes

- Menu opens asynchronously (portal) vs Radix's near-synchronous open — only observable in tests (handled above).
- **Menu is content-sized, not anchor-width** (deliberate deviation, above).
- `DropdownMenuLabel` maps to Base UI `GroupLabel`. `app-sidebar-user` uses it standalone (outside a `Group`); it renders fine as a styled label but its aria group-association is orphaned. Low impact; flagged.

## Follow-up sweep (separate commit) — REQUIRED to make the branch green

The branch has a **pre-existing red from the collapsible migration** (dede625f) that surfaced here: `sidebar.stories.tsx:892` asserts `data-state="open"` on a Collapsible trigger — Base UI uses `aria-expanded`/`data-panel-open`, not `data-state`. That commit's consumer sweep was incomplete (sidebar.stories / chat-sidebar weren't re-run), leaving stale `group-data-[state=open]/collapsible` hooks too.

A focused follow-up commit rewrites all Base-UI-incompatible `data-[state=*]` selectors + assertions to Base-UI-compatible attributes, covering **both** families' fallout:

- Trigger-highlight hooks (menu + submenu triggers): `data-[state=open]:` → `aria-expanded:` (native, family-agnostic; verified from rendered DOM: both Radix and Base UI triggers carry `aria-expanded`).
- Collapsible group hooks (`group-data-[state=open]/collapsible`): per-site — the Collapsible **root** carries `data-open` (`group-data-open`), the **trigger** carries `aria-expanded`/`data-panel-open` (`group-aria-expanded`).
- sidebar.stories `data-state="open"/"closed"` assertions → `aria-expanded` `"true"/"false"`.
- Files: `sidebar.tsx`, `sidebar.stories.tsx`, `collapsible.stories.tsx`, `app-sidebar-pinned.tsx`, `project-list-sidebar/index.tsx`, `chat-item.tsx`, `chat-sidebar/*`.

**Process note for Leo:** the collapsible migration shipped an incomplete consumer sweep (silent because those story/consumer files weren't re-run). Add "grep consumers for `data-[state=` styling hooks + stale `data-state` assertions" to the per-component sweep for the remaining wrappers (hover-card, marker, sidebar).

## Verify by hand

- Open each menu (icon triggers + wide-row triggers): menu is content-sized, keyboard nav + typeahead work, Escape/outside-click close and return focus.
- Submenus open on hover/click; checkbox/radio items toggle and the menu re-opens with state preserved.
- After the follow-up sweep: a trigger/row highlights while its menu (or collapsible) is open.
- **Visual: re-baseline the dropdown-menu stories in the visual-tests panel.**
