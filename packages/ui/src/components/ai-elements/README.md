# ai-elements/

Vercel **AI Elements** — AI-native building blocks (Conversation, Message,
Response, Reasoning, Tool, Prompt Input, …) vendored from the `@ai-elements`
shadcn registry. Built on top of the shadcn/ui primitives in the parent
directory; our theme/tokens apply automatically.

**CLI-owned, regenerable — do not hand-author here.** Add or update a component
with the shadcn CLI, targeting this package:

```bash
pnpm dlx shadcn@latest add @ai-elements/message -c packages/ui
```

The `@ai-elements` registry is configured in `packages/ui/components.json`
(`registries` → `https://registry.ai-sdk.dev/{name}.json`); registry items
carry their own `ai-elements/` subpath, so they land here via the `components`
alias. Re-running `add --overwrite` replaces the file, so keep customizations
minimal (a light JSDoc fork for the Storybook manifest is the one expected
deviation, same as the shadcn primitives — see the package `AGENTS.md`).

Hand-authored, non-registry components live in `../custom/`, and the shadcn
base-nova primitives sit flat in `../`.
