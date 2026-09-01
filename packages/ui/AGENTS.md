# packages/ui

Shared `@workspace/ui` shadcn library.

## Ownership

| Path                          | Owner                       | Update path                                                     |
| ----------------------------- | --------------------------- | --------------------------------------------------------------- |
| `src/components/`             | shadcn base-nova primitives | `pnpm dlx shadcn@latest add <name> -c packages/ui`              |
| `src/components/ai-elements/` | AI Elements registry        | `pnpm dlx shadcn@latest add @ai-elements/<name> -c packages/ui` |
| `src/components/custom/`      | llame                       | edit directly; never generate here                              |

Keep registry outputs separated because regeneration overwrites their paths.
Import any tier through `@workspace/ui/components/...`. App-wired compositions
belong in the app.

## Vendored components and stories

After generation, restore the minimal component and prop JSDoc consumed by the
Storybook AI manifest. Regeneration overwrites this intentional fork, so diff
and restore it during upgrades.

Stories are the component behavior/a11y/visual test layer. Read
[`.claude/rules/stories.md`](../../.claude/rules/stories.md) before editing one;
it owns structure, provenance tags, manifest rules, upstream transcription, and
failure handling.

Two local traps remain:

- Agents tag every story they author `"ai-generated"` and never remove that
  tag; only a human may signal human authorship by omitting/removing it.
- A story-only dependency needs both `optimizeDeps.include` in Storybook
  `main.ts` and an `apps/storybook` devDependency.

## Other traps

- Theme and `src/styles/globals.css` live here; apps must not redeclare them.
- UI excludes stories from Tailwind and app-build hashes; Storybook restores
  both. Change the paired exclusions/includes together.
- Prefer composition over editing generated primitives. Component/prop JSDoc is
  the expected exception.
