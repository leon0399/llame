---
paths:
  - "**/*.stories.{ts,tsx,js,jsx}"
---

# Storybook story authoring

Stories are consumed by AI agents through the Storybook MCP manifest (`@storybook/addon-mcp` — manifest generation is always on), not just by humans in the docs UI. Everything below exists so the manifest stays a high-signal reference; `packages/ui/src/components/model-switch-boundary.stories.tsx` is the reference implementation.

## Workflow

- Call the `storybook` MCP `get-storybook-story-instructions` tool before creating or editing any story; follow it over remembered conventions.
- Verify with the MCP `run-story-tests` tool (not a package.json script) and include `preview-stories` URLs in your response.
- Never guess component props — verify each one via `get-documentation` or an example story before use. An undocumented prop does not exist.

## Story structure

- **One concept per story.** Rendering several elements in one story is fine *only* when they all demonstrate the same single idea; combining two dimensions is the anti-pattern:

  ```tsx
  // ✅ Good — one prop change, controls stay live
  export const Primary: Story = { args: { variant: "primary" } };

  // ✅ Good — multiple elements, but all demonstrate the ONE concept "disabled"
  export const Disabled: Story = {
    render: () => (
      <>
        <Button disabled>Disabled</Button>
        <Button variant="primary" disabled>Disabled primary</Button>
      </>
    ),
  };

  // ❌ Bad — crosses two dimensions (size × variant); useless as an agent
  // reference and no story maps to a single documented prop
  export const SizesAndVariants: Story = {
    render: () => (
      <>
        <Button size="sm">Small</Button>
        <Button size="lg">Large</Button>
        <Button variant="outline">Outline</Button>
      </>
    ),
  };
  ```

  Split by *concept*, not by value: values that are distinct use-cases (semantic variants like `Destructive` vs `Ghost` — each its own decision) get their own story, but a single-axis *scale or enumeration* (all sizes, all placements) MAY be one showcase story (`Sizes`, `Sides`) since that is still one concept. Crossing two axes in one story is the only hard anti-pattern.

- **Prefer `args` over a custom `render`.** Args-driven stories keep the controls panel live **and** forward meta args like `onClick: fn()` to the component — a `render` that ignores args leaves controls dead *and* logs nothing in the Actions panel. JSX children (an icon, icon+text, or the `<a>` for an `asChild` story) belong in `args.children`, not `render`. Reach for `render` only when the story needs **multiple sibling elements** (a `Sizes`/`Sides` showcase) or stateful wrapper logic — and even then, **spread `{...args}` into each element** and hardcode only the axis the story varies, so shared controls and Actions still drive the whole showcase:

  ```tsx
  export const Sizes: Story = {
    args: { variant: "outline" },
    render: (args) => (
      <>
        <Button {...args} size="sm">Small</Button>
        <Button {...args} size="lg">Large</Button>
      </>
    ),
  };
  ```

  Disable the control for the axis such a showcase hardcodes, since it's inert there — `argTypes: { size: { control: false } }` on that story keeps the row visible but non-editable. The manifest evaluates the *final rendered output* either way, so this is for human controls/clarity, not the agent.
- CSF3 with `satisfies Meta<typeof Component>`; types from `@storybook/nextjs-vite`, test utils from `storybook/test`.
- Add a `play` function when the story's concept is behavioral (open/close, keyboard, invoke callback). When passing an `fn()` callback as an arg, assert it was called in `play`. a11y violations are test errors.

## Documentation (feeds the AI manifest)

- **Every story gets a JSDoc block** stating *why/when* to use that state — not a restatement of what it renders — plus an `@summary` tag (the manifest uses the summary; otherwise the first 60 chars of the description):

  ```tsx
  /**
   * Use the collapsed boundary in routine chat history so a model change
   * stays visible without competing with the conversation.
   *
   * @summary for the normal compact transcript boundary
   */
  export const Collapsed: Story = {};
  ```

- Document the **component** and its **props** with JSDoc in the component source — the manifest extracts both via `react-docgen-typescript`. Component JSDoc states what the component is *for*; prop JSDoc states what each prop does:

  ```tsx
  /**
   * Button is used for user interactions that do not navigate. For navigation
   * use Link instead.
   *
   * @summary for user interactions that do not navigate
   */
  export function Button({ icon, ...props }: ButtonProps) { /* ... */ }

  interface ButtonProps {
    /** Icon rendered before the button text */
    icon?: ReactNode;
  }
  ```

  For vendored shadcn primitives this is a deliberate light fork (re-running `shadcn add` overwrites it); keep it minimal and reviewable.

## Naming

- `Basic` for the default state; then one story per concept named for the concept (`Disabled`, `WithForm`, `LongContent`). No `Demo`/`Showcase`/`AllVariants` grab-bags.

## Tags & manifest

