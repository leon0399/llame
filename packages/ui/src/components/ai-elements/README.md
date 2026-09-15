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

## Local divergences beyond the JSDoc fork

Three files carry behavioral edits, because lint rules this repository enables
at error fire inside the registry source and no wrapper can fix a violation in
a file it merely renders. Diff and re-apply these on upgrade:

- `shimmer.tsx` — `motion.create()` moved out of render into a module-scope
  table, and the gradient moved from an inline `backgroundImage` to a class.
  Building a motion component during render remounts the element and restarts
  the sweep on every pass, so this is also a bug fix. Narrows `as` to the
  exported `ShimmerTag` union, since the renderable set has to be closed.
- `reasoning.tsx` — the streaming start time is a `useRef` rather than state.
  Only the derived duration is ever rendered, so this removes a
  `set-state-in-effect` without changing what the trigger reads.
- `tool.tsx` — the five raw-palette status colors are value contrast plus
  `text-destructive` on error, which `DESIGN.md` §2 requires. Per-state icons
  are unchanged, so the states stay distinguishable without hue.

Hand-authored, non-registry components live in `../custom/`, and the shadcn
base-nova primitives sit flat in `../`.
