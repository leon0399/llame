# kbd

2026-07-21 · golden pair via CLI (base-nova stock) · pure-class (`<kbd>`), no primitive; typecheck + story tests green.

## Changed

- `kbd.tsx` — adopted base-nova's `in-data-[slot=tooltip-content]:*` variant
  form (was our `[[data-slot=tooltip-content]_&]:*` descendant selector; same
  effect via the shadcn `in-*` variant). Re-applied JSDoc; `@see` link → base.
- `kbd.stories.tsx` — docs anchors → base.

## Left alone

No consumers use `asChild`; nothing else touched.

## Behavior changes

None — equivalent styling, restated with the shadcn variant.

## Verify by hand

Key token renders at h-5; inside a tooltip it inverts to the tooltip surface.
