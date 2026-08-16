# Chat-Loop Integration Test-Double Migration Plan

**Status:** Implemented and independently approved locally; pending stacked PR
submission on
`quality-taser/chat-loop-integration-doubles`.

**Goal:** Remove all seven `as unknown as` assertions from
`apps/api/src/chats/chat-loop.integration.test.ts` without weakening its real
Postgres, transaction, rollback, single-flight, or tool-availability coverage.

**Approach:** Use the narrow production contracts that already exist:

- `ModelSelectionValidator` for model-catalog validation;
- `RunStreamResponder` with a native Web `Response`;
- `RunDispatcher` with typed Vitest functions;
- `InstanceConfigReader` with `BUILT_IN_DEFAULTS` plus explicit test overrides.

The suite keeps the real `TenantDbService` and Postgres repositories. No
production type change, custom fixture builder, repository-specific runner,
assertion allowlist, `as any`, or weaker replacement assertion belongs here.

## Execution and verification

1. Run the focused integration suite to establish the behavior baseline.
2. Replace the seven broad service assertions with the four existing narrow
   contracts and complete standard configuration values.
3. Prove the owned file contains no `as unknown as` or replacement `as any`.
4. Run the focused real-Postgres integration suite, API unit suite, build,
   typecheck, lint, Prettier, and `git diff --check`.
5. Update the tracker and changelog with measured counts and verified evidence.
6. Obtain independent specification and quality reviews before committing.

## Acceptance

- [x] The owned integration test contains no `as unknown as` or replacement
      `as any`.
- [x] All 19 focused real-Postgres integration tests pass.
- [x] The full API unit project passes: 78 files, 1,090 tests.
- [x] API build, typecheck, and lint pass.
- [x] Prettier and `git diff --check` pass.
- [x] Independent specification and quality reviews approve the slice.
