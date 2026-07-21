# input

2026-07-21 · golden pair via CLI (base-nova stock) · migrated to Base UI Input primitive; typecheck + 6 story tests green.

## Changed

- `packages/ui/src/components/input.tsx` — the plain `<input>` is now the
  `@base-ui/react/input` primitive (base-nova ships Input as a Base UI part, not
  a bare element). Adopted nova classes: `h-9`→`h-8`, `rounded-md`→`rounded-lg`,
  `px-3`→`px-2.5`, dropped `shadow-xs` + the `selection:*` classes, `file:h-7`→
  `file:h-6`, added `disabled:bg-input/50` + `dark:disabled:bg-input/80`,
  `ring-[3px]`→`ring-3`. Prop type stays `React.ComponentProps<"input">`
  (base-nova types it the same). Re-applied JSDoc; docs link → base.
- `packages/ui/src/components/input.stories.tsx` — bodies unchanged (Input is
  driven by native props: `id`/`type`/`placeholder`/`disabled`/`aria-invalid`/
  `required`, all drop-in on the Base UI primitive; stories compose the
  still-Radix `Field` fine). Docs anchors → base.
- **Storybook infra:** `apps/storybook/.storybook/main.ts` — the previous
  single `@base-ui/react` entry in `optimizeDeps.include` did NOT pre-bundle
  subpaths, so `@base-ui/react/input` re-optimized mid-run (stale-React
  `useMemo` crash on the play-function stories). Replaced it with the explicit
  list of every `@base-ui/react/<part>` subpath the migration touches, so no
  future component re-triggers this.

## Left alone

- No consumer changes: Input exposes no `asChild` and the Base UI primitive is a
  drop-in over the native input, so all `<Input .../>` call-sites are unaffected.
- `Field` (composed in the stories) is still Radix — migrated separately.

## Behavior changes

- Now renders through `@base-ui/react/input` rather than a bare `<input>`. Base
  UI Input still renders a single native `<input>` and forwards native props;
  no API change for consumers. Visual: tighter nova sizing (h-8, rounded-lg,
  reduced padding), no shadow.

## Verify by hand

- Focus ring (3px), invalid ring (aria-invalid), disabled dimming, and
  `type="file"` button all render; placeholder + typing work.
