## 1. Proposal layer

Tracks issue #1177. Delivery stack:

```text
master <- persist-context-items-at-dispatch/proposal <- persist-context-items-at-dispatch/record <- persist-context-items-at-dispatch/user-turn <- persist-context-items-at-dispatch/reply <- persist-context-items-at-dispatch/finalize
```

Process: [CONTRIBUTING](../../../CONTRIBUTING.md). Use `$gh-stack` for every
stack operation and `$openspec-apply-change` for implementation. Create each
implementation layer only after proposal approval; publication and merge each
require their own authorization. Every layer has a self-review (SR) checkpoint
before draft -> ready and a GitHub review (GR) checkpoint after ready; for
finalize both follow archive movement as post-archive gates.

Layers, each with its branch, parent, ownership, authored-size estimate against
its parent (tests, specs, and docs included; generated output counted
separately), exit evidence, and issue responsibility:

- `persist-context-items-at-dispatch/proposal` (parent `master`): this ledger,
  the proposal, the design, and ten delta specs. Estimated about 2,400 authored
  lines, most of it verbatim MODIFIED blocks; named budget exception: the
  canonical requirements this change edits are long and must be copied whole.
  Exit: the OpenSpec proposal, Product Markdown, and Any change rows, review
  rounds committed separately, and approval of the published revision. Closes
  no issue.
- `persist-context-items-at-dispatch/record` (parent `proposal`): removes
  `runs.context_items`, its endpoint, DTOs, OpenAPI path, and generated client,
  and moves the model-switch baseline to the latest prior reply's recorded
  model. Estimated about 900 authored lines (net production deletion), plus a
  generated migration snapshot and client churn. Exit: the Workspace
  TypeScript, API DB/tenancy, API/generated client, Product Markdown, and Any
  change rows, and current-head CI green after ready. Closes no issue.
- `persist-context-items-at-dispatch/user-turn` (parent `record`): the fenced
  dispatch transaction that stores every accepted-turn item on the user
  message and advances told and baseline state with it, and retry reuse.
  Estimated about 1,800 authored lines. Exit: the Workspace TypeScript, API
  DB/tenancy, Product Markdown, and Any change rows, and current-head CI green
  after ready. Closes no issue.
- `persist-context-items-at-dispatch/reply` (parent `user-turn`): the reply row
  created at first dispatch, in-Run items written through, every terminal
  writer finalizing the reply, fork and web handling of a `running` reply.
  Estimated about 2,000 authored lines. Exit: the Workspace TypeScript, API
  DB/tenancy, Cross-surface behavior, Product Markdown, and Any change rows,
  and current-head CI green after ready. Its delivery owner closes #1177.
- `persist-context-items-at-dispatch/finalize` (parent `reply`): canonical spec
  synchronization, task records, and archive movement only. Closes no issue.

Re-estimate each layer's authored size at its boundary and before publication;
split a growing concern or request a named exception before publishing an
oversized layer.

- [ ] 1.1 [proposal] Run the review rounds on the proposal, design, and delta specs; verify each finding against the repository; commit each round separately.
- [ ] 1.2 [proposal] Verify every MODIFIED block reproduces master's requirement text and scenario headings, with only the edits the proposal names, by a recorded sentence-level diff against `openspec/specs`.
- [ ] 1.3 [proposal] Prove the layer with `pnpm exec openspec validate persist-context-items-at-dispatch --strict`, `pnpm lint:markdown`, `pnpm format:check`, and `git diff --check`; obtain approval of the final revision.
- [ ] 1.4 [proposal] SR: self-review the published draft PR's parent-relative diff against `REVIEW_GUIDE.md` and the approved scope, fix accepted findings with new commits, and mark the PR ready.
- [ ] 1.5 [proposal] GR: after ready, run the Ready-PR monitoring loop on the current head with zero actionable unresolved feedback before creating `record`.

## 2. Record layer

Branch `persist-context-items-at-dispatch/record`, parent
`persist-context-items-at-dispatch/proposal`. Owns removal of the Run-level item
record and the model-switch baseline.

