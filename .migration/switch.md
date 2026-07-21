# switch

2026-07-21 · golden pair via CLI (base-nova stock) · migrated to Base UI; typecheck (ui+web) + 9 story tests green.

## Changed

- `switch.tsx` — Radix → `@base-ui/react/switch` (`Root`/`Thumb`). Adopted nova
  styling: `data-[state=checked]:`→`data-checked:` (now-defined shadcn variant),
  larger hit area (`after:-inset-x-3 after:-inset-y-2`), `aria-invalid` rings,
  `data-disabled:` (was `disabled:`), precise sizes (h-[18.4px]/w-[32px]),
  dropped `shadow-xs`. Dropped our `SwitchProps` interface (not imported
  anywhere; checked/onCheckedChange docs come from Base UI's `Root.Props`). Kept
  component + size JSDoc. Docs link → base.
- `switch.stories.tsx` — docs anchors → base.

## Left alone

- `share-chat-dialog.tsx` `<Switch onCheckedChange={(next) => …}>` — unchanged;
  Base UI's `onCheckedChange` gains an ignorable 2nd `eventDetails` arg, so the
  1-arg callback is compatible.

## Behavior changes

- Root renders `<span>` + always-present hidden `<input>` (Radix rendered a
  `<button>`); no consumer-visible API change. Nova visuals (precise track/thumb
  sizes, bigger tap target).

## Verify by hand

Toggle on/off; keyboard (space) toggles; sm/default sizes; disabled + invalid
styling.
