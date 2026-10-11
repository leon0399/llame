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
  the proposal, the design, and eleven delta specs. Estimated about 3,000
  authored lines, most of it verbatim MODIFIED blocks; named budget exception:
  the canonical requirements this change edits are long and must be copied
  whole. Exit: the OpenSpec proposal, Product Markdown, and Any change rows,
  review rounds committed separately, and approval of the published revision.
  References #1177 and closes no issue.
- `persist-context-items-at-dispatch/record` (parent `proposal`): removes
  `runs.context_items`, its endpoint, DTOs, OpenAPI path, and generated client
  (design D9). Estimated about 800 authored lines (net production deletion),
  plus a generated migration snapshot and client churn. Exit: the Workspace
  TypeScript, API DB/tenancy, API/generated client, Product Markdown, and Any
  change rows, and current-head CI green after ready. References #1177 and
  closes no issue.
- `persist-context-items-at-dispatch/user-turn` (parent `record`): the fenced
  dispatch transaction that stores every accepted-turn item on the user
  message and advances told and baseline state with it, the dispatched-Run
  rule for epoch start and baselines, and the retry rule (design D1 without
  the reply, D2, D4, D11). Keeps master's Run-based model-switch comparison.
  Estimated about 1,800 authored lines. Exit: the Workspace TypeScript, API
  DB/tenancy, Product Markdown, and Any change rows, and current-head CI green
  after ready. References #1177 and closes no issue.
- `persist-context-items-at-dispatch/reply` (parent `user-turn`): the reply row
  created at first dispatch with `running` usage, attempt-scoped
  finalization, in-Run item snapshots, the shared finalizer for every terminal
  writer, the model-switch baseline from the latest prior reply, and
  owner-facing reads and forks skipping a `running` reply (design D3, D5, D6,
  D7, D8, D10). Estimated about 2,200 authored lines; named budget exception:
  attempt-scoped finalization, the shared finalizer, and its per-writer tests
  protect one invariant (no reply stays `running`), and a split would publish
  a layer that creates `running` rows some writers never finalize. Exit: the
  Workspace TypeScript, API DB/tenancy, Cross-surface behavior, Product
  Markdown, and Any change rows, and current-head CI green after ready. Its PR
  body carries `Closes #1177` once every acceptance item in `proposal.md` is
  covered by a test, so the issue closes when this layer merges; nobody closes
  it by hand.
- `persist-context-items-at-dispatch/finalize` (parent `reply`): canonical spec
  synchronization, task records, and archive movement only. References #1177
  and closes no issue.

Re-estimate each layer's authored size at its boundary and before publication;
split a growing concern or request a named exception before publishing an
oversized layer.

- [x] 1.1 [proposal] Run the review rounds on the proposal, design, and delta specs; verify each finding against the repository; commit each round separately. Recorded: round 1 (spec consistency and feasibility reviewers; 4 P0 and 15 P1 accepted) applied in `79b5b56e`; round 2 (same reviewers; no P0 or P1, 13 P2/P3 accepted) applied in `f54b94c5`.
- [x] 1.2 [proposal] Verify every MODIFIED block reproduces master's requirement text and scenario headings, with only the edits the proposal names, by a recorded sentence-level diff against `openspec/specs`. Recorded after round 2: 30 MODIFIED blocks across 11 deltas keep all 185 canonical scenario headings; the renamed tool-calling and chat-recency-digest requirements keep theirs under the new names.
- [x] 1.3 [proposal] Prove the layer with `pnpm exec openspec validate persist-context-items-at-dispatch --strict`, `pnpm lint:markdown`, `pnpm format:check`, and `git diff --check`; obtain approval of the final revision. Recorded: all pass at `f54b94c5`; approval of this revision carried forward from Leo's instruction to implement after two review rounds (2026-10-10).
- [x] 1.4 [proposal] SR: self-review the published draft PR's parent-relative diff against `REVIEW_GUIDE.md` and the approved scope, fix accepted findings with new commits, and mark the PR ready. Recorded: self-review was the two review rounds above; marked ready at the round-2 head.
- [ ] 1.5 [proposal] GR: after ready, run the Ready-PR monitoring loop on the current head with zero actionable unresolved feedback before creating `record`.

## 2. Record layer

Branch `persist-context-items-at-dispatch/record`, parent
`persist-context-items-at-dispatch/proposal`. Owns removal of the Run-level item
record.

