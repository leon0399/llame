# Mutation Testing Pilot Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents are available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish and publish a bounded, non-blocking StrykerJS pilot that measures mutation quality for three pure MCP utilities. Queue useful survivors as four reviewable child `gh-stack` layers; do not make completing that repair backlog a prerequisite for publishing the current pilot.

**Architecture:** Run the maintained StrykerJS Vitest runner only inside `apps/api`, against three explicitly listed production modules and their direct unit tests. Keep the initial score diagnostic, emit native clear-text/HTML/JSON reports, and force one-worker foreground execution so the pilot cannot fan out across the monorepo or repeat the resource-exhaustion failure. The full run may need scoped sandbox permission for Stryker's internal Node logging-server bind; this is not external network access by the product or tests.

**Tech Stack:** StrykerJS 9.6.1, `@stryker-mutator/vitest-runner` 9.6.1, Vitest 4.1.10, pnpm 10

---

## Task 1: Add the bounded native Stryker configuration

**Files:**

- Modify: `apps/api/package.json`
- Create: `apps/api/stryker.config.json`
- Modify: `pnpm-lock.yaml`
- Verify: `apps/api/src/mcp/tool-id.test.ts`
- Verify: `apps/api/src/mcp/protected-values.test.ts`
- Verify: `apps/api/src/mcp/mcp-bounded-fetch.test.ts`

- [x] Add exact dev dependencies `@stryker-mutator/core@9.6.1` and `@stryker-mutator/vitest-runner@9.6.1`; do not adopt the release-cooldown-ineligible 10.x line.
- [x] Add `test:mutation` and `test:mutation:dry` scripts backed directly by the Stryker CLI.
- [x] Configure only `src/mcp/tool-id.ts`, `src/mcp/protected-values.ts`, and `src/mcp/mcp-bounded-fetch.ts` as mutation targets, and only their direct unit tests as `testFiles`.
- [x] Configure the native Vitest runner, clear-text/HTML/JSON reporters, `concurrency: 1`, and non-breaking thresholds (`break: null`). Do not add a wrapper, custom reporter, custom checker, or CI gate.
- [x] Confirm the GREEN setup with a foreground dry run: 4.23 s, 279432 kB maximum resident set, 33 tests, and 425 mutants.

## Task 2: Measure the one-worker baseline

**Files:**

- Inspect: `apps/api/reports/mutation/mutation.json` (generated and ignored)
- Modify: `docs/code-quality-tracker.md`

- [x] Run the three direct Vitest files first:
      `pnpm --filter api exec vitest run --project unit src/mcp/tool-id.test.ts src/mcp/protected-values.test.ts src/mcp/mcp-bounded-fetch.test.ts`.
- [x] Check host memory headroom, then run `/usr/bin/time -v pnpm --filter api test:mutation` in the foreground with the configured single worker.
- [x] Record runtime, peak RSS, mutation score, killed/survived/no-coverage/timeout/compile-error counts, and every survivor location from the native JSON report.
- [x] Classify each survivor as a useful behavior gap, likely equivalent mutant, intentionally untested implementation detail, or (only with exact-replacement manual evidence) a narrowly evidenced runner/static-mutant activation artifact. The last category is not a test gap, equivalent mutant, ignored mutant, waiver, or score-inflation bucket; do not suppress or game mutants.

## Task 3: Queue evidence-backed repairs as child `gh-stack` layers

**Files:**

- Modify when justified: `apps/api/src/mcp/tool-id.test.ts`
- Modify when justified: `apps/api/src/mcp/protected-values.test.ts`
- Modify when justified: `apps/api/src/mcp/mcp-bounded-fetch.test.ts`
- Modify production code only if mutation evidence reveals an actual defect or unreadable invariant.

The current pilot can be published before any of these repairs. The baseline has
100 useful `U` mutants; none is marked repaired. Each row is a separate child
stack layer and must be reviewed, verified, and submitted independently. Do not
batch the four layers into one local repair commit.

