# apps/storybook

Dedicated Storybook app: the component workbench and browser interaction/a11y
test host for `@workspace/ui`. Stories themselves stay **co-located next to the
components in `packages/ui/src`** — this package owns only the runtime
(`.storybook/`), the Vitest browser project, and the static build.

## Commands

```bash
pnpm --filter storybook dev              # storybook dev on :6006 (also part of root `pnpm dev`)
pnpm --filter storybook build            # storybook build → storybook-static/
pnpm --filter storybook test:component   # vitest browser-mode story tests (needs Playwright chromium)
pnpm --filter storybook test             # node-only guard tests (safe for `turbo run test`)
pnpm --filter storybook lint / typecheck
```

## Structure

- `.storybook/main.ts` — framework `@storybook/nextjs-vite`; stories glob points at `packages/ui/src`
- `.storybook/preview.tsx` + `preview.css` — theme toolbar/decorator; the CSS entry imports
  `@workspace/ui/globals.css` and adds the `@source` scan for story files
- `.storybook/vitest.setup.ts` — project annotations (a11y `test: "error"`)
- `test/` — plain node tests (run in the `unit` vitest project via the `test` script); this is the sanctioned home for tooling-invariant guards (config ordering, addon wiring) that have no source file to co-locate with (docs/testing.md)
- Visual testing comes from the external [`storyproof`](https://github.com/leon0399/storyproof)
  npm package (registered as `storyproof/preset` in `.storybook/main.ts`) — it
  no longer lives in this repo; see that repo for its own source and package
  changelog.

## Gotchas

- **Story Tailwind classes are compiled here, not in the apps.** `packages/ui`'s
  `globals.css` excludes `*.stories.tsx` from its `@source` scan (so app builds
  don't carry story-only utilities); `.storybook/preview.css` re-adds the scan.
  If a story's utility class renders unstyled, that pipeline is the suspect.
- **Turbo hashing is deliberately asymmetric**: `packages/ui/turbo.json` excludes
  stories from `build`/`transit` inputs (story edits must not rebuild web), and
  this package's `turbo.json` folds them back in via `$TURBO_ROOT$` inputs for
  `build` and `test:component`. Touch those inputs together or caching goes
  silently wrong in one direction.
- `test:component` is a separate task from `test` because it needs Playwright
  browsers; CI runs it in its own job. Keep browser-dependent tests out of the
  plain `test` script.
- Storybook builds against Next's compiler (`@storybook/nextjs-vite`), so this
  package pins the same `next` version as `apps/web` — keep them in lockstep.
- Visual tests run from the **Visual tests** panel in development Storybook
  (installed from the `storyproof` package). Baselines still commit
  source-adjacent in _this_ repo, under
  `__screenshots__/<story-file>.visual/<story-id>/<environment>/` —
  `baseline.png` and `baseline.json`; candidate/diff/result files are
  transient and ignored. Static builds cannot capture or approve because
  those operations require the dev server.