- [ ] 2.1 [record] Delete `runs.context_items` and the `RunContextItem` type from `apps/api/src/db/schema/chats.ts`, generate the drop migration with `pnpm --filter api db:generate`, and delete `recordContextItems`, every `contextItems` write in `run-execution.service.ts`, `toRunContextItems`, and `BuiltContext.contextItems`/`readContextItems` in `context-builder.ts` (design D9); verify `pnpm --filter api db:check` and that the migration only drops the column.
- [ ] 2.2 [record] Delete `GET /api/v1/runs/{id}/context-items`, its DTOs, the OpenAPI path and schemas, and regenerate the web client; verify the OpenAPI lint, a second generation with a clean diff, and the contract test.
- [ ] 2.3 [record] Delete or rewrite the tests that pin the record (`run-context-items.test.ts`, record assertions in the run-execution, context-builder, compaction-context, chat-loop, and controller suites); update `SPEC.md` §9.8 to drop the record clause and keep the non-erasure note for persisted parts; add a dated `CHANGELOG.md` entry naming the **BREAKING** endpoint removal; verify `pnpm lint:markdown`.
- [ ] 2.4 [record] Prove the layer with `pnpm --filter api lint`, `typecheck`, focused unit and integration tests for the touched suites, `pnpm --filter api build`, `pnpm format:check`, and `git diff --check`; measure the authored diff; publish the draft with `$gh-stack`.
- [ ] 2.5 [record] SR: self-review the draft PR's parent-relative diff against `REVIEW_GUIDE.md`, with one code-review and one ponytail-review subagent; fix accepted findings with new commits, rerun affected checks, update the PR body, and mark ready.
- [ ] 2.6 [record] GR: after ready, run the Ready-PR monitoring loop to completion on the current head before creating `user-turn`.

## 3. User-turn layer

Branch `persist-context-items-at-dispatch/user-turn`, parent
`persist-context-items-at-dispatch/record`. Owns persisting accepted-turn items
at dispatch, the told and baseline state that accounts for them, and the
dispatched-Run rule.

- [ ] 3.1 [user-turn] Build the fenced dispatch transaction (design D1 steps 1, 2, 3, and 5), locking in the worker's completion order (run, then the user row and reply in `messages`, then `chats`): store the attempt's accepted-turn items with one insert per item in that transaction, with no per-item identity or text dedupe, relying on the attempt fence to commit it at most once per attempt (design D2), inserting at producer rank around the pre-dispatch `prompt-imports` and `skill-activation` facts on a Run's first dispatch; write `runs.turn_tool_availability` in it even when it is `[]` or the comparison emits no reminder (design D11); and append `model.requested`; delete the `persistFinishedContext` prepend; verify a focused test that a Run failing after its first request leaves every accepted-turn item on the user message in producer order and a non-null comparison record on the Run, and that a completing first attempt's request bytes are unchanged.
- [ ] 3.2 [user-turn] Advance told and baseline state in that transaction (design D4): Workspace told root and detach-reason clear with the `workspace` item; the recency-digest told set and an existing epoch's baseline-disclosure accounting whether or not the request carries a digest item (first-baseline initialization stays with the winning turn); the skill-catalog told set in the dispatch transaction that persists the catalog notice, whatever the Run's outcome (the first-epoch catalog baseline freeze stays with the winning turn); keep master's Run-based model-switch comparison in this layer; verify focused tests that after a failed Run carrying a Workspace snapshot, a detach notice, a digest update, a catalog notice, or an availability reminder, the next turn emits none of them again; that a request with no digest item still commits the epoch's disclosure accounting; and that a dispatch transaction failing before commit leaves neither the catalog notice nor the updated told state visible, with a retry producing one consistent notice.
- [ ] 3.3 [user-turn] Count a Run as dispatched when its `turn_tool_availability` is not null or its status is `completed`, and judge epoch start, the digest supersession marker, and the availability baseline against the most recent prior dispatched Run (design D11); update `SPEC.md` §9.7's availability baseline sentence ("the previous successful turn's committed availability record") to the most recent prior dispatched Run; verify focused tests that a failed Run that dispatched a checkpoint's supersession marker and full `Unavailable tools:` list is not followed by a second marker or list, and that a pre-cutover failed Run with a null record never becomes the baseline.
- [ ] 3.4 [user-turn] Implement the retry rule (design D2): a retry after an earlier attempt of the Run dispatched keeps every item that dispatch transaction stored, unchanged and in place, derives each accepted-turn producer again treating those items and the told, seen, and baseline state their dispatch advanced as already told, and stores only what that comparison newly yields after the last stored context item and before the user text, in producer order, in its own dispatch transaction, advancing the Run's id/state record to its own observation; a retry of a Run with no dispatched attempt stores everything at producer rank as a first attempt does; stop request assembly from adding stored items a second time; verify focused integration tests that a crash-then-retry request carries one copy of each item, no second `temporal` or model-switch item, and no instruction-file reads for already stored files; that a detaching retry appends its detach notice and snapshot after the stored items; that an availability change since the stored record yields one new reminder whose `Added tools` lists only tools callable now; that a tool going unavailable, available, then unavailable again across three dispatched attempts stores each of the three reminders, including the repeated one; and that a retry after an attempt that stored prompt imports but died before dispatch stores its items at producer rank around them.
- [ ] 3.5 [user-turn] Rewrite the tests that pin success-only publication ("publishes no staged rail part when the attempt fails" for accepted-turn items, "leaves nothing seen when an attempt fails after loading" for accepted-turn bundles, "does not use a failed prior run as the availability baseline"); update the retry sentences in `docs/product/reference/instruction-files.md` and `docs/product/reference/prompt-imports.md`; add a dated `CHANGELOG.md` entry; verify `pnpm lint:markdown`.
- [ ] 3.6 [user-turn] Prove the layer with `pnpm --filter api lint`, `typecheck`, focused unit and integration tests, `pnpm --filter api build`, `pnpm format:check`, and `git diff --check`; measure the authored diff; publish the draft with `$gh-stack`.
- [ ] 3.7 [user-turn] SR: self-review the draft PR's parent-relative diff against `REVIEW_GUIDE.md`, with one code-review and one ponytail-review subagent; fix accepted findings with new commits, rerun affected checks, update the PR body, and mark ready.
- [ ] 3.8 [user-turn] GR: after ready, run the Ready-PR monitoring loop to completion on the current head before creating `reply`.

