# Unsafe Assertion Result Truncation Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development
> (if subagents are available) or superpowers:executing-plans to implement this
> plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove all seventeen unsafe assertions from the tool-result truncation
boundary, its direct tests, and the runner integration edge without changing the
result cap, structural truncation, marker precedence, or recovery notice.

**Architecture:** Keep `truncateOversizedResult` as the single JSON-projection
boundary. Reuse the repository's `isRecord` guard to prove that the parsed root
is a success record, split object recursion into a record-returning helper so
TypeScript retains the evidence, and use Zod only in tests to validate the
specific dynamic result shapes they inspect. Do not add a new checker, parser
framework, type assertion, lint suppression, or provider-specific type.

**Tech Stack:** TypeScript, Vitest, Zod, Oxlint type-aware rules, pnpm, gh-stack

---

## Chunk 1: Tool-result truncation boundary

### Task 1: Freeze the seventeen-finding baseline and current behavior

**Files:**

- Modify: `apps/api/src/tools/result-truncation.ts`
- Modify: `apps/api/src/tools/result-truncation.test.ts`
- Modify: `apps/api/src/tools/runner.test.ts`

- [x] **Step 1: Capture the native failing baseline**

  From `apps/api`, run:

  ```bash
  pnpm exec oxlint --threads=1 --type-aware \
    -D typescript/no-unsafe-type-assertion --format=json \
    src/tools/result-truncation.ts src/tools/result-truncation.test.ts \
    src/tools/runner.test.ts
  ```

  Expected: exit 1 with exactly seventeen diagnostics: two production findings,
  fourteen direct-test findings, and one runner-test finding.

- [x] **Step 2: Run the unchanged direct suites**

  From the repository root, run with one worker:

  ```bash
  pnpm --filter api exec vitest run --project unit \
    src/tools/result-truncation.test.ts src/tools/runner.test.ts --maxWorkers=1
  ```

  Expected: all 41 existing tests pass. This freezes the cap, Unicode boundary,
  marker, nested-shape, array, excessive-field, and runner behavior before
  refactoring.

- [x] **Step 3: Add RED malformed-projection cases**

  Add table-driven direct cases where an oversized success result's top-level
  `toJSON` returns an oversized non-record JSON value (array or string), an
  oversized record without `status`, or an oversized record whose `status` is
  not `success`. Require the truncation boundary to reject every invalid
  oversized projection instead of treating array indices, string indices, or a
  forged discriminant as a valid success payload. Numeric, boolean, and `null`
  roots cannot exceed the cap and are outside this truncator's contract; do not
  turn this function into an all-results validator. Add a `runTool` case for one
  representative malformed oversized root and require the public boundary to
  return its static `execution_failed` observation. Run only these cases and
  confirm they fail before changing production code.

### Task 2: Replace assertions with runtime and structural evidence

**Files:**

- Modify: `apps/api/src/tools/result-truncation.ts`
- Modify: `apps/api/src/tools/result-truncation.test.ts`
- Modify: `apps/api/src/tools/runner.test.ts`

- [x] **Step 1: Validate the parsed JSON projection**

  Parse the serialized result into `unknown`. Reuse `isRecord` and require the
  `status` field to remain `success` before destructuring the payload. Throw a
  short `TypeError` for an invalid root projection; `runTool` already catches
  this boundary failure and converts it to its static `execution_failed`
  observation. Preserve valid JSON projections byte-for-byte.

- [x] **Step 2: Preserve record evidence through recursive truncation**

  Extract the object branch of `capValues` into a helper that accepts and returns
  `Record<string, unknown>`. Call it both from recursion and the result builder,
  removing the production narrowing assertion without duplicating traversal or
  changing entry order, top-level field retention, path naming, or markers.

- [x] **Step 3: Replace test assertions with Zod evidence**

  Define only the small direct-test schemas needed for truncation markers and
  inspected nested payloads. Parse dynamic outputs before property access. In
  the runner's no-identity case, replace the matcher cast around
  `expect.stringContaining(...)` with explicit error-discriminant narrowing and
  a direct message assertion; do not use Zod for an already-discriminated
  `ToolResult`.
  Keep Vitest assertions for behavior; do not create a general test validator or
  duplicate production schemas.

- [x] **Step 4: Run focused GREEN checks**

  ```bash
  pnpm --filter api exec vitest run --project unit \
    src/tools/result-truncation.test.ts src/tools/runner.test.ts --maxWorkers=1
  pnpm --filter api typecheck
  ```

  The new runner case proves the public execution boundary converts a malformed
  serialized result into its static failure observation; the existing runner
  case continues to prove that normal oversized successes are capped.

- [x] **Step 5: Prove the owned files have zero native findings**

  Re-run Task 1 Step 1. Expected: exit 0 and zero diagnostics.

### Task 3: Verify, review, and publish the layer

**Files:**

- Modify: `docs/code-quality-tracker.md`
- Modify: `CHANGELOG.md`
- Modify: `docs/superpowers/plans/2026-08-15-unsafe-assertion-result-truncation.md`

- [x] **Step 1: Run the full native inventory**

  From `apps/api`, run the one-thread native rule over `.` and record diagnostics,
  unique files, and `threads_count`. Expected reduction from 260/75 to 243/72 if
  no unrelated drift occurred; observed output is authoritative.

- [x] **Step 2: Run exact bounded repository verification**

  Apply the tracker host-safety gate first (`free -h`; second `vmstat 2 2` sample
  must have `si=0`, `so=0`, with at least 2 GiB available), then run sequentially:

  ```bash
  pnpm --filter api lint
  pnpm --filter api typecheck
  pnpm --filter api build
  git diff --exit-code -- apps/api/openapi.json
  pnpm lint:ast-grep
  pnpm lint:markdown
  pnpm format:check
  git diff --check
  ```

  Do not run the root aggregate build, mutation testing, parallel workers, or a
  custom checker.

- [x] **Step 3: Obtain independent reviews**

  Require specification-compliance, code-quality, and final whole-layer reviews.
  Fix and re-review every P0/P1 finding and any factual documentation defect.

- [x] **Step 4: Update canonical evidence**

  Record the seventeen-finding reduction, focused suite counts, final native
  inventory, and remaining assertion debt. Keep the native rule diagnostic until
  the full API inventory reaches zero.

- [ ] **Step 5: Commit and publish the stacked PR**

  Commit with conventional messages and the required co-author trailer. Require
  the current branch base to equal the live head of PR #400 with no rebase need.
  Publish a non-draft PR through gh-stack with a `Verification` section and no
  `Test plan` section. Use `Closes #...` only for a genuinely applicable issue.
  Monitor CI, repair failures, and do not merge.
