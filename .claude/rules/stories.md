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

- **Stories carry a provenance tag.** `"ai-generated"` for stories we author (add to `meta.tags` for a whole agent-generated file, or a single story's `tags`). In `packages/ui`, stories transcribed verbatim from a component's shadcn docs example instead carry `"shadcn-example"` and link the docs anchor — see [packages/ui/AGENTS.md](../../packages/ui/AGENTS.md). The two are mutually exclusive: a verbatim upstream example is not "authored". Either way provenance is marked for human review and does not change manifest inclusion.
- Every `meta` also carries `"autodocs"` (generates the Autodocs page). A typical file: `tags: ["autodocs", "ai-generated"]`.
- Stories are in the manifest by default. Exclude anti-pattern examples or scaffolding with `tags: ["!manifest"]` (on a story, or on `meta` to exclude the whole file). Too much low-value context degrades the agent as much as too little.
- **MDX docs pages** (design tokens, guidelines) reach the manifest only through a `summary` attribute on their `<Meta>`, and only via *static analysis* — values pulled from imported modules (e.g. token values in a `.map()`) are **not** captured. Embed anything the agent needs literally in the MDX, not by reference.
