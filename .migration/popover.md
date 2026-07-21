# popover

2026-07-21 · golden pair via CLI (base-nova stock) · migrated to Base UI; typecheck (ui+web) + 14 story tests green.

## Changed

- `popover.tsx` — Radix → `@base-ui/react/popover`. PopoverContent → Portal >
  Positioner > Popup (positioning on Positioner); nova classes (rounded-lg,
  ring-1, gap layout, `data-open/closed`, inline-\* sides). Title/Description
  now use the Base UI `Title`/`Description` parts (were plain div/p).
  `PopoverTrigger` keeps `asChild` as a `render` shim (stories + model-selector
  unchanged). Kept JSDoc; link → base.
- **Dropped `PopoverAnchor`** — Base UI has no Anchor part and it was unused
  (verified no importers).
- `popover.stories.tsx` — docs → base.

## Left alone

No consumer edits (asChild shim). model-selector's `<PopoverTrigger asChild>`

- `<PopoverContent side align>` work unchanged (web typecheck green).

## Behavior changes

- Content is Portal/Positioner/Popup; `data-state` → `data-open`.
- `PopoverAnchor` removed (no Base UI equivalent).

## Verify by hand

Click opens/closes; outside-click + Escape dismiss; header/title/description;
button-group WithPopover; model-selector popover.