- [ ] 2.1 [record] Delete `runs.context_items` and the `RunContextItem` type from `apps/api/src/db/schema/chats.ts`, generate the drop migration with `pnpm --filter api db:generate`, and delete `recordContextItems`, every `contextItems` write in `run-execution.service.ts`, `toRunContextItems`, and `BuiltContext.contextItems`/`readContextItems` in `context-builder.ts` (design D9); verify `pnpm --filter api db:check` and that the migration only drops the column.
- [ ] 2.2 [record] Delete `GET /api/v1/runs/{id}/context-items`, its DTOs, the OpenAPI path and schemas, and regenerate the web client; verify the OpenAPI lint, a second generation with a clean diff, and the contract test.
- [ ] 2.3 [record] Replace the model-switch baseline with the model recorded on the most recent prior assistant reply in effective history, whatever its status (design D5); keep compaction's completed-Run receipt lookup; verify focused tests that a failed prior reply's model is the baseline and that no switch item is emitted when it matches.
- [ ] 2.4 [record] Delete or rewrite the tests that pin the record (`run-context-items.test.ts`, record assertions in the run-execution, context-builder, compaction-context, chat-loop, and controller suites); update `SPEC.md` §9.8 to drop the record clause and keep the non-erasure note for persisted parts; add a dated `CHANGELOG.md` entry naming the **BREAKING** endpoint removal; verify `pnpm lint:markdown`.
- [ ] 2.5 [record] Prove the layer with `pnpm --filter api lint`, `typecheck`, focused unit and integration tests for the touched suites, `pnpm --filter api build`, `pnpm format:check`, and `git diff --check`; measure the authored diff; publish the draft with `$gh-stack`.
- [ ] 2.6 [record] SR: self-review the draft PR's parent-relative diff against `REVIEW_GUIDE.md`, with one code-review and one ponytail-review subagent; fix accepted findings with new commits, rerun affected checks, update the PR body, and mark ready.
- [ ] 2.7 [record] GR: after ready, run the Ready-PR monitoring loop to completion on the current head before creating `user-turn`.

## 3. User-turn layer

Branch `persist-context-items-at-dispatch/user-turn`, parent
`persist-context-items-at-dispatch/record`. Owns persisting accepted-turn items
at dispatch.

- [ ] 3.1 [user-turn] Build the fenced dispatch transaction (design D1 steps 1, 2, 3, and 5): lock the triggering user row, store every accepted-turn item through the generalized runId-keyed idempotent part insert (design D2), and append `model.requested`; delete the `persistFinishedContext` prepend; verify a focused test that a Run failing after its first request leaves every accepted-turn item on the user message in producer order.
- [ ] 3.2 [user-turn] Advance told and baseline state in that transaction (design D4): Workspace told root and detach-reason clear, recency-digest told set and disclosure accounting (first-baseline initialization stays with the winning turn), skill-catalog told set, and `runs.turn_tool_availability`; compare availability against the most recent prior Run that dispatched; verify focused tests that after a failed Run carrying each item, the next turn emits none of them again.
- [ ] 3.3 [user-turn] Make a retry reuse the stored accepted-turn items and stop request assembly from adding them a second time; keep them on a detaching retry; verify a focused integration test that a crash-then-retry request carries one copy of each item and performs no instruction-file reads for already stored files.
- [ ] 3.4 [user-turn] Rewrite the tests that pin success-only publication ("publishes no staged rail part when the attempt fails" for accepted-turn items, "leaves nothing seen when an attempt fails after loading" for accepted-turn bundles, "does not use a failed prior run as the availability baseline"); update the retry sentences in `docs/product/reference/instruction-files.md` and `docs/product/reference/prompt-imports.md`; add a dated `CHANGELOG.md` entry; verify `pnpm lint:markdown`.
- [ ] 3.5 [user-turn] Prove the layer with `pnpm --filter api lint`, `typecheck`, focused unit and integration tests, `pnpm --filter api build`, `pnpm format:check`, and `git diff --check`; measure the authored diff; publish the draft with `$gh-stack`.
- [ ] 3.6 [user-turn] SR: self-review the draft PR's parent-relative diff against `REVIEW_GUIDE.md`, with one code-review and one ponytail-review subagent; fix accepted findings with new commits, rerun affected checks, update the PR body, and mark ready.
- [ ] 3.7 [user-turn] GR: after ready, run the Ready-PR monitoring loop to completion on the current head before creating `reply`.

