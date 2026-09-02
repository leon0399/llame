# Global mutation testing

## Goal

Run mutation testing against every hand-written production TypeScript file and
every compatible unit test. Keep commands package-owned and run workspaces in
parallel in CI.

## Scope

| Workspace                          | Runner  | Scope                                                 |
| ---------------------------------- | ------- | ----------------------------------------------------- |
| `apps/api`                         | Vitest  | all production `src/**/*.ts`; all unit tests          |
| `apps/web`                         | Vitest  | hand-written TS/TSX including root runtime files      |
| `apps/storybook`                   | Vitest  | config/runtime TS; all four unit tests                |
| `packages/config-interpolation`    | Vitest  | all production `src`; all tests                       |
| `packages/oxlint-plugin-anti-slop` | command | `index`, rules, shared, vendor; registry + rule tests |
| `packages/ui`                      | Vitest  | all production TS/TSX; all unit tests                 |

Mutation excludes tests, stories, generated clients, build output, fixtures,
and test-support modules. These are not hand-written production behavior.
`packages/config-typescript` has no executable source or tests.

Storybook browser tests remain outside mutation execution. Its unit project is
included; starting a browser for every mutant is not viable.

## Commands

Each included workspace owns:

- `stryker.config.json`;
- Stryker core and TypeScript checker development dependencies;
- the Vitest runner, or the command runner for anti-slop;
- `test:mutation` and `test:mutation:dry` scripts.

The root commands are `turbo run test:mutation --concurrency=1` and
`turbo run test:mutation:dry --concurrency=1`. Root execution is serialized to
avoid running several Stryker worker pools on one developer machine. Turbo
registers both tasks with `cache: false`.

Vitest configs select each workspace's complete unit-test project. Anti-slop's
command runner executes its existing registry check and every RuleTester file;
it does not require a test-framework rewrite. `coverageAnalysis` is `perTest`
for Vitest and `off` for the command runner.

## Quality policy

- Use the TypeScript checker in every workspace.
- Ignore static mutants in `perTest` Vitest workspaces. The command-runner
  workspace retains them because it cannot detect static mutants.
- Set `allowEmpty: false` explicitly.
- Run each complete workspace scope before setting its threshold.
- Set `thresholds.break` to the measured score rounded down to one decimal
  place. Threshold reductions require an ordinary reviewed config change.
- Keep `high` and `low` informational. The per-workspace break threshold is the
  CI contract; there is no invented global 80% threshold.

## CI

CI uses a `fail-fast: false` matrix with one job per workspace. Matrix entries
provide workspace name, path, timeout, and Stryker concurrency. Cold runs
execute in parallel and each failure names its owner.

The baseline action accepts workspace path and an environment fingerprint.
Cache keys include workspace, runner OS, dependency/config hash, commit, run,
and attempt. Restore prefixes never cross workspaces. GitHub's pull-request
cache scope isolates PR writes from `master`; successful PR, `master`, and
scheduled runs save their own incremental report. Artifact names include the
workspace and never collide.

Fingerprints include the lockfile, Node version, setup/baseline actions, the
workspace manifest, Stryker/Vitest/TypeScript configs, generated inputs consumed
by tests, and internal workspace dependencies. Source and test files remain out
of the fingerprint because Stryker diffs them inside the incremental report.

The scheduled workflow uses the same matrix and forces every configured mutant.
Pull requests reuse the latest compatible baseline and rerun affected mutants.
A cache miss runs that workspace's full configured scope. Per-workspace timeout
and concurrency values come from measured cold runs, with headroom; a workspace
that cannot fit GitHub's six-hour limit must be split before merging.

## Verification

For every workspace:

1. Dry run passes with all workspace tests discovered.
2. Full mutation run completes and records score, mutant count, and duration.
3. The configured decimal break threshold passes that measured result.
4. Zero tests or zero mutants fails.
5. Root Turbo dry runs contain all six workspaces.
6. Cache keys and artifacts are unique per workspace and trust scope.
7. CI matrix, actionlint, formatting, lint, typecheck, unit, integration,
   component, and Product E2E checks pass.
