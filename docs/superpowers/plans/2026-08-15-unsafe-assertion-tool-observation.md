# Unsafe Assertion Tool-Observation Migration Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove all seven native unsafe type assertions from persisted tool-observation and compaction-ledger validation without changing replay, cancellation, or fail-closed behavior.

**Architecture:** Reuse the API-root `isRecord` guard for generic object evidence and keep the domain-specific safe-integer predicate beside the ledger parser. Characterize malformed persisted parts and ledgers through existing public behavior, then make every narrowing fact derive from control flow. This is one chat-domain layer on top of PR #395; it does not widen into MCP transport or other chat assertions.

**Tech Stack:** TypeScript, Vitest, Oxlint type-aware rules, pnpm, gh-stack

---

## Chunk 1: Persisted tool-observation boundary

### Task 1: Freeze the slice and its runtime contract

**Files:**

- Modify: `apps/api/src/chats/context-builder.test.ts`
- Modify: `apps/api/src/compaction/compaction.test.ts`

- [x] **Step 1: Capture the native failing assertion baseline**

  Run from `apps/api`:

  ```bash
  pnpm exec oxlint --threads=1 --type-aware -D typescript/no-unsafe-type-assertion --format=json src/chats/tool-observation-part.ts
  ```

  Expected: exit 1 with exactly seven diagnostics in `tool-observation-part.ts` at the tool-part, cancellation-metadata, observation, ledger, and omitted-count narrowings.

- [x] **Step 2: Add malformed tool-part characterization cases**

  In `context-builder.test.ts`, exercise `projectToolObservations` with record-shaped persisted parts that have invalid required fields and assert they produce no projection. Exercise malformed cancellation metadata through `buildContext`: use a matched error part whose `resultProviderMetadata.llame` is an array or primitive, then assert the integrated replay still emits one matched `tool-call`/`tool-result` pair with `Outcome: error`, does not throw, and does not become `cancelled`.

- [x] **Step 3: Add malformed ledger characterization cases**

  In `context-builder.test.ts`, pass ledgers whose `omittedCount` is negative, fractional, nonnumeric, or greater than `Number.MAX_SAFE_INTEGER`. Assert the persisted ledger fails closed: no replayed observation and no omission marker. In `compaction.test.ts`, pass one hostile `previous` ledger to `buildNextCompactionToolObservationLedger` with no absorbed observations and assert the write path resets it to `{ version: 1, omittedCount: 0, observations: [] }`. Keep the existing maximal-safe-integer preservation case green.

- [x] **Step 4: Run the characterization tests before production changes**

  Run sequentially with one worker:

  ```bash
  pnpm --filter api exec vitest run --project unit src/chats/context-builder.test.ts --maxWorkers=1
  pnpm --filter api exec vitest run --project unit src/compaction/compaction.test.ts --maxWorkers=1
  ```

  Expected: pass. These tests freeze existing fail-closed behavior; the native Oxlint diagnostic in Step 1 is the RED gate for this control-flow refactor. Do not manufacture a behavior failure or add a bespoke checker.

### Task 2: Derive every narrowing fact from control flow

**Files:**

- Modify: `apps/api/src/chats/tool-observation-part.ts`
- Reuse: `apps/api/src/unknown-record.ts`

- [x] **Step 1: Replace generic object assertions with the shared guard**

  Import `isRecord` from `../unknown-record`. Use it in `isToolActivityPart`, `isCancelledMetadata`, `isCompactionObservation`, and `parseCompactionToolObservationLedger`. Preserve the existing non-array object contract and all existing field validation.

- [x] **Step 2: Add the local omitted-count predicate**

  Add a non-exported `isNonNegativeSafeInteger(value: unknown): value is number` beside the ledger parser:

  ```ts
  function isNonNegativeSafeInteger(value: unknown): value is number {
    return (
      typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    );
  }
  ```

  Use it once to validate `ledger.omittedCount`; after that guard, pass the narrowed number directly to `boundCandidates`. Do not move domain validation into `unknown-record.ts`.

- [x] **Step 3: Run focused tests after the refactor**

  Run the two commands from Task 1 Step 4 sequentially. Expected: both pass with no failures or warnings.

- [x] **Step 4: Prove the owned file has zero native findings**

  Re-run the Step 1 Oxlint command. Expected: exit 0 and zero diagnostics for `tool-observation-part.ts`.

### Task 3: Verify, review, and record the layer

**Files:**

- Modify: `docs/code-quality-tracker.md`
- Modify: `CHANGELOG.md`
- Modify: `docs/superpowers/plans/2026-08-15-unsafe-assertion-tool-observation.md`

- [x] **Step 1: Run the full native inventory**

  From `apps/api`, run:

  ```bash
  pnpm exec oxlint --threads=1 --type-aware -D typescript/no-unsafe-type-assertion --format=json .
  ```

  Expected: 274 diagnostics if no unrelated drift occurred. Record the observed unique-file count from native JSON; do not encode that file count as a brittle gate.

- [x] **Step 2: Run scoped repository verification sequentially**

  Check host memory first. From the repository root, run these exact commands sequentially:

  ```bash
  pnpm --filter api lint
  pnpm --filter api typecheck
  pnpm --filter api build
  pnpm lint:ast-grep
  pnpm lint:markdown
  pnpm format:check
  git diff --check
  ```

  `pnpm --filter api build` is the repository-owned scoped command that couples the Nest build, built-runtime contract, OpenAPI regeneration, and OpenAPI formatting. After it exits, require `git diff --exit-code -- apps/api/openapi.json` so generated contract drift cannot hide in the working tree. Do not substitute `nest build`, run the root aggregate build, run mutation testing, or use parallel workers.

- [x] **Step 3: Obtain independent reviews**

  Dispatch a specification-compliance reviewer against the approved design and this plan, then a code-quality reviewer against the resulting diff. Fix and re-review any P0/P1 finding. Dispatch a final whole-diff reviewer before publication.

- [x] **Step 4: Update canonical evidence**

  Add the stacked layer, before/after native counts, test evidence, and maintained-tool decision to `docs/code-quality-tracker.md`. Add a dated `CHANGELOG.md` entry describing the assertion-free persisted tool-observation validation. Keep the rule diagnostic until the full API inventory reaches zero.

- [x] **Step 5: Commit and publish the stacked PR**

  Commit with a conventional message and the required co-author trailer. Submit the current branch above PR #395, open a non-draft PR, reference any applicable issues with `Closes #...`, and include a `Verification` section but no `Test plan` section. Monitor CI and repair failures; do not merge.
