# ai-elements/

AI-native building blocks for the chat transcript (Conversation, Message,
Response, Reasoning, Tool, Chain of Thought, …). Built on top of the shadcn/ui
primitives in the parent directory; our theme/tokens apply automatically.

Two generations live here:

- **Rebuilt on shadcn/ui `Trace`**: `tool.tsx`, `reasoning.tsx`,
  `reasoning-content.tsx`, and `chain-of-thought.tsx`. shadcn/ui replaced the
  AI Elements registry with [patterns](https://ui.shadcn.com/docs/ai-elements)
  that are copied, not installed, so these files are hand-maintained. `tool`
  and `reasoning` keep the exports and props of the registry files they
  replace; `chain-of-thought` folds a run of them behind one summary line.
- **Still vendored from the `@ai-elements` registry**: every other file.

The rest of this page is about the vendored files.

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

## Local divergences beyond the JSDoc fork

Two files carry behavioral edits, because lint rules this repository enables
at error fire inside the registry source and no wrapper can fix a violation in
a file it merely renders. Diff and re-apply these on upgrade:

- `shimmer.tsx` — `motion.create()` moved out of render into a module-scope
  table, and the gradient moved from an inline `backgroundImage` to a class.
  Building a motion component during render remounts the element and restarts
  the sweep on every pass, so this is also a bug fix. Narrows `as` to the
  exported `ShimmerTag` union, since the renderable set has to be closed.

`../trace.tsx` carries one edit of its own: `TraceDescription` uses
`text-muted-foreground` rather than upstream's 70% tint, which fails AA
contrast on the page background.

Hand-authored, non-registry components live in `../custom/`, and the shadcn
base-nova primitives sit flat in `../`.