| Child layer                                                                 | Useful `U` mutants | Boundary                                                                                                                                                                                                                                                                                                                         |
| --------------------------------------------------------------------------- | -----------------: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Tool-id canonicalization/parser                                          |                 18 | Invalid-format parsing, canonical server/tool IDs, separators, and the 64-character boundary                                                                                                                                                                                                                                     |
| 2. Protected-values normalization/propagation                               |                 24 | Normalization, longest-match ordering and ties, scalar detection, and nested failure propagation                                                                                                                                                                                                                                 |
| 3. Bounded-fetch request parsing/body sizing/response byte-limit semantics  |                 42 | Exact IDs: `S7`, `S10`, `S12`, `S16`, `S17`, `S33`, `NC37`, `NC38`, `S39`, `NC51`, `NC52`, `NC53`, `NC54`, `NC55`, `NC56`, `NC57`, `NC58`, `NC59`, `S41`, `S42`, `S43`, `S45`, `S47`, `S48`, `S49`, `S50`, `S65`, `S66`, `S68`, `S70`, `S71`, `S73`, `S79`, `S81`, `S89`, `S101`, `S102`, `S103`, `S106`, `S109`, `S111`, `S123` |
| 4. Bounded-fetch SSE recognition/framing plus wrapper cancellation/metadata |                 16 | Exact IDs: `S85`, `S113`, `S136`, `S137`, `S139`, `S140`, `S146`, `S149`, `S151`, `S153`, `S163`, `S164`, `S165`, `S166`, `S167`, `S168`                                                                                                                                                                                         |

- [ ] For each child layer, add behavior-focused assertions for its `U` rows and prove the relevant survived behavior fails when the assertion is absent.
- [ ] Make the smallest test or implementation change that expresses the real contract; avoid mutant-specific assertions and production-code test seams.
- [ ] Re-run the affected direct Vitest file after each repair.
- [ ] Re-run the bounded mutation command for the child layer after repairs and update the measured results and classification.
- [ ] Submit each child layer as its own `gh-stack` layer; do not delay the current pilot publication until all 100 gaps are repaired.

## Task 4: Complete current-pilot documentation for publication

**Files:**

- Modify: `apps/api/AGENTS.md`
- Modify: `apps/api/README.md`
- Modify: `docs/testing.md`
- Modify: `docs/code-quality-tracker.md`
- Modify: `CHANGELOG.md`

- [x] Document the exact commands, exact pilot scope, one-Stryker-worker plus one-Vitest-worker safety limit, foreground-only execution, diagnostic/non-CI status, native report locations, sandbox logging-server caveat, and rule against replacing Stryker with bespoke mutation infrastructure.
- [x] Update the tracker with the actual baseline measurements, survivor disposition, commit evidence (`8d5c0023` for implementation/baseline and `00f7ceb4` for operating docs), four queued child layers with exact mutant-ID membership, and the explicit no-go against local batching or expanding mutation scope before runtime and peak-memory budgets are established.
- [x] Remove the stale API coverage command reference without inventing coverage tooling.
- [x] Add the dated changelog entry for the diagnostic pilot.

## Task 5: Verify, review, and publish the current pilot layer

- [ ] Run the current pilot's required checks sequentially, never concurrently; the repair-child checks belong to their own layers.
- [ ] Run the root native quality gates relevant to changed files: Markdown lint and Prettier check. Do not run the aggregate root build.
- [ ] Run `git diff --check` before committing.
- [ ] Inspect the diff for generated reports, unrelated edits, custom infrastructure, accidental threshold gating, and dependency drift.
- [ ] Obtain an independent correctness/maintainability review and repair valid findings.
- [ ] Commit the current config/baseline/docs layer with the required co-author trailer and submit it as the next `gh-stack` PR (PR number pending at plan time). Child repair layers follow separately; publishing this pilot is not blocked on the 100-gap backlog.
