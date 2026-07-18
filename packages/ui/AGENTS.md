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

**Where the canonical examples live** (source of truth, in `shadcn-ui/ui`):

- `apps/v4/content/docs/components/radix/<comp>.mdx` — the example list and section anchors (each `<ComponentPreview name="<comp>-<x>">` names an example; its heading is the `#anchor`).
- `apps/v4/registry/new-york-v4/examples/<comp>-<x>.tsx` — the verbatim example code (`new-york-v4` matches our `components.json` `"style": "new-york"`). Pull these with the `shadcn` MCP `get_item_examples_from_registries` rather than transcribing rendered HTML.

**Surface the docs link on the Storybook docs page.** Put a markdown link to the component's docs page in the **component** JSDoc (shows on the Autodocs header), and link each story's specific example **anchor** in that story's JSDoc — `https://ui.shadcn.com/docs/components/radix/<comp>#<anchor>`. Both render as clickable links in Autodocs and are captured in the manifest.

## Gotchas

- Tailwind config and `globals.css` live here and are consumed by the apps — don't re-declare theme setup in app code.
- Stories (`*.stories.tsx`) are co-located next to components but **rendered only by `apps/storybook`**: `globals.css` excludes them from its `@source` scan and `turbo.json` here excludes them from the `build`/`transit` hash (story edits must not rebuild the apps). `apps/storybook` re-includes both — see its `AGENTS.md` before touching either exclusion.
- Treat generated shadcn primitives as vendored: prefer composing in app code over editing them, unless an intentional fork. Component/prop JSDoc (see "Document vendored components" above) is the one expected fork — it must survive upgrades.
