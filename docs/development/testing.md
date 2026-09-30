# Testing

## Layers

| Layer       | Proves                          | Naming/location                    | Command                              |
| ----------- | ------------------------------- | ---------------------------------- | ------------------------------------ |
| Unit        | pure logic/hooks, no I/O        | co-located `*.test.ts(x)`          | `turbo run test`                     |
| Integration | real Postgres, RLS, queue, HTTP | co-located `*.integration.test.ts` | `pnpm --filter api test:integration` |
| Component   | browser behavior/a11y/visuals   | co-located `*.stories.tsx`         | `pnpm --filter <ws> test:stories`    |
| Product E2E | full user flow                  | `e2e/<surface>/*.spec.ts`          | `pnpm test:e2e`                      |
| Eval        | model-graded quality            | `apps/api/evals/*.test.ts`         | `pnpm --filter api test:evals`       |

Component tests are Vitest Browser Mode: `@storybook/addon-vitest` turns each
story into a Chromium test. Stories run from the workspace that authors them:
`packages/ui` and `apps/web` each have a `stories` project
(`pnpm --filter <ws> test:stories`) rendered through apps/storybook's
configuration, so one `test:coverage` run measures a workspace's logic and its
rendered components together. A browser is therefore required for their
`test:coverage` but not for `test`, which runs the `unit` project alone.

Every workspace with tests has a `test:coverage` script that enforces its
coverage ratchet; root `scripts/` uses `pnpm test:scripts:coverage` (Node's
built-in coverage). CI runs only these, never the plain `test` scripts.

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
4. Test gates are uncached. Unit/coverage disable Turbo cache; integration,
   eval, and E2E run outside Turbo.
5. Component DOM/interaction assertions belong in story play functions. Keep
   jsdom for headless hooks, Query cache logic, and temporarily containers that
   mock at least three modules, router, or AI streaming; add a one-line reason.
6. Product E2E has one directory per user surface; app tests stay with apps.
7. Tenant changes ship an RLS cross-tenant integration test and a separate
   app-layer authorization unit test.
8. New apps follow the same shape and own integration setup only when they own
   an external dependency.
9. Retry is diagnostic. In CI, Playwright retries twice and
   `failOnFlakyTests` keeps a recovered test red; local runs use zero retries.
   Never fix flakes with wider timeouts/retries.
10. E2E builds and starts production web and rejects occupied ports. Do not turn
    dev compilation races into assertion waits or readiness endpoints.
11. Reject tautologies: mock-return echoes, implementation-derived expected
    values, call-only assertions when effects matter, and snapshots with no
    independent oracle. Mutate the implementation; a green test measured
    nothing.

Importing a constant is valid when asserting an invariant. Recomputing the
implementation from that constant is not. Every wire key, cap, or key factory
needs one literal anchor in its test file; sibling tests may then compose with
the constant. Iterating an implementation list is tautological only when the
expected values come from that same list.

## Mutation testing

Mutation covers API, config-interpolation and runtime-safety business logic.
Web/UI, tooling, browser, integration, and E2E behavior stay in their existing
gates.

```bash
pnpm test:mutation:dry
pnpm test:mutation
pnpm test:mutation:changed --base origin/master
```

A pull request mutates the lines its diff changed, and every mutant on them
must be detected. `git diff -U0` against the merge base gives the changed lines
per file; only mutant sources contribute, so a range in a test, a fixture, a
migration, a generated artifact or a configuration file selects nothing.
Ranges within three lines of each other merge; a file touched in many places
contributes many ranges and is never collapsed to the whole file, because that
would measure lines the pull request never wrote.
`coverageAnalysis: perTest` then runs only the tests covering each mutant.

The gate is a level over the changed lines: the score across them must reach
80%. A changed line that carries no mutant at all — a declaration, a type-only
expression — passes, because there was nothing for a test to detect. Untouched
legacy debt is never measured, so it cannot fail a pull request, and no prior
measurement, stored index, cache key or environment fingerprint is involved:
the scope is computed from the pull request's own tree and cannot go stale.

What this does not catch: coverage removed without changing a source line. A
diff that only weakens or deletes a test changes no mutant, so review is the
check that sees it. A full-corpus run (`pnpm test:mutation`) is available on a
workstation when a wider measurement is wanted. [The redesign
record](mutation-gate-redesign.md) has the reasoning and the alternative
considered.

A diff with no mutable line in a workspace runs nothing there and passes.
Documentation, frontend, CI wiring, Git ignore rules, lint configuration and
mutation tooling therefore need no mutation execution without being enumerated
as exemptions.

Each package remains runnable directly; reports live under ignored workspace
`reports/` directories. `--workspace packages/runtime-safety` narrows local
execution. Direct `test:mutation` runs report MSI over the whole corpus without
enforcing a threshold. See the [measurements and
alternatives](research/development-pipeline.md).

## CI mapping

```text
typecheck ----> test (one leg per workspace) ----+
typecheck ----> build ---------------------------+-> product e2e
typecheck ----> mutation
```

- Lint workflow: Oxlint, formatting, anti-slop rules, Markdown, OpenAPI, Knip,
  jscpd, and Halstead difficulty.
- Workflow lint: actionlint, zizmor, pinact.
- CI: typecheck; a `test` matrix with one leg per workspace running its
  `test:coverage` (thresholds, and CRAP where the script adds it), with the
  api leg on Testcontainers and the `web`/`ui` legs in the Playwright image;
  build plus generated-diff check; mutation; production Playwright.
- Each test leg uploads its report to Codecov as its own flag;
  `.github/codecov.yml` also groups paths into components by SPEC area.
  Codecov reports trends and pull request deltas; the thresholds stay the gate.
- Evals never run in CI.

## Tracked follow-ups

- Move the remaining story-eligible web component tests under rule 5; delete
  jsdom coverage only after equivalent story assertions exist. Six pairs are
  done (`chat-item`, `effort-selector`, `effective-context-inspector`,
  `tool-cap-notice-part`, `memory-section`, `app-sidebar-admin-entry`); the
  next candidates need a story written first, and `useFileChat` needs a
  preview mock before `chat-item`'s project-filing assertions can move.
- Remove dead in-file DB guards when touching those suites.
- Add CRAP to `packages/ui`'s `test:coverage` once `MessageAttachment`,
  `rewriteChildrenByValue`, `detectPrimaryModifier` and `getTimeOfDay` are
  covered; each scores above 42 with zero coverage.
- Enable remaining Vitest style rules one at a time and repair their scope.
