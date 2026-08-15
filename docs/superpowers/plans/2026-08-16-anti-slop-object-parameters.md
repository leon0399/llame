# Anti-Slop Object Parameters Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove every broad `object` function parameter and enforce `anti-slop/no-object-parameters` at zero baseline across all five lint scopes.

**Architecture:** Preserve the existing HTTP and controller-test boundaries while naming what each helper actually accepts. HTTP helpers use their endpoint DTO plus one explicit invalid-property fixture variant, and the Pins controller fixture accepts only the public `PinsService` capabilities its tests provide. The maintained Oxlint rule becomes the shared local, hook, and CI gate after the three existing findings are removed.

**Tech Stack:** TypeScript, NestJS testing utilities, Supertest, Vitest, Oxlint, Prettier.

---

## No-go

- Do not replace `object` with `any`, `unknown`, `Record<string, unknown>`, an empty interface, or a renamed alias that resolves to `object`. The HTTP helpers already have owner DTOs.
- Do not weaken production DTOs or controller/service signatures to accommodate test fixtures.
- Do not add inline suppressions, a baseline, a custom checker, or another lint command.
- Do not delete invalid-payload tests or duplicate their request setup merely to remove the helper parameter.

## Task 1: Prove the current baseline

**Files:**

- Modify: `.oxlintrc.json`
- Modify: `apps/api/.oxlintrc.json`
- Modify: `apps/web/.oxlintrc.json`
- Modify: `apps/storybook/.oxlintrc.json`
- Modify: `packages/ui/.oxlintrc.json`

- [x] Add `"anti-slop/no-object-parameters": "error"` beside the three already-enabled anti-slop rules in all five configs.
- [x] Run `pnpm --filter api lint` and verify RED: exactly three diagnostics in `memory.integration.test.ts`, `personalization.integration.test.ts`, and `pins.test.ts`.
- [x] Run root, web, Storybook, and UI lint and verify they have no finding for the new rule.

## Task 2: Replace broad test-helper inputs with owned contracts

**Files:**

- Modify: `apps/api/src/memory/memory.integration.test.ts`
- Modify: `apps/api/src/personalization/personalization.integration.test.ts`
- Modify: `apps/api/src/pins/pins.test.ts`

- [x] Import `UpdateMemoryDto` and define `MemoryPatchBody` as `UpdateMemoryDto | (UpdateMemoryDto & { userId: string })`. Use it for the memory PATCH helper so normal payloads track the endpoint contract while the deliberate unknown-property request still reaches `ValidationPipe`.
- [x] Import `UpdatePersonalizationDto` and define the equivalent `PersonalizationPatchBody` union for the personalization helper. Do not make the invalid `userId` fixture compile only through a cast or dictionary type.
- [x] Define a local Pins controller service-double type as `Partial<Pick<PinsService, 'listPins' | 'pin' | 'unpin'>>` and use it for `makeController`. Do not introduce a production interface for a test-only fixture seam.
- [x] Run `pnpm --filter api lint` and verify GREEN: zero findings, including the new rule.
- [x] Run `pnpm --filter api exec vitest run --project unit src/pins/pins.test.ts` and verify the controller/service unit suite passes.
- [x] Run `pnpm --filter api typecheck` to prove the DTO and service-double contracts accept every current valid and intentionally invalid fixture.

## Task 3: Record and publish the stack layer

**Files:**

- Modify: `docs/code-quality-tracker.md`
- Modify: `CHANGELOG.md`
- Modify: `docs/superpowers/plans/2026-08-16-anti-slop-object-parameters.md`

- [x] Mark the rule active with zero diagnostics and add this dependent layer to the tracker.
- [x] Record the enforced rule and three refactored helpers in the changelog without claiming merge or release.
- [x] Run `pnpm lint:root`, the four workspace lint commands, API typecheck, focused Pins unit tests, `pnpm lint:markdown`, targeted Prettier, and `git diff --check` sequentially.
- [x] Obtain independent specification and code-quality review; repair every factual or P0/P1/P2 finding.
- [x] Commit with the required co-author trailer, link the branch above PR #402 with `gh stack link`, open the PR ready for review, and reference issue #268. Do not merge.
- [x] Require the full remote matrix to pass before calling the layer ready.
