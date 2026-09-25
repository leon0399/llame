# apps/storybook

Storybook runtime for stories co-located in `packages/ui/src` and `apps/web`.
This workspace owns `.storybook/` and the static build; it does not own
component stories. Each story-owning workspace runs its stories in Chromium
through this configuration from its own `stories` Vitest project, so their
coverage counts toward that workspace.

## Commands

```bash
pnpm --filter storybook dev
pnpm --filter storybook build
pnpm --filter storybook test           # node-only tooling guards
pnpm --filter storybook test:coverage
pnpm --filter @workspace/ui test:stories # Playwright Chromium required
pnpm --filter storybook lint
pnpm --filter storybook typecheck
```

## Boundaries

- `.storybook/main.ts`: `@storybook/nextjs-vite`, addon wiring, and the
  `packages/ui/src` plus `apps/web` story globs.
- `.storybook/preview.tsx`, `preview.css`: theme and Tailwind story-source scan.
- `.storybook/vitest.setup.ts`: browser annotations; a11y failures are errors.
- `test/`: node-only tooling guards with no co-locatable source owner.
- Visual testing comes from `storyproof/preset`. Baselines live beside source
  under `__screenshots__/<story-file>.visual/<story-id>/<environment>/`;
  candidates and diffs are ignored.

## Traps

- `packages/ui/src/styles/globals.css` excludes stories; `preview.css` restores their
  Tailwind scan. Keep that paired with the inverse Turbo inputs: UI excludes
  stories from app builds, Storybook includes them in `build`.
- Keep story projects out of each workspace's plain `test`; only
  `test:stories` and `test:coverage` may require a browser.
- Pin the same Next version as `apps/web`.
- Capture and approval require the development server; static builds cannot do
  either.