- **Provenance tags go on each individual story, not on `meta`.** `meta.tags` carries only file-level concerns — `["autodocs"]` (plus `"!manifest"` to exclude a whole file). Every **story** carries its own provenance so a reviewer sees where each one came from without cross-referencing meta.
- **Every story an agent writes MUST be tagged `"ai-generated"`** (in that story's own `tags`). It marks AI authorship for human review. An agent must never create a story without it, and **must never remove it** — even when correcting or restyling an existing story. **Only a human may drop `"ai-generated"` or author a story without it** — that is what signals human authorship/review.
- **`"shadcn-example"` is orthogonal to `"ai-generated"`, not mutually exclusive** — they answer different questions and coexist. `"shadcn-example"` marks the *rendered output's* provenance (transcribed verbatim from the component's shadcn docs example, linking the docs anchor — see "Transcribing shadcn examples" below); `"ai-generated"` marks *authorship*. So a story transcribed by an agent carries **both** — `tags: ["shadcn-example", "ai-generated"]` — while an agent-authored original carries `tags: ["ai-generated"]`. Tags never change manifest inclusion.
- **`"ai-elements-example"` is the exact analog for vendored Vercel AI Elements components** (`src/components/ai-elements/*`). It marks a story whose rendered output is transcribed from the component's AI Elements docs example at `https://elements.ai-sdk.dev/components/<name>`. The docs render examples via client-side `<Preview>` with no inline source, so the runnable example code lives in the `vercel/ai-elements` repo under `packages/examples/src/<comp>*.tsx` (check it out with the `librarian` skill). Same rules as `shadcn-example`: adapt only imports (`@repo/elements/*` → `./<comp>.js`), our lucide icons, framework primitives, and a11y names; link the docs section in the story JSDoc; and pair with `"ai-generated"` (`tags: ["ai-elements-example", "ai-generated"]`). An AI Elements story with no matching docs example carries `["ai-generated"]` only.
- So a typical file is `meta` with `tags: ["autodocs"]`, and each `export const X: Story` sets its own `tags: ["shadcn-example", "ai-generated"]` or `tags: ["ai-generated"]`.
- Stories are in the manifest by default. Exclude anti-pattern examples or scaffolding with `tags: ["!manifest"]` (on a story, or on `meta` to exclude the whole file). Too much low-value context degrades the agent as much as too little.
- **MDX docs pages** (design tokens, guidelines) reach the manifest only through a `summary` attribute on their `<Meta>`, and only via *static analysis* — values pulled from imported modules (e.g. token values in a `.map()`) are **not** captured. Embed anything the agent needs literally in the MDX, not by reference.

## Transcribing shadcn examples

Stories with play functions ARE this repo's component-test layer (docs/testing.md), so a component without stories is an untested component. For each vendored component, work through its shadcn docs example list and add one `shadcn-example` story per example — **except** RTL/`dir="rtl"` demos and examples depending on companion components we never vendored (e.g. `Spinner`, `ButtonGroup`). **Log the examples you skip** so the coverage gap is visible rather than silent.

**Where the canonical examples live** (source of truth, `shadcn-ui/ui`, GitHub `main`):

- `apps/v4/examples/radix/<comp>-<x>.tsx` — the verbatim code the docs' **Radix UI** tab renders. Fetch with `curl https://raw.githubusercontent.com/shadcn-ui/ui/main/apps/v4/examples/radix/<comp>-<x>.tsx`.
- `apps/v4/content/docs/components/base/<comp>.mdx` — the example list and section anchors (each `<ComponentPreview name="<comp>-<x>">` names an example; its heading is the `#anchor`). List every example for a component with `gh api "repos/shadcn-ui/ui/contents/apps/v4/examples/radix?ref=main" --jq '.[].name'`.

Adapt **only** the import (`@/styles/radix-nova/ui/<comp>` → `./<comp>.js`), our `lucide` icons (upstream sometimes uses `@tabler/icons-react`), framework primitives (`next/link` → a plain `<a>`), and the minimum needed for our stricter a11y gate (e.g. an `aria-label` an icon-only example omits). Any `play`/interaction test is our own overlay and does not change the transcription.

**Compatibility is about USAGE, not which registry an example lives in.** As of mid-2026 upstream moved per-example files out of `new-york-v4/examples/` (mostly 404 there now) into `apps/v4/examples/radix/`. Do not confuse those with the `bases/radix/ui/<comp>.tsx` *component implementations*, which are a rewrite with different classes (`cn-switch`) — irrelevant, because an example only uses the public `<Component>` API. The real test: **does the example use props/subcomponents our `<comp>.tsx` actually exports?** If yes, transcribe it. Skip only for a true API gap (report it — it is the "how outdated are we" signal), RTL, or an unvendored companion. The `shadcn` MCP's `get_item_examples_from_registries` indexes the older, largely-gone `new-york-v4/examples/` set, and is not reachable from spawned subagents — prefer the files above.

