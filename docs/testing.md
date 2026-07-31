# Testing

How tests are organized across the monorepo: which layer proves what, where a
test lives, what it is named, and what runs it.

## The pyramid

| Layer        | Proves                                                                                                   | Runner                          | Naming / location                                                     | Runs via                                   |
| ------------ | -------------------------------------------------------------------------------------------------------- | ------------------------------- | --------------------------------------------------------------------- | ------------------------------------------ |
| Unit         | pure logic, hooks — no I/O                                                                               | Vitest (node / jsdom)           | `*.test.ts(x)`, co-located next to source                             | `turbo run test` — always, cached          |
| Integration  | anything needing a real Postgres: RLS isolation, queries, queue semantics, the HTTP boundary (supertest) | Vitest (`integration` project)  | `*.integration.test.ts`, co-located next to the owning feature module | `pnpm --filter api test:integration`       |
| UI component | component behavior, interaction, visuals in a real browser                                               | Storybook play fns + storyproof | `*.stories.tsx`, co-located next to the component                     | `turbo run test:storybook`                 |
| Product e2e  | whole-product flows through a user surface (db + api + worker + mock model + client)                     | Playwright                      | `e2e/<surface>/*.spec.ts`; shared boot infra in `e2e/support/`        | root `pnpm test:e2e`                       |
| Evals        | model-graded quality; costs provider spend                                                               | Vitest (`evals` project)        | `apps/api/evals/*.test.ts`                                            | `test:evals` (opt-in, `RUN_MODEL_EVALS=1`) |

Placement rule of thumb: _provable with a function/repo call?_ → unit or
integration. _Needs a browser user?_ → story (one component) or product e2e (a
cross-app flow). Tooling-invariant guards (e.g. the Storybook globals.css
ordering test in `apps/storybook/test/`) are ordinary unit tests owned by the
workspace whose tooling they guard.

## The rules

1. **`*.test.ts(x)` is Vitest, everywhere.** Root `e2e/` is Playwright's
   island and uses its `*.spec.ts` convention; no Vitest glob ever looks
   there. `nest g` is configured (`generateOptions.spec: false`) not to
   scaffold test files.
2. **The `.integration` infix declares "needs a real Postgres".** A plain
   `.test.ts` runs with zero external dependencies, always.
3. **`test:integration` is self-provisioning.** Its globalSetup starts a
   throwaway Postgres via Testcontainers and reproduces the worst-case
   self-hosted topology — a **non-superuser role that owns the schema and runs
   the migrations**, so a green RLS suite proves `FORCE ROW LEVEL SECURITY`
   constrains even the table owner. Docker is the only prerequisite;
   `TEST_DATABASE_URL` overrides with an already-provisioned database
   (`docker/postgres/` initdb scripts show the role model). Nothing
   silently skips: no database means a loud failure, not a green zero-test
   run.
4. **Live-state tasks are never cached.** `test:integration` and `test:evals`
   are `cache: false` in turbo — their outcome depends on state turbo's hash
   cannot see.
5. **Component behavior lives in stories.** Renders + asserts DOM/interaction
   ⇒ a play-function test in the component's `.stories.tsx`. Rubric: leaf
   component with ≤2 module mocks migrates; a container mocking ≥3 modules,
   the router, or the AI SDK streaming hook stays a jsdom `.test.tsx` (with a
   one-line comment) until shared mock-provider decorators exist. Headless
   hooks and React Query cache logic stay jsdom unit tests.
6. **Root `e2e/` is product-level, one subdirectory per user surface**
   (`e2e/web/` today). App-scoped tests never live there.
7. **RLS is an acceptance criterion.** Any new tenant-scoped table or endpoint
   ships a `*-rls.integration.test.ts` next to its feature module with a
   cross-tenant negative case (AGENTS.md § Security). App-layer authorization
   gets its own unit test — the two prove different layers.
8. **A new app inherits the same shape**: co-located unit tests; its own
   `test:integration` (cache: false, self-provisioning) if it ever owns an
   external dependency (today only apps/api owns a datastore — SPEC §22.0);
   `e2e/<surface>/` for its product flows.

## Commands

```bash
turbo run test                       # unit everywhere — no DB, no docker, cached
pnpm --filter api test:integration   # self-provisions Postgres (docker); TEST_DATABASE_URL overrides
pnpm test:e2e                        # Playwright product suite (boots everything)
turbo run test:storybook             # browser component tests (needs Playwright browsers)
pnpm --filter api test:evals         # opt-in, model-graded — bring POSTGRES_URL + credentials
```

## CI mapping

- **checks** — lint, typecheck, format, build, `turbo run test` (unit only).
- **rls** — `pnpm --filter api test:integration` (self-provisioned worst-case-owner Postgres).
- **browser-e2e** — root Playwright suite, the only place it runs.
- **storybook** — `test:storybook` + static build.
- Evals never run in CI.

## Follow-ups (deliberate, not forgotten)

- Migrate the story-eligible `apps/web` component tests per rule 5's rubric
  (low-friction first: compaction-boundary, effective-context-inspector,
  admin-section-nav, …; mixed files split pure/render first). Delete a jsdom
  test only after its story covers the same assertions.
- Replace `chat-page.hydration.test.ts` (regex over its own source text) with
  behavioral coverage.
- The in-file `describeIfDb`-style guards inside integration suites are dead
  code now that the globalSetup guarantees the env — remove them when touching
  each suite.
- The four disabled `vitest/*` style rules in `apps/api/.oxlintrc.json` are a
  ratchet: flip one to "error" and fix its findings when touching the affected
  suites.
- Consolidate model test doubles onto the AI SDK's official `ai/test`
  utilities: `run-execution-tools.integration.test.ts` and
  `reasoning-loop.integration.test.ts` already show the right pattern (REAL
  `streamText` over a scripted `MockLanguageModelV3` + `simulateReadableStream`),
  while 16 sites across 8 files still forge the streamText _result_ via
  `as unknown as ReturnType<typeof streamText>` casts — lower fidelity (the
  real AI SDK loop is bypassed) and brittle across `ai` upgrades. Migrate
  `fake-model-client.ts`, `src/testing/support.ts`'s FakeModelsService, and
  `worker-harness.ts`'s HarnessModelClient to build on the official mocks.
  The HTTP-level `e2e/support/model-server.ts` stays — product e2e needs an
  OpenAI-protocol endpoint, which `ai/test` deliberately does not provide.
