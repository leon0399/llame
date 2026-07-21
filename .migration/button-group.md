# button-group

2026-07-21 · golden pair via CLI (base-nova stock) · migrated to Base UI; typecheck + 9 story tests green.

## Changed

- `button-group.tsx` — `ButtonGroupText` now uses Base UI `useRender` +
  `mergeProps` (Radix Slot → `render`; no consumer used `asChild`). `ButtonGroup`
  stays a plain `role="group"` div with nova cva (rounded-lg segment rules,
  select-trigger handling). `ButtonGroupSeparator` uses the migrated Separator
  (its `data-horizontal/vertical` classes now resolve via shadcn.css). Kept
  JSDoc; link → base.
- `button-group.stories.tsx` — docs → base. No `ButtonGroupText asChild` usage
  to convert (the story's other `asChild` are Dropdown/Popover/Select triggers
  wrapping Buttons, which compose fine via the Button shim).

## Left alone

No app consumers (only stories).

## Behavior changes

`ButtonGroupText` `asChild` → `render`. Visual: nova rounded-lg segments.
Separator divider now renders (was 0-size pre-shadcn.css).

## Verify by hand

Attached horizontal/vertical groups; text segment; separator; split button;
input-in-group; nested dropdown/popover/select triggers.
