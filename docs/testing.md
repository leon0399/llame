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

Mutation covers API, config-interpolation and runtime-safety business logic. Web/UI, tooling,
browser, integration, and E2E behavior stay in their existing gates.

```bash
pnpm test:mutation:dry
pnpm test:mutation
pnpm test:mutation:changed --base origin/master
```

A mutation scope is the changed mutant source files plus every mutant file
covered by a changed test file, resolved from the baseline's per-test coverage.
Weakening or deleting an indexed test still selects the sources it covered.
A changed test the baseline does not credit — a test the pull request adds, or
one the mutation run never executes, such as an integration test the runner
excludes — contributes nothing and is skipped: it flips no mutant the baseline
measured, so it cannot gain an undetected mutant. A missing baseline, an index
that measured no mutants, a recognized fixture/test double, deleted or
excluded source, or runtime configuration change makes the delta unavailable.
A migration is skipped for the same reason a changed test the index does not
credit is: it flips no mutant, so it cannot gain an undetected mutant, and only
a trusted run writes the index that bounding it would require.
Shared runtime dependencies have unbounded API impact; their test files do not,
because package builds exclude tests. Unknown root inputs make every workspace
delta unavailable. PR and master CI fail before mutation execution in these
cases; they never substitute a full-corpus sweep.

Documentation/frontend changes, CI wiring, Git ignore rules, mutation tooling,
lint/format configuration and Stryker configuration skip mutation execution.
Lint and format configuration is exempt in both the scope and the environment
fingerprint — markdownlint, oxlint and Prettier read source text and never run
during a test, so no mutant's status can depend on them, and a root-level file
would otherwise make every workspace's delta unavailable at once. Package
manifest edits skip only when their changes are limited to `test:mutation`
command keys. Runtime dependencies and other command changes do not qualify. CI
wiring, Git ignore rules and lint/format configuration do not invalidate an
index; mutation engine/configuration changes still can. Their own checks run in
CI. Local changed mode also includes tracked working-tree and untracked edits;
a missing base ref fails.

The gate is a delta, not a level: a run fails when a source file it measured
gains undetected mutants (survived or uncovered) against the baseline, so
editing one line of a legacy file does not fail a pull request for pre-existing
debt. In a scoped run, files with no baseline entry have no allowance.
A missing or incompatible baseline is a failed evidence check, not a passing
mutation result. Restore or generate a compatible trusted baseline, or update
the PR to a revision it covers.

Unbounded-impact changes need an explicitly approved bypass; CI does not waive
the requirement automatically. The bypass is the `mutation-bypass` label on the
pull request. Applying a label needs write access, so only an operator can
grant it, and a push event carries no labels, so master still fails on missing
evidence. `mutation-plan` passes `--bypass` to the plan, which resolves each
unbounded workspace to `skip`, schedules no shards for it, and emits a
`::warning` annotation naming every input the waiver left unmeasured — the
waiver is recorded on the run rather than silent. A waived merge still changes
master's environment fingerprint, so follow it with a
`mutation-baseline.yml` dispatch to rebuild the index.
Full-corpus mutation runs are explicit scheduled/manual work and report MSI
without enforcing a score threshold.

Each workspace's baseline is a merged index
(`<workspace>/reports/mutation-baseline.json`): the API writes it from its shard
reports, a package from its own single report. The index records the measured
Git revision. Scoped refreshes retain unmeasured files and accumulate coverage,
so a narrower run cannot erase previously observed reachability. Full refreshes
replace the index, removing deleted paths and their old mutant allowances.
The plan restores the index under an environment fingerprint covering fixtures,
excluded inputs and transitive runtime dependencies. Dependency test files and
Drizzle migrations are not fingerprint inputs: neither changes which mutants
exist or which test reports covering one, and a scoped run re-measures its files
against the checked-out schema. Each gate downloads the plan's immutable index
artifact, so a concurrent master run cannot change its comparison baseline.
An index must come from an ancestor of the checked-out revision; future or
unrelated indexes cannot supply a PR allowance.

A trusted scoped run folds its reports in once its delta gate passes. A
scheduled/manual full run refreshes the baseline as the trend's measurement.
A pull request folds nothing, so it is measured against master rather than its
own earlier pushes. Master plans resume from each
workspace's last measured revision (`--from-baseline`), including changes from
cancelled or failed predecessor runs. Trusted API restore/fold/save jobs are
serialized across CI and weekly refresh; a late ancestor measurement cannot
overwrite a descendant's index.
Without a usable index, master first checks its event diff: tooling-only changes
can skip, but a mutation-relevant change fails for missing evidence.
After a mutation engine/configuration change invalidates the index, dispatch
`mutation-baseline.yml` on trusted master before the next business-code PR.
If a weekly sweep finishes after a newer master measurement, its score is still
published, but the older index is not folded; the refresh log names the retained
revision.

CI assigns API files heaviest-first using measured mutant counts, with at most
eight runners. A scoped run sizes its pool by its share of the cached corpus,
using one full-run shard's average workload as the target. Small diffs share one
runner instead of repeating dependency builds and checker startup per file.
Explicit full runs retain eight slots; without measurements they balance by file count.
Mutant counts estimate work, not duration: test costs can still differ.
The weekly sweep retests every mutant (`--force`) and reports global MSI.
Failed selected shards, missing or malformed reports, and unfinished mutant
statuses fail the aggregate.

Each package remains runnable directly; reports live under ignored workspace
`reports/` directories. Add `--dryRunOnly` to the changed command to exercise
selection and initial tests. `--workspace packages/runtime-safety` narrows local
execution explicitly. See the [measurements and alternatives](research/development-pipeline.md).
Direct `test:mutation` runs report MSI without enforcing a score threshold.

## CI mapping

```text
typecheck ----> integration ----------------+
typecheck + unit ----> build ----------------+-> product e2e
typecheck + unit + mutation scope -> mutation
typecheck + unit ----> storybook
```

- Lint workflow: Oxlint, formatting, anti-slop rules, Markdown, OpenAPI, Knip,
  jscpd, and Halstead difficulty.
- Workflow lint: actionlint, zizmor, pinact.
- CI: typecheck; unit/coverage/CRAP; build plus generated-diff check;
  Testcontainers integration; mutation; Storybook; production Playwright.
- Evals never run in CI.

## Tracked follow-ups

- Move story-eligible web component tests under rule 5; delete jsdom coverage
  only after equivalent story assertions exist.
- Remove dead in-file DB guards when touching those suites.
- Enable remaining Vitest style rules one at a time and repair their scope.
