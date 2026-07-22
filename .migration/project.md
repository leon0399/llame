# project — Radix → Base UI (base-nova) migration

Whole-project migration of `packages/ui` from Radix UI to Base UI, adopting the
`base-nova` component styling. Tokens stay ours (base-nova ships zero cssVars).

**Status (2026-07-22): COMPLETE.** 0 wrappers remain on Radix; the old shadcn
setup is dropped. Per-component detail is in the sibling `.migration/<component>.md`
files.

## Infrastructure prerequisites

### shadcn custom Tailwind variants + utilities (REQUIRED)

base-nova component classes use custom Tailwind variant **shorthands** that do
not exist in stock Tailwind v4 and are provided by the shadcn CLI's
`shadcn/tailwind.css` (a fresh base-nova setup imports it alongside
`tw-animate-css`):

- Variants: `data-open`, `data-closed`, `data-checked`, `data-unchecked`,
  `data-selected`, `data-disabled`, `data-active`, `data-horizontal`,
  `data-vertical`. Crucially, `data-horizontal:` maps to
  `[data-orientation="horizontal"]` — which is the attribute Base UI actually
  emits. Without the variant, `data-horizontal:h-px` compiles to the literal
  `[data-horizontal]` (never present), so the element gets **no size → 0×0**.
- Utilities: `no-scrollbar`, `scroll-fade*`, `shimmer*`.

**Fix:** vendored verbatim to `packages/ui/src/styles/shadcn.css` and imported
from `globals.css` (after `tw-animate-css`, before the typography plugin).
Prettier-ignored (upstream serialization). Refresh from
`https://unpkg.com/shadcn@latest/dist/tailwind.css` — do not hand-edit. (The
accordion keyframes carry a `--radix-accordion-content-height` fallback ahead of
Base UI's `--accordion-panel-height`; it's harmless — Base UI falls through — so
we keep it in sync with upstream rather than diverge.)

This was discovered when the migrated **Separator** rendered 0×0 (Base UI emits
`data-orientation`, not `data-horizontal`). It also silently affected
`button-group.tsx`'s inner divider, and would have hit every data-state
component (switch, tabs, accordion, select, dropdown). Verified fixed by
measuring the live Storybook: horizontal separator 320×0 → 320×1, vertical
0×0 → 1×20.

### @base-ui/react

`@base-ui/react@^1.6.0` in `packages/ui`. `radix-ui` removed after the last
wrapper (sidebar) migrated — see Finalization.

## App-code consumer sweep (RESOLVED — zero edits)

The feared 191 `asChild` sites across 37 files did **not** need rewriting to
Base UI's `render`. Each wrapper keeps `asChild` as a compatibility alias:
`const resolvedRender = asChild && isValidElement(children) ? children : render`,
passed to the Base UI primitive's `render`. Consumers are unchanged. The genuine
consumer fallout was elsewhere and handled by a compat sweep: menu-item
`onSelect`→`onClick`, `data-[state=open]` styling hooks → `aria-expanded`/
`data-open`, and `<Select items={…}>` label maps (see `.migration/dropdown-menu.md`).

## Finalization (2026-07-22)

- **Dependency:** removed `radix-ui` from `packages/ui/package.json`. Remaining
  `@radix-ui/*` in `pnpm-lock.yaml` are transitive deps of `cmdk` — not our
  direct deps (`pnpm why @radix-ui/react-dialog` → `cmdk`).
- **components.json:** `style: "new-york"` → `"base-nova"` in both `packages/ui`
  and `apps/web`. No separate `base` field — it's derived from the combined
  `style` enum. `shadcn info` now reports `base: base`, `style: base-nova`.
- **CSS:** `shadcn.css` is kept verbatim in sync with upstream base-nova
  `shadcn/tailwind.css` (the accordion `--radix-accordion-content-height`
  fallback is upstream's own and harmless — left untouched). `globals.css`
  unchanged. Only the header's refresh URL was corrected to `/dist/tailwind.css`.
- **Comments/docs:** docs URLs `components/radix/*` → `components/base/*`; stale
  jsdom test-mock comments Radix → Base UI; `stripRadixIds` → `stripGeneratedIds`.
  Behavior-delta comments (`unlike Radix…`) kept as accurate documentation.

## Baselines

All committed visual baselines were regenerated for the base-nova appearance
(nova styling + Base UI DOM). Animated stories (spinner, text-shimmer) and
never-open stories (hover-cards, overlay dismiss-tests) carry
`visualTests.disable`; their baselines were removed.

## N wrappers remain on Radix

**0** — `rg -l "from \"radix-ui\"|@radix-ui" packages/ui/src/components` → none.