## 4. Reply layer

Branch `persist-context-items-at-dispatch/reply`, parent
`persist-context-items-at-dispatch/user-turn`. Owns the reply row from first
dispatch, its finalization, and the model-switch baseline; its PR body carries
`Closes #1177`.

- [ ] 4.1 [reply] Create or reset the reply in the dispatch transaction with usage `{ status: 'running', complete: false, runId, attemptId, modelId, effort }` (effort omitted when the Run has none; `permissionMode: 'bypass'` added when the dispatching attempt's effective mode is bypass), and record the dispatching attempt id on the `model.requested` payload (design D1 step 4, D3, D7); treat `running` as non-completed in the completion guard, the replace guard, and usage completeness, which does not count the Run's own `running` usage as an earlier reply; verify focused tests that the reply exists with that usage after the first request (including `permissionMode` under bypass), that a retry resets it in its own dispatch transaction and its request excludes the reply, and that a retry failing before its own dispatch leaves the earlier attempt's reply, output, and items untouched.
- [ ] 4.2 [reply] Split finalization by source (design D3): a settler that holds the attempt's live collector (completion, in-process failure, cancellation, in-process worker expiry, lost settlement) persists the collector's parts, which already hold the in-Run items in position; a settler without it (dead-letter retry exhaustion, native-recovery settlement, claim-time terminal transitions, pickup failure, admission expiry, a later attempt that ends before its own dispatch) rebuilds text, reasoning, and tool parts only from the events of the attempt named in the reply usage, from its `model.requested` up to the next attempt's `run.started`; a finalizer that finds no reply row creates it from the Run's full event log with no in-Run items only when that log has a `model.requested` event, and otherwise writes no reply and no usage; verify focused tests that a completed turn's stored parts equal the live collector's, that native-recovery `outcome_unknown` after attempt A dispatched and stored an in-Run bundle keeps A's output and bundle on the reply, that after A and B both dispatch the rebuilt reply carries none of A's events, that a Run dispatched before this layer settled by the dead letter gets a reply from its full log, and that a Run cancelled before start or failed at pickup before any dispatch gets no reply and no usage.
- [ ] 4.3 [reply] Write each in-Run item with the reply's current part snapshot in one fenced transaction when its step dispatches; for rebuilding settlers, place each stored item after the last rebuilt part whose `toolCallId` appears anywhere before that item in the stored snapshot, and at the start only when none of those ids survive in the rebuild (design D3); delete `withoutContextItems`; verify focused tests that an in-Run bundle loaded before an in-process failure stays on the failed reply in position, and that a rebuild ordering a step's tool parts differently from the snapshot, or lacking one, still places the bundle after the step's last surviving tool part.
- [ ] 4.4 [reply] Move reply finalization, the event rebuild, and open-tool settlement into one repository-level finalizer callable from both the chat module and the run worker, always writing terminal usage when the Run has a reply (status, `complete`, `runId`, `attemptId`, `modelId`, `effort`, and `permissionMode` when present) even with empty parts; a finalizer whose own attempt is not the one named in the reply usage writes the terminal status, `complete: false`, and the running usage's identity fields with no tokens, latency, or measured size (design D3, D6); call it from completion, failure, cancellation, worker expiry, retry exhaustion (dead letter), cancellation before start, native-recovery `outcome_unknown`, pickup failure (`failRunTransactionally`), the claim-time `markFinished` paths, expiry by a new message, and lost settlement; verify one focused test per writer asserting the terminal status and usage fields and that no reply remains `running`, plus one for a later attempt that ends before its own dispatch.
- [ ] 4.5 [reply] Replace master's Run-based model-switch comparison with `usage.modelId` of the most recent prior assistant reply in the Chat whose seq is below the triggering user message, regardless of status and checkpoints (design D5); keep compaction's completed-Run receipt lookup; verify focused tests that a failed prior reply's model is the baseline, that no switch item is emitted when it matches, that a reply absorbed by a checkpoint still serves as the baseline, and that a failed Run that persisted a switch item without output is not followed by a second one.
- [ ] 4.6 [reply] Omit a `running` reply from history, the public share, the shared-chat fork source, owner fork selection, and the chat-list preview, and reject a fork anchor naming a `running` reply as not found (design D8, D10); make no web change; verify `fork-chat` integration tests and focused history, share, and chat-list tests, and run web `history.test.ts` and the chat-flow, tool-loop, and stop-from-submission e2e specs as a regression check.
- [ ] 4.7 [reply] Update `SPEC.md` §9.3 for a reply that exists from first dispatch; add a dated `CHANGELOG.md` entry; confirm the #1177 'Expected' baseline wording matches design D5; once each acceptance item in `proposal.md` is covered by a test, put `Closes #1177` in the PR body (the issue closes when the layer merges, never by hand); verify `pnpm lint:markdown`.
- [ ] 4.8 [reply] Prove the layer with `pnpm --filter api lint`, `typecheck`, focused unit and integration tests, the web regression checks from 4.6, `pnpm --filter api build`, `pnpm format:check`, and `git diff --check`; measure the authored diff against the 2,200-line estimate and its named budget exception; publish the draft with `$gh-stack`.
- [ ] 4.9 [reply] SR: self-review the draft PR's parent-relative diff against `REVIEW_GUIDE.md`, with one code-review and one ponytail-review subagent; fix accepted findings with new commits, rerun affected checks, update the PR body, and mark ready.
- [ ] 4.10 [reply] GR: after ready, run the Ready-PR monitoring loop to completion on the current head before creating `finalize`.

## 5. Finalize layer

Branch `persist-context-items-at-dispatch/finalize`, parent
`persist-context-items-at-dispatch/reply`. Spec synchronization, task records,
and archive movement only; never an application fix. Enter the branch with
`$gh-stack` from the implementation top **before** `$openspec-sync-specs`
writes any canonical spec.

- [ ] 5.1 [finalize] Confirm with `$gh-stack` that `finalize` sits on the published, reviewed `reply` layer and that every task above is checked.
- [ ] 5.2 [finalize] Use `$openspec-sync-specs` to apply the eleven deltas; rewrite the `openspec/specs/model-system-prompts/spec.md` Purpose sentence ("only successful turns publish attempt-owned conversation context and minimal tool-availability comparison state") to persistence at dispatch; verify `pnpm exec openspec validate --specs --strict` and `pnpm exec openspec validate --all --strict` and that every shipped scenario heading survives.
- [ ] 5.3 [finalize] Verify archive readiness with `openspec status --change persist-context-items-at-dispatch --json` and every tracked task checked; then use `$openspec-archive-change` and verify strict `--specs` and `--all` validation, `pnpm lint:markdown`, `pnpm format:check`, and `git diff --check`.

## Workflow follow-up

- Publish the finalize draft with `$gh-stack`, self-review its diff (SR) and mark ready, run the Ready-PR monitoring loop (GR), recheck stack bases and checks, and request merge permission; merge only through `$gh-stack`.
