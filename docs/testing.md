# Testing

How tests are organized across the monorepo: which layer proves what, where a
test lives, what it is named, and what runs it.

## The pyramid

| Layer        | Proves                                                                                                   | Runner                          | Naming / location                                                     | Runs via                                   |
| ------------ | -------------------------------------------------------------------------------------------------------- | ------------------------------- | --------------------------------------------------------------------- | ------------------------------------------ |
| Unit         | pure logic, hooks — no I/O                                                                               | Vitest (node / jsdom)           | `*.test.ts(x)`, co-located next to source                             | `turbo run test` — always, uncached        |
| Integration  | anything needing a real Postgres: RLS isolation, queries, queue semantics, the HTTP boundary (supertest) | Vitest (`integration` project)  | `*.integration.test.ts`, co-located next to the owning feature module | `pnpm --filter api test:integration`       |
| UI component | component behavior, interaction, visuals in a real browser                                               | Storybook play fns + storyproof | `*.stories.tsx`, co-located next to the component                     | `turbo run test:component`                 |
| Product e2e  | whole-product flows through a user surface (db + api + worker + mock model + client)                     | Playwright                      | `e2e/<surface>/*.spec.ts`; shared boot infra in `e2e/support/`        | root `pnpm test:e2e`                       |
| Evals        | model-graded quality; costs provider spend                                                               | Vitest (integration project)    | `apps/api/evals/*.test.ts`                                            | `test:evals` (opt-in, `RUN_MODEL_EVALS=1`) |

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
4. **Test gates are never cached.** `test` and `test:component` set
   `cache: false` in Turbo; `test:integration`, `test:evals`, and product e2e
   run directly outside Turbo. Their outcomes can depend on state Turbo's hash
   cannot see, and a cached success would hide a later failure.
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
   direct, uncached, self-provisioning `test:integration` command if it owns an
   external dependency (today only apps/api owns a datastore — SPEC §22.0);
   `e2e/<surface>/` for its product flows.
9. **A retry is diagnostic evidence, not a pass.** Product e2e keeps two CI
   retries so Playwright can capture the failure and compare a warm retry, but
   `failOnFlakyTests` makes any recovered test fail the job. Do not normalize
   timing regressions into green CI by widening timeouts or adding retries.
10. **Product behavior runs behind a production-ready web boundary.**
    Playwright builds `apps/web` with the E2E API URL and admits `next start`
    before tests begin. It also rejects occupied E2E service ports instead of
    reusing processes whose code and configuration are unknown. Dev compiler
    latency and hot-reload DOM churn are not product behavior; do not move
    those races into assertion timeouts or a bespoke readiness endpoint.
