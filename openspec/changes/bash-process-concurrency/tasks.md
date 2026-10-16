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

- `proposal`, parent `master`: owns planning only; estimate 500 authored lines,
  no generated churn. Prove strict change validation, Markdown lint, changed-file
  formatting, and diff whitespace; complete independent refinement and obtain
  approval of the published revision before creating implementation branches.
  After publication permission, self-review the actual draft diff before ready,
  then complete the GitHub review/CI loop. Local readiness is not approval.
- `implementation`, parent `proposal`: owns the configurable worker limiter,
  API wiring, regression tests, and shipped documentation atomically; estimate
  1,400 authored lines and no generated churn. Tasks 1.1–1.7 own its exit evidence.
  Re-estimate before publication and split or seek an exception if over budget.
- `finalize`, parent `implementation`: owns canonical spec synchronization and
  archive movement only; estimate 600 authored added-plus-deleted lines, no
  generated churn. Tasks 2.1–2.2 gate archive; SR and GR follow archive movement.

No layer here closes #1050. The later timeout implementation owns closure only
when all remaining published acceptance is satisfied.

## 1. implementation

- [ ] 1.1 Add `tools.bashMaxProcesses` to configuration types, defaults, parser, schema, and example; default four, reject invalid resolved values per design D4. Verify focused `config-loader.test.ts` tests cover absent, explicit one, larger valid capacity, interpolation, null, wrong type, zero, negative, fractional, non-finite, and unsafe integers.
- [ ] 1.2 Replace `maxProcesses` and the module-global counter with the shared `BashProcessLimiter`; drop the obsolete sanitize rule. Create it once in worker composition and pass the same object through every Run context in both worker topologies. Verify configured capacities of one and four, independent limiters, and separate concurrent Run contexts sharing one limiter. Verify pending durable writes already consume slots, and refusals start no process and record no attempt.
- [ ] 1.3 Add `process_limit` to the package result union with a message naming actual capacity, per-worker scope, and fresh retry; verify the existing API mapping preserves it and the missing executor path remains `executor_unavailable`. Replace the pinned refusal assertion. Add the #1050 two-call regression with two slots free and two durable results; demonstrate failure on the parent runtime and success with the fix, without relying on new-only APIs for the baseline proof.
- [ ] 1.4 Verify reservation lifecycle with focused executor/API tests: normal success, command failure, spawn failure, timeout, cancellation before and after start, duplicate-attempt recovery, failed attempt write, repeated release, and attempted reuse. Assert no leak, negative count, or premature capacity reuse; retain unknown-outcome quarantine checks. Use controlled pending operations rather than sleep-based concurrency assertions.
- [ ] 1.5 Update the packaged `bash` description and exact-output tests, reference §Bounds and §Errors, operator native-files configuration page, scaling cross-link, and dated changelog. Coordinate prompt edits with the other session without touching its checkout. Run focused executor/API/config/prompt tests, affected workspace lint/typecheck, `pnpm lint:markdown`, changed-file Prettier, strict change validation, and `git diff --check`; leave full suites and aggregate format verification to published-head CI.
- [ ] 1.6 Self-review the parent-relative draft diff against `REVIEW_GUIDE.md`, fix accepted findings with new commits, and re-run the focused checks green before marking the PR ready.
- [ ] 1.7 Run the GitHub review and CI loop on the published head; verify every expected automated reviewer completes or is explicitly recorded quota-exhausted, with terminal passing CI before handoff.

## 2. finalize

- [ ] 2.1 Enter `bash-process-concurrency/finalize` with `$gh-stack` before any synchronization write, then run `$openspec-sync-specs`; verify `pnpm exec openspec validate --specs --strict`, `pnpm exec openspec validate --all --strict`, `pnpm lint:markdown`, changed-file Prettier, and `git diff --check` all pass and record the results in the PR body; published-head CI owns aggregate formatting.
- [ ] 2.2 Confirm every task above is checked, then verify `openspec status --change bash-process-concurrency --json` reports the planning artifacts complete and that `openspec/specs/bash-execution/spec.md` carries the new requirement with every MODIFIED scenario still present.

## Workflow follow-up

- Run `$openspec-archive-change` after readiness is proved; self-review the finalize diff and run the review and monitoring loop as post-archive gates.
- Merge the stack only with Leo's explicit permission, through `$gh-stack`.
- Open a separate change for #1050's long-command timeout contract; that change closes #1050.
