# apps/storybook

Dedicated Storybook app: the component workbench and browser interaction/a11y
test host for `@workspace/ui`. Stories themselves stay **co-located next to the
components in `packages/ui/src`** — this package owns only the runtime
(`.storybook/`), the Vitest browser project, and the static build.

## Commands

```bash
pnpm --filter storybook dev              # storybook dev on :6006 (also part of root `pnpm dev`)
pnpm --filter storybook build            # storybook build → storybook-static/
pnpm --filter storybook test:storybook   # vitest browser-mode story tests (needs Playwright chromium)
pnpm --filter storybook test             # node-only guard tests (safe for `turbo run test`)
pnpm --filter storybook lint / typecheck
pnpm test:visual                          # isolated addon integration smoke
```

## Structure

- `.storybook/main.ts` — framework `@storybook/nextjs-vite`; stories glob points at `packages/ui/src`
- `.storybook/preview.tsx` + `preview.css` — theme toolbar/decorator; the CSS entry imports
  `@workspace/ui/globals.css` and adds the `@source` scan for story files
- `.storybook/vitest.setup.ts` — project annotations (a11y `test: "error"`)
- `test/` — plain node tests (run in the `unit` vitest project via the `test` script)
- `packages/storybook-addon-visual-tests` — repo-local visual capture, diff, review, and approval addon

## Gotchas

- **Story Tailwind classes are compiled here, not in the apps.** `packages/ui`'s
  `globals.css` excludes `*.stories.tsx` from its `@source` scan (so app builds
  don't carry story-only utilities); `.storybook/preview.css` re-adds the scan.
  If a story's utility class renders unstyled, that pipeline is the suspect.
- **Turbo hashing is deliberately asymmetric**: `packages/ui/turbo.json` excludes
  stories from `build`/`transit` inputs (story edits must not rebuild web), and
  this package's `turbo.json` folds them back in via `$TURBO_ROOT$` inputs for
  `build` and `test:storybook`. Touch those inputs together or caching goes
  silently wrong in one direction.
- `test:storybook` is a separate task from `test` because it needs Playwright
  browsers; CI runs it in its own job. Keep browser-dependent tests out of the
  plain `test` script.
- Storybook builds against Next's compiler (`@storybook/nextjs-vite`), so this
  package pins the same `next` version as `apps/web` — keep them in lockstep.
- Visual tests run from the **Visual tests** panel in development Storybook.
  Commit `baseline.png` and `baseline.json` under the source-adjacent
  `__screenshots__/<story-file>.visual/<story-id>/<environment>/` directory;
  candidate/diff/result files are transient and ignored. Static builds cannot
  capture or approve because those operations require the dev server.
