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

  If you need to show every value of an axis, give each its own story (`Small`, `Large`) rather than one grid — each becomes an addressable manifest entry.

- **Prefer `args` over a custom `render`.** Args-driven stories keep the Storybook controls panel live (a `render` that ignores args leaves controls dead) and read as a single documented prop change. Reach for `render` only when the concept genuinely needs composed children or multiple elements (the `Disabled` case above). The manifest evaluates the *final rendered output* either way, so this is for human controls and clarity, not the agent.
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

- **AI-authored stories MUST carry the `"ai-generated"` tag.** Add it to `meta.tags` when the whole file was agent-generated, or to a single story's `tags` when only that story was. It marks provenance for human review and does not change manifest inclusion. Since agents author nearly every story here, this is effectively the default — a file without it should be a conscious exception.
- Every `meta` also carries `"autodocs"` (generates the Autodocs page). A typical file: `tags: ["autodocs", "ai-generated"]`.
- Stories are in the manifest by default. Exclude anti-pattern examples or scaffolding with `tags: ["!manifest"]` (on a story, or on `meta` to exclude the whole file). Too much low-value context degrades the agent as much as too little.
- **MDX docs pages** (design tokens, guidelines) reach the manifest only through a `summary` attribute on their `<Meta>`, and only via *static analysis* — values pulled from imported modules (e.g. token values in a `.map()`) are **not** captured. Embed anything the agent needs literally in the MDX, not by reference.
