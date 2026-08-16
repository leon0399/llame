# Chat Controller Test-Double Migration Plan

**Status:** Implemented and independently approved locally; pending stacked PR
submission on
`quality-taser/chat-controller-test-doubles`.

**Goal:** Remove all six `as unknown as` assertions from
`apps/api/src/chats/chats.controller.test.ts` without weakening controller,
streaming, abort, ownership, or error behavior.

**Approach:** Use existing framework, runtime, and SDK surfaces only:

- narrow controller dependencies to the capabilities the controller consumes,
  using `Pick<>` and explicit Nest injection tokens where required;
- keep Vitest mocks inferred so call assertions remain type-safe;
- use Node stream/event primitives and Express response capabilities for SSE;
- use the AI SDK's exported stream/result types instead of a locally invented
  approximation.

No shared mock layer, repository-specific runner, assertion allowlist, custom
quality script, `as any`, or weaker single assertion belongs in this slice.

## Execution and verification

1. Characterize the six assertions and run the focused controller suite.
2. Replace service doubles and streaming fixtures with the standard typed
   surfaces above; change production signatures only where the consumer
   contract is currently broader than its actual use.
3. Prove the owned test has zero `as unknown as` and no replacement `as any`.
4. Run the focused suite, full API unit project, API build/typecheck/lint,
   Prettier, and `git diff --check`.
5. Update the tracker and changelog with measured counts and verified evidence.
6. Obtain independent specification and quality reviews before committing the
   stack layer.

## Acceptance

- [x] The owned test contains no `as unknown as` or replacement `as any`.
- [x] Controller behavior and all 22 focused tests pass.
- [x] The full API unit project passes: 78 files, 1,090 tests.
- [x] API build, typecheck, and lint pass.
- [x] Prettier and `git diff --check` pass.
- [x] Independent specification and quality reviews approve the slice.
