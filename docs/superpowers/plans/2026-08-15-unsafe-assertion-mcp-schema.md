# Unsafe Assertion MCP Schema Canonicalization Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove all five native unsafe type assertions from MCP declaration-schema canonicalization and its direct tests without changing schema admission, redaction, prototype-shaped key handling, or canonical output.

**Architecture:** Give `canonicalize` an overload that truthfully preserves only the outer `Record<string, unknown>` boundary while retaining `unknown` for unconstrained callers. Use that contract in MCP declaration admission, and replace test-only JSON/cast shortcuts with typed object literals plus runtime guards or whole-object expectations. Keep the remaining MCP SDK executable-binding assertion in `mcp-server-client.ts` for a separate package-boundary layer.

**Tech Stack:** TypeScript overloads, Vitest, Oxlint type-aware rules, pnpm, gh-stack

---

## Chunk 1: MCP declaration-schema canonicalization boundary

### Task 1: Freeze the five-finding baseline and direct behavior

**Files:**

- Modify: `apps/api/src/mcp/declaration-admission.test.ts`
- Verify: `apps/api/src/mcp/declaration-admission.ts`

- [x] **Step 1: Capture the native failing assertion baseline**

  From `apps/api`, run:

  ```bash
  pnpm exec oxlint --threads=1 --type-aware -D typescript/no-unsafe-type-assertion --format=json src/mcp/declaration-admission.ts src/mcp/declaration-admission.test.ts
  ```

  Expected: exit 1 with exactly five diagnostics: one production canonicalization assertion and four direct-test assertions.

- [x] **Step 2: Run the unchanged direct suite**

  From the repository root, run:

  ```bash
  pnpm --filter api exec vitest run --project unit src/mcp/declaration-admission.test.ts --maxWorkers=1
  ```

  Expected: 26/26 pass before edits. This behavior-preserving refactor uses the native rule in Step 1 as its RED gate.

- [x] **Step 3: Replace the test fixture assertions before production changes**

  In `declaration-admission.test.ts`:

  - replace both `JSON.parse(...) as Record<string, unknown>` fixtures with object literals using a computed `['__proto__']` property so the key is own data rather than object-literal prototype syntax;
  - replace the prototype-key `properties` assertion with `isRecord` control-flow narrowing before inspecting its prototype, keys, and own properties;
  - replace the nested instance-data `properties` assertion with a whole-schema `toMatchObject` expectation, keeping the existing `safeParseArgs` assertion.

  Do not add `any`, another assertion, a suppression, or a custom test helper.

- [x] **Step 4: Re-run the direct suite before production changes**

  Run the Step 2 command. Expected: 26/26 pass, preserving schema admission and prototype-shaped key behavior.

### Task 2: Expose the truthful record canonicalization contract

**Files:**

- Modify: `apps/api/src/canonical-json.ts`
- Modify: `apps/api/src/mcp/declaration-admission.ts`

- [x] **Step 1: Add a record-specific overload without widening the generic contract**

  Add these overload signatures immediately before the existing implementation:

  ```ts
  export function canonicalize(
    value: Record<string, unknown>,
  ): Record<string, unknown>;
  export function canonicalize(value: unknown): unknown;
  ```

  Keep the implementation body and its runtime behavior unchanged. Do not use a generic `<T>(value: T): T` overload: canonicalization does not preserve arbitrary class prototypes or unconstrained inner types.

- [x] **Step 2: Consume the overload at declaration admission**

  Replace the production cast with an explicitly typed assignment or object field whose value is `canonicalize(schemaAdmission.inputSchema)`. The input is already a validated `Record<string, unknown>`, so overload resolution supplies the exact `JsonSchemaDocument` alias without an assertion.

- [x] **Step 3: Run focused GREEN checks**

  Run the Step 2 direct Vitest command, then:

  ```bash
  pnpm --filter api typecheck
  ```

  Expected: 26/26 tests pass and typecheck exits 0.

- [x] **Step 4: Prove both owned files have zero native findings**

  Re-run the Step 1 Oxlint command. Expected: exit 0 and zero diagnostics across both files.

### Task 3: Verify, review, and publish the layer

**Files:**

- Modify: `docs/code-quality-tracker.md`
- Modify: `CHANGELOG.md`
- Modify: `docs/superpowers/plans/2026-08-15-unsafe-assertion-mcp-schema.md`

- [x] **Step 1: Run the full native inventory**

  From `apps/api`, run:

  ```bash
  pnpm exec oxlint --threads=1 --type-aware -D typescript/no-unsafe-type-assertion --format=json .
  ```

  Record `.diagnostics | length`, the count of unique `.diagnostics[].filename`
  values, and `.threads_count` from the native JSON. Expected: 269 diagnostics if
  no unrelated drift occurred. The current unique-file projection is 79 because
  both owned files should leave the inventory, but observed JSON is authoritative.

- [x] **Step 2: Run exact scoped repository verification sequentially**

  From the repository root, run `free -h` and `vmstat 1 2` first. Proceed only
  when `free` reports at least 2 GiB available and the second `vmstat` sample
  reports zero swap-in and swap-out (`si=0`, `so=0`). Then run:

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

  Do not run the root aggregate build, mutation testing, parallel workers, or a custom checker.

- [x] **Step 3: Obtain independent reviews**

  Require specification-compliance and code-quality reviews of the implementation, then a final whole-layer review including tracker/changelog truthfulness. Fix and re-review any P0/P1 finding.

- [x] **Step 4: Update canonical evidence**

  Record the five-finding reduction, direct-test count, final native inventory, and separate deferral of the SDK executable-binding assertion. Keep the native rule diagnostic until the full API inventory reaches zero.

- [x] **Step 5: Commit and publish the stacked PR**

  Commit with conventional messages and the required co-author trailer. Before
  publication, run `gh stack view --json` and require the current branch base to
  equal the live head of PR #396 with `needsRebase: false`. Publish a non-draft PR
  through gh-stack with a `Verification` section and no `Test plan` section. Use
  `Closes #...` only if a genuinely applicable issue exists. Monitor CI, repair
  failures, and do not merge.
