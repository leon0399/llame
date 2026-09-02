# Global mutation testing

## Goal

Run mutation testing against every production TypeScript file and every unit
test in each applicable workspace. Keep commands package-owned and keep CI
runtime bounded.

## Scope

| Workspace                          | Mutated code          | Tests            |
| ---------------------------------- | --------------------- | ---------------- |
| `apps/api`                         | all production `src`  | all unit tests   |
| `apps/web`                         | production TS and TSX | all Vitest tests |
| `packages/config-interpolation`    | all production `src`  | all Vitest tests |
| `packages/oxlint-plugin-anti-slop` | rules, shared, vendor | all rule tests   |
| `packages/ui`                      | production TS and TSX | all Vitest tests |

`apps/storybook` is excluded. Its production behavior belongs to UI packages,
and its browser project is unsuitable for per-mutant execution.
`packages/config-typescript` has no executable source or tests.

## Commands

Each included workspace owns `test:mutation` and `test:mutation:dry`. The root
commands delegate through `turbo run`. Turbo runs workspace mutation tasks in
parallel; each Stryker process uses conservative internal concurrency.

Stryker discovers all tests in its workspace. Configs exclude generated files,
entrypoints, migrations, fixtures, and test files from mutation only when those
files are not production behavior.

## Quality policy

- Use the TypeScript checker and Vitest runner in every included workspace.
- Ignore static mutants because they cannot use per-test coverage and dominate
  runtime.
- Measure each workspace before setting its break threshold.
- Set each break threshold to the integer floor of its measured score. This
  establishes an honest non-regression floor without claiming an unearned 80%.
- Keep `high` and `low` informational; the break threshold is the CI contract.

## CI

CI uses one matrix job per workspace so cold runs execute in parallel and each
failure names its owner. Incremental reports are cached per workspace and
environment. Pull requests may write only their isolated cache scope; pushes to
`master` and the scheduled workflow refresh the trusted baseline.

The scheduled workflow forces every configured mutant. Pull requests reuse the
latest compatible baseline and rerun affected mutants. A cache miss runs that
workspace's full configured scope.

## Verification

For every workspace:

1. Dry run passes with all workspace tests discovered.
2. Full mutation run completes and records its score.
3. The configured break threshold passes that measured result.
4. Root Turbo commands invoke every included workspace.
5. CI matrix, cache keys, actionlint, formatting, lint, typecheck, unit,
   integration, component, and Product E2E checks pass.
