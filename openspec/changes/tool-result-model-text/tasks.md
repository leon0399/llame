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
         <- tool-result-model-text/rendering-seam
         <- tool-result-model-text/file-text
         <- tool-result-model-text/grep-bash
         <- tool-result-model-text/finalize
```

| Layer            | Parent           | Owns                                                                                                                                                                                                                                | Closes      | Estimated authored lines |
| ---------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ------------------------ |
| `proposal`       | `master`         | this ledger, the proposal, the design, and the delta specs                                                                                                                                                                          | none        | about 1,300              |
| `rendering-seam` | `proposal`       | the rendering function on every path with JSON output, `display` with the thumbnail move and legacy strip, the one neutralization rule in a package, the global cap on the rendering, the measurement fixture and script, changelog | none        | about 1,600              |
| `file-text`      | `rendering-seam` | `read`/`edit`/`write` text renderers and text-measured bounds, `lineCount`/`entryCount`, the `edit`/`write` stored shapes, additive Machine fields, the UI edit row, docs, changelog                                                | none        | about 1,900              |
| `grep-bash`      | `file-text`      | `grep` text and its text-measured budget, `bash` wall time and text, the UI bash row, docs, changelog                                                                                                                               | #1419, #917 | about 1,500              |
| `finalize`       | `grep-bash`      | spec synchronization, task records, and archive movement                                                                                                                                                                            | none        | under 900                |

Budget: no layer needs an exception at proposal time. Each implementation layer is re-measured
before publication. If `file-text` goes over, the Machine additive fields and the hub mapping move
to `grep-bash`, which has room. No generated output changes.

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

## 2. Rendering seam

Create `tool-result-model-text/rendering-seam` from `tool-result-model-text/proposal` with
`$gh-stack`.

- [ ] 2.1 Move the reserved-name rule and its set to
      `packages/runtime-safety/src/reserved-delimiters.ts`; `authored-text.ts` imports it and keeps
      rule 1 for prompt values; verify with a unit test that `</div>` passes and `</tool-result>`,
      `< tool-result>`, and `</TOOL-RESULT >` are escaped (scenario "Tool result payloads are
      neutralized by the reserved-name rule").
- [ ] 2.2 Add `renderToolResultForModel(toolName, part)` in `apps/api/src/tools/model-text.ts`:
      strip `display` and a legacy top-level `thumbnail`, render every success as JSON with the
      reserved-name rule over its strings, render a failure as its neutralized `errorText` plus the
      rejected locator, return `json` for successes and the SDK error form for failures; verify with
      a unit test per branch, a test that `display` and a legacy `thumbnail` never appear, and a
      test that a `command_failed` error text with `</tool-result>` is escaped (scenarios of "One
      rendering function…" and "Display data is stored and never rendered").
- [ ] 2.3 Wire the function: `toModelOutput` for every tool in `createModelToolDefinition`,
      `settleBoundTool` returns the stored object, `tool-observation-part.ts` and
      `continue-projection.ts` call it, the replay wrapper stops its `sanitizeAuthoredText` pass,
      `neutralizeToolResult` and `serializeNativeModelOutput` are deleted and their JSON measure
      callers (`skill-activation.ts`, the prompt-import body, `skill-results.ts`) use a renamed
      `measureJson` in `runtime-safety`; verify with a test that live, replayed, and Continue
      payloads are equal for `read`, `search_conversations`, and a `command_failed` bash part
      (scenario "Live and replayed renderings agree").
- [ ] 2.4 Move `thumbnail` to `display.thumbnail` in `tool-media-store.ts`, `result-truncation.ts`
      (set aside `display`), `media.ts` types, and `chats/prompt-imports-item.ts`; `read.tsx`
      reads `display.thumbnail` and keeps `thumbnail`; verify with the thumbnail tests moved to the
      new key, a replay test for a stored top-level `thumbnail`, and a negative test that a client
      tool part is not persisted (scenarios "A stored image part with a top-level thumbnail replays
      without it", "A client part cannot persist display data").
- [ ] 2.5 Make the global cap in `runner.ts` measure `renderToolResultForModel` for the result;
      verify with `runner.test.ts` cases for a JSON result over the cap and for a result whose
      rendering is exactly 16,000 units (scenarios of "The global result cap measures the
      rendering").
- [ ] 2.6 Add `gpt-tokenizer` as a root dev dependency, the fixture file and the "today" JSON
      fixture captured at `64db12c9` under `scripts/fixtures/tool-results/`, and
      `scripts/measure-tool-results.mjs` printing the "today" column; verify that the today
      numbers match the proposal table.
- [ ] 2.7 Docs: `docs/product/reference/tools/index.md` names the one neutralization rule;
      `apps/api/src/tools/prompts/read.md` drops the JSON-decoding instruction and names the
      reserved-name rule; dated `CHANGELOG.md` entry; verify with `pnpm lint:markdown`.
- [ ] 2.8 SR: self-review the parent-relative diff against REVIEW_GUIDE.md; run the code-review
      and ponytail-review passes; fix with new commits; re-measure the authored size.
- [ ] 2.9 GR: mark ready and run the Ready-PR monitoring loop until CI is green and the bot
      feedback is processed.

## 3. File text

Create `tool-result-model-text/file-text` from `tool-result-model-text/rendering-seam` with
`$gh-stack`.

- [ ] 3.1 Store `lineCount` on regular-file, web, `kb://`, and `skill://` text reads and
      `entryCount` on listings, none on outlines; add both as optional fields to the `fs.read`
      wire and the hub mapping; verify with `read.test.ts`, `stream-read.test.ts`,
      `directory-listing.test.ts`, `web-read/result.test.ts`, and a Machine mapping test for an
      answer without the field (scenarios of "A text read carries the source line count when it
      is known").
- [ ] 3.2 Add the `read` text renderer in `packages/native-file-tools/src/model-text.ts`: header
      forms for single, multi-range, directory, outline, raw, and empty; attribution lines in the
      spec's order; the continuation line keyed on `truncated` with per-form resume selectors;
      `truncationNotice` as a bracketed line; verify with renderer tests for each header and
      continuation form and for a stored part without `lineCount` (scenarios of "The read header
      names…", "Attribution fields render…", "Continuation is one bracketed notice line").
- [ ] 3.3 Measure `selectSourceLines`, `selectMultiRangeLines`, and the directory bound on the
      neutralized rendering; turn the scheme resolvers' `reserveCodeUnits` into attribution-line
      width; verify with a bound test at exactly 16,000 rendered units and an escaping test
      (scenarios of "Bounds are measured on the neutralized rendering").
- [ ] 3.4 Change `mutate.ts`: `edit` returns `content` with two context lines, `lineCount`, and
      `display { startLine, oldText, newText }`, no `diff`; `write` returns `lineCount`, no
      `content` or `diff`; bounding shrinks `content` only; the hub's `readFsMutateResult` accepts
      both shapes and drops an old daemon's `diff`/`content`; verify with `mutate.test.ts` cases
      that fail on the old shape and a hub mapping test (scenarios "The stored edit carries display
      data and no diff", "A stored write is status only").
- [ ] 3.5 Add the `edit` and `write` text renderers, with the legacy forms for a stored part
      without `display` or with `content`; verify the four-line edit, created-file, and legacy
      scenarios against the fixture file.
- [ ] 3.6 Wire the three renderers into `renderToolResultForModel` by tool name, Machine variants
      included, and return `text`; verify with the live/replay equality test extended to `edit`
      and `write` and a Machine `read` rendering test.
- [ ] 3.7 UI: `edit.tsx` renders from `display` and falls back to the input-derived diff for parts
      without it; `write.tsx` keeps rendering from input; verify with stories for a new-shape part,
      a legacy part, and a running edit, and `run-story-tests`.
- [ ] 3.8 Extend `scripts/measure-tool-results.mjs` with the "after" column for `read`, `edit`,
      and `write` from the live renderer; verify that it reproduces the proposal's rows.
- [ ] 3.9 Docs: `docs/product/reference/tools/{read,edit,write}.md` describe the text shapes and
      the legacy forms; dated `CHANGELOG.md` entry; verify with `pnpm lint:markdown`.
- [ ] 3.10 SR: self-review the parent-relative diff; run the code-review and ponytail-review
      passes; run one torture conversation over the draft and record it in the PR body; fix with
      new commits; re-measure the authored size.
- [ ] 3.11 GR: mark ready and run the Ready-PR monitoring loop until CI is green and the bot
      feedback is processed.

## 4. Grep and bash

Create `tool-result-model-text/grep-bash` from `tool-result-model-text/file-text` with `$gh-stack`.

- [ ] 4.1 Add the `grep` text renderer: notice first, `## <locator>` per run of passages,
      `*N:` match rows from absolute `matches`, blank line between passages, `[warnings: …]`,
      continuation line with the cursor; verify the two-passage, overlapping-scope, and warnings
      scenarios.
- [ ] 4.2 Measure the grep page budget on the neutralized rendering in `grep/page.ts`; replace
      `grepCursorFieldUnits` and the placeholder hash with the continuation line's width; verify
      `page.test.ts` at exactly 15,000 code units and the "budget ends a page early" scenario.
- [ ] 4.3 Record `wallTimeMs` in the managed watcher, SSH, and Machine bash producers and add it
      as an optional wire field; carry it on success and in the `command_failed` and `timed_out`
      messages; drop `operation` and `executor` and map them away from an old daemon; verify with
      `bash.test.ts`, `ssh-bash.test.ts`, and the Machine call test (scenarios "Wall time is
      reported", "A timeout names the elapsed time", "An old daemon reports no wall time").
- [ ] 4.4 Add the `bash` text renderer in `packages/bash-executor` with `exit <code>[, <seconds>
      s]`, `[stderr]`, `(no output)`, and the `truncationNotice` line, and compose the
      `command_failed` message with it in `bash-result.ts`; verify the silent-command,
      labelled-stderr, failing-command, and legacy scenarios.
- [ ] 4.5 Wire both renderers into `renderToolResultForModel`; verify with the live/replay
      equality test extended to `grep` and `bash`.
- [ ] 4.6 UI: `bash.tsx` shows wall time and stops parsing `executor`; `grep.tsx` unchanged;
      verify with a story and `run-story-tests`.
- [ ] 4.7 Extend `scripts/measure-tool-results.mjs` with the `grep` and `bash` rows; verify that
      it reproduces the proposal's table.
- [ ] 4.8 Docs: `docs/product/reference/tools/{grep,bash}.md`; dated `CHANGELOG.md` entry; verify
      with `pnpm lint:markdown`.
- [ ] 4.9 SR: self-review the parent-relative diff; run the code-review and ponytail-review passes;
      fix with new commits; re-measure the authored size.
- [ ] 4.10 GR: mark ready with `Closes #1419` and `Closes #917`; run the Ready-PR monitoring loop
      until CI is green and the bot feedback is processed.

## 5. Finalize

Enter `tool-result-model-text/finalize` from `tool-result-model-text/grep-bash` with `$gh-stack`
before `$openspec-sync-specs` writes any canonical spec.

- [ ] 5.1 Run `$openspec-sync-specs`; verify with `pnpm exec openspec validate --specs --strict`
      that the new `tool-result-rendering` spec and the nine modified requirements validate, and
      read the merged `native-file-tools`, `media-attachments`, `grep-tool`, `bash-execution`,
      `knowledge-tools`, and `tool-calling` blocks for wording consistency with their neighbours.
- [ ] 5.2 Archive readiness: `openspec status --change tool-result-model-text --json` reports every
      artifact complete and every task above checked; verify with
      `pnpm exec openspec validate --all --strict`, `pnpm lint:markdown`, `pnpm format:check`, and
      `git diff --check`.

## Workflow follow-up

- Run `$openspec-archive-change` after 5.2; preserve checked task history.
- Publish the finalize PR as draft with `$gh-stack`; SR and GR are post-archive gates.
- Merge each layer only through `$gh-stack` with Leo's explicit permission.
