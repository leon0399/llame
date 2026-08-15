# Mutation Testing Pilot Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents are available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish a bounded, non-blocking StrykerJS pilot that measures mutation quality for three pure MCP utilities and turns useful survivors into behavior-focused Vitest coverage.

**Architecture:** Run the maintained StrykerJS Vitest runner only inside `apps/api`, against three explicitly listed production modules and their direct unit tests. Keep the initial score diagnostic, emit native clear-text/HTML/JSON reports, and force one-worker foreground execution so the pilot cannot fan out across the monorepo or repeat the resource-exhaustion failure.

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

- [ ] Confirm the RED state: `pnpm --filter api test:mutation:dry` fails because no mutation script exists.
- [ ] Add exact dev dependencies `@stryker-mutator/core@9.6.1` and `@stryker-mutator/vitest-runner@9.6.1`; do not adopt the release-cooldown-ineligible 10.x line.
- [ ] Add `test:mutation` and `test:mutation:dry` scripts backed directly by the Stryker CLI.
- [ ] Configure only `src/mcp/tool-id.ts`, `src/mcp/protected-values.ts`, and `src/mcp/mcp-bounded-fetch.ts` as mutation targets, and only their direct unit tests as `testFiles`.
- [ ] Configure the native Vitest runner, clear-text/HTML/JSON reporters, `concurrency: 1`, and non-breaking thresholds (`break: null`). Do not add a wrapper, custom reporter, custom checker, or CI gate.
- [ ] Confirm the GREEN setup with a foreground dry run. Record elapsed time and peak RSS; stop if memory growth is disproportionate.

## Task 2: Measure the one-worker baseline

**Files:**

- Inspect: `apps/api/reports/mutation/mutation.json` (generated and ignored)
- Modify: `docs/code-quality-tracker.md`

- [ ] Run the three direct Vitest files first:
      `pnpm --filter api exec vitest run --project unit src/mcp/tool-id.test.ts src/mcp/protected-values.test.ts src/mcp/mcp-bounded-fetch.test.ts`.
- [ ] Check host memory headroom, then run `/usr/bin/time -v pnpm --filter api test:mutation` in the foreground with the configured single worker.
- [ ] Record runtime, peak RSS, mutation score, killed/survived/no-coverage/timeout/compile-error counts, and every survivor location from the native JSON report.
- [ ] Classify each survivor as a useful behavior gap, likely equivalent mutant, or intentionally untested implementation detail. Do not suppress or game mutants to inflate the score.

## Task 3: Repair evidence-backed test gaps

**Files:**

- Modify when justified: `apps/api/src/mcp/tool-id.test.ts`
- Modify when justified: `apps/api/src/mcp/protected-values.test.ts`
- Modify when justified: `apps/api/src/mcp/mcp-bounded-fetch.test.ts`
- Modify production code only if mutation evidence reveals an actual defect or unreadable invariant.

- [ ] For every useful survivor, first add a behavior-focused assertion and prove it fails when the survived behavior is present.
- [ ] Make the smallest test or implementation change that expresses the real contract; avoid mutant-specific assertions and production-code test seams.
- [ ] Re-run the affected Vitest file after each repair.
- [ ] Re-run the bounded mutation command once after repairs and update the measured results and classification.

## Task 4: Document the pilot and operating limits

**Files:**

- Modify: `apps/api/AGENTS.md`
- Modify: `apps/api/README.md`
- Modify: `docs/testing.md`
- Modify: `docs/code-quality-tracker.md`
- Modify: `CHANGELOG.md`

- [ ] Document the command, exact pilot scope, one-worker safety limit, foreground-only execution, diagnostic/non-CI status, generated report locations, and rule against replacing Stryker with bespoke mutation infrastructure.
- [ ] Update the tracker with the actual baseline/final measurements, survivor disposition, follow-ups, and the explicit no-go against expanding mutation scope before runtime and peak-memory budgets are established.
- [ ] Add the dated changelog entry for the diagnostic pilot.

## Task 5: Verify, review, and publish the stack layer

- [ ] Run sequentially, never concurrently: API lint, API typecheck, the three focused Vitest files, mutation dry run, and full bounded mutation run.
- [ ] Run the root native quality gates relevant to changed files: ast-grep scan, Markdown lint, and Prettier check. Do not run the aggregate root build.
- [ ] Run `git diff --check` before committing.
- [ ] Inspect the diff for generated reports, unrelated edits, custom infrastructure, accidental threshold gating, and dependency drift.
- [ ] Obtain an independent correctness/maintainability review and repair valid findings.
- [ ] Commit with the required co-author trailer, submit as the next `gh-stack` PR, link applicable issues without falsely closing exploratory follow-ups, and confirm the remote stack is linear and current.
