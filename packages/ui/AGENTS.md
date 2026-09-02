# packages/ui

Shared shadcn/ui component library, published in-workspace as `@workspace/ui` and consumed by the apps.

## Structure

- `src/components/` — shadcn base-nova primitives, **flat** (generated; see below)
- `src/components/ai-elements/` — Vercel AI Elements (generated from the `@ai-elements` registry)
- `src/components/custom/` — hand-authored components (ours; never CLI-generated)
- `src/hooks/`, `src/lib/`, `src/styles/`, `types/`
- `components.json` — shadcn config for this package (base-nova; `registries` maps `@ai-elements`)

### Component organization

Components are grouped by **provenance/ownership**, because the two registries
overwrite their own directories on re-add — so they must stay isolated:

1. **shadcn primitives** — the `@shadcn` base-nova registry (`button`, `dialog`,
   `select`, `marker`, …). Live **flat** in `src/components/`. Regenerate with
   `pnpm dlx shadcn@latest add <name> -c packages/ui` (or `-c apps/web`).
2. **AI Elements** — the `@ai-elements` registry (`message`, `conversation`,
   `response`, `tool`, …). Live in `src/components/ai-elements/`. Regenerate with
   `pnpm dlx shadcn@latest add @ai-elements/<name> -c packages/ui`. See that
   dir's `README.md`.
3. **Custom** — hand-authored, no registry (`code-block`, `markdown`,
   `text-shimmer`, `model-switch-boundary`). Live in `src/components/custom/`.
   Never overwritten by the CLI.

A general-vs-AI split _inside_ `custom/` is deliberately **not** imposed yet —
most shared customs are generic primitives, and app-wired AI compositions live
in `apps/web/(chat)/components/`, so the practical line is "shared primitive vs
app composition", not "general vs AI". Revisit if `custom/` grows.

Import from any tier via the wildcard export, e.g.
`@workspace/ui/components/button`, `@workspace/ui/components/ai-elements/message`,
`@workspace/ui/components/custom/markdown`.

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

### Stories for vendored components

Stories with play functions ARE this repo's component-test layer
([docs/testing.md](../../docs/testing.md)) — interaction, a11y, and visual
coverage all hang off them, so a component without stories is an untested
component. Every vendored component SHOULD have stories.

**[`.claude/rules/stories.md`](../../.claude/rules/stories.md) is the authoring
contract** — story structure, the `ai-generated` / `shadcn-example` /
`ai-elements-example` provenance tags, naming, manifest inclusion, how to
transcribe upstream shadcn examples, and the recurring `vitest`/`tsgo`/axe
failures with their fixes. Read it before writing or editing a story; do not
re-derive those conventions here.

Two things that bite from this side of the boundary:

- **An agent MUST tag every story it writes `"ai-generated"`** and must never
  remove the tag, even when correcting an existing story. Only a human may drop
  it — that is what signals human authorship.
- **A story-only dependency needs two registrations**, not one:
  `optimizeDeps.include` in `apps/storybook/.storybook/main.ts` _and_ an
  `apps/storybook` devDependency. One without the other fails cold in CI only.

## Gotchas

- Tailwind config and `globals.css` live here and are consumed by the apps — don't re-declare theme setup in app code.
- Stories (`*.stories.tsx`) are co-located next to components but **rendered only by `apps/storybook`**: `globals.css` excludes them from its `@source` scan and `turbo.json` here excludes them from the `build`/`transit` hash (story edits must not rebuild the apps). `apps/storybook` re-includes both — see its `AGENTS.md` before touching either exclusion.
- Treat generated shadcn primitives as vendored: prefer composing in app code over editing them, unless an intentional fork. Component/prop JSDoc (see "Document vendored components" above) is the one expected fork — it must survive upgrades.
