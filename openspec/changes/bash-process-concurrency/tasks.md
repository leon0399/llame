## Delivery stack

Use `$gh-stack` and `$openspec-apply-change` after proposal approval. Each layer
is one PR; keep it draft until its verification passes.

```text
master
  <- bash-process-concurrency/proposal
  <- bash-process-concurrency/implementation
  <- bash-process-concurrency/finalize
```

Every layer references #1050. `implementation` enables the concurrency behavior
but does not close #1050, whose acceptance also covers the long-command timeout
contract this change leaves open; that contract closes the issue with a later
change. `finalize` archives.

## 1. implementation

- [ ] 1.1 Delete `maxProcesses` from `BashExecutorContext` (`packages/bash-executor/src/types.ts`), own the bound as one named constant of four in the executor, drop the `maxProcesses <= 0` rule from `packages/bash-executor/src/sanitize.ts`, and stop passing the field from `apps/api/src/tools/bash.ts`; verify package tests that the executor admits up to four managed processes concurrently and refuses the next call before any process starts and before any attempt is written.
- [ ] 1.2 Add `process_limit` to the refusal union in `BashUnavailableResult` and map it in `apps/api/src/tools/bash.ts` to a result that names the bound and states that a retry may succeed; verify a unit test on the mapping, and a package test that an exhausted bound returns `process_limit` while an unset `tools.nativeExecutorId` still returns `unavailable`.
- [ ] 1.3 Replace the pinned refusal assertion (`packages/bash-executor/src/execute.test.ts:398`) and add the #1050 regression: a step issuing two bash calls admits both and records a result for each; verify the regression fails on the parent commit and passes here.
- [ ] 1.4 Document the bound: state the per-worker scope and the refuse-rather-than-queue behavior in the `bash` tool description (`apps/api/src/prompts/tools/bash.md`) and in `docs/product/reference/tools/bash.md` §Bounds and §Errors; add this layer's dated `CHANGELOG.md` entry; verify the tool-description test, `pnpm lint:markdown`, and `pnpm format:check` pass.
- [ ] 1.5 Self-review the parent-relative draft diff against `REVIEW_GUIDE.md`, fix accepted findings with new commits, and re-run the focused checks green before marking the PR ready.
- [ ] 1.6 Run the GitHub review and CI loop on the published head; verify every expected automated reviewer reports and CI is terminal and passing before handoff.

## 2. finalize

- [ ] 2.1 Enter `bash-process-concurrency/finalize` with `$gh-stack` before any synchronization write, then run `$openspec-sync-specs`; verify `pnpm exec openspec validate --specs --strict`, `pnpm exec openspec validate --all --strict`, `pnpm lint:markdown`, `pnpm format:check`, and `git diff --check` all pass and record the results in the PR body.
- [ ] 2.2 Confirm every task above is checked, then verify `openspec status --change bash-process-concurrency --json` reports the planning artifacts complete and that `openspec/specs/bash-execution/spec.md` carries the new requirement with every MODIFIED scenario still present.

## Workflow follow-up

- Run `$openspec-archive-change` after readiness is proved; self-review the finalize diff and run the review and monitoring loop as post-archive gates.
- Merge the stack only with Leo's explicit permission, through `$gh-stack`.
- Open a separate change for #1050's long-command timeout contract; that change closes #1050.
