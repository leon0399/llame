# toggle-group

2026-07-21 · golden pair via CLI (base-nova stock) · migrated to Base UI; typecheck + story tests green.

## Changed

- `toggle-group.tsx` — Radix → `@base-ui/react/toggle-group`; items are now the
  base `@base-ui/react/toggle` primitive (base-nova reuses Toggle as the group
  item). Added `orientation` prop + context; nova classes (rounded-lg,
  `data-vertical:` layout, connected-segment `spacing=0` rules). Kept JSDoc.
- `toggle-group.stories.tsx` — **API migration** (Radix discriminant → Base UI):
  - `type="multiple"` → `multiple`; `type="single"` → omit (single is default).
  - `value`/`defaultValue` are now always arrays: `defaultValue="all"` →
    `defaultValue={["all"]}`, controlled `value={x}` → `value={[x]}`,
    `onValueChange={(v)=>…}` → `(v)=>… v[0]`.
  - play: `data-state="on|off"` → `data-pressed` presence.
  - argTypes `type` → `multiple`; dropped the discriminated-union Story-type
    workaround (Base UI props are no longer a union).

## Left alone

No app consumers.

## Behavior changes

- `type="single|multiple"` → `multiple` boolean (default single).
- value model is always an array, even in single mode (`[]` = nothing selected).
- `rovingFocus` dropped (always on); `loop`→`loopFocus`.
- Items emit `data-pressed` not `data-state`.

## Verify by hand

Single vs multiple selection; connected segment (spacing=0) vs separated;
vertical orientation; the controlled font-weight Custom picker.
