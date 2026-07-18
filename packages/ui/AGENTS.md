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

### Stories for vendored components

Every vendored component SHOULD have stories, and those stories carry a **provenance tag** so the Storybook AI manifest (and a human reviewer) can tell where each came from:

- **`"shadcn-example"`** — the story's rendered output is transcribed from the component's own shadcn docs example, adapted **only** for: import paths, our `lucide` icon library (upstream examples sometimes use `@tabler/icons-react`), framework primitives (`next/link` → a plain `<a>`), and the minimum needed to satisfy our stricter a11y gate (e.g. adding an `aria-label` an icon-only example omits). The tag marks the **rendered example's** provenance; any `play`/interaction test is our own overlay and does not change the tag. Every such story links its docs anchor (see below).
- **`"ai-generated"`** — stories we author for our own usages, states, or compositions that upstream doesn't document. Mutually exclusive with `shadcn-example`.

**Cover the upstream examples.** For each vendored component, work through its shadcn docs example list and add a `shadcn-example` story per example, **except**: RTL/`dir="rtl"` demos, and examples that depend on companion components we did not vendor (e.g. `Spinner`, `ButtonGroup`). **Log the examples you skip** so the coverage gap is visible, not silent.

**Compatibility is about USAGE, not which registry an example lives in.** As of mid-2026 upstream moved the per-example files out of `new-york-v4/examples/` (mostly 404 there now) into `apps/v4/examples/radix/` — the source the docs' **"Radix UI"** tab renders (`styleName="radix-nova"`). These examples compose the standard Radix component API and are almost always compatible with our components; the only change needed is the import line. Do **not** confuse this with the separate `bases/radix/ui/<comp>.tsx` _component implementation_, which is a rewrite (different classes like `cn-switch`) — that's irrelevant, because an example only uses the public `<Component>` API, not its internals. The real compatibility test: **does the example use props/subcomponents our `<comp>.tsx` actually exports?** If yes, transcribe it. Skip an example only when it uses a prop/subcomponent we genuinely lack (a true API gap — report it as the "how outdated are we" signal), or it's RTL/depends on a companion component we never vendored.

**Where the canonical examples live** (source of truth, in `shadcn-ui/ui`, GitHub `main`):

- `apps/v4/examples/radix/<comp>-<x>.tsx` — the verbatim example code the Radix-UI docs tab renders. Fetch with `curl https://raw.githubusercontent.com/shadcn-ui/ui/main/apps/v4/examples/radix/<comp>-<x>.tsx`. Adapt **only** the import (`@/styles/radix-nova/ui/<comp>` → `./<comp>.js`), our `lucide` icons, framework primitives (`next/link` → `<a>`), and a11y names. (The `shadcn` MCP `get_item_examples_from_registries` indexes the older `new-york-v4/examples/` set, which is now largely gone — prefer the `apps/v4/examples/radix/` files above; the MCP is also not reachable from spawned subagents.)
- `apps/v4/content/docs/components/radix/<comp>.mdx` — the example list and section anchors (each `<ComponentPreview name="<comp>-<x>">` names an example; its heading is the `#anchor`). List the dir with `gh api "repos/shadcn-ui/ui/contents/apps/v4/examples/radix?ref=main" --jq '.[].name'` to see every example for a component.

**Verify.** The `storybook` MCP `run-story-tests` is the preferred check but is often not connected (including from subagents). Reliable fallback, scoped to one file: `pnpm --filter storybook exec vitest run --project storybook <comp>.stories` — the same runner, with addon-a11y `test: "error"` applied.

**Surface the docs link on the Storybook docs page.** Put a markdown link to the component's docs page in the **component** JSDoc (shows on the Autodocs header), and link each story's specific example **anchor** in that story's JSDoc — `https://ui.shadcn.com/docs/components/radix/<comp>#<anchor>`. Both render as clickable links in Autodocs and are captured in the manifest.

**Match the docs' preview frame for inline components.** The docs render every example centered and width-constrained. Verbatim examples carry their own per-example widths (some `max-w-lg`, some `w-full`, some `max-w-sm`), which render as a "zoo" of sizes here — and a `w-full` one grows horizontally as its content expands. For **inline** components (accordion, tabs, select, …): (1) set `parameters.layout: "centered"`; (2) add a meta `decorators` wrapper with a single **fixed** width that owns sizing (e.g. `<div className="w-[32rem] max-w-full">`); and (3) **strip the per-example width classes** (`max-w-*`, `w-full`, `w-[…]`) from the story bodies so they all fill that one frame and nothing resizes on interaction. Keep non-width classes (e.g. `rounded-lg border`). This is the one place where matching the docs' presentation overrides byte-verbatim fidelity — the rendered concept is unchanged. Overlay/trigger components (dialog, popover, tooltip, sheet, dropdown-menu) don't need this — their trigger centers and the content is portalled.

## Gotchas

- Tailwind config and `globals.css` live here and are consumed by the apps — don't re-declare theme setup in app code.
- Stories (`*.stories.tsx`) are co-located next to components but **rendered only by `apps/storybook`**: `globals.css` excludes them from its `@source` scan and `turbo.json` here excludes them from the `build`/`transit` hash (story edits must not rebuild the apps). `apps/storybook` re-includes both — see its `AGENTS.md` before touching either exclusion.
- Treat generated shadcn primitives as vendored: prefer composing in app code over editing them, unless an intentional fork. Component/prop JSDoc (see "Document vendored components" above) is the one expected fork — it must survive upgrades.
