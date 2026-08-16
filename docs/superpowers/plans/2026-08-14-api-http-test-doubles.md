# API HTTP Test-Double Migration Plan

**Status:** Implemented locally; pending stacked PR submission.

**Goal:** Remove all 16 `as unknown as` assertions from the API app-setup,
authentication, models-controller, and runs-controller unit tests without
weakening their HTTP, security, or framework behavior checks.

**Approach:** Use existing framework and language surfaces only:

- narrow production consumers with `Pick<>` where a test only needs part of a
  NestJS service or application contract;
- keep Vitest spies inferred so their call metadata remains available;
- use real NestJS, Express, and validation types instead of hand-forged
  framework objects;
- inspect public framework behavior rather than casting through private state.

No shared mock layer, repository-specific test runner, cast allowlist, or custom
quality script belongs in this slice.

## Acceptance

- [x] The five owned test files contain no `as unknown as` or replacement
      `as any` assertions.
- [x] Focused Vitest suites pass: 5 files, 29 tests.
- [x] The full API unit project passes: 78 files, 1,090 tests.
- [x] API build, typecheck, and lint pass.
- [x] Prettier and `git diff --check` pass.
- [x] Independent specification and quality reviews approve the slice.

The unrestricted unit rerun was necessary because the MCP suites bind localhost
and spawn fixture processes; the restricted sandbox run failed at `listen EPERM`,
while the identical permitted run passed all 1,090 tests.
