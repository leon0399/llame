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

### Document vendored components after generating them

shadcn emits primitives without JSDoc. After vendoring (or when adding a new one), add a JSDoc block to the exported component describing what it is _for_, and a JSDoc comment on each prop — the Storybook AI manifest extracts both via `react-docgen-typescript`, so undocumented props are invisible to agents. This is a deliberate light fork of the generated file; keep it minimal.

Because it lives in the generated file, this documentation is **overwritten whenever the component is re-added or upgraded** (`shadcn add` regenerates in place). Treat restoring it as part of the upgrade: re-add, diff against the previous version, and re-apply the JSDoc (and any other intentional forks) before committing. The full authoring conventions live in `.claude/rules/stories.md`.

## Gotchas

- Tailwind config and `globals.css` live here and are consumed by the apps — don't re-declare theme setup in app code.
- Stories (`*.stories.tsx`) are co-located next to components but **rendered only by `apps/storybook`**: `globals.css` excludes them from its `@source` scan and `turbo.json` here excludes them from the `build`/`transit` hash (story edits must not rebuild the apps). `apps/storybook` re-includes both — see its `AGENTS.md` before touching either exclusion.
- Treat generated shadcn primitives as vendored: prefer composing in app code over editing them, unless an intentional fork. Component/prop JSDoc (see "Document vendored components" above) is the one expected fork — it must survive upgrades.
