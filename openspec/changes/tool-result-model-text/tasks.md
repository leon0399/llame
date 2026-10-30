Track [#1419](https://github.com/leon0399/llame/issues/1419) and
[#917](https://github.com/leon0399/llame/issues/917) and their PR layers through
[Project tracking](../../../CONTRIBUTING.md#project-tracking). Keep live status in the Project.

Implementation is one `gh stack` rooted on `master`, one PR per layer, bottom to top. Each layer is
created and published with `$gh-stack` and implemented with `$openspec-apply-change`. Each layer is
self-reviewed before it is marked ready and monitored per [CONTRIBUTING.md](../../../CONTRIBUTING.md).
Each implementation layer also gets a code-review and a ponytail-review pass on its draft diff
before ready.

```text
(master) <- tool-result-model-text/proposal
         <- tool-result-model-text/rendering
         <- tool-result-model-text/grep-bash
         <- tool-result-model-text/finalize
```

| Layer       | Parent      | Owns                                                                                                                                                                                                                             | Closes      | Estimated authored lines |
| ----------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ------------------------ |
| `proposal`  | `master`    | this ledger, the proposal, the design, and the delta specs                                                                                                                                                                       | none        | about 900                |
| `rendering` | `proposal`  | the rendering entry point on every path, `display`, the reserved-name neutralizer, `read`/`edit`/`write` text, the `edit`/`write` persisted shapes, the thumbnail move, the UI edit row, the measurement script, docs, changelog | none        | about 1,900              |
| `grep-bash` | `rendering` | `grep` text and its text-measured budget, `bash` wall time and text, the UI bash row, docs, changelog                                                                                                                            | #1419, #917 | about 1,400              |
| `finalize`  | `grep-bash` | spec synchronization, task records, and archive movement                                                                                                                                                                         | none        | under 800                |

Budget: no layer needs an exception at proposal time. The `rendering` layer is re-measured before
publication; if the UI edit row and the thumbnail move push it over, the thumbnail move and
`prompt-imports-item.ts` go to `grep-bash`, which has room. No generated output changes.

## 1. Proposal

- [ ] 1.1 Create `tool-result-model-text/proposal` from `master` with `$gh-stack` before any change
      artifact; verify with `gh stack view --json`.
- [ ] 1.2 Write the proposal, design, delta specs, and this ledger; verify with
      `pnpm exec openspec validate tool-result-model-text --strict`, `pnpm lint:markdown`,
      `pnpm format:check`, and `git diff --check`.
- [ ] 1.3 Run two rounds of `$iterative-review-refinement` with two independent reviewers each;
      commit each round separately and record the finding counts in the PR body.
- [ ] 1.4 SR: self-review the proposal PR diff against [REVIEW_GUIDE.md](../../../REVIEW_GUIDE.md)
      before ready.
- [ ] 1.5 GR: run the Ready-PR monitoring loop until CI is green and the bot feedback is processed.

## 2. Rendering

Create `tool-result-model-text/rendering` from `tool-result-model-text/proposal` with `$gh-stack`.

- [ ] 2.1 Export the reserved-name-only neutralizer from `authored-text.ts`; verify with a unit
      test that `</div>` passes and `</tool-result>`, `< tool-result>`, and `</TOOL-RESULT >` are
      escaped (scenario "Text payloads are neutralized by the reserved-name rule only").
- [ ] 2.2 Add `renderToolResultForModel(toolName, output)` in `apps/api/src/tools/model-text.ts`:
      strip `display`, text renderers for `read`, `edit`, `write` (by name, Machine variants
      included), JSON through `neutralizeToolResult` for every other tool; verify with a unit test
      per branch and a test that a `display` key never appears in any rendering.
- [ ] 2.3 Add the `read` text renderer in `packages/native-file-tools/src/model-text.ts`: header
      forms for single, multi-range, directory, outline, and raw; attribution lines in the design's
      order; one continuation line; measure `selectSourceLines` and the directory bound on the
      rendered text; delete `serializeNativeModelOutput`; verify with renderer tests for each header
      form and a bound test at exactly 16,000 code units (scenarios "The read header names the
      source and its total", "Continuation is one bracketed notice line", "Bounds are measured on
      rendered text").
- [ ] 2.4 Change `mutate.ts`: `edit` returns `content` with two context lines, `lineCount`, and
      `display { startLine, oldText, newText }`, no `diff`; `write` returns `lineCount`, no
      `content` or `diff`; bounding shrinks `content` only; apply the same shape in
      `machine-files.ts`; verify with `mutate.test.ts` cases that fail on the old shape (scenarios
      "The persisted edit carries display data and no diff", "A persisted write is status only").
- [ ] 2.5 Add the `edit` and `write` text renderers; verify the four-line edit scenario and the
      created-file scenario against the fixture file.
- [ ] 2.6 Attach `toModelOutput` for every tool in `createModelToolDefinition`; route
      `tool-observation-part.ts` and `continue-projection.ts` through the entry point; drop the
      replay wrapper's second `sanitizeAuthoredText` pass; measure the replay budgets on the rendered
      pair; verify with a test that live and replayed payloads are equal for `read` and
      `search_conversations` (scenario "Live and replayed renderings agree").
- [ ] 2.7 Move `thumbnail` to `display.thumbnail` in `tool-media-store.ts`, `result-truncation.ts`
      (set aside `display`), `prompt-imports-item.ts`, and the client part check (reject `display`);
      verify with the existing thumbnail tests moved to the new key and a negative test for a
      client part carrying `display`.
- [ ] 2.8 UI: `edit.tsx` renders from `display` and falls back to the input-derived diff for parts
      without it; `read.tsx` reads `display.thumbnail` and keeps `thumbnail`; `write.tsx` keeps
      rendering from input; verify with stories for a new-shape part, a legacy part, and a running
      edit, and `run-story-tests`.
- [ ] 2.9 Add `gpt-tokenizer` as a root dev dependency and `scripts/measure-tool-results.mjs`;
      verify that it reproduces the proposal's `read`, `edit`, and `write` rows.
- [ ] 2.10 Docs: `docs/product/reference/tools/{read,edit,write}.md` describe the text shapes;
      `apps/api/src/tools/prompts/read.md` drops the JSON-decoding instruction and names the
      reserved-delimiter rule; dated `CHANGELOG.md` entry; verify with `pnpm lint:markdown`.
- [ ] 2.11 SR: self-review the parent-relative diff against REVIEW_GUIDE.md; run the code-review
      and ponytail-review passes; fix with new commits; re-measure the authored size.
- [ ] 2.12 GR: mark ready and run the Ready-PR monitoring loop until CI is green and the bot
      feedback is processed.

## 3. Grep and bash

Create `tool-result-model-text/grep-bash` from `tool-result-model-text/rendering` with `$gh-stack`.

- [ ] 3.1 Add the `grep` text renderer: notice first, `## <locator>` per file, `*N:` match rows,
      blank line between passages, `[skipped: …]`, continuation line with the cursor; verify the
      two-passage and warnings scenarios.
- [ ] 3.2 Measure the grep page budget on the rendered text in `grep/page.ts`; replace
      `grepCursorFieldUnits` and the placeholder hash with the continuation line's width; verify
      `page.test.ts` at exactly 15,000 code units and the "budget ends a page early" scenario.
- [ ] 3.3 Record `wallTimeMs` in the managed watcher, SSH, and Machine bash producers and the
      Machine wire; carry it on success and in the `command_failed` and `timed_out` messages; drop
      `operation` and `executor`; verify with `bash.test.ts`, `ssh-bash.test.ts`, and the Machine
      call test (scenarios "Wall time is reported", "A timeout names the elapsed time").
- [ ] 3.4 Add the `bash` text renderer with `exit <code>, <seconds> s`, `[stderr]`, `(no output)`,
      and the truncation line; verify the silent-command and labelled-stderr scenarios.
- [ ] 3.5 UI: `bash.tsx` shows wall time and stops parsing `executor`; `grep.tsx` unchanged;
      verify with a story and `run-story-tests`.
- [ ] 3.6 Extend `scripts/measure-tool-results.mjs` with the `grep` and `bash` rows; verify that
      it reproduces the proposal's table.
- [ ] 3.7 Docs: `docs/product/reference/tools/{grep,bash}.md`; dated `CHANGELOG.md` entry; remove
      the result-shape line from `ROADMAP.md` if one exists; verify with `pnpm lint:markdown`.
- [ ] 3.8 SR: self-review the parent-relative diff; run the code-review and ponytail-review passes;
      fix with new commits; re-measure the authored size.
- [ ] 3.9 GR: mark ready with `Closes #1419` and `Closes #917`; run the Ready-PR monitoring loop
      until CI is green and the bot feedback is processed.

## 4. Finalize

Enter `tool-result-model-text/finalize` from `tool-result-model-text/grep-bash` with `$gh-stack`
before `$openspec-sync-specs` writes any canonical spec.

- [ ] 4.1 Run `$openspec-sync-specs`; verify with `pnpm exec openspec validate --specs --strict`
      that the new `tool-result-rendering` spec and the six modified requirements validate, and
      read the merged `native-file-tools`, `media-attachments`, `grep-tool`, `bash-execution`, and
      `knowledge-tools` blocks for wording consistency with their neighbours.
- [ ] 4.2 Archive readiness: `openspec status --change tool-result-model-text --json` reports every
      artifact complete and every task above checked; verify with
      `pnpm exec openspec validate --all --strict`, `pnpm lint:markdown`, `pnpm format:check`, and
      `git diff --check`.

## Workflow follow-up

- Run `$openspec-archive-change` after 4.2; preserve checked task history.
- Publish the finalize PR as draft with `$gh-stack`; SR and GR are post-archive gates.
- Merge each layer only through `$gh-stack` with Leo's explicit permission.
