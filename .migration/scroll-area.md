# scroll-area

2026-07-21 · golden pair via CLI (base-nova stock) · migrated to Base UI; typecheck + 2 story tests green.

## Changed

- `scroll-area.tsx` — Radix → `@base-ui/react/scroll-area`. Part renames:
  `ScrollAreaScrollbar` → `Scrollbar`, `ScrollAreaThumb` → `Thumb` (Root,
  Viewport, Corner unchanged). Scrollbar sizing now uses the shadcn
  `data-horizontal:`/`data-vertical:` variants (was JS `orientation === …`
  conditionals) + `data-orientation` attr. Kept JSDoc; link → base.
- `scroll-area.stories.tsx` — docs anchors → base.

## Left alone

No app consumers (stories only).

## Behavior changes

None functional; Base UI ScrollArea adds `data-has-overflow-*` / scroll-fade
hooks we don't use here. Same visual scrollbar.

## Verify by hand

Vertical + horizontal scrollbars appear on overflow; thumb drags; content
scrolls.
