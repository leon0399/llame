# label

2026-07-21 · golden pair via CLI (base-nova stock) · Radix → native `<label>`; typecheck + story test green.

## Changed

- `label.tsx` — Base UI has no Label primitive, so base-nova ships a native
  `<label>`. Swapped `radix-ui` `Label.Root` → `<label>`, prop type
  `React.ComponentProps<typeof LabelPrimitive.Root>` → `React.ComponentProps<"label">`.
  Classes identical. Radix's only behavioral extra (no text-selection on
  double-click) is covered by the existing `select-none`. Docs link → base.
- `label.stories.tsx` — docs anchor → base.

## Left alone

7 `<Label>` call-sites use `htmlFor`/`id` only (drop-in on native label). The
`asChild` hits in the grep are `SidebarGroupLabel` (part of sidebar), not Label.

## Behavior changes

None — native `<label>` with the same classes and association behavior.

## Verify by hand

Clicking the label focuses/toggles its `htmlFor` control; disabled styling via
`peer-disabled` / `group-data-[disabled]` still applies.
