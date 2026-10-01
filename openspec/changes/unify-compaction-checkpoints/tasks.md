Track [#806](https://github.com/leon0399/llame/issues/806) and its PRs through the delivery Project under [CONTRIBUTING.md](../../../CONTRIBUTING.md). Local drafting or commits do not change Project status. The follow-ups [#1068](https://github.com/leon0399/llame/issues/1068), [#1069](https://github.com/leon0399/llame/issues/1069) and [#1070](https://github.com/leon0399/llame/issues/1070) are separate work, not native blockers. This change supersedes [#865](https://github.com/leon0399/llame/issues/865) and [#866](https://github.com/leon0399/llame/issues/866).

Use `$gh-stack` for every layer and `$openspec-apply-change` for implementation. Create the next layer only after the approved proposal revision is carried forward and the previous layer passed its gates. Publication and merge each require separate permission.

```text
(master) <- unify-compaction-checkpoints/proposal
         <- unify-compaction-checkpoints/trigger
         <- unify-compaction-checkpoints/checkpoint-rows
         <- unify-compaction-checkpoints/prompt-and-eval
         <- unify-compaction-checkpoints/finalize
```

- `proposal` (parent `master`, about 1,400 authored lines) owns only proposal, design, the delta
  specs, and this task list.
- `trigger` (parent `proposal`, estimated 1,300 authored lines, mostly deletion): one synchronous
  compaction trigger before the Run's first model step with publication before the step (design
  D4, D5), still writing the existing `compactions` table. Deletes the post-turn path, the
  staleness guard, `createIfCutoffAbsent`, and the staged transition mode. References #806.
- `checkpoint-rows` (parent `trigger`, estimated 2,600 authored lines, about 1,900 of them
  deletions): the `checkpoint` row, absorbed-through sequence, summary-only checkpoints,
  datastore isolation, forks, markers, the owner UI, the table drop, and the spec, doc and
  changelog updates (design D1-D3, D6-D9, D12). Its merge completes #806's acceptance, so its PR
  uses `Closes #806`. **Named exception requested:** the layer exceeds the review budget because
  the cutover deletes `compactions` and every reader and test of it; splitting it would leave a
  layer that writes two storages. The exception is confirmed or refused at publication, with the
  measured authored and deleted counts.
- `prompt-and-eval` (parent `checkpoint-rows`, estimated 900 authored lines): the merged
  summarization instruction with its structure and rules, the envelope clause, the pinned-string
  tests, the on-demand eval and its runbook (design D10, D11). References #806.
- `finalize` (parent `prompt-and-eval`, about 100 authored lines) owns only spec sync, checked
  task records, and archive movement.

Re-estimate authored size at each layer boundary and before publication; split a growing concern or request a named exception before publishing an oversized layer. Do not put live delivery status in this file.

## 1. `unify-compaction-checkpoints/proposal`

- [ ] 1.1 Commit the proposal, design, delta specs, and this task list. Verify with `pnpm exec openspec validate unify-compaction-checkpoints --strict`, `pnpm lint:markdown`, `pnpm format:check`, and `git diff --check`.
- [ ] 1.2 Run `$iterative-review-refinement` with at least two independent reviewers per round. Verify each finding against code, specs, or primary sources, and commit each round separately.
- [ ] 1.3 Record Leo's approval of the final proposal revision (a GitHub approval or a top-level comment naming the revision) before any implementation branch exists.
- [ ] 1.4 Self-review (SR) the draft PR's actual diff against `REVIEW_GUIDE.md`, fix accepted findings, and mark ready.
- [ ] 1.5 GitHub review (GR): complete the ready-PR monitoring loop with terminal current-head CI and zero actionable unresolved feedback.

## 2. `unify-compaction-checkpoints/trigger`: one synchronous trigger

