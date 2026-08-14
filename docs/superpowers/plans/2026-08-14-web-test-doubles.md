# Web Test-Double Migration Plan

**Status:** Implemented locally; pending stacked PR submission.

**Goal:** Remove all 19 `as unknown as` assertions from `apps/web` without
replacing them with weaker casts, bespoke helpers, or narrower behavior checks.

**Approach:** Use the existing standard test/runtime surfaces:

- typed `vi.fn<typeof fetch>()`, `vi.stubGlobal`, real `Response`, and
  `vi.spyOn` for HTTP behavior;
- `vi.stubGlobal` with the native `ResizeObserver` signatures for jsdom gaps;
- `vi.mocked` against real module specifiers plus explicit stable manual-mock
  spies for Storybook controls.

The component and story behavior stays unchanged. Manual-mock control values are
injected through the redirected hook return so the rendered component and story
assertions observe the same spy instance.

## Acceptance

- [x] `rg -n 'as\s+unknown\s+as' apps/web` returns no matches.
- [x] `pnpm --filter web test` passes: 50 files, 340 tests.
- [x] `pnpm --filter web typecheck` passes.
- [x] `pnpm --filter web lint` passes.
- [x] `pnpm --filter storybook test:storybook` passes: 61 files, 300 tests.
- [x] Prettier and `git diff --check` pass.
- [x] Independent specification and quality reviews approve the slice.

The Storybook browser command requires permission to bind localhost in the
sandbox; its first restricted run failed with `listen EPERM`, and the identical
command passed once that environment permission was granted.
