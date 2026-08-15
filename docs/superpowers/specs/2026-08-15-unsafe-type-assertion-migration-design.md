# Unsafe Type-Assertion Migration Design

**Status:** Approved for autonomous execution on 2026-08-15.

## Goal

Remove unsafe narrowing assertions from existing API code, then reject them with
Oxlint's maintained type-aware `typescript/no-unsafe-type-assertion` rule. Preserve
runtime validation at untrusted boundaries instead of replacing assertions with
different unchecked syntax.

## Strongest counterargument

An assertion ban can create worse code when applied mechanically. Replacing a cast
with a ceremonial schema, `Reflect.get`, duplicated property checks, or a broad
lint suppression changes the spelling without adding evidence. Enabling the rule
before the existing tree is clean would also require the permanent baseline or
allowlist that this quality program forbids.

The migration therefore proceeds by coherent runtime boundary, not by search-and-
replace. Each layer must make the asserted fact derivable from control flow, a
validated schema, a narrower dependency contract, or a test fixture's construction.

## Decision

Do not vendor `dmmulroy/anti-slop` or enable its preset. Owning copied linter
implementation in this repository would violate the tracker rule to prefer
maintained industry tooling over repository-owned rule code. The external project
was useful as a source of hypotheses; it is not an enforcement dependency.

The two promising anti-slop ideas are already covered more directly by the
maintained `typescript-eslint` rule `no-unsafe-type-assertion`, which Oxlint 1.72.0
implements through the API's existing `oxlint-tsgolint` type-aware integration:

- `no-widen-then-assert`: the later narrowing assertion is rejected directly;
- `no-known-value-widening`: loss of evidence matters when it later requires an
  unchecked narrowing assertion. A blanket ban on explicit object contracts is
  intentionally not adopted because assigning an object literal to a precise
  named contract is legitimate boundary ownership, not necessarily evidence loss.

The remaining anti-slop rules stay investigation candidates, not defaults. Global
bans on `unknown`, `typeof`, dictionary types, module mocking, or identifier names
would reject legitimate parsing and framework boundaries in the current tree.

## Measured baseline

On branch `quality-taser/mutation-bounded-fetch-sse` at head
`4b65d3a1eacf6de98b7cafa109775df9715f8616` (PR #394; implementation commit
`e9e8a566`), the native command
`pnpm exec oxlint --threads=1 --type-aware -D
typescript/no-unsafe-type-assertion --format=json .` reports 282 API diagnostics
across 83 files. It scans existing production, unit, integration, evaluation, and
fixture code in 2.1 seconds with one Oxlint thread. The earlier timed multi-threaded
run peaked at 705,192 KiB RSS with zero swaps; all subsequent agent runs use one
thread. The quality tracker records this command and provenance so later slices can
reproduce their before/after counts.

The largest files are not one reviewable concern: run-execution tool integration
tests contain 36 findings, instance-config production and tests contain 42, and
result-truncation tests contain 14. This rules out a single cleanup PR.

## Architecture

### Shared runtime evidence

Introduce one small `isRecord(value: unknown): value is Record<string, unknown>`
guard at the API source root. It owns the recurring JSON-object boundary invariant:
non-null object and not an array. The module exports only that predicate. Replace
the four identical local implementations already present in MCP/tool modules and
use it where parsed JSON is currently cast. Exact-shape and domain validators stay
beside their domain code; this module must not become a generic validation sink.

The first implementation slice consolidates the four identical MCP/tool predicates
and migrates bounded-fetch request parsing to the shared guard. It removes one
measured production finding without changing the transport contract. Persisted
tool-observation validation is a separate chat-domain slice with seven findings.

### Migration sequence

1. Shared record guard, the four duplicate MCP/tool predicates, and bounded-fetch
   request parsing.
2. Persisted tool-observation part and compaction-ledger validation, verified by
   `src/chats/context-builder.test.ts` and `src/compaction/compaction.test.ts`, with
   malformed-part and malformed-ledger cases.
3. Remaining MCP production boundaries, one protocol or schema owner per layer.
4. Remaining tool-schema production boundaries, one owner per layer.
5. Instance-configuration JSON parsing.
6. Handlebars AST validation.
7. Queue boundaries.
8. Run boundaries.
9. Chat boundaries.
10. Database result boundaries.
11. Test and evaluation debt in independently reviewable fixture families; direct
    tests needed to prove a production refactor remain with that production layer.
12. Final zero-baseline API gate: enable
    `typescript/no-unsafe-type-assertion` in `apps/api/.oxlintrc.json` only after the
    native full-tree scan reports zero.

Each layer records its before/after native diagnostic count in the quality tracker.
No diff-only gate, file override, suppression, baseline, or allowlist is accepted as
the finished state.

### Workspace boundary

This design covers `apps/api`, the only workspace currently configured for
type-aware Oxlint. Web, UI, and Storybook require a separate measured decision about
type-aware lint cost and framework false positives before the rule can be applied
there. The existing full-tree double-assertion gate remains cross-workspace.

## Verification

Every slice runs the native one-thread diagnostic on its owned files, focused
Vitest suites, API lint and typecheck, full-tree ast-grep and Markdown gates,
Prettier check, and `git diff --check`. Behavior-changing boundary repairs add a
red test first. Pure control-flow refactors must keep existing focused tests green
and receive independent specification and code-quality reviews.

## Rejected shortcuts

- Vendor the anti-slop plugin or maintain a fork of its rules in this repository.
- Enable all 15 rules and suppress or baseline the fallout.
- Replace assertions with `any`, `Reflect.get`, assertion functions that do no
  validation, or schema parsing where ordinary control-flow narrowing suffices.
- Enable the native rule with per-file exceptions before the existing API is clean.
- Convert all 282 diagnostics in one PR.

## Revision history

- **v2 (2026-08-15):** Anchored the baseline to the exact branch head and tracker,
  split MCP transport from persisted chat validation, decomposed the migration into
  tracker-ownable boundaries, and constrained the shared guard to one predicate.
- **v1 (2026-08-15):** Initial approved design from the native Oxlint baseline and
  anti-slop source review.
