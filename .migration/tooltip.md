# tooltip

2026-07-21 · golden pair via CLI (base-nova stock) · migrated to Base UI; typecheck (ui+web) + 8 story tests green. Zero consumer sweep via shims.

## Changed

- `tooltip.tsx` — Radix → `@base-ui/react/tooltip`. TooltipContent → Portal >
  Positioner > Popup > Arrow (positioning props on Positioner). Popup uses
  base-ui CSS vars (`--transform-origin`), `data-open/closed` +
  `data-[state=delayed-open]`, `data-[side=inline-*]` logical sides.
- **Compat shims (zero consumer churn):**
  - `TooltipTrigger` keeps `asChild` → mapped to Base UI `render` (8 files use
    `<TooltipTrigger asChild>`, incl. the nested Tooltip>Collapsible>Button
    chain in model-switch-boundary — all unchanged).
  - `TooltipProvider` keeps `delayDuration` (Radix's name) as an alias for Base
    UI's `delay` (used by sidebar.tsx).
    Kept JSDoc; link → base.
- `tooltip.stories.tsx` — docs → base; `const meta` annotated (not `satisfies`)
  to dodge tsgo TS2883 (Base UI props reference non-exported internal types).

## Left alone

No consumer edits (shims). web typecheck green with all 10+ tooltip consumers.

## Behavior changes

- Content is Portal/Positioner/Popup; `data-state` → `data-open` (+ delayed-open).
- `asChild`/`delayDuration` are now aliases for `render`/`delay`.

## Verify by hand

Hover/focus opens tooltip; arrow points; all sides; nested trigger chains
(model-switch-boundary) still open; sidebar icon tooltips.
