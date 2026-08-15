# Bounded Fetch SSE Mutation Repair Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents are available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repair and account for the exact 16 queued bounded-fetch mutation gaps covering SSE recognition/framing, explicit consumer cancellation, and transparent response metadata.

**Architecture:** Add behavior assertions only to the direct bounded-fetch Vitest suite unless a red assertion exposes a production defect. Treat the existing native Stryker survivor report as the red baseline, use Web Streams and Fetch API primitives directly, and keep `mcp-bounded-fetch.ts` byte-for-byte unchanged unless required by observable behavior. Do not add helpers, custom runners, reporters, ignores, or thresholds.

**Tech Stack:** TypeScript, Vitest 4.1.10, StrykerJS 9.6.1, Web Streams API, Fetch API, `gh-stack`

---

## Chunk 1: SSE contracts

### Task 1: Establish the child layer and baseline

**Files:**

- Verify: `docs/code-quality-tracker.md`
- Verify: `apps/api/reports/mutation/mutation.json` (generated and ignored)
- Verify: `apps/api/src/mcp/mcp-bounded-fetch.ts`

- [x] Verify PR #393 is the clean top of stack #369 with `needsRebase: false`.
- [x] Run `gh stack add quality-taser/mutation-bounded-fetch-sse` before editing.
- [x] Record the production source SHA-256 and confirm the native report contains all and only these queued layer-4 survivors: `S85`, `S113`, `S136`, `S137`, `S139`, `S140`, `S146`, `S149`, `S151`, `S153`, `S163`, `S164`, `S165`, `S166`, `S167`, and `S168`.

### Task 2: Cover SSE recognition and blank-line framing

**Files:**

- Modify: `apps/api/src/mcp/mcp-bounded-fetch.test.ts`

- [x] Add a successful parameterized `text/event-stream; charset=utf-8` response whose aggregate body exceeds the per-event limit; this kills `S85`.
- [x] Add successful streams with a leading LF blank line and two bare-CR-delimited events at the exact per-event limit; these kill `S113` and `S136`.
- [x] Run the focused Vitest suite; all assertions must pass on production.

### Task 3: Cover multi-line SSE events

**Files:**

- Modify: `apps/api/src/mcp/mcp-bounded-fetch.test.ts`

- [x] Add oversized multi-line event assertions using bare CR, CRLF, and LF delimiters. Each line fits independently while the event does not, so incorrect per-line resets survive no longer. This kills `S137`, `S139`, `S140`, `S146`, `S149`, `S151`, and `S153`.
- [x] Assert each returned body rejects with `McpBodyLimitError` and cancels its upstream stream exactly once.
- [x] Run the focused Vitest suite.

## Chunk 2: Wrapper transparency and publication

### Task 4: Cover consumer cancellation and response metadata

**Files:**

- Modify: `apps/api/src/mcp/mcp-bounded-fetch.test.ts`

- [x] Read from the returned bounded stream, explicitly cancel its reader with a sentinel reason, and assert the upstream reader receives that exact reason; this kills `S163`.
- [x] Return a native `Response` with nondefault status, status text, header, `redirected`, `type`, and `url`; assert the bounded wrapper preserves every field while preserving its body. This kills `S164` through `S168`.
- [x] Run the focused Vitest suite and verify the production source hash remains unchanged.

### Task 5: Run the bounded mutation measurement and update evidence

**Files:**

- Inspect: `apps/api/reports/mutation/mutation.json` (generated and ignored)
- Modify: `docs/code-quality-tracker.md`
- Modify: `docs/superpowers/plans/2026-08-15-mutation-testing-pilot.md`
- Modify: `CHANGELOG.md`

- [x] Check available memory and swap activity; do not run below 2 GiB available memory or while swap is actively increasing.
- [x] Run one foreground native command with configured concurrency 1: `/usr/bin/time -v pnpm --filter api exec stryker run --mutate src/mcp/mcp-bounded-fetch.ts --testFiles src/mcp/mcp-bounded-fetch.test.ts`.
- [x] Record totals, score, survivor/no-coverage IDs, wall time, peak RSS, and swaps. Account for all 16 target IDs using native JSON evidence; do not invent exclusions or reclassifications to improve the score.
- [x] Update the tracker, parent plan, this plan, and changelog without rewriting the historical baseline.

### Task 6: Verify and publish

- [x] Run sequentially: focused Vitest, `pnpm --filter api lint`, `pnpm --filter api typecheck`, `pnpm lint:ast-grep`, `pnpm lint:markdown`, `pnpm format:check`, and `git diff --check`.
- [x] Do not run the aggregate root build.
- [x] Review the diff for production changes, generated reports, custom infrastructure, issue-closing claims, and scope creep.
- [ ] Commit with the required co-author trailer.
- [ ] Publish a non-draft stacked PR based on #393, update the tracker with its PR number, push, and verify `needsRebase: false`.
