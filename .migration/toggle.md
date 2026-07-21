# toggle

2026-07-21 · golden pair via CLI (base-nova stock) · migrated to Base UI; typecheck + story tests green.

## Changed

- `toggle.tsx` — Radix → `@base-ui/react/toggle` (callable primitive). Nova cva:
  `rounded-lg`, `aria-pressed:bg-muted` + `hover:text-foreground`, `has-data-[icon=*]`
  spacing, sizes h-8/h-7/h-9. Dropped unused `ToggleProps` interface (base-ui
  `Toggle.Props` carries the docs). Kept `toggleVariants` export + JSDoc; link → base.
- `toggle.stories.tsx` — docs → base; play assertions `data-state="on|off"` →
  `data-pressed` presence (Base UI toggles emit `data-pressed`, not
  `data-state`); `onPressedChange` now called with `(pressed, eventDetails)`.

## Left alone

No app consumers (used only in stories + toggle-group).

## Behavior changes

- `data-state="on|off"` → `data-pressed` (presence). `aria-pressed` unchanged.
- `onPressedChange(pressed)` gains an `eventDetails` 2nd arg.

## Verify by hand

Toggle on/off; keyboard; pressed styling via aria-pressed/data-pressed.
