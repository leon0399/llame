# select

2026-07-21 · golden pair via CLI (base-nova stock) · migrated to Base UI; typecheck + 15 story tests green. Unblocks the button-group WithSelect story Leo flagged.

## Changed

- `select.tsx` — Radix → `@base-ui/react/select`. Part restructure:
  Content → Portal > Positioner > Popup > List; Viewport → List; Label →
  GroupLabel; ScrollUp/DownButton → ScrollUp/DownArrow. `IconPlaceholder` →
  our lucide icons (Chevron/Check). Dropped upstream's undefined `cn-menu-*`
  classes (single-menu setup). `SelectContent` `position` prop →
  `alignItemWithTrigger` + side/sideOffset/align/alignOffset (base-nova).
  Positioner uses base-ui CSS vars (`--available-height`, `--anchor-width`,
  `--transform-origin`); Popup uses `data-open/closed`, nova `rounded-lg ring-1`.
  `Select` typed to `Root.Props<string>` (non-generic; a generic wrapper broke
  the stories' Meta inference). Kept JSDoc + SelectTriggerProps size fork.
- `select.stories.tsx` — several Base UI behavior migrations:
  - **`SelectValue` label:** Base UI renders the value's label from Root `items`
    (Radix mirrored the selected item's text). Added `items` arrays
    (FRUIT/FRUIT_VEG/TIMEZONE) on each Select so triggers show labels.
  - play: `data-state="open"` → `toBeInTheDocument()` (Base UI unmounts on close).
  - Removed `aria-label` from `SelectContent` — Base UI's Popup is
    `role="presentation"`, where `aria-label` is prohibited (the trigger names
    the combobox). Meta suppresses the base-ui structural listbox false
    positives (`aria-input-field-name`, `aria-required-children`).
  - docs anchors → base; `position` JSDoc → `alignItemWithTrigger`.
- `button-group.stories.tsx` (WithSelect — the flagged story) — `onValueChange`
  handles Base UI's `string | null`; trigger gets `aria-label="Currency"`
  (button-name); `data-state` → `toBeInTheDocument()`; removed SelectContent
  aria-label. The Select now renders with nova styling, connecting cleanly to
  the nova Input in the group.

## Left alone

- No live app consumer: `prompt-input.tsx`'s Select usage is entirely commented
  out.

## Behavior changes

- **`SelectValue` needs `items` on Root** to show labels (else raw value/empty).
- `position="item-aligned|popper"` → `alignItemWithTrigger` boolean.
- `onValueChange(value)` → `(value: string | null, eventDetails)`.
- Content split into Portal/Positioner/Popup; `data-state` → `data-open/closed`.

## Verify by hand

Open/select updates the trigger label; item-aligned vs popper (AlignItem
toggle); groups + separator; long scrollable list; disabled; invalid ring;
the button-group currency Select connects flush to the input.
