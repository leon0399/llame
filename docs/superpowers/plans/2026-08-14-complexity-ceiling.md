# Complexity Ceiling Implementation Plan

**Status:** Implemented locally; pending stacked PR submission.

**Goal:** Enforce modified cyclomatic complexity `<= 35` in every lint-owning
TypeScript workspace and reduce the only baseline violation without changing
chat transaction behavior or extracting arbitrary metric-driven helpers.

**Tooling:** Oxlint's native `complexity` rule. No custom calculator, fixture
harness, allowlist, or repository-specific wrapper.

## Baseline

With Oxlint's `modified` variant and maximum 20, the measured debt was API 12,
web 3, UI 1, Storybook 0. At maximum 35, only the accepted-turn transaction
callback in `chat-loop.service.ts` failed, measuring 53.

## Implementation

### 1. Configure the native rule

Add this rule to the four existing workspace configs:

```json
"complexity": ["error", { "max": 35, "variant": "modified" }]
```

Files:

- `apps/api/.oxlintrc.json`
- `apps/web/.oxlintrc.json`
- `packages/ui/.oxlintrc.json`
- `apps/storybook/.oxlintrc.json`

Run `pnpm exec turbo run lint --force` before the extraction. Expected RED: one
error at complexity 53 in `chat-loop.service.ts`; no other workspace violation.

### 2. Extract one responsibility boundary

Extract system-prompt rendering, effective-context resolution, prior snapshot
and compaction reads, and message-part assembly into the private
`buildTurnContextAndParts` helper. Keep transaction ownership, tenant scope,
lock ordering, conflict/retry behavior, run creation, event append, and snapshot
persistence in the original callback.

The existing `MessagePart` contract must explicitly include the already-stored
`ModelSwitchPart`, `ToolAvailabilityPart`, and `RecencyDigestPart` variants. Do
not hide that pre-existing contract gap with spreads or assertions.

### 3. Record policy and evidence

Document that 35 is a ceiling, not a design target. Inline disables, arbitrary
helper extraction, and one-interface-per-service ceremony are prohibited. Lower
ratchets remain evidence-driven follow-up work.

## Acceptance

- [x] The four workspace configs use Oxlint's native modified-complexity rule.
- [x] `pnpm exec turbo run lint --force` passes after extraction.
- [x] The original callback measures 30; `buildTurnContextAndParts` measures 24.
- [x] Context-builder and chat-loop unit tests pass: 83/83.
- [x] Real-Docker chat-loop integration tests pass: 19/19.
- [x] `pnpm --filter api typecheck` passes.
- [x] Prettier and `git diff --check` pass.
- [x] Independent specification and quality reviews approve the layer.
