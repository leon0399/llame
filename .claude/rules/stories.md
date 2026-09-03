---
paths:
  - "**/*.stories.{ts,tsx,js,jsx}"
---

# Storybook stories

Stories feed the Storybook MCP manifest and browser tests. Use
`packages/ui/src/components/custom/model-switch-boundary.stories.tsx` as the
reference.

## Workflow

- Before editing, call `get-storybook-story-instructions` and follow it over
  memory. Verify every prop through Storybook documentation or an example.
- After editing, use MCP `run-story-tests` and return `preview-stories` URLs.
  If MCP is unavailable, run
  `pnpm --filter storybook exec vitest run --project storybook <name>.stories`.

## Shape

- One concept per story. One-axis enumerations such as all sizes may share a
  story; crossing axes may not.
- Prefer `args`, including JSX children, so controls and Actions remain live.
  Use `render` only for siblings or state. Spread `{...args}` into each rendered
  component and disable controls for hard-coded axes.
- Use CSF3 with `satisfies Meta<typeof Component>`, types from
  `@storybook/nextjs-vite`, and utilities from `storybook/test`.
- Behavioral concepts get a `play` function; assert `fn()` callbacks. A11y
  violations are test failures.
- Name the default `Basic`, then name each story for its concept. Avoid
  `Demo`, `Showcase`, and multi-concept grab bags.

## Documentation and manifest

- Every story has JSDoc explaining when to use it plus `@summary`.
- Component source documents the component's purpose and every prop. This is an
  intentional minimal fork for generated shadcn files and must be restored
  after regeneration.
- `meta.tags` contains file-wide tags such as `"autodocs"` or `"!manifest"`.
  Provenance belongs on each story.
- Every agent-authored story has `"ai-generated"`; agents never remove it.
- Verbatim shadcn examples also use `"shadcn-example"`; AI Elements examples
  use `"ai-elements-example"`. These coexist with `"ai-generated"`.
- Use `"!manifest"` for scaffolding or anti-patterns.
- MDX enters the manifest through a literal `<Meta summary="...">`; imported
  dynamic values are not captured.

## Upstream examples

For shadcn, use `shadcn-ui/ui` `main`:

- Example code: `apps/v4/examples/radix/<component>-<example>.tsx`.
- Example list/anchors:
  `apps/v4/content/docs/components/base/<component>.mdx`.

Add one story per compatible docs example. Skip RTL and unvendored companions;
record every skip. Adapt only imports, icons, Next primitives, required a11y
names, and preview-frame width. Compatibility depends on our public component
API, not the upstream registry path. Link component docs from component JSDoc
and the exact example anchor from story JSDoc.

For inline components, center the layout, use one fixed-width meta decorator,
and remove per-example width classes. Portalled/trigger components need no
wrapper.

AI Elements source lives in `vercel/ai-elements`
`packages/examples/src/<component>*.tsx`; use the `librarian` skill to inspect
it. Docs are at `https://elements.ai-sdk.dev/components/<name>`.
Link the exact docs section from story JSDoc. Adapt only imports, icons, Next
primitives, required a11y names, and preview-frame width; record other changes.

## Known failures

- Cold-cache invalid hooks: add the story-only dependency to both Storybook
  `optimizeDeps.include` and devDependencies.
- TS4023 unnamed inferred meta type: annotate
  `const meta: Meta<typeof Component>`.
- Discriminated-union props collapse to `never`: use
  `StoryObj<typeof Component>`, set the discriminator per story, and disable its
  meta control.
- Known contrast issue #232: spread `contrastKnownIssue232` with a `// #232`
  comment. Do not hide other a11y failures.
- Radix/cmdk false positives may disable only the proven rule with a comment.
  Fix real missing names or keyboard access.
- Story-level a11y rule arrays replace meta arrays. Spread inherited rules when
  adding one.
