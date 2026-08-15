# Unsafe Assertion MCP Executor Binding Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the final two native unsafe assertions from the MCP server-client production boundary and its direct suite while preserving prototype-safe SDK executor lookup and JSON-RPC fixture validation.

**Architecture:** Keep the existing own-property descriptor check so remote tool names cannot bind inherited properties or trigger accessors, but use descriptor metadata only as runtime evidence and then read the executor through the SDK's typed map. Parse test JSON-RPC request bodies through the shared runtime record guard instead of asserting a shape. This is an SDK package-binding layer; it does not change schema admission, transport protocol behavior, or the fixture server.

**Tech Stack:** TypeScript, AI SDK MCP client, Vitest, Oxlint type-aware rules, pnpm, gh-stack

---

## Chunk 1: SDK executor materialization boundary

### Task 1: Freeze the two-finding baseline and direct MCP behavior

**Files:**

- Modify: `apps/api/src/mcp/mcp-server-client.test.ts`
- Verify: `apps/api/src/mcp/mcp-server-client.ts`

- [x] **Step 1: Capture the native failing assertion baseline**

  From `apps/api`, run:

  ```bash
  pnpm exec oxlint --threads=1 --type-aware -D typescript/no-unsafe-type-assertion --format=json src/mcp/mcp-server-client.ts src/mcp/mcp-server-client.test.ts
  ```

  Expected: exit 1 with exactly two diagnostics: the test JSON parser assertion and the production descriptor-value assertion.

- [x] **Step 2: Run the unchanged direct suite**

  From the repository root, run sequentially with one worker:

  ```bash
  pnpm --filter api exec vitest run --project unit src/mcp/mcp-server-client.test.ts --maxWorkers=1
  ```

  Expected: the full direct suite passes. It opens a loopback fixture server. If
  the output contains `listen EPERM: operation not permitted 127.0.0.1`, ignore
  the resulting per-test failure cascade and rerun the same command with narrowly
  scoped local-bind permission before interpreting any test failure. Only the
  permitted rerun is repository evidence.

- [x] **Step 3: Replace the test JSON assertion before production changes**

  Import `isRecord` into `mcp-server-client.test.ts`. Parse `init.body` into `unknown`, require a record, require `method` to be a string, and require an optional `id` to be a number before returning the narrow `{ id?, method }` fixture contract. Throw the existing fixture-style `TypeError` when the request body is malformed. Do not add `any`, another assertion, a suppression, or a bespoke parser/helper.

  Add one direct discovery case for the prototype-shadowing name `constructor`.
  Assert it is retained as `mcp__web__constructor`, proving a valid own SDK data
  property is not rejected. Keep the existing `__proto__` case proving that a
  name for which the SDK produces no own data property remains refused.

- [x] **Step 4: Re-run the direct suite before production changes**

  Run the Step 2 command. Expected: the full direct suite passes, including the new
  `constructor` case and the existing case that refuses a raw `__proto__` name when
  the SDK cannot create an own executor.

### Task 2: Bind only own SDK data properties without reading `any`

**Files:**

- Modify: `apps/api/src/mcp/mcp-server-client.ts`

- [x] **Step 1: Separate descriptor validation from typed map access**

  Store `Object.getOwnPropertyDescriptor(packageTools, definition.remoteName)` in a local descriptor. Refuse the declaration unless the descriptor exists and is a data property rather than an accessor (`get` and `set` are absent). After that evidence, read `packageTools[definition.remoteName]` through the SDK return type and keep the existing `packageTool?.execute === undefined` refusal.

  Do not read `descriptor.value`, call an accessor, use `Object.assign`, weaken the own-property requirement to an `in` check, or assert `PackageTool`.

- [x] **Step 2: Run focused GREEN checks**

  Run the Step 2 direct Vitest command, then:

  ```bash
  pnpm --filter api typecheck
  ```

  Expected: the direct suite passes and typecheck exits 0.

- [x] **Step 3: Prove both owned files have zero native findings**

  Re-run the Step 1 Oxlint command. Expected: exit 0 and zero diagnostics across both files.

### Task 3: Verify, review, and publish the layer

**Files:**

- Modify: `docs/code-quality-tracker.md`
- Modify: `CHANGELOG.md`
- Modify: `docs/superpowers/plans/2026-08-15-unsafe-assertion-mcp-executor-binding.md`

- [x] **Step 1: Run the full native inventory**

  From `apps/api`, run:

  ```bash
  pnpm exec oxlint --threads=1 --type-aware -D typescript/no-unsafe-type-assertion --format=json .
  ```

  Record total diagnostics, unique filenames, and `threads_count` from the native JSON. Expected: 267 diagnostics across 77 files if no unrelated drift occurred.

- [x] **Step 2: Run exact scoped repository verification sequentially**

  From the repository root, run `free -h` and `vmstat 1 2` first. This is an
  agent-host safety pause condition, not repository acceptance evidence. Proceed
  only when `free` reports at least 2 GiB available and the second `vmstat`
  sample reports `si=0`, `so=0`; otherwise pause and retry without recording a
  repository failure. Then run:

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

  Record the two-finding reduction, direct-suite count, final native inventory, and completion of all MCP production assertion boundaries. Keep the native rule diagnostic until the full API inventory reaches zero.

- [ ] **Step 5: Commit and publish the stacked PR**

  Commit with conventional messages and the required co-author trailer. Before publication, run `gh stack view --json` and require the current branch base to equal the live head of PR #397 with `needsRebase: false`. Publish a non-draft PR through gh-stack with a `Verification` section and no `Test plan` section. Use `Closes #...` only if a genuinely applicable issue exists. Monitor CI, repair failures, and do not merge.
