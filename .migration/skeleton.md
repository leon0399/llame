# skeleton

2026-07-21 · golden pair via CLI (base-nova stock) · pure-class component, no primitive swap; typecheck + story tests green.

## Changed

- `packages/ui/src/components/skeleton.tsx` — Skeleton has no Radix primitive
  (a styled `<div>`), so only the nova class refresh applies:
  - `bg-accent` → `bg-muted` (base-nova stock class).
  - Updated the vendored-from JSDoc link to the Base docs path
    (`/docs/components/base/skeleton`).
  - No import swap needed (already `@workspace/ui/lib/utils`); no radix import
    to remove. Leftover scan clean.
- `packages/ui/src/components/skeleton.stories.tsx` — the six stories
  (Basic, Avatar, CardSkeleton, Text, Form, Table) are already byte-identical
  to the current base-nova examples (`apps/v4/examples/base/skeleton-*`), so
  re-transcription is a no-op on the bodies. Updated the docs-anchor links and
  header comment from `/components/radix/skeleton` to
  `/components/base/skeleton`. `shadcn-example` + `ai-generated` tags retained.
  Story tests: 6 passed.

## Left alone

- Nothing adjacent. Skeleton depends only on `cn`; its Card story composes our
  own Card wrapper (migrated separately).

## Behavior changes

None. Pure visual token swap (`bg-accent` → `bg-muted`); the placeholder shape
and animation are unchanged.

## Verify by hand

- The Card-shaped skeleton story renders inside our vendored Card — confirm the
  header/media placeholders still read as a card once Card is migrated.
- Visual baseline shifts slightly (muted vs accent fill); regenerated in the
  end-of-migration baseline pass.
