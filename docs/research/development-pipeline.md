# Development pipeline measurements

2026-09-08. [Issue #730](https://github.com/leon0399/llame/issues/730).

Changed-file mutation testing applies here. Stryker already supports incremental
results, but every API shard also paid for the complete initial test suite.
This change narrows PR mutation scope, preserves full-scope fallbacks, and
reduces repeated local static checks. It keeps the 80% mutation threshold.

## Measurements

The [measurement data](development-pipeline-statistics.json) records individual
samples and GitHub run IDs. CI durations include setup and scheduling. Local
trials used Linux, 16 logical CPUs, Node 22.23.2, pnpm 11.22.0, Prettier 3.5.1,
and Stryker 9.6.1. Local and GitHub runner durations are separate comparisons.

| Workflow sample | Completed runs | Successful | Cancelled | Failed | Successful median | Successful maximum |
| --------------- | -------------: | ---------: | --------: | -----: | ----------------: | -----------------: |
| Master CI       |             15 |          9 |         6 |      0 |            11m09s |             81m23s |
| PR CI           |             12 |          4 |         4 |      4 |            10m14s |             10m50s |
| Lint            |             10 |         10 |         0 |      0 |               65s |                83s |

These are recent September 6-8 samples, not population percentiles. Medians use
the midpoint of the two middle observations for even sample sizes. Failed and
cancelled runs are counted but excluded from successful-duration summaries.

The [cold master run](https://github.com/leon0399/llame/actions/runs/34160230903)
used 26,445 summed job-seconds; the
[subsequent warm run](https://github.com/leon0399/llame/actions/runs/34213677394)
used 2,519. Logs confirm a missing mutation baseline in the former and a
compatible restored baseline in the latter.

| API shard 3/8            |   Cold |           Warm |
| ------------------------ | -----: | -------------: |
| Stryker execution        | 76m10s |          2m26s |
| Initial test run         |  1m59s |          1m58s |
| Tests executed initially |  2,854 |          2,854 |
| Reused mutant results    |      0 | 2,595 of 2,862 |

The cold shard durations ranged from 31m56s to 76m51s including setup.
File-count balance does not imply runtime balance. Baseline compatibility and
work selection matter much more than the roughly one-minute lint workflow.

| Local check                  |                   Before |                      After | Evidence                                          |
| ---------------------------- | -----------------------: | -------------------------: | ------------------------------------------------- |
| Whole-repository formatting  |              30.49s mean |            4.42s warm mean | 3 uncached runs; 2 warm cached runs, all pass     |
| First cached formatting run  |                        - |                     28.71s | Cache population still parses files               |
| Pre-push, same cached checks | 24.92s median sequential |     19.30s median parallel | One warmup and 3 measured runs per mode, all pass |
| Focused API mutation         |                  230.79s |                    162.94s | One run per mode; same 22 mutants and statuses    |
| Complete unit command        |             109.32s mean | No execution-policy change | 3 passing baseline runs                           |
| Warm typecheck               |               0.92s mean |    Existing cache retained | 3 passing baseline runs                           |

Formatting reuse is about 6.9 times faster after cache population. Parallel
hooks reduce median time by 22.5%. The focused mutation trial is 29.4% faster;
one trial does not establish a general speed estimate.

The mutation comparison uses `src/chats/tool-observation-neutralizer.ts` with
the same checker, concurrency, source and tests. Only Vitest related-test
selection differs. Both reports contain 3 killed and 19 compile-error mutants,
with identical source locations, operators, replacements and statuses. A
preliminary `pg-error.ts` sample contained only compile-error mutants and was
rejected as behavioral-equivalence evidence. Only three mutants in the accepted
sample were testable. This supports equivalence for that one file/configuration
and outcome set; its 100% score does not establish broad related-test correctness.

The original local lint and hook baselines failed on pre-existing untracked
`.agents/notes/` Markdown. Their timings are retained with nonzero exit codes
in `local.baseline` and `local.failedHookBaseline` in the data, but are not used
as successful baselines. Local notes are now
ignored; their contents are preserved.

## Changes and guarantees

- D1: PRs mutate complete changed source files. Tests, recognized fixtures,
  deleted/excluded source, configuration and dependency changes expand the
  affected workspace. Unknown root inputs expand all mutation workspaces.
  Code-plus-test edits therefore normally retain full workspace scope.
- D2: Known documentation/frontend-only changes skip mutation execution.
  Named package checks remain, and the API aggregate explicitly handles zero
  selected shards. A failed planner or selected shard cannot become a green
  aggregate because report files happen to exist.
- D3: Source selection reads the existing Stryker exclusions. Sparse API
  matrices retain stable shard IDs and cache partitions. Changed scopes do not
  restore, reuse or publish full-scope incremental baselines.
- D4: Full-scope cache keys include fixtures, excluded/runtime inputs and
  transitive workspace dependencies. Ordinary owned source/test changes are
  left to Stryker's incremental analysis. PR and trusted cache classes remain
  separate. Master keeps full scope; weekly refreshes force all mutants.
- D5: API mutation uses Vitest's native related-test selection. TypeScript
  mutant checking, numeric thresholds, ordinary unit/integration execution,
  coverage and CRAP gates remain enabled.
- D6: Formatting uses content-based caching. Pre-commit code lint uses the
  canonical Turbo task, including native-file-tools, bash-executor and plugin
  JSON changes. The inherited root lint configuration now participates in
  workspace lint hashes. Mutation tooling tests run before expensive CI jobs.
- D7: API unit/integration coverage starts after typecheck. Product E2E still
  waits for both that coverage job and the unit-gated build. Removing the wait
  for unrelated web/package units shortens the graph without dropping a gate.

A changed-scope score has a smaller denominator than a full-workspace score.
It is not equivalent assurance. Stryker's
[incremental mode](https://stryker-mutator.io/docs/stryker-js/incremental/)
tracks mutant and test changes but needs separate invalidation for other inputs.
The [Vitest runner](https://stryker-mutator.io/docs/stryker-js/vitest-runner/)
uses import relationships for related-test selection; tests that exercise code
only through an external process need separate verification. The full CI run
and weekly refresh remain necessary.

## Further options, in priority order

| Option                                                                | Benefit                                                          | Disposition                                                                                               |
| --------------------------------------------------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| O1: Save validated partial incremental checkpoints after interruption | Recover useful work from cancelled cold runs                     | Follow-up; verify cancellation, partial-file integrity and trust boundaries first                         |
| O2: Balance cold shards by observed runtime                           | Reduce the 2.4:1 cold shard duration spread                      | Follow-up; changing assignments invalidates existing baselines                                            |
| O3: Profile TypeScript mutant checking                                | Identify the remaining cold-run cost                             | Follow-up; retain the checker and comparable score semantics until measured                               |
| O4: Narrow more non-mutation CI jobs by dependency scope              | Reduce documentation-only runner consumption                     | Follow-up; required checks and generated-output dependencies need explicit handling                       |
| O5: Expand coverage/mutation ownership to newer runtime packages      | Measure native-file-tools and bash-executor directly             | Separate quality work; their source is currently a dependency of API mutation                             |
| O6: Cache unit-test verdicts                                          | Avoid roughly 109s locally                                       | Deferred under the current uncached-test policy; cached successes can conceal flakes or undeclared inputs |
| O7: Raise worker counts or remove isolation                           | Potentially shorten unit execution                               | Deferred; memory pressure and module-state leakage need measurements                                      |
| O8: Lint root tooling under a defined Node configuration              | Extend static analysis beyond current workspace/product surfaces | Follow-up; current root scripts use Node tests and formatting                                             |
| O9: Revisit the fixed review interval                                 | Reduce ready-PR turnaround once CI is shorter                    | Policy decision; CONTRIBUTING.md currently requires at least 15 minutes of review monitoring              |

## Reproduction

Read exact job timing records with:

```bash
gh api 'repos/leon0399/llame/actions/runs/34160230903/jobs?per_page=100'
gh api 'repos/leon0399/llame/actions/runs/34213677394/jobs?per_page=100'
```

For local comparisons, finish installation/build prerequisites first, serialize
benchmarks, retain exit codes, and distinguish initial from warm cache runs:

```bash
hyperfine --runs 3 'pnpm exec prettier --check .'
hyperfine --runs 1 'pnpm format:check'
hyperfine --runs 2 'pnpm format:check'
hyperfine --warmup 1 --runs 3 'pnpm exec lefthook run pre-push'
pnpm test:mutation:tooling
pnpm test:mutation:changed --base origin/master --dryRunOnly
pnpm test:mutation:changed --base origin/master
```

The first command deletes Prettier's default cache when no `--cache-location`
is supplied, verified in the installed 3.5.1 CLI. The next command measures
population; the final two runs measure warm reuse.
[Prettier's cache documentation](https://prettier.io/docs/cli#--cache)
describes its content, option, version and runtime keys. For the mutation A/B
test, make two copies of the API Stryker configuration with JSON-only reporting,
toggle `vitest.related`, and run each with
`--mutate src/chats/tool-observation-neutralizer.ts`. Compare mutants by source
location/operator/replacement, not report order or test IDs.
