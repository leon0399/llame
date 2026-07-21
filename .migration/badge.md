# badge

2026-07-21 · golden pair via CLI (base-nova stock) · migrated to Base UI useRender; typecheck + 7 story tests green.

## Changed

- `badge.tsx` — Radix Slot → Base UI's `useRender` + `mergeProps` composition
  (`@base-ui/react/use-render`, `@base-ui/react/merge-props`). `asChild` is
  replaced by the `render` prop (no app consumer used `<Badge asChild>` — only
  the story). Nova cva: `rounded-4xl`, h-5, `has-data-[icon=*]` spacing,
  `[&>svg]:size-3!`, subtle destructive (`bg-destructive/10`). Dropped unused
  `BadgeProps`. Kept component JSDoc; link → base.
- `badge.stories.tsx` — `AsLink` story `<Badge asChild><a/></Badge>` →
  `<Badge render={<a/>}>…`; removed the `asChild` argType. Docs → base. #232
  (`contrastKnownIssue232`) on the 3 stories rendering the subtle destructive
  badge (Basic, Variants, WithSpinner).
- `apps/storybook/.storybook/main.ts` — pre-bundle `@base-ui/react/use-render`
  and `@base-ui/react/merge-props` (the useRender composition subpaths).

## Left alone

No app consumers (badge is composed as `<Badge>` with variant/className only).

## Behavior changes

- `asChild` → `render` (Base UI useRender). Subtle destructive badge fails
  WCAG AA contrast (#232), like the destructive button.

## Verify by hand

Variants; icon spacing (data-icon); link badge via render; custom-color badges.