**Surface the docs links.** Put a markdown link to the component's docs page in the **component** JSDoc (it shows on the Autodocs header), and link each story's specific example **anchor** in that story's JSDoc — `https://ui.shadcn.com/docs/components/base/<comp>#<anchor>`. Both render as clickable links and are captured in the manifest.

**Match the docs' preview frame for inline components.** The docs render every example centered and width-constrained; verbatim examples carry their own per-example widths (`max-w-lg`, `w-full`, `max-w-sm`), which render here as a zoo of sizes, and a `w-full` one grows as its content expands. For **inline** components (accordion, tabs, select, …): set `parameters.layout: "centered"`; add a meta `decorators` wrapper with a single **fixed** width that owns sizing (e.g. `<div className="w-[32rem] max-w-full">`); and **strip the per-example width classes** from the story bodies. Keep non-width classes (`rounded-lg border`). This is the one place where matching the docs' presentation overrides byte-verbatim fidelity — the rendered concept is unchanged. Overlay/trigger components (dialog, popover, tooltip, sheet, dropdown-menu) don't need it: their trigger centers and the content is portalled.

**Verify.** The `storybook` MCP `run-story-tests` is preferred but is often not connected (including from subagents). Reliable fallback, scoped to one file: `pnpm --filter storybook exec vitest run --project storybook <comp>.stories` — the same runner, with addon-a11y `test: "error"` applied.

## Common story failures

Check here before improvising:

- **`vitest` fails with "Invalid hook call" / "Cannot read properties of null (reading 'useMemo')" on the FIRST run, then passes on re-run.** A story is the first to import a dep no other story pulls in, so Vite discovers it mid-run on a cold cache, re-optimizes, and the reload leaves a stale React copy. Transient locally (warm cache), but **CI runs `test:storybook` cold**, so it is a real intermittent CI failure. **Fix:** add the dep to `optimizeDeps.include` in `apps/storybook/.storybook/main.ts` (`viteFinal`) **and** declare it as an `apps/storybook` devDependency — under pnpm's isolated `node_modules` the bare specifier won't resolve from the storybook root otherwise (you'll see a `Failed to resolve dependency … present in … optimizeDeps.include` warning and the fix silently does nothing). Match the version to `packages/ui`'s (`catalog:` where it uses one). Already handled for `sonner`/`next-themes` and `react-hook-form`/`zod`/`@hookform/resolvers`; **expect this for any new story that introduces a story-only dependency.**
- **`tsgo` TS4023 "has or is using name '…' … but cannot be named".** The component's props reference a type its package doesn't export (e.g. sonner's `ToastIcons`), so the inferred `meta` type can't be named once exported. **Fix:** annotate `const meta: Meta<typeof Component> = {…}` instead of `… satisfies Meta<typeof Component>` — the alias is nameable (safe for render-only stories).
- **`tsgo` demands `args: never` on every story.** The component's props are a discriminated union (accordion/toggle-group `type`, sidebar `collapsible`, …), which `StoryObj<typeof meta>` collapses. **Fix:** `type Story = StoryObj<typeof Component>` (from the component, not `meta`), set the discriminant per story, and disable the meta control for it.
- **A story fails axe `color-contrast` ONLY, from `text-muted-foreground` / `text-destructive/90` on a muted or card surface.** This is the tracked #232 token defect — do not hide it with an ad-hoc rule-disable. Spread `contrastKnownIssue232` from `./known-a11y-issues.ts` into that story's `parameters` (it disables only `color-contrast`) with a `// #232` comment. Remove all of these when #232's token fix lands: `rg "KnownIssue232"`.
- **A story fails axe `aria-hidden-focus`, `scrollable-region-focusable`, or `aria-required-children` from a Radix/cmdk portal or structure.** Vendored-structure false positives (Radix portals toggle `aria-hidden`; cmdk nests a `separator` in a `listbox`). Disable the specific rule per story/meta via `parameters.a11y.config.rules: [{ id, enabled: false }]` **with a justifying comment**, per `select.stories.tsx`/`dropdown-menu.stories.tsx`. Never use this for a *real* failure: a missing accessible name is fixed with `aria-label`; a non-keyboard-scrollable region gets `tabIndex={0} role="region" aria-label`.
- **A story's own `parameters.a11y.config.rules` silently drops a `meta`-level suppression instead of adding to it.** Storybook does not merge parameter arrays across levels — a story-level `rules: [...]` replaces `meta`'s wholesale. Concretely bit `avatar.stories.tsx`'s `Dropdown` story (#232): `meta` spreads `contrastKnownIssue232`, but `Dropdown` set its own `rules: [{ id: "aria-hidden-focus", enabled: false }]`, dropping the `color-contrast` suppression — CI then failed intermittently, only when the story's real external image (`https://github.com/shadcn.png`) failed to load and the low-contrast fallback text rendered. **Fix:** spread the inherited rules array too: `rules: [...contrastKnownIssue232.a11y.config.rules, { id: "aria-hidden-focus", enabled: false }]`.