- [ ] 2.1 Persist each completed attempt's final-request context size (input plus output of the final model request) as a separate field in the assistant message's usage, not added to the aggregate (design D4). Verify with the usage-accounting unit tests that a two-request loop records the final request's size and an unchanged aggregate, and that a request without counts records no size.
- [ ] 2.2 Evaluate one compaction condition before the attempt's first model step: measured size (previous completed assistant message's final-request size plus the estimate of later rows and rail items, or the whole-request estimate when no size is persisted) at or above the Run model's threshold, or the prepared request not fitting the Run model's window (design D4). Verify with `run-execution.service.test.ts` that a chat over threshold compacts once before the first request, that one under threshold makes no summary call, that a model switch whose request does not fit the target compacts against the target and fails `context_incompatible` if it still does not fit, and that a failed previous Run is not a trigger of its own.
- [ ] 2.3 Build the summary request on the attempt's prepared context: system prompt, schema-only declarations, compactable prefix, the trailing instruction, `toolChoice: 'none'`, the Run's resolved effort; write the row and the re-baked epoch state (digest baseline, temporal anchor, skill-catalog baseline, workspace told-set, markers) in one transaction before the step, and keep them when the attempt later fails (design D4, D5). Verify with `compaction-context.integration.test.ts` that the request is byte-identical to today's full-current request for the same prefix, that a failing attempt leaves the row and the markers published, that a retry reuses the row without a second summary call, and that a provider tool call despite `toolChoice: 'none'` is rejected.
- [ ] 2.4 Delete `maybeCompact`, the post-turn call site, the staleness guard, `createIfCutoffAbsent`, `compactForTransition` and the staged transition state; make the compaction service one path with one input (design D4). Verify `compaction.service.test.ts` covers only the remaining path and that `git grep` finds no reference to the deleted symbols.
- [ ] 2.5 Update `SPEC.md` §2.1 for the single trigger and add a dated `CHANGELOG.md` entry. Run `pnpm --filter api lint`, `typecheck`, and `test:coverage`, the focused integration files touched above, `pnpm format:check`, `pnpm lint:markdown`, `git diff --check`, and `pnpm exec openspec validate unify-compaction-checkpoints --strict`; record the commands in the PR body.
- [ ] 2.6 Self-review (SR) the parent-relative draft diff against `REVIEW_GUIDE.md`, fix accepted findings, and rerun affected checks before marking ready.
- [ ] 2.7 GitHub review (GR): complete the ready-PR monitoring loop with terminal current-head CI and zero actionable unresolved feedback before adding the `checkpoint-rows` layer.

## 3. `unify-compaction-checkpoints/checkpoint-rows`: the checkpoint message

- [ ] 3.1 Generated migration: `message_role` adds `checkpoint`; `messages` gains nullable `absorbed_through_seq` with a partial unique index on `(chat_id, absorbed_through_seq)` for checkpoint rows; the `messages_public_read` policy is replaced to exclude the role as a hand-authored SQL-comment step; `compactions` is dropped; `chats` markers naming a dropped id become null (design D1, D2, D6, D12). Verify with the schema tests, a second `db:generate` producing no diff, `db:reset` plus `db:migrate` on an empty database, and an RLS test that an anonymous public read of a compacted public chat returns no checkpoint row.
- [ ] 3.2 Write the checkpoint as a `checkpoint` row carrying one `data-context` part (`producer: 'compaction'`, `form: 'checkpoint'`, rendered envelope text, payload `{ v: 1, summary }`), usage, and `absorbed_through_seq` equal to the last absorbed row; replace the embedded compaction DTO with the row in the owner's messages response (design D1, D2, D9). Verify with `compaction-context.integration.test.ts` that the row is inserted at the next `seq` with the boundary at the row before the triggering user turn, that a second insert for the same boundary is a no-op, and with `chats.service` tests that the owner response carries the row and the public DTO does not.
- [ ] 3.3 Replay: select the latest checkpoint below the current position, emit its stored text as one user-role message, then every later user/assistant row with `seq` above its absorbed-through sequence, with no re-rendering; delete `replacement_history` handling, `compaction-replacement-history.ts`, `buildCompactionToolReplacementRecords`, the inherited-record carry, `COMPACTION_CHECKPOINT_ENVELOPE_PREFIX` and the renderer bypass (design D2, D3). Verify with `context-builder.test.ts` that projections for no checkpoint, one, two, and a model switch match the expected message lists, that a renderer change leaves stored text unchanged, that rows after the checkpoint keep the ordinary bounded tool projection, and that tool parts absorbed by a checkpoint do not reappear.
- [ ] 3.4 Exclude `checkpoint` rows from search projection, `conversation_read`, public DTOs, ordinary exports and the shared-fork copy; copy them verbatim in owner forks and remap the three markers to the copied message ids; delete the fork compaction loop and `compactions-repository.ts` (design D6, D7, D8). Verify with negative tests that a compacted public chat read anonymously, searched by another user, read through `conversation_read`, and forked by another user shows no checkpoint text, and that an owner fork replays the same prefix as its source.
- [ ] 3.5 Key the epoch on the checkpoint message: `startsEpoch` compares the active checkpoint's `seq` with the previous completed Run's assistant `seq`; digest, catalog, workspace and instruction-file seen state derive from rows after the absorbed-through sequence (design D7). Verify with the existing epoch tests re-pointed at the row and an instruction-files test that a file absorbed by a checkpoint reloads on its next trigger.
- [ ] 3.6 Web: render the boundary from the checkpoint row with the absorbed count derived from `seq`; delete `apps/web/lib/services/chat/compaction.ts`'s `uptoSeq` placement (design D9). Verify with the page tests and the boundary story that the marker sits before the first row after the boundary and shows the derived count.
- [ ] 3.7 Update operator docs for compaction, `SPEC.md` §2.1, `ROADMAP.md`, and add a dated `CHANGELOG.md` entry marking the breaking schema change. Run `pnpm --filter api lint`, `typecheck`, and `test:coverage`, `pnpm --filter web lint`, `typecheck`, and `test`, the focused integration files touched above, `pnpm format:check`, `pnpm lint:markdown`, `git diff --check`, and `pnpm exec openspec validate unify-compaction-checkpoints --strict`; record the commands and the measured authored and deleted counts in the PR body.
- [ ] 3.8 Self-review (SR) the parent-relative draft diff against `REVIEW_GUIDE.md`, fix accepted findings, and rerun affected checks before marking ready.
- [ ] 3.9 GitHub review (GR): complete the ready-PR monitoring loop with terminal current-head CI and zero actionable unresolved feedback before adding the `prompt-and-eval` layer.

