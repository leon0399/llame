# Global mutation testing

## Goal

Run mutation testing against every hand-written production TypeScript file and
every compatible unit test. Keep commands package-owned and run workspaces in
parallel in CI.

## Scope

| Workspace                          | Runner  | Scope                                                 |
| ---------------------------------- | ------- | ----------------------------------------------------- |
| `apps/api`                         | Vitest  | all production `src/**/*.ts`; complete unit glob      |
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

API, web, and Storybook own small mutation Vitest configs:

- API selects the complete unit glob, removes the operator-config exclusion,
  and resolves config interpolation through its built package instead of a
  source alias outside the Stryker sandbox. Config-dependent unit tests use
  committed examples or temporary fixtures.
- Web resolves UI through its installed workspace package instead of the
  tsconfig source alias outside the sandbox.
- Storybook defines only its unit project; its normal config still owns the
  browser project.

Config interpolation and UI reuse their single-project Vitest configs.
Anti-slop's command runner executes its existing registry check and every
RuleTester file; it does not require a test-framework rewrite.
`coverageAnalysis` is `perTest` for Vitest and `off` for the command runner.

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
execute in parallel and each failure names its owner. Concurrency groups are:

- PR: `mutation-pr-<number>-<workspace>` with stale revisions cancelled;
- trusted: `mutation-trusted-<workspace>` without cancellation.

The baseline action accepts workspace path and an environment fingerprint.
Cache keys include workspace, runner OS, trust class, dependency/config hash,
commit, run, and attempt. PR restore order is its own cache followed by the
trusted cache; PR saves use only `pr-<number>`. Trusted runs save only
`trusted`. Artifact names use `mutation-report-<workspace>`.

Every fingerprint includes `pnpm-lock.yaml`, root `package.json`,
`.node-version`, setup/baseline actions, and the workspace's package, Stryker,
Vitest, and TypeScript configs. Additional inputs are exact:

| Workspace     | External inputs                                         |
| ------------- | ------------------------------------------------------- |
| API           | `openapi.json`, config-interpolation package and source |
| web           | generated API client, UI package/source/types           |
| Storybook     | `.storybook`, UI package/source/styles                  |
| interpolation | none                                                    |
| anti-slop     | registry script and package root entrypoint             |
| UI            | component registry and ambient type declarations        |

API search-eval baselines are excluded because eval tests are outside the unit
project. Source and unit-test files stay out of the fingerprint because Stryker
diffs them inside the incremental report.

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
4. Dry-run output confirms a non-zero test and mutant count for every explicit
   scope; no custom report wrapper is added.
5. Root Turbo dry runs contain all six workspaces.
6. Cache keys and artifacts are unique per workspace and trust scope.
7. CI matrix, actionlint, formatting, lint, typecheck, unit, integration,
   component, and Product E2E checks pass.
