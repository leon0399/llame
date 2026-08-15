# Unsafe Assertion Tool Schema Utilities Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development
> (if subagents are available) or superpowers:executing-plans to implement this
> plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the three unsafe assertions from the production tool-schema
admission owner without narrowing supported JSON Schema dialects or changing Zod
validation behavior.

**Architecture:** Prove the structural Zod boundary through ordinary object and
callable-property checks. Materialize AI SDK-generated JSON Schema documents with
object spread so the result has the function's owned record contract without
asserting it. Raw caller-supplied JSON Schema documents remain unchanged and keep
their draft-07, 2019-09, and 2020-12 support.

**Tech Stack:** TypeScript, AI SDK schema adapters, Zod, Ajv, Vitest, Oxlint
type-aware rules, pnpm, gh-stack

---

## Chunk 1: Production tool-schema boundary

### Task 1: Freeze the three-finding baseline and schema behavior

**Files:**

- Modify: `apps/api/src/tools/schema-utils.test.ts`
- Verify: `apps/api/src/tools/schema-utils.ts`

- [ ] **Step 1: Capture the native failing baseline**

  From `apps/api`, run:

  ```bash
  pnpm exec oxlint --threads=1 --type-aware \
    -D typescript/no-unsafe-type-assertion --format=json \
    src/tools/schema-utils.ts
  ```

  Expected: exit 1 with exactly three diagnostics: the structural Zod predicate
  and two AI SDK JSON Schema result assertions.

- [ ] **Step 2: Run the unchanged direct suite**

  From the repository root, run with one worker:

  ```bash
  pnpm --filter api exec vitest run --project unit \
    src/tools/schema-utils.test.ts --maxWorkers=1
  ```

  Expected: 19/19 pass.

- [ ] **Step 3: Characterize Zod admission before implementation**

  Add a direct `admitToolInputSchema` test using a Zod object schema. Require a
  successful record-shaped JSON Schema with `type: 'object'` and `properties`,
  while retaining the existing Zod validation and `resolveJsonSchema` tests. Keep
  production unchanged and rerun the direct suite; expected: 20/20 pass.

### Task 2: Derive schema types from runtime and construction evidence

**Files:**

- Modify: `apps/api/src/tools/schema-utils.ts`

- [ ] **Step 1: Replace the Zod predicate assertion**

  Require a non-null object, require `'safeParse' in schema`, and require the
  property to be a function. Preserve inherited `safeParse` support used by real
  Zod instances. Do not use `Reflect.get`, `any`, an assertion, or an exact-shape
  validator.

- [ ] **Step 2: Construct generated JSON Schema records**

  In `admitToolInputSchema` and `resolveJsonSchema`, await the AI SDK-generated
  `jsonSchema` and return a shallow object spread. Do not cast to `JSONSchema7`,
  add a generic canonicalization overload, or apply this copying behavior to raw
  caller-supplied `JsonSchemaDocument` values.

- [ ] **Step 3: Run focused GREEN checks**

  Run the direct suite, then the schema consumers sequentially with one worker:

  ```bash
  pnpm --filter api exec vitest run --project unit \
    src/tools/schema-utils.test.ts \
    src/tools/turn-tool-catalog.test.ts \
    src/mcp/declaration-admission.test.ts \
    src/runs/snapshot-tool-execution.test.ts --maxWorkers=1
  pnpm --filter api typecheck
  ```

  Record the observed test count. These suites cover admission, raw-dialect
  preservation, catalog construction, MCP declaration admission, and run
  snapshotting.

- [ ] **Step 4: Prove the owned file has zero native findings**

  Re-run Task 1 Step 1. Expected: exit 0 and zero diagnostics.

### Task 3: Verify, review, and publish the layer

**Files:**

- Modify: `docs/code-quality-tracker.md`
- Modify: `CHANGELOG.md`
- Modify: `docs/superpowers/plans/2026-08-15-unsafe-assertion-tool-schema-utils.md`

- [ ] **Step 1: Run the full native inventory**

  From `apps/api`, run:

  ```bash
  pnpm exec oxlint --threads=1 --type-aware \
    -D typescript/no-unsafe-type-assertion --format=json .
  ```

  Record total diagnostics, unique filenames, and `threads_count`. Expected: 264
  diagnostics across 76 files with one thread if no unrelated drift occurred;
  observed output is authoritative.

- [ ] **Step 2: Run exact bounded repository verification**

  Apply the tracker host-safety gate first (`free -h`; second `vmstat 1 2` sample
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

- [ ] **Step 3: Obtain independent reviews**

  Require specification-compliance, code-quality, and final whole-layer reviews.
  Fix and re-review every P0/P1 finding and any factual documentation defect.

- [ ] **Step 4: Update canonical evidence**

  Record the three-finding reduction, focused suite count, final native inventory,
  and preservation of raw JSON Schema identity/dialect behavior. Keep the rule
  diagnostic until the full API inventory reaches zero.

- [ ] **Step 5: Commit and publish the stacked PR**

  Commit with conventional messages and the required co-author trailer. Require
  the current branch base to equal the live head of PR #398 with
  `needsRebase: false`. Publish a non-draft PR through gh-stack with a
  `Verification` section and no `Test plan` section. Use `Closes #...` only for a
  genuinely applicable issue. Monitor CI, repair failures, and do not merge.