## 4. Reply layer

Branch `persist-context-items-at-dispatch/reply`, parent
`persist-context-items-at-dispatch/user-turn`. Owns the reply row from first
dispatch and the closure of #1177.

- [ ] 4.1 [reply] Create or reset the reply with usage status `running`, `runId`, and `attemptId` in the dispatch transaction (design D1 step 4, D3, D7); treat `running` as non-completed in the completion guard, the replace guard, and usage completeness; verify focused tests that the reply exists after the first request and that a retry resets it before reading history.
- [ ] 4.2 [reply] Append each in-Run item to the reply in a fenced transaction when its step dispatches, and make settlement place stored items after the triggering step's last tool part; delete `withoutContextItems` and the live-collector-only rule; verify a focused test that an in-Run bundle loaded before a failure stays on the failed reply in position.
- [ ] 4.3 [reply] Finalize the reply on every terminal writer (design D6): failure, cancellation, worker expiry, expiry by a new message, supersession, retry exhaustion, and lost settlement; verify one focused test per writer asserting no reply remains `running`.
- [ ] 4.4 [reply] Skip a `running` reply in whole-chat forks (design D8) and adopt it in web history as the live stream's message (design D10); verify `fork-chat` integration tests, web `history.test.ts`, and the chat-flow, tool-loop, and stop-from-submission e2e specs.
- [ ] 4.5 [reply] Update `SPEC.md` §9.3 for a reply that exists from first dispatch; add a dated `CHANGELOG.md` entry; then close #1177 after verifying each acceptance item in `proposal.md` is covered by a test; verify `pnpm lint:markdown`.
- [ ] 4.6 [reply] Prove the layer with `pnpm --filter api lint`, `typecheck`, focused unit and integration tests, `pnpm --filter web lint`, `typecheck`, and focused tests, `pnpm --filter api build`, `pnpm format:check`, and `git diff --check`; measure the authored diff; publish the draft with `$gh-stack`.
- [ ] 4.7 [reply] SR: self-review the draft PR's parent-relative diff against `REVIEW_GUIDE.md`, with one code-review and one ponytail-review subagent; fix accepted findings with new commits, rerun affected checks, update the PR body, and mark ready.
- [ ] 4.8 [reply] GR: after ready, run the Ready-PR monitoring loop to completion on the current head before creating `finalize`.

## 5. Finalize layer

Branch `persist-context-items-at-dispatch/finalize`, parent
`persist-context-items-at-dispatch/reply`. Spec synchronization, task records,
and archive movement only; never an application fix. Enter the branch with
`$gh-stack` from the implementation top **before** `$openspec-sync-specs`
writes any canonical spec.

- [ ] 5.1 [finalize] Confirm with `$gh-stack` that `finalize` sits on the published, reviewed `reply` layer and that every task above is checked.
- [ ] 5.2 [finalize] Use `$openspec-sync-specs` to apply the ten deltas; verify `pnpm exec openspec validate --specs --strict` and `pnpm exec openspec validate --all --strict` and that every shipped scenario heading survives.
- [ ] 5.3 [finalize] Verify archive readiness with `openspec status --change persist-context-items-at-dispatch --json` and every tracked task checked; then use `$openspec-archive-change` and verify strict `--specs` and `--all` validation, `pnpm lint:markdown`, `pnpm format:check`, and `git diff --check`.

## Workflow follow-up

- Publish the finalize draft with `$gh-stack`, self-review its diff (SR) and mark ready, run the Ready-PR monitoring loop (GR), recheck stack bases and checks, and request merge permission; merge only through `$gh-stack`.
