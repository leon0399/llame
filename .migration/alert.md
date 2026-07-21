# alert

2026-07-21 · golden pair via CLI (base-nova stock) · pure-class (styled `<div>`s), no primitive; typecheck + story tests green.

## Changed

- `alert.tsx` — nova restyle: tighter padding (`px-2.5 py-2` was `px-4 py-3`),
  `group/alert`, `gap-0.5`, icon layout via `*:[svg]:row-span-2` +
  `has-[>svg]:grid-cols-[auto_1fr]` (was explicit `grid-cols-[0_1fr]` /
  `grid-cols-[calc(var(--spacing)*4)_1fr]`), link styles on Title/Description
  (`[&_a]:underline …`), Description `text-balance md:text-pretty` +
  `[&_p:not(:last-child)]:mb-4`, AlertAction `top-2 right-2` (was `top-3 right-4`).
  Kept our `AlertProps` interface + `variant` JSDoc + component JSDoc (forks);
  docs link → base.
- `alert.stories.tsx` — docs anchors → base. Existing `contrastKnownIssue232`
  on the Destructive story still covers the (unchanged) #232 pairing
  (`text-destructive/90` on card); no new suppressions needed.

## Left alone

No `asChild`; no consumer changes.

## Behavior changes

Visual only (nova spacing + icon grid + link affordances). #232 surface
unchanged: destructive description `text-destructive/90` on card still
suppressed; other variants pass.

## Verify by hand

Default + destructive with/without a leading icon; AlertAction button sits
top-right without overlapping the title.
