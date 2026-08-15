# Unsafe Assertion Boundary Foundation Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace four duplicate JSON-record predicates plus bounded-fetch's unchecked parsed-body assertion with one shared runtime guard, reducing the native API unsafe-assertion inventory from 282 to 281 without changing behavior.

**Architecture:** Add one root API utility exporting only `isRecord`; keep exact-shape validation in each feature. Characterize the shared predicate before adding it, migrate only the existing MCP/tool duplicates and bounded-fetch parser, and leave the native rule non-blocking until the full API reaches zero.

**Tech Stack:** TypeScript, Vitest 4, Oxlint 1.72 type-aware rules, `oxlint-tsgolint` 0.24, `gh-stack`

---

## Chunk 1: Runtime record boundary

### Task 1: Establish red evidence and the shared predicate

**Files:**

- Create: `apps/api/src/unknown-record.test.ts`
- Create: `apps/api/src/unknown-record.ts`
- Verify: `apps/api/src/mcp/mcp-bounded-fetch.ts`

- [ ] From `apps/api`, run
      `pnpm exec oxlint --threads=1 --type-aware -D typescript/no-unsafe-type-assertion --format=json src/mcp/mcp-bounded-fetch.ts`
      and verify exactly one diagnostic at the parsed request body.
- [ ] Add a Vitest test importing `isRecord` from the not-yet-created module and specifying the boundary: accept plain and null-prototype records; reject `null`, arrays, primitives, and functions.
- [ ] Run `pnpm --filter api exec vitest run src/unknown-record.test.ts` and verify RED because `./unknown-record` does not exist.
- [ ] Add `apps/api/src/unknown-record.ts` with only:

```ts
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
```

- [ ] Run the focused test and verify GREEN.

### Task 2: Consolidate existing MCP/tool predicates

**Files:**

- Modify: `apps/api/src/mcp/declaration-admission.ts`
- Modify: `apps/api/src/mcp/protected-values.ts`
- Modify: `apps/api/src/mcp/mcp-server-client.ts`
- Modify: `apps/api/src/tools/turn-tool-catalog.ts`

- [ ] Import `isRecord` from `../unknown-record` in each owner and delete only the byte-identical local predicate.
- [ ] Do not move exact-key, protocol, schema, redaction, or domain validators into the shared module.
- [ ] Run the direct suites sequentially:
      `src/mcp/declaration-admission.test.ts`,
      `src/mcp/protected-values.test.ts`,
      `src/mcp/mcp-server-client.test.ts`, and
      `src/tools/turn-tool-catalog.test.ts`.

### Task 3: Migrate bounded-fetch request parsing

**Files:**

- Modify: `apps/api/src/mcp/mcp-bounded-fetch.ts`
- Verify: `apps/api/src/mcp/mcp-bounded-fetch.test.ts`

- [ ] Import `isRecord` and replace the manual object/array condition plus `as Record<string, unknown>` with `if (!isRecord(body))` and direct indexed access.
- [ ] Preserve malformed JSON fallback, non-string method fallback, HTTP-method normalization, and all request/response byte behavior.
- [ ] Run `pnpm --filter api exec vitest run src/mcp/mcp-bounded-fetch.test.ts`; all 46 existing tests must pass.
- [ ] From `apps/api`, run
      `pnpm exec oxlint --threads=1 --type-aware -D typescript/no-unsafe-type-assertion --format=json src/unknown-record.ts src/mcp/declaration-admission.ts src/mcp/protected-values.ts src/mcp/mcp-server-client.ts src/mcp/mcp-bounded-fetch.ts src/tools/turn-tool-catalog.ts`
      and verify zero diagnostics.
- [ ] From `apps/api`, run
      `pnpm exec oxlint --threads=1 --type-aware -D typescript/no-unsafe-type-assertion --format=json .`
      and verify 281 diagnostics. Record the observed unique-file count from native JSON rather than making it a brittle acceptance target. If the diagnostic count differs, inspect the native JSON rather than editing the target to fit the expected number.

## Chunk 2: Evidence and publication

### Task 4: Record the completed slice

**Files:**

- Modify: `docs/code-quality-tracker.md`
- Modify: `CHANGELOG.md`
- Modify: `docs/superpowers/plans/2026-08-15-unsafe-assertion-boundary-foundation.md`

- [ ] Add the boundary-foundation layer to the tracker, preserving the 282/83 historical baseline and recording the new 281 count plus the observed unique-file count.
- [ ] Record the anti-slop no-go: do not vendor its rule source or install the all-on preset while maintained native rules cover the useful defect class.
- [ ] Add a dated changelog entry describing the shared guard, five migrated owners, one removed unsafe assertion, and non-blocking migration status.
- [ ] Mark only completed plan steps checked; do not claim the native rule is enabled or the 281 remaining diagnostics are resolved.

### Task 5: Verify, review, and publish

- [ ] Run sequentially: the six focused Vitest files, `pnpm --filter api lint`, `pnpm --filter api typecheck`, `pnpm lint:ast-grep`, `pnpm lint:markdown`, `pnpm format:check`, and `git diff --check`.
- [ ] Do not run a root aggregate build, background command, or multi-threaded type-aware pilot.
- [ ] Receive independent specification-compliance review, then independent code-quality review; repair and re-review every P0/P1 finding.
- [ ] Commit implementation and documentation with the required co-author trailer.
- [ ] Submit a non-draft stacked PR based on #394, update the tracker with the actual PR number, commit the bookkeeping, push, and verify `needsRebase: false`.

## Revision history

- **v1 (2026-08-15):** Initial plan from the approved unsafe-assertion migration design and the 282-diagnostic native baseline.
