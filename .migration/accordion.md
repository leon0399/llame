# accordion

2026-07-21 · golden pair via CLI (base-nova stock) · migrated to Base UI; typecheck + 5 story tests green.

## Changed

- `accordion.tsx` — Radix → `@base-ui/react/accordion`. Content → `Panel`
  (Header/Trigger/Item/Root unchanged names). Two-chevron trigger (down when
  collapsed, up when expanded via `group-aria-expanded`) using lucide icons
  (dropped `IconPlaceholder`). Panel animates on `data-open/closed` with
  `--accordion-panel-height` (was `--radix-accordion-content-height`). Nova
  classes (rounded-lg, not-last:border-b, link styles). Kept JSDoc; link → base.
- `accordion.stories.tsx` — **API migration:** Radix `type="single"|"multiple"`
  - `collapsible` → Base UI `multiple` boolean (default single, always
    collapsible); `defaultValue="x"` → `defaultValue={["x"]}` (array model);
    play `data-state="open|closed"` → `aria-expanded`; disabled item via
    `aria-disabled`; argTypes `type` → `multiple`; docs → base.

## Left alone

No app consumers.

## Behavior changes

- `type`/`collapsible` → `multiple` boolean; value model is always an array.
- Two-icon chevron toggle (was a single rotating chevron).
- `data-state` → `data-open/closed` (Panel) / `aria-expanded` (Trigger);
  disabled via `aria-disabled`.

## Verify by hand

Single-open exclusivity; multiple mode; open/close animation; disabled item;
bordered/card variants.
