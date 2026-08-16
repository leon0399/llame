# Bounded Fetch Limits Mutation Repair Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents are available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repair and account for the 42 baseline useful mutation gaps in MCP request context, request-body sizing, session handling, and non-SSE response limits as one reviewable child stack layer.

**Architecture:** Add behavior assertions only to the direct bounded-fetch unit suite unless a test exposes a production defect. Keep SSE framing, explicit consumer cancellation, and response metadata in child layer 4. Use the installed native Stryker/Vitest runner with one worker; prove new assertions with exact temporary mutant replacements, then restore production source byte-for-byte.

**Tech Stack:** TypeScript, Vitest 4.1.10, StrykerJS 9.6.1, `gh-stack`

---

## Chunk 1: Request contracts

### Task 1: Create the child stack layer

**Files:**

- Verify: `docs/code-quality-tracker.md`
- Verify: `apps/api/src/mcp/mcp-bounded-fetch.ts`
- Verify: `apps/api/src/mcp/mcp-bounded-fetch.test.ts`

- [x] Run `gh stack view --json` and verify #392 is the clean, unrebase-needed top.
- [x] Run `gh stack add quality-taser/mutation-bounded-fetch-limits` before editing.
- [x] Record the production source SHA-256 and keep production changes out unless a behavior assertion exposes a real defect.

### Task 2: Cover request accounting context

**Files:**

- Modify: `apps/api/src/mcp/mcp-bounded-fetch.test.ts`
- Temporarily mutate and restore: `apps/api/src/mcp/mcp-bounded-fetch.ts:27-46`

- [x] Add focused assertions that consume the returned body and observe `onBytes`:
  - lower-case `init.method` is reported as upper-case;
  - a `Request` method is used when `init.method` is absent;
  - a URL request defaults to `GET`;
  - a non-string body preserves the HTTP method and reports `rpcMethod: null`;
  - JSON `method` values that are numeric, boolean, or object report `null`;
  - malformed JSON reports `null` without throwing.
- [x] Run `pnpm --filter api exec vitest run --project unit src/mcp/mcp-bounded-fetch.test.ts`; current production must stay green.
- [x] Apply representative exact native replacements for `S7`, `S10`, `S17`, `S33`, and `NC37`, one at a time. Each new behavior assertion must fail for the intended reason; restore the source after every probe.
- [x] Re-run the direct suite and verify green plus the original production SHA-256.

### Task 3: Cover every supported request-body size branch

**Files:**

- Modify: `apps/api/src/mcp/mcp-bounded-fetch.test.ts`
- Temporarily mutate and restore: `apps/api/src/mcp/mcp-bounded-fetch.ts:50-80`

- [x] Add table-driven exact-boundary and one-byte-over assertions for `URLSearchParams`, `ArrayBuffer`, `Uint8Array`, and `Blob` request bodies.
- [x] Add independent assertions for:
  - a two-byte UTF-8 string at a two-byte limit;
  - absent and `null` bodies with a zero-byte limit;
  - an unsupported `ReadableStream` body rejected when a request limit exists;
  - the same unsupported body reaching fetch when the request limit is omitted;
  - a supported below-limit body reaching fetch.
- [x] Run the direct suite and verify green.
- [x] Apply representative exact native replacements for `S39`, `NC51`, `NC54`, `NC56`, `NC58`, `S41`, `S47`, `S65`, and `S68`, one at a time. Verify the relevant behavior test fails, then restore.
- [x] Re-run the direct suite and verify green plus the original production SHA-256.

## Chunk 2: Response contracts and publication

### Task 4: Cover session and non-SSE response semantics

**Files:**

- Modify: `apps/api/src/mcp/mcp-bounded-fetch.test.ts`
- Temporarily mutate and restore: `apps/api/src/mcp/mcp-bounded-fetch.ts:85-120`

- [x] Add assertions that an absent session header does not call `onSessionId`, while a present header with no callback does not throw.
- [x] Add a successful `application/json` response whose streamed body is exactly the response limit; assert its content is preserved.
- [x] Add `Content-Length` cases for numeric prefix junk, numeric suffix junk, a multi-digit oversized claim, and an exact-limit claim.
- [x] Add an oversized claimed response with `body: null`; assert `McpBodyLimitError`, not a null-body dereference.
- [x] Add a bodyless response without an oversized claim and assert the exact original `Response` object is returned.
- [x] Run the direct suite and verify green.
- [x] Apply representative exact native replacements for `S79`, `S81`, `S89`, `S101`, `S102`, `S103`, `S106`, `S109`, `S111`, and `S123`, one at a time. Verify the relevant assertion fails, then restore.
- [x] Re-run the direct suite and verify green plus the original production SHA-256.

### Task 5: Run the final bounded mutation measurement

**Files:**

- Inspect: `apps/api/reports/mutation/mutation.json` (generated and ignored)
- Modify: `docs/code-quality-tracker.md`
- Modify: `docs/superpowers/plans/2026-08-15-mutation-testing-pilot.md`
- Modify: `CHANGELOG.md`

- [x] Check `free -h`; do not run if available memory is below 2 GiB or swap is actively increasing.
- [x] Run one foreground command only:
      `/usr/bin/time -v pnpm --filter api exec stryker run --mutate src/mcp/mcp-bounded-fetch.ts --testFiles src/mcp/mcp-bounded-fetch.test.ts`.
- [x] Record native totals, score, covered score, survivor/no-coverage IDs, wall time, peak RSS, and swaps. Keep `concurrency: 1`; do not add wrappers, custom reporters, ignores, or a CI threshold.
- [x] Account for all 42 baseline `U` IDs. Reclassify only with supported-domain reasoning or exact-replacement failure evidence; leave the 16 layer-4 IDs queued.
- [x] Update tracker status/backlog, the parent pilot plan, and the changelog. Do not rewrite the historical baseline.

### Task 6: Verify and publish

- [x] Run sequentially: direct Vitest, `pnpm --filter api lint`, `pnpm --filter api typecheck`, `pnpm lint:ast-grep`, `pnpm lint:markdown`, `pnpm format:check`, and `git diff --check`.
- [x] Do not run the aggregate root build.
- [x] Review the layer diff for production changes, generated reports, custom infrastructure, issue-closing claims, and accidental layer-4 scope.
- [x] Commit with the required co-author trailer.
- [x] Link the branch to stack #369, publish a non-draft PR based on #392, update the tracker with its PR number, push, and verify `needsRebase: false`.