11. **Tautological tests considered harmful.** A test that cannot fail is worse
    than no test: it reports coverage it does not have, and the next person
    trusts it. The recurring shapes are asserting that a mock returns what the
    same test configured it to return; recomputing the expected value with the
    implementation's own expression instead of an independently known one;
    letting `toHaveBeenCalled()` stand in for the behavior the call was supposed
    to produce; and recording a snapshot of current output with no independent
    notion of correct. The check is mechanical — **break the implementation and
    re-run**. Still green against a deliberately wrong version means the test
    measured nothing; that is exactly the property the
    [mutation pilot](#api-mutation-testing-pilot-diagnostic) samples on the
    modules it covers. Assert observable behavior at a real seam, against a
    value derived independently of the code under test.

### The invariant-vs-recompute line (rule 11)

Importing a constant into a test is not itself the problem — what matters is what
the assertion does with it.

Stating an **invariant** over a constant is real:
`expect(chunk.length).toBeLessThanOrEqual(CHUNK_MAX_CHARS)` holds at any bound and
still catches a chunker that overshoots.

**Recomputing the implementation's own derivation** is not:
`toBe(Math.floor(window * COMPACTION_WINDOW_RATIO))` moves both sides together,
so any ratio ships green. Iterating the implementation's own list is
tautological only when the expectation is derived from that same list; a loop
with independent per-item expectations is a valid invariant test.

A key factory, a cap, or a wire-format constant needs one **literal anchor**
somewhere in its test file (`expect(pinQueryKeys.all).toEqual(["pins"])`). Given
that anchor, other tests in the file may compose with the constant freely.

## Commands

```bash
turbo run test                       # unit everywhere — no DB, no docker, uncached
pnpm --filter api test:integration   # self-provisions Postgres (docker); TEST_DATABASE_URL overrides
pnpm test:e2e                        # Playwright product suite (boots everything)
turbo run test:component             # browser component tests (needs Playwright browsers)
pnpm --filter api test:evals         # opt-in, model-graded — bring model credentials; DB self-provisions (TEST_DATABASE_URL overrides)
```

## API mutation-testing pilot (diagnostic)

Mutation testing is a bounded diagnostic follow-up to direct unit tests. It is
not a coverage substitute and is not a CI gate. This pilot is API-only; it does
not add mutation testing to the monorepo pyramid or apply it to integration,
Docker, browser, or product-e2e suites.

Run the exact commands in the foreground:

```bash
pnpm --filter api test:mutation:dry
pnpm --filter api test:mutation
```

The scope is exactly three pure MCP production modules and their direct unit
tests: `tool-id.ts` / `tool-id.test.ts`, `protected-values.ts` /
`protected-values.test.ts`, and `mcp-bounded-fetch.ts` /
`mcp-bounded-fetch.test.ts`. Stryker runs one worker (`concurrency: 1`). The
repository pins `@stryker-mutator/vitest-runner@9.6.1` in the package and
lockfile; its installed 9.6.1 runner source's runtime options force
`maxThreads`, `maxWorkers`, and `maxConcurrency` to 1. This pin plus installed
source is repo-reproducible evidence. Do not increase concurrency without new
measured peak-memory evidence; any runner upgrade must reverify those three
options and the peak-memory budget. The native clear-text summary is emitted by
the foreground command. Native HTML and JSON reports are written to
`apps/api/reports/mutation/mutation.html` and
`apps/api/reports/mutation/mutation.json` under the ignored
`apps/api/reports/mutation/` directory. Do not add a bespoke wrapper, reporter,
checker, or CI threshold gate.

The 2026-08-15 baseline is 2:30.62 wall time, 250388 kB peak RSS, and a 69.41%
mutation score across 425 mutants. Full Stryker opens an internal logging server
with Node `listen`; a restricted sandbox may need narrowly scoped network
permission for that local bind. This does not mean the product or tests need
external network access, and the dry run may not hit the logging server. See
the [tracker baseline and provenance](code-quality-tracker.md#mutation-testing-pilot-baseline-2026-08-15)
for the measured counts and source of each observation.

## CI mapping

Three test-pipeline workflows, one job per concern (`.github/workflows/` —
`git-ai.yaml`, a merge-time automation helper, sits outside this pyramid):

**Lint** — source checks, independent of everything, so they report in seconds:

- **Lint** — `turbo run lint` (including the root E2E Oxlint task, three
  zero-baseline anti-slop rules, and unused-disable rejection in every Oxlint
  workspace) · **Format** — `format:check`
- **Structural lint** — `pnpm lint:ast-grep` (native ast-grep enforcement for
  the constructor-decorator placement convention)
- **Markdown lint** — `pnpm lint:markdown` (semantic Markdown rules across the
  product-owned documentation tree)

**Workflow lint** — the pipeline checks itself:

- **actionlint** (syntax + shellcheck, official container pinned by image digest)
- **zizmor** (security posture, SARIF to the Security tab)
- **pinact** (validate-only: every action ref must be a full commit SHA)

**CI** — the pyramid as a job graph, each layer gated on the cheaper layer
that would catch the same breakage:

```text
typecheck ─┐
unit ──────┼─→ build ───────────┐
           ├─→ integration ─────┴─→ browser-e2e
           └─→ storybook        (component tests, real browser)
```

- **Typecheck** / **Unit tests** — cheap gates, run unconditionally in parallel
- **Build** — `turbo run build` + a `git diff --exit-code` drift check
- **Integration tests (real Postgres)** — the RLS gate; self-provisions via Testcontainers
- **Component tests (Storybook)** — runs in the Playwright image (browser preinstalled)
- **Product e2e (Playwright)** — builds/starts the production web app and is
  the only place the browser suite runs
- Evals never run in CI.

## Follow-ups (deliberate, not forgotten)

- Migrate the story-eligible `apps/web` component tests per rule 5's rubric
  (low-friction first: compaction-boundary, effective-context-inspector,
  admin-section-nav, …; mixed files split pure/render first). Delete a jsdom
  test only after its story covers the same assertions.
- The in-file `describeIfDb`-style guards inside integration suites are dead
  code now that the globalSetup guarantees the env — remove them when touching
  each suite.
- The four disabled `vitest/*` style rules in `apps/api/.oxlintrc.json` are a
  ratchet: flip one to "error" and fix its findings when touching the affected
  suites.
