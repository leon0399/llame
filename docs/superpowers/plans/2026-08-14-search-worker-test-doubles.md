# Search Worker Test-Double Migration Plan

**Status:** Implemented locally; pending independent review and stacked PR
submission on
`quality-taser/search-worker-test-doubles`.

**Goal:** Remove all six `as unknown as` assertions from
`apps/api/src/search/search-reindex.worker.test.ts` without weakening the
boot-time provisioning, non-fatal degradation, or logging checks.

**Approach:** Replace direct private-member access and hand-forged whole-service
casts with Nest's standard testing surface:

- compile `SearchReindexWorker` in a real `TestingModule`;
- override its providers with the minimal values Nest accepts at runtime;
- exercise the public `onApplicationBootstrap()` lifecycle;
- spy on `Logger.prototype` rather than asserting through the worker's private
  logger field;
- let queue bootstrap methods resolve without executing consumer callbacks.

No production change, custom test framework, private-member assertion,
repository-specific runner, assertion allowlist, or replacement `as any`
belongs in this slice.

## Execution and verification

1. Run the focused unit suite to establish the behavior baseline.
2. Move the existing four cases onto `TestingModule` and the public lifecycle.
3. Prove the owned file contains no `as unknown as` and introduces no `as any`.
4. Run the focused suite, full API unit project, build, typecheck, lint,
   Prettier, and `git diff --check`.
5. Update the tracker and changelog with measured counts and evidence.
6. Obtain independent specification and quality reviews before committing.

## Acceptance

- [x] The owned test contains no `as unknown as` and introduces no `as any`.
- [x] All four focused unit tests pass through the public bootstrap lifecycle.
- [x] The full API unit project passes: 78 files, 1,090 tests.
- [x] API build, typecheck, and lint pass.
- [x] Prettier and `git diff --check` pass.
- [ ] Independent specification and quality reviews approve the slice.
