# packages/ui

Shared shadcn/ui component library, published in-workspace as `@workspace/ui` and consumed by the apps.

## Structure

- `src/components/` — shadcn components (generated)
- `src/hooks/`, `src/lib/`, `src/styles/`, `types/`
- `components.json` — shadcn config for this package

## Adding / updating components

Run shadcn from the **consuming app**, targeting this package — e.g. at repo root:

```bash
pnpm dlx shadcn@latest add button -c apps/web
```

Components land in `packages/ui/src/components`. Import them in apps via:

```tsx
import { Button } from "@workspace/ui/components/button";
```

## Gotchas

- Tailwind config and `globals.css` live here and are consumed by the apps — don't re-declare theme setup in app code.
- Stories (`*.stories.tsx`) are co-located next to components but **rendered only by `apps/storybook`**: `globals.css` excludes them from its `@source` scan and `turbo.json` here excludes them from the `build`/`transit` hash (story edits must not rebuild the apps). `apps/storybook` re-includes both — see its `AGENTS.md` before touching either exclusion.
- Treat generated shadcn primitives as vendored: prefer composing in app code over editing them, unless an intentional fork.
