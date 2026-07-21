# separator

2026-07-21 · golden pair via CLI (base-nova stock, forks replayed by hand) · migrated to Base UI, typecheck green.

## Changed

- `packages/ui/src/components/separator.tsx` — rewired from Radix to Base UI.
  - Import `Separator as SeparatorPrimitive` from `@base-ui/react/separator`
    (was `radix-ui`); the primitive is a single callable part (`Separator`,
    no `.Root`).
  - Props type is now `SeparatorPrimitive.Props`; dropped the local
    `SeparatorProps` interface and its `export type` (no consumer imported it —
    verified `rg 'SeparatorProps'`).
  - **`decorative` prop removed** — Base UI's separator is always semantic
    (`role="separator"`). No consumer passed `decorative` (verified).
  - Class data-attrs renamed to Base UI's shorthand:
    `data-[orientation=horizontal]:*` → `data-horizontal:*`,
    `data-[orientation=vertical]:h-full` → `data-vertical:self-stretch`,
    `data-[orientation=vertical]:w-px` → `data-vertical:w-px`.
  - Re-applied our component JSDoc fork (Autodocs header + AI manifest) and
    updated the vendored-from link to the Base docs path
    (`/docs/components/base/separator`).
  - Leftover scan clean: `grep -n "radix-ui\|@radix-ui"` → none.
- `packages/ui/package.json` — added `@base-ui/react@^1.6.0` (coexists with
  `radix-ui`; radix removed only after the last component migrates).

Consumers unchanged — all call-sites use `<Separator />`,
`orientation="vertical"`, or `className` only (button-group, field, sidebar,
scroll-area story, model-preview-card, compaction-boundary, separator story).
No `asChild` on any Separator.

## Left alone

- `separator.stories.tsx` — still valid (uses only `orientation`/`className`).
  Its visual baseline will change (see below) and is regenerated in the
  end-of-migration baseline pass, not here.

## Behavior changes

- **Vertical separator sizing.** Base UI stock uses `data-vertical:self-stretch`
  (was Radix `h-full`). `self-stretch` only gives height inside a **flex**
  parent. Vertical separators in non-flex contexts (button-group inner rule,
  sidebar rail, the story's inline `orientation="vertical"` rows) may collapse
  to zero height. Flagged, not patched — verify visually and add an explicit
  height at the call-site if a context isn't flex.
- **`decorative={false}` is unavailable.** Anything that wanted a semantic
  thematic break already gets `role="separator"` by default; anything that
  wanted a purely visual rule (there were none) must switch to a plain
  `<div aria-hidden>`.

## Verify by hand

- Render Storybook separator stories: horizontal rules span full width; the
  vertical dividers between inline items show full height (they sit in flex
  rows in the story — confirm they don't collapse).
- Check the three in-app vertical/inline separators once their parent
  components are migrated: button-group divider, sidebar rail, compaction
  boundary horizontal rules (`flex-1`).
