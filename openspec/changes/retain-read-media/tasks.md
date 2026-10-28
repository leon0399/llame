Track [#1422](https://github.com/leon0399/llame/issues/1422) and its PR layers through
[Project tracking](../../../CONTRIBUTING.md#project-tracking). Keep live status in the Project.

Implementation is one `gh stack` rooted on `master`, one PR per layer, bottom to top. Each layer is
created and published with `$gh-stack` and implemented with `$openspec-apply-change`. Each layer is
self-reviewed before it is marked ready and monitored per [CONTRIBUTING.md](../../../CONTRIBUTING.md).
The implementation layer also gets a code-review, a simplification-review, and a ponytail-review
pass on its draft diff before ready.

```text
(master) <- retain-read-media/proposal
         <- retain-read-media/inline-parts
         <- retain-read-media/finalize
```

| Layer          | Parent         | Owns                                                                                                                                                                                                  | Closes | Estimated authored lines          |
| -------------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | --------------------------------- |
| `proposal`     | `master`       | this ledger, the proposal, the design, and the delta specs                                                                                                                                            | none   | about 3,100; see the budget note  |
| `inline-parts` | `proposal`     | retained bytes in parts, events, and import entries; the per-message bound; replay and admission from them; egress strip; overflow trigger; fork chunking; the `read` description; docs and changelog | #1422  | about 2,600; see the budget note  |
| `finalize`     | `inline-parts` | spec synchronization, the `media-attachments` Purpose, task records, and archive movement                                                                                                             | none   | under 1,600, mostly spec movement |

Budget:

- `proposal` is a named exception to the review budget. Seven capability deltas restate their
  MODIFIED requirements in full. Four of them are long canonical blocks: `tool-calling` (about 270
  lines), `context-injection` (about 230), `model-system-prompts` compaction (about 375), and
  `native-file-tools` web reads (about 125). Each changes a few paragraphs or scenarios. A split
  publishes an incomplete contract.
- `inline-parts` is a named exception, re-measured at its boundary. It keeps storage, replay, and
  egress in one layer. A layer that writes bytes without the egress strip sends them to the
  browser, and a layer that strips without replay adds dead data. The attempt-memory deletion cannot
  move to a later layer either, because replay and the live path share the map. The PR records the
  measured size.
- No generated output changes: the API contract and the web client stay the same.

## 1. Proposal

- [x] 1.1 Create `retain-read-media/proposal` from `master` with `$gh-stack` before any change
      artifact; verify with `gh stack view --json`.
- [x] 1.2 Write the proposal, design, delta specs, and this ledger; verify with
      `pnpm exec openspec validate retain-read-media --strict`, `pnpm lint:markdown`,
      `pnpm format:check`, and `git diff --check`.
- [ ] 1.3 Run two rounds of `$iterative-review-refinement` with two independent reviewers each;
      commit each round separately and record the finding counts in the PR body.
- [ ] 1.4 SR: self-review the proposal PR diff against [REVIEW_GUIDE.md](../../../REVIEW_GUIDE.md)
      before ready.
- [ ] 1.5 GR: run the Ready-PR monitoring loop until CI is green and the bot feedback is processed.

## 2. Inline parts

Create `retain-read-media/inline-parts` from `retain-read-media/proposal` with `$gh-stack`.

- [ ] 2.1 Make the media hook keep every image's model variant and every PDF's original as base64,
      whatever the model's input; delete `releaseMedia`, the released-size fields, and the release loop
      in the composer; verify with the tool-media-store and step-composer unit tests.
- [ ] 2.2 Add `retainedMedia` to the `tool-read` part and to the model-origin `tool.completed`
      payload beside `output`, and copy it in the event-log rebuild; verify that a live part and a
      rebuilt part both keep the bytes, that a system-origin event carries none, and that a UI stream
      chunk carries none.
- [ ] 2.3 Apply the per-message bound in `recordToolCompleted` before the event, from the seeded
      kept parts and the settled reads, and in the prompt-import pass; verify that a read past the bound
      succeeds, records `{ "exceeded": true }` in the part and the event, takes the limit placeholder in
      the live step and on replay, and that a Continue counts its kept parts.
- [ ] 2.4 Add `retainedMedia` to prompt-import image and PDF entries and to the API payload
      validator; verify with the prompt-imports-item validator tests for each closed-set scenario.
- [ ] 2.5 Load `retainedMedia` from epoch rows, Continue kept parts, and the compaction prefix into
      the attempt's map under row-identity keys; emit a marker only for a part or entry with
      `retainedMedia`, in the stored replay, the Continue projection, the import marker, and the live
      output; verify that a later turn, a Continue, an owner fork, and a compaction request attach the
      read, that the main build, the continuation estimate, and the compaction request resolve the same
      row, and that a legacy row and a Continue of a legacy reply replay as text.
- [ ] 2.6 Delete the `not-retained` admission status and the not-retained placeholder; size retained
      references from their base64 length and decode only attached ones; verify with epoch-admission
      tests for the byte bound, two reads of one file, and a changed file.
- [ ] 2.7 Count retained references in earlier rows for the overflow trigger, and skip Continue kept
      references in the trigger slice and the continuation estimate; verify with compaction trigger
      tests, one of them a Continue whose kept reads overflow.
- [ ] 2.8 Strip `retainedMedia` from the owner history response, the run event stream
      (`tool.completed` and `run.continued`), and the Continue and Regenerate job payloads; verify with
      chats and runs controller tests, a follow-up-admission test of the job data, and a negative test
      that another owner's history and events requests return no row and no bytes.
- [ ] 2.9 Chunk the owner fork's message inserts by part bytes; verify with a fork test whose rows
      exceed one chunk.
- [ ] 2.10 Update the packaged `read` description, `SPEC.md`, the `read`, locator, prompt-import,
      Continue, and web-read references, the media operator page, and `CHANGELOG.md`; verify with
      `pnpm lint:markdown` and the prompt-render tests.
- [ ] 2.11 Run `pnpm --filter api lint`, `pnpm --filter api typecheck`, the focused unit tests, the
      API integration suites for runs, chats, and prompt imports, `pnpm format:check`, and
      `git diff --check`.
- [ ] 2.12 SR: self-review the draft diff, then run the code-review, simplification-review, and
      ponytail-review passes; fix the accepted findings before ready.
- [ ] 2.13 GR: run the Ready-PR monitoring loop until CI is green and the bot feedback is processed.

## 3. Finalize

Enter `retain-read-media/finalize` from `retain-read-media/inline-parts` with `$gh-stack` before
`$openspec-sync-specs` writes.

- [ ] 3.1 Run `$openspec-sync-specs`, and update the `media-attachments` Purpose to name part
      retention; verify with `pnpm exec openspec validate --specs --strict`.
- [ ] 3.2 Confirm every task above is checked and `openspec status --change retain-read-media
  --json` reports all artifacts done; verify with `pnpm exec openspec validate --all --strict`.

## Workflow follow-up

- Archive the change with `$openspec-archive-change` after 3.2.
- After archive, self-review the finalize PR, mark it ready, and run the Ready-PR monitoring loop.
