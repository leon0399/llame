# project — Radix → Base UI (base-nova) migration

Whole-project migration of `packages/ui` from Radix UI to Base UI, adopting the
`base-nova` component styling. Tokens stay ours (base-nova ships zero cssVars).

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
`https://unpkg.com/shadcn@latest/tailwind.css`.

This was discovered when the migrated **Separator** rendered 0×0 (Base UI emits
`data-orientation`, not `data-horizontal`). It also silently affected
`button-group.tsx`'s inner divider, and would have hit every data-state
component (switch, tabs, accordion, select, dropdown). Verified fixed by
measuring the live Storybook: horizontal separator 320×0 → 320×1, vertical
0×0 → 1×20.

### @base-ui/react

Installed `@base-ui/react@^1.6.0` in `packages/ui` (coexists with `radix-ui`;
radix removed after the last wrapper migrates).

## App-code consumer sweep (pending)

191 `asChild` sites across 37 files become Base UI's `render` prop. Wrappers
that expose `asChild` (button, badge, menus) cannot commit without migrating
their consumers in the same commit.

## Baselines

All 226 committed visual baselines will shift (nova styling + Base UI DOM) and
are regenerated in one pass at the end of the migration.
