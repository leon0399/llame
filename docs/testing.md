# Testing

## Layers

| Layer       | Proves                          | Naming/location                    | Command                              |
| ----------- | ------------------------------- | ---------------------------------- | ------------------------------------ |
| Unit        | pure logic/hooks, no I/O        | co-located `*.test.ts(x)`          | `turbo run test`                     |
| Integration | real Postgres, RLS, queue, HTTP | co-located `*.integration.test.ts` | `pnpm --filter api test:integration` |
| Component   | browser behavior/a11y/visuals   | co-located `*.stories.tsx`         | `pnpm test:component`                |
| Product E2E | full user flow                  | `e2e/<surface>/*.spec.ts`          | `pnpm test:e2e`                      |
| Eval        | model-graded quality            | `apps/api/evals/*.test.ts`         | `pnpm --filter api test:evals`       |

Use unit/integration when a function or repository call proves behavior; use a
story for one browser component and product E2E for a cross-app user flow.
Tooling guards may live in the owning workspace's test directory.

## Rules

1. `*.test.ts(x)` is Vitest everywhere. Only root `e2e/` uses Playwright
   `*.spec.ts`; Nest does not scaffold tests.
2. `.integration` means real Postgres. Plain tests have no external dependency.
3. Integration global setup provisions a non-superuser, schema-owning Postgres
   through Testcontainers, migrates, and provisions RLS. Docker is the only
   prerequisite; `TEST_DATABASE_URL` overrides. Missing DB fails loudly.
4. Test gates are uncached. Unit/Storybook disable Turbo cache; integration,
   eval, and E2E run outside Turbo.
5. Component DOM/interaction assertions belong in story play functions. Keep
   jsdom for headless hooks, Query cache logic, and temporarily containers that
   mock at least three modules, router, or AI streaming; add a one-line reason.
6. Product E2E has one directory per user surface; app tests stay with apps.
7. Tenant tables/endpoints ship datastore and app-layer negative tests.
8. New apps follow the same shape and own integration setup only when they own
   an external dependency.
9. Retry is diagnostic. Playwright retries twice but `failOnFlakyTests` keeps a
   recovered test red. Never fix flakes with wider timeouts/retries.
10. E2E builds and starts production web and rejects occupied ports. Do not turn
    dev compilation races into assertion waits or readiness endpoints.
11. Reject tautologies: mock-return echoes, implementation-derived expected
    values, call-only assertions when effects matter, and snapshots with no
    independent oracle. Mutate the implementation; a green test measured
    nothing.

Importing a constant is valid when asserting an invariant. Recomputing the
implementation from that constant is not. Every wire key, cap, or key factory
needs one literal anchor in its test file; sibling tests may then compose with
the constant.

## Mutation testing

API mutation complements coverage; it covers product source and unit tests, not
Postgres/browser/E2E paths.

```bash
pnpm test:mutation:dry
pnpm test:mutation
```

Stryker uses four workers and pinned
`@stryker-mutator/vitest-runner@9.6.1`; the installed runner keeps each Vitest
worker single-threaded. Reverify concurrency and memory on upgrade. Native HTML
and JSON reports live under ignored `apps/api/reports/mutation/`; do not add a
wrapper/reporter.

CI restores `apps/api/reports/stryker-incremental.json` through the shared
baseline action. PRs restore only; successful `master` pushes publish; weekly
forced runs replace the baseline. Writers share one concurrency group.

## CI mapping

```text
typecheck -+
unit ------+-> build ---------+
           +-> integration ---+-> product e2e
           +-> mutation
           +-> storybook
```

- Lint workflow: Oxlint, formatting, repository anti-slop rules, Markdown.
- Workflow lint: actionlint, zizmor, pinact.
- CI: typecheck; unit/coverage/CRAP; build plus generated-diff check;
  Testcontainers integration; mutation; Storybook; production Playwright.
- Evals never run in CI.

## Tracked follow-ups

- Move story-eligible web component tests under rule 5; delete jsdom coverage
  only after equivalent story assertions exist.
- Remove dead in-file DB guards when touching those suites.
- Enable remaining Vitest style rules one at a time and repair their scope.
