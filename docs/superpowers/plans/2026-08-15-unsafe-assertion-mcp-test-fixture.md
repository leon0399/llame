# Unsafe Assertion MCP Test Fixture Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development
> (if subagents are available) or superpowers:executing-plans to implement this
> plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the four unsafe assertions from the shared MCP HTTP test fixture
without changing JSON-RPC request summaries, cursor extraction, or loopback server
addressing.

**Architecture:** Reuse the root `isRecord` runtime guard for parsed JSON objects
and narrow Node's native `AddressInfo | string | null` return value through control
flow. Keep the fixture as the single shared transport test double; do not add a
schema library, parser abstraction, assertion, suppression, or custom checker.

**Tech Stack:** TypeScript, Node HTTP server, Vitest, Oxlint type-aware rules,
pnpm, gh-stack

---

## Chunk 1: Shared MCP fixture boundary

### Task 1: Freeze the four-finding baseline and fixture behavior

**Files:**

- Modify: `apps/api/src/mcp/mcp-test-fixture.ts`
- Modify: `apps/api/src/mcp/mcp-test-fixture.test.ts`
- Verify: `apps/api/src/mcp/mcp-server-client.test.ts`
- Verify: `apps/api/src/mcp/mcp-package.contract.test.ts`

- [x] **Step 1: Capture the native failing baseline**

  From `apps/api`, run:

  ```bash
  pnpm exec oxlint --threads=1 --type-aware \
    -D typescript/no-unsafe-type-assertion --format=json \
    src/mcp/mcp-test-fixture.ts
  ```

  Expected: exit 1 with exactly four diagnostics: three JSON record assertions
  and one `AddressInfo` assertion.

- [x] **Step 2: Run the unchanged direct fixture suite**

  From the repository root, run with one worker:

  ```bash
  pnpm --filter api exec vitest run --project unit \
    src/mcp/mcp-test-fixture.test.ts --maxWorkers=1
  ```

  Expected: 8/8 pass. This opens a loopback server. If sandboxing rejects the
  local bind, rerun with narrowly scoped loopback permission before interpreting
  the result.

- [x] **Step 3: Characterize non-record and malformed request bodies**

  Add table-driven direct fixture cases for `{}`, a JSON array, a primitive,
  `null`, a non-string `method`, non-record `params`, and a non-string `cursor`.
  Assert the recorded summary uses `rpcMethod: null` or `cursor: null` as
  appropriate. Add a separate malformed-JSON case that asserts HTTP 400 and no
  recorded request. Keep the fixture implementation unchanged and run the direct
  suite; expected: 16/16 pass.

### Task 2: Replace assertions with existing runtime evidence

**Files:**

- Modify: `apps/api/src/mcp/mcp-test-fixture.ts`

- [x] **Step 1: Narrow parsed JSON with `isRecord`**

  Import `isRecord` from `../unknown-record`. Use it in `readRpcMethod` for the
  request body and in `readCursor` for both the body and nested `params`. Preserve
  the existing string-only method/cursor behavior for object, array, primitive,
  null, and malformed JSON inputs. Do not introduce a fixture-specific validator.

- [x] **Step 2: Narrow the native server address union**

  Remove the `node:net` `AddressInfo` import. Read `server.address()` without an
  assertion. If it is `null`, throw the fixture-specific `TypeError` directly
  because no listener exists. If it is a string, await a callback-backed
  `server.close()` Promise before throwing the same error so the Unix-socket
  listener is not leaked. Otherwise use the narrowed TCP address port. Do not
  forge an address or use a non-null assertion.

- [x] **Step 3: Run focused GREEN checks**

  Run the direct fixture suite, then the three unit consumers sequentially with
  one worker:

  ```bash
  pnpm --filter api exec vitest run --project unit \
    src/mcp/mcp-test-fixture.test.ts \
    src/mcp/mcp-server-client.test.ts \
    src/mcp/mcp-package.contract.test.ts --maxWorkers=1
  pnpm --filter api typecheck
  ```

  These tests exercise normal JSON-RPC summaries, pagination/cursor extraction,
  real TCP binding, server-client transport, and package-contract discovery.

- [x] **Step 4: Prove the owned file has zero native findings**

  Re-run Task 1 Step 1. Expected: exit 0 and zero diagnostics.

### Task 3: Verify, review, and publish the layer

**Files:**

- Modify: `docs/code-quality-tracker.md`
- Modify: `CHANGELOG.md`
- Modify: `docs/superpowers/plans/2026-08-15-unsafe-assertion-mcp-test-fixture.md`

- [x] **Step 1: Run the full native inventory**

  From `apps/api`, run:

  ```bash
  pnpm exec oxlint --threads=1 --type-aware \
    -D typescript/no-unsafe-type-assertion --format=json .
  ```

  Record total diagnostics, unique filenames, and `threads_count` from the native
  JSON. Expected: 260 diagnostics across 75 files with one thread if no unrelated
  drift occurred; observed output is authoritative.

- [x] **Step 2: Run exact bounded repository verification**

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

- [x] **Step 3: Obtain independent reviews**

  Require specification-compliance, code-quality, and final whole-layer reviews.
  Fix and re-review every P0/P1 finding and any factual documentation defect.

- [x] **Step 4: Update canonical evidence**

  Record the four-finding reduction, focused suite counts, final native inventory,
  and remaining MCP test/integration debt. Keep the native rule diagnostic until
  the full API inventory reaches zero.

- [ ] **Step 5: Commit and publish the stacked PR**

  Commit with conventional messages and the required co-author trailer. Require
  the current branch base to equal the live head of PR #399 with
  `needsRebase: false`. Publish a non-draft PR through gh-stack with a
  `Verification` section and no `Test plan` section. Use `Closes #...` only for a
  genuinely applicable issue. Monitor CI, repair failures, and do not merge.
