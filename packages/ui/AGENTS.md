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

Every vendored component SHOULD have stories, and each story carries **provenance tags** so the Storybook AI manifest (and a human reviewer) can tell where it came from. Tags go on the **individual story**, not on `meta` — `meta.tags` holds only `["autodocs"]` (file-level). The two provenance tags are **orthogonal** — one marks who _authored_ the story, the other marks where its _rendered output_ came from:

- **`"ai-generated"` — mandatory on every story an agent writes.** It marks that an AI authored the story, for human review. An agent MUST tag every story it creates with this (in that story's own `tags`) and MUST NOT remove it — even when correcting or restyling an existing story. **Only a human may drop `"ai-generated"` or author a story without it**, which is what signals human authorship.
- **`"shadcn-example"`** — orthogonal to `ai-generated`, **not** mutually exclusive: it marks the story's **rendered output** as transcribed from the component's own shadcn docs example, adapted **only** for import paths, our `lucide` icon library (upstream sometimes uses `@tabler/icons-react`), framework primitives (`next/link` → a plain `<a>`), and the minimum needed to satisfy our stricter a11y gate (e.g. an `aria-label` an icon-only example omits). Any `play`/interaction test is our own overlay and does not change it. Every such story links its docs anchor (see below).
- So a **transcribed** story carries both — `tags: ["shadcn-example", "ai-generated"]` — and an **authored** story (no upstream example) carries `tags: ["ai-generated"]`. `meta` stays `tags: ["autodocs"]`.

**Cover the upstream examples.** For each vendored component, work through its shadcn docs example list and add a `shadcn-example` story per example, **except**: RTL/`dir="rtl"` demos, and examples that depend on companion components we did not vendor (e.g. `Spinner`, `ButtonGroup`). **Log the examples you skip** so the coverage gap is visible, not silent.

**Compatibility is about USAGE, not which registry an example lives in.** As of mid-2026 upstream moved the per-example files out of `new-york-v4/examples/` (mostly 404 there now) into `apps/v4/examples/radix/` — the source the docs' **"Radix UI"** tab renders (`styleName="radix-nova"`). These examples compose the standard Radix component API and are almost always compatible with our components; the only change needed is the import line. Do **not** confuse this with the separate `bases/radix/ui/<comp>.tsx` _component implementation_, which is a rewrite (different classes like `cn-switch`) — that's irrelevant, because an example only uses the public `<Component>` API, not its internals. The real compatibility test: **does the example use props/subcomponents our `<comp>.tsx` actually exports?** If yes, transcribe it. Skip an example only when it uses a prop/subcomponent we genuinely lack (a true API gap — report it as the "how outdated are we" signal), or it's RTL/depends on a companion component we never vendored.

**Where the canonical examples live** (source of truth, in `shadcn-ui/ui`, GitHub `main`):

- `apps/v4/examples/radix/<comp>-<x>.tsx` — the verbatim example code the Radix-UI docs tab renders. Fetch with `curl https://raw.githubusercontent.com/shadcn-ui/ui/main/apps/v4/examples/radix/<comp>-<x>.tsx`. Adapt **only** the import (`@/styles/radix-nova/ui/<comp>` → `./<comp>.js`), our `lucide` icons, framework primitives (`next/link` → `<a>`), and a11y names. (The `shadcn` MCP `get_item_examples_from_registries` indexes the older `new-york-v4/examples/` set, which is now largely gone — prefer the `apps/v4/examples/radix/` files above; the MCP is also not reachable from spawned subagents.)
- `apps/v4/content/docs/components/base/<comp>.mdx` — the example list and section anchors (each `<ComponentPreview name="<comp>-<x>">` names an example; its heading is the `#anchor`). List the dir with `gh api "repos/shadcn-ui/ui/contents/apps/v4/examples/radix?ref=main" --jq '.[].name'` to see every example for a component.

**Verify.** The `storybook` MCP `run-story-tests` is the preferred check but is often not connected (including from subagents). Reliable fallback, scoped to one file: `pnpm --filter storybook exec vitest run --project storybook <comp>.stories` — the same runner, with addon-a11y `test: "error"` applied.

**Surface the docs link on the Storybook docs page.** Put a markdown link to the component's docs page in the **component** JSDoc (shows on the Autodocs header), and link each story's specific example **anchor** in that story's JSDoc — `https://ui.shadcn.com/docs/components/base/<comp>#<anchor>`. Both render as clickable links in Autodocs and are captured in the manifest.

**Match the docs' preview frame for inline components.** The docs render every example centered and width-constrained. Verbatim examples carry their own per-example widths (some `max-w-lg`, some `w-full`, some `max-w-sm`), which render as a "zoo" of sizes here — and a `w-full` one grows horizontally as its content expands. For **inline** components (accordion, tabs, select, …): (1) set `parameters.layout: "centered"`; (2) add a meta `decorators` wrapper with a single **fixed** width that owns sizing (e.g. `<div className="w-[32rem] max-w-full">`); and (3) **strip the per-example width classes** (`max-w-*`, `w-full`, `w-[…]`) from the story bodies so they all fill that one frame and nothing resizes on interaction. Keep non-width classes (e.g. `rounded-lg border`). This is the one place where matching the docs' presentation overrides byte-verbatim fidelity — the rendered concept is unchanged. Overlay/trigger components (dialog, popover, tooltip, sheet, dropdown-menu) don't need this — their trigger centers and the content is portalled.

### Common story problems & fixes

Recurring failures hit during the story sweep, and how to resolve them — check here before improvising:

- **`vitest` fails with "Invalid hook call" / "Cannot read properties of null (reading 'useMemo')" on the FIRST run, then passes on re-run.** A story is the first to import a dep no other story pulls in, so Vite discovers it mid-run on a cold cache, re-optimizes, and the reload leaves a stale React copy. It's transient locally (warm cache) but **CI runs `test:storybook` cold**, so it's a real, intermittent CI failure. **Fix:** add the dep to `optimizeDeps.include` in `apps/storybook/.storybook/main.ts` (`viteFinal`) **and** declare it as an `apps/storybook` devDependency — under pnpm's isolated `node_modules` the bare specifier won't resolve from the storybook root otherwise (you'll see a `Failed to resolve dependency … present in … optimizeDeps.include` warning and the fix silently does nothing). Match the version to `packages/ui`'s (`catalog:` where it uses one). Already handled for `sonner`/`next-themes` and `react-hook-form`/`zod`/`@hookform/resolvers`; **expect this for any new story that introduces a story-only dependency.**
- **`tsgo` TS4023 "has or is using name '…' … but cannot be named".** The component's props reference a type its package doesn't export (e.g. sonner's `ToastIcons`), so the inferred `meta` type can't be named once exported. **Fix:** annotate `const meta: Meta<typeof Component> = {…}` instead of `… satisfies Meta<typeof Component>` — the alias is nameable (safe for render-only stories).
- **`tsgo` demands `args: never` on every story.** The component's props are a discriminated union (accordion/toggle-group `type`, sidebar `collapsible`, …), which `StoryObj<typeof meta>` collapses. **Fix:** `type Story = StoryObj<typeof Component>` (from the component, not `meta`), set the discriminant per story, and disable the meta control for it.
- **A story fails axe `color-contrast` ONLY, from `text-muted-foreground` / `text-destructive/90` on a muted or card surface.** This is the tracked #232 token defect — do not hide it with an ad-hoc rule-disable. Spread `contrastKnownIssue232` from `./known-a11y-issues.ts` into that story's `parameters` (it disables only `color-contrast`) with a `// #232` comment. Remove all of these when #232's token fix lands: `rg "KnownIssue232"`.
- **A story fails axe `aria-hidden-focus`, `scrollable-region-focusable`, or `aria-required-children` from a Radix/cmdk portal or structure.** Vendored-structure false positives (Radix portals toggle `aria-hidden`; cmdk nests a `separator` in a `listbox`). Disable the specific rule per story/meta via `parameters.a11y.config.rules: [{ id, enabled: false }]` **with a justifying comment**, per `select.stories.tsx`/`dropdown-menu.stories.tsx`. Never use this for a _real_ failure: a missing accessible name is fixed with `aria-label`; a non-keyboard-scrollable region gets `tabIndex={0} role="region" aria-label`.

## Gotchas

- Tailwind config and `globals.css` live here and are consumed by the apps — don't re-declare theme setup in app code.
- Stories (`*.stories.tsx`) are co-located next to components but **rendered only by `apps/storybook`**: `globals.css` excludes them from its `@source` scan and `turbo.json` here excludes them from the `build`/`transit` hash (story edits must not rebuild the apps). `apps/storybook` re-includes both — see its `AGENTS.md` before touching either exclusion.
- Treat generated shadcn primitives as vendored: prefer composing in app code over editing them, unless an intentional fork. Component/prop JSDoc (see "Document vendored components" above) is the one expected fork — it must survive upgrades.