## 4. `unify-compaction-checkpoints/prompt-and-eval`: instruction, envelope, eval

- [ ] 4.1 Merge the two instructions into one packaged template with the amended headings and the five rules, and add the envelope clause (design D10). Verify with the pinned-string tests that the rendered instruction carries every heading in order and each rule, that the envelope is three sentences, and that the standing-context exclusions are unchanged.
- [ ] 4.2 Add `apps/api/evals/compaction/` with its own `llame.config.json` (`opencode-go`, `space-bunny-free`), five fixtures, a runner behind `pnpm --filter api eval:compaction`, and the deterministic assertions in design D11; keep it out of `lint`, `test` and CI. Verify by running it once against the gateway and recording the pass in the PR body; verify a missing key or model fails the run with a named error.
- [ ] 4.3 Document the eval in `docs/development/` and add a dated `CHANGELOG.md` entry. Run `pnpm --filter api lint`, `typecheck`, and `test:coverage`, `pnpm format:check`, `pnpm lint:markdown`, `git diff --check`, and `pnpm exec openspec validate unify-compaction-checkpoints --strict`; record the commands in the PR body.
- [ ] 4.4 Self-review (SR) the parent-relative draft diff against `REVIEW_GUIDE.md`, fix accepted findings, and rerun affected checks before marking ready.
- [ ] 4.5 GitHub review (GR): complete the ready-PR monitoring loop with terminal current-head CI and zero actionable unresolved feedback before adding the `finalize` layer.

## 5. `unify-compaction-checkpoints/finalize`

- [ ] 5.1 Enter `unify-compaction-checkpoints/finalize` from `prompt-and-eval` with `$gh-stack` before any spec sync writes.
- [ ] 5.2 Run `$openspec-sync-specs`; confirm every MODIFIED delta replaced its canonical requirement in full and every REMOVED one is gone; verify with `pnpm exec openspec validate --specs --strict`.
- [ ] 5.3 Confirm `openspec status --change unify-compaction-checkpoints --json` reports every artifact complete and every task above checked; stop on any incomplete item.
- [ ] 5.4 Run `$openspec-archive-change`, preserving checked task history; verify with `pnpm exec openspec validate --all --strict`, `pnpm lint:markdown`, `pnpm format:check`, and `git diff --check`; publish the draft, then SR and GR as post-archive gates.
