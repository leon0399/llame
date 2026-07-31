# Testing

How tests are organized across the monorepo: which layer proves what, where a
test lives, what it is named, and what runs it. The naming contract is enforced
by `scripts/check-test-naming.mjs` (CI checks job + lefthook pre-commit), so a
misnamed file fails loudly instead of being silently ignored by a runner's
include glob.

## The pyramid

| Layer          | Proves                                                                               | Runner                             | Naming                    | Lives                                                                                           | Runs via                                     |
| -------------- | ------------------------------------------------------------------------------------ | ---------------------------------- | ------------------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------- |
| Unit           | pure logic, no I/O                                                                   | Vitest (node / jsdom)              | `*.test.ts(x)`            | co-located next to source                                                                       | `turbo run test` (always, cached)            |
| DB integration | RLS isolation, queries, queue semantics against a real Postgres                      | Vitest (`integration` project)     | `*.integration.test.ts`   | co-located next to the feature module that owns the behavior                                    | `test:integration` (explicit, no DB ⇒ FAILS) |
| App e2e        | one app's boundary contract (HTTP via supertest) against a real Postgres             | Vitest (`e2e` project, sequential) | `<app>/e2e/*.test.ts`     | `apps/api/e2e/`                                                                                 | api `test:e2e` (explicit, no DB ⇒ FAILS)     |
| UI component   | component behavior, interaction, visuals in a real browser                           | Storybook play fns + storyproof    | `*.stories.tsx`           | co-located next to the component (packages/ui, apps/web)                                        | `turbo run test:storybook`                   |
| Product e2e    | whole-product flows through a user surface (db + api + worker + mock model + client) | Playwright                         | `e2e/<surface>/*.spec.ts` | root `e2e/web/` today; `e2e/<surface>/` per future surface; shared boot infra in `e2e/support/` | root `test:e2e`                              |
| Evals          | model-graded quality; costs provider spend                                           | Vitest (`evals` project)           | `<app>/evals/*.test.ts`   | `apps/api/evals/`                                                                               | `test:evals` (opt-in, `RUN_MODEL_EVALS=1`)   |

Tooling-invariant tests (guards on a tool's own config, e.g. the Storybook
globals.css ordering guard in `apps/storybook/test/`) are ordinary unit tests
owned by the workspace whose tooling they guard — the one sanctioned exception
to co-location, since a config invariant has no single source file to sit next
to.

## The rules

1. **Suffix + directory identify the runner.** `*.test.ts(x)` is Vitest,
   everywhere. `*.spec.ts` is Playwright and exists only under the root `e2e/`
   tree. Nothing else — `.e2e-spec.ts` and Vitest-run `.spec.ts` are retired.
   (NestJS scaffolding note: `nest g` emits `.spec.ts` files — rename them, the
   guard catches forgetting.)
2. **Infix declares the dependency.** A plain `.test.ts` runs with zero
   external dependencies, always. `.integration.test.ts` declares "needs a real
   Postgres". Directory declares e2e (`apps/api/e2e/`, root `e2e/`).
3. **No silent skips.** A suite that cannot reach its declared dependency fails
   with instructions — it never green-skips to zero tests. Local zero-dep runs
   come from task selection (`test` vs `test:integration`), not runtime
   skipping. The only sanctioned gate is the evals opt-in (`RUN_MODEL_EVALS`),
   which guards spend, not a missing dependency.
4. **Never cache a test that talks to live state.** `test:integration`,
   `test:e2e`, and `test:evals` are `cache: false` in turbo — their outcome
   depends on database and model state turbo's hash cannot see, and a stale
   cached PASS is worse than the silent skip this setup killed.
5. **Component behavior lives in stories.** A test that renders a component and
   asserts DOM or interaction belongs in the component's `.stories.tsx` as a
   play-function test (real browser, a11y addon, visual snapshot for free).
   Rubric: a leaf/presentational component with ≤2 module mocks migrates; a
   container mocking ≥3 modules, the router, or the AI SDK streaming hook stays
   a jsdom `.test.tsx` until shared mock-provider decorators exist — with a
   one-line comment saying so.
6. **Pure logic and headless hooks stay unit.** `renderHook`, React Query cache
   logic, and provider state machines are jsdom unit tests; stories are a poor
   fit for headless logic.
7. **Root `e2e/` is product-level, one subdirectory per user surface.** A
   surface without a browser still lands here (Playwright drives HTTP/APIs
   too). App-scoped tests never do — an app's boundary contract lives in that
   app (`apps/api/e2e/`).
8. **RLS tests are integration tests, named `*-rls.integration.test.ts`, next
   to the feature module** (`src/chats/chats-rls.integration.test.ts`) — never
   next to `src/db/schema/`. Any new tenant-scoped table or endpoint ships one
   with a cross-tenant negative case; that is an acceptance criterion
   (AGENTS.md § Security), not a follow-up. Authorization enforced in app code
   gets a unit test too — the two prove different layers.
9. **A new app inherits the same shape.** Co-located unit tests from day one;
   `.integration.test.ts` + its own `test:integration` (cache: false) if it
   ever owns an external dependency (today only apps/api owns a datastore —
   SPEC §22.0); `<app>/e2e/` for its boundary contract; `e2e/<surface>/` for
   its product flows.

## Commands

```bash
turbo run test                       # unit everywhere — no DB, no docker, cached
pnpm --filter api test:integration   # needs TEST_DATABASE_URL (fails loudly without)
pnpm --filter api test:e2e           # needs POSTGRES_URL (fails loudly without)
bash apps/api/scripts/rls-test.sh    # provisions worst-case-owner throwaway PG, runs both of the above
pnpm test:e2e                        # Playwright product suite (boots everything)
turbo run test:storybook             # browser component tests (needs Playwright browsers)
pnpm --filter api test:evals         # opt-in, model-graded, costs provider spend
```

Against the dev database:
`pnpm db:up && TEST_DATABASE_URL=postgres://app:app@localhost:5432/llame pnpm --filter api test:integration`
— fine for iteration; the RLS gate that counts is `rls-test.sh` (worst-case
single-role owner + FORCE), which CI runs on every PR.

## CI mapping

- **checks** — naming guard, lint, typecheck, format, build, `turbo run test`
  (unit only; nothing in it can silently skip).
- **rls** — `rls-test.sh`: throwaway Postgres, migrations as the owning
  non-superuser role, `test:integration` + api `test:e2e`.
- **browser-e2e** — root Playwright suite, the only place it runs.
- **storybook** — `test:storybook` + static build.
- Evals never run in CI; they are a manual, spend-gated tool.

## Follow-ups (deliberate, not forgotten)

- Migrate the story-eligible `apps/web` component tests per rule 5's rubric
  (low-friction first: compaction-boundary, effective-context-inspector,
  admin-section-nav, …; mixed files split pure/render first). Delete a jsdom
  test only after its story covers the same assertions.
- Replace `chat-page.hydration.test.ts` (regex over its own source text) with
  behavioral coverage.
- The in-file `describeIfDb`-style guards inside integration suites are dead
  code now that the project setup guarantees the env — remove them when
  touching each suite.
- The four disabled `vitest/*` style rules in `apps/api/.oxlintrc.json` are a
  ratchet: flip one on and fix its findings when touching the affected suites.
