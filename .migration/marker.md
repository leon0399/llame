# marker

2026-07-21 · transformation engine (custom cva component) · Swapped Radix `Slot` for Base UI's `useRender` + `mergeProps`, matching the already-migrated `badge`. No consumer edits (nothing used `asChild`).

## Changed

- **`packages/ui/src/components/marker.tsx`** — the only Radix usage was `Slot.Root` for the `asChild` merge. Replaced with Base UI's `useRender({ defaultTagName: "div", props: mergeProps<"div">(…), render, state })` — the same pattern `badge.tsx` already uses. `asChild?: boolean` is dropped in favor of the `render` prop (`useRender.ComponentProps<"div">`); `data-slot="marker"` and `data-variant` are now emitted via `useRender`'s `state` object (each state key becomes a `data-*` attribute — verified against badge's rendered `data-slot="badge" data-variant="…"`). `MarkerIcon`/`MarkerContent` are plain spans, untouched. `markerVariants` export unchanged. Leftover scan clean (`radix\|@radix\|Slot` → none).
- **`packages/ui/src/components/marker.stories.tsx`** — replaced the stale `asChild` argType (control:false) with a `render` argType. Stories pass **3/3**; the consumer `model-switch-boundary.stories` passes **3/3**.

Typecheck green: `@workspace/ui` and `web` both exit 0.

## Left alone

- No consumer used `Marker asChild` (`model-switch-boundary` and the stories all use `<Marker variant=…>`), so dropping it for `render` needed no consumer edits.
- **Visual baselines** (`__screenshots__/marker.stories.tsx.visual/*`) — marker's own classes are unchanged, so its rendered output should be byte-identical; the baselines likely still match. Re-baseline only if the panel reports a diff.

## Behavior changes

- `asChild` → `render` (Base UI). Since no caller used `asChild`, no behavior change in practice. The `data-variant`/`group-data-[variant=…]/marker` styling hook that `MarkerContent` and consumers rely on still works (emitted via `useRender` state).

## Verify by hand

- The chat "model changed" separator (`model-switch-boundary`) still renders centered between two rules — confirms `data-variant="separator"` reaches the `group-data-[variant=separator]/marker` hook.
- Each marker story variant (`default`/`separator`/`border`) renders its treatment.
