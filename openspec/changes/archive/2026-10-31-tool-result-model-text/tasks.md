Track [#1419](https://github.com/leon0399/llame/issues/1419) and
[#917](https://github.com/leon0399/llame/issues/917) and their PR layers through
[Project tracking](../../../../CONTRIBUTING.md#project-tracking). Keep live status in the Project.

Implementation is one `gh stack` rooted on `master`, one PR per layer, bottom to top. Each layer is
created and published with `$gh-stack` and implemented with `$openspec-apply-change`. Each layer is
self-reviewed before it is marked ready and monitored per [CONTRIBUTING.md](../../../../CONTRIBUTING.md).
Each implementation layer also gets a code-review and a ponytail-review pass on its draft diff
before ready.

```text
(master) <- tool-result-model-text/proposal
         <- tool-result-model-text/rendering-seam
         <- tool-result-model-text/read-text
         <- tool-result-model-text/mutation-text
         <- tool-result-model-text/grep-bash
         <- tool-result-model-text/finalize
```

| Layer            | Parent           | Owns                                                                                                                                                                                                                      | Closes      | Estimated authored lines |
| ---------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ------------------------ |
| `proposal`       | `master`         | this ledger, the proposal, the design, and the delta specs                                                                                                                                                                | none        | about 1,500              |
| `rendering-seam` | `proposal`       | the rendering function on every path with JSON output, `display` with the thumbnail move and legacy strip, the one neutralization rule in a package, the cap on the rendering, the "today" measurement fixture, changelog | none        | about 1,600              |
| `read-text`      | `rendering-seam` | the `read` text renderer, `lineCount`/`entryCount` and the `fs.read` wire field, read bounds on text, the prompt-import body, the `read` description and docs, changelog                                                  | none        | about 1,700              |
| `mutation-text`  | `read-text`      | the `edit`/`write` stored shapes and text, the mutate wire mapping, the UI edit row, the `edit`/`write` descriptions and docs, changelog                                                                                  | none        | about 1,500              |
| `grep-bash`      | `mutation-text`  | `grep` text and its text-measured budget, `bash` wall time and text, the UI bash row, the `grep`/`bash` descriptions and docs, the full measurement script, changelog                                                     | #1419, #917 | about 1,700              |
| `finalize`       | `grep-bash`      | spec synchronization, task records, and archive movement                                                                                                                                                                  | none        | under 900                |

Budget: no layer needs an exception at proposal time. Each implementation layer is re-measured
before publication. If `read-text` goes over, the prompt-import body and the `read` description
move to `mutation-text`; the wire field stays with the field. No generated output changes.

## 1. Proposal

- [x] 1.1 Create `tool-result-model-text/proposal` from `master` with `$gh-stack` before any change
      artifact; verify with `gh stack view --json`.
- [x] 1.2 Write the proposal, design, delta specs, and this ledger; verify with
      `pnpm exec openspec validate tool-result-model-text --strict`, `pnpm lint:markdown`,
      `pnpm format:check`, and `git diff --check`.
- [x] 1.3 Run two rounds of `$iterative-review-refinement` with two independent reviewers each;
      commit each round separately and record the finding counts in the PR body.
- [x] 1.4 SR: self-review the proposal PR diff against [REVIEW_GUIDE.md](../../../../REVIEW_GUIDE.md)
      before ready.
- [x] 1.5 GR: run the Ready-PR monitoring loop until CI is green and the bot feedback is processed.

## 2. Rendering seam

Create `tool-result-model-text/rendering-seam` from `tool-result-model-text/proposal` with
`$gh-stack`.

- [x] 2.1 Move the reserved-name rule and its set to
      `packages/runtime-safety/src/reserved-delimiters.ts`; `authored-text.ts` imports it and keeps
      rule 1 for prompt values; verify with a unit test that `</div>` passes and `</tool-result>`,
      `< tool-result>`, and `</TOOL-RESULT >` are escaped (scenarios of "Tool result payloads are
      neutralized by the reserved-name rule").
- [x] 2.2 Add `renderToolResultForModel(toolName, result)` in `apps/api/src/tools/model-text.ts`:
      strip `display` and a legacy top-level `thumbnail`, render every success and failure as
      JSON with the rule over keys and string values, return the string and kind `json`; verify
      with a unit test per branch, a test that `display` and a legacy `thumbnail` never appear, a
      key-escaping test on an MCP-shaped result, and a `command_failed` object test (scenarios of
      "One rendering function…" and "Display data is stored and never rendered").
- [x] 2.3 Wire the function: `toModelOutput` for every tool in `createModelToolDefinition`
      (native tools keep `toolResultOutput(text, retainedReadRef(…))` and type `text`; others
      `json`), `settleBoundTool` returns the result object, `tool-observation-part.ts` rebuilds a
      failure object and calls the function, `continue-projection.ts` calls it, the replay wrapper
      stops its `sanitizeAuthoredText` pass; delete `neutralizeToolResult`, re-point
      `measureNativeModelOutput` at the JSON rendering with the rule, bound
      `conversation-read.ts` on the same rule, and give `skills/skill-activation.ts` a
      `measureJson` in `runtime-safety`; verify with a test that live, replayed, and Continue
      payloads are equal for `read`, `search_conversations`, a PNG read with its reference, and a
      `command_failed` bash part (scenarios "Live and replayed renderings agree", "A media reference
      survives the rendering").
- [x] 2.4 Move `thumbnail` to `display.thumbnail` in `tool-media-store.ts`, `result-truncation.ts`
      (set aside `display`), `media.ts` types, and the read of it in `chats/prompt-imports-item.ts`
      (the import payload key is unchanged); `read.tsx` reads `display.thumbnail` and keeps
      `thumbnail`; verify with the thumbnail tests moved to the new key, a replay test for a stored
      top-level `thumbnail`, and a negative test that a client part with `display` is rejected at
      the DTO (scenarios "A stored image part with a top-level thumbnail replays without it", "A
      client cannot supply display data").
- [x] 2.5 Give `truncateOversizedResult` a measure parameter and pass the rendering measure from
      `runner.ts` and `mcp-runtime.service.ts`, with the omitted count in rendered units; verify
      with `runner.test.ts` and `result-truncation.test.ts` cases for a JSON result over the cap
      and for a result whose rendering is exactly 16,000 units (scenarios of "The global result
      cap measures the rendering").
- [x] 2.6 Add `gpt-tokenizer` as a root dev dependency, the "today" JSON fixture captured from a
      `64db12c9` worktree under `scripts/fixtures/tool-results/`, and
      `scripts/measure-tool-results.mjs` reading the fixture file with `git show` and printing the
      "today" column; verify that the today numbers match the proposal table.
- [x] 2.7 Docs: `docs/product/reference/tools/index.md` names the one neutralization rule; dated
      `CHANGELOG.md` entry; verify with `pnpm lint:markdown`.
- [x] 2.8 SR: self-review the parent-relative diff against REVIEW_GUIDE.md; run the code-review
      and ponytail-review passes; fix with new commits; re-measure the authored size.
- [x] 2.9 GR: mark ready and run the Ready-PR monitoring loop until CI is green and the bot
      feedback is processed.

## 3. Read text

Create `tool-result-model-text/read-text` from `tool-result-model-text/rendering-seam` with
`$gh-stack`.

- [x] 3.1 Store `lineCount` by the line-feed byte scan for files of at most 32 MiB on host,
      `kb://`, and `skill://` reads, from the render for web reads, `entryCount` on listings, none
      on outlines or larger files; add both as optional fields to the `fs.read` wire and the hub
      mapping; verify with `read.test.ts`, `stream-read.test.ts`, `directory-listing.test.ts`,
      `web-read/result.test.ts`, a large-file test that asserts no whole-file scan, an invalid-UTF-8
      tail test, and a Machine mapping test for an answer without the field (scenarios of "A text
      read carries the source line count when it is known").
- [x] 3.2 Add the `read` text renderer in `packages/native-file-tools/src/model-text.ts`: header
      forms for single, multi-range, raw, outline, empty, and oversized-first-line; directory as
      stored content; attribution lines in the spec's order; the continuation line keyed on
      `truncated` with per-form and open-ended resume selectors and the remaining count;
      `truncationNotice` as a bracketed line; verify with renderer tests for each header and
      continuation form and for a stored part without `lineCount` (scenarios of "The read header
      names…", "The read header carries the source total…", "Attribution fields render…",
      "Continuation is one bracketed notice line").
- [x] 3.3 Measure `selectSourceLines`, `selectMultiRangeLines`, the directory bound, the Markdown
      ancestor and outline bounds, and `web-read/result.ts` on the neutralized rendering; turn the
      scheme resolvers' `reserveCodeUnits` into attribution-line width; verify with a bound test at
      exactly 16,000 rendered units and an escaping test (scenarios of "Bounds are measured on the
      neutralized rendering").
- [x] 3.4 Wire the `read` renderer into `renderToolResultForModel` by tool name, Machine variants
      included, returning kind `text`; make the prompt-import body in `run-execution.service.ts`
      the same rendering; verify with the live/replay equality test extended to `read`, a Machine
      `read` rendering test, and the prompt-import body test.
- [x] 3.5 Extend `scripts/measure-tool-results.mjs` with the "after" column for the `read` rows
      from fixture objects with `lineCount` injected and the window held equal; verify that it
      reproduces the proposal's read rows.
- [x] 3.6 Docs: `apps/api/src/prompts/tools/read.md` describes the text shape, drops the
      JSON-decoding instruction, and names the reserved-name rule;
      `docs/product/reference/tools/read.md`; dated `CHANGELOG.md` entry; verify with
      `pnpm lint:markdown`.
- [x] 3.7 SR: self-review the parent-relative diff; run the code-review and ponytail-review passes;
      run one torture conversation over the draft and record it in the PR body; fix with new
      commits; re-measure the authored size.
- [x] 3.8 GR: mark ready and run the Ready-PR monitoring loop until CI is green and the bot
      feedback is processed.

## 4. Mutation text

Create `tool-result-model-text/mutation-text` from `tool-result-model-text/read-text` with
`$gh-stack`.

- [x] 4.1 Change `mutate.ts`: `edit` returns bounded `content` with two context lines, `lineCount`,
      and `display { startLine, oldText, newText }`, no `diff`; `write` returns `lineCount`, no
      `content` or `diff`; bounding shrinks `content` only and marks `truncated`; measure on the
      neutralized rendering; the hub's `readFsMutateResult` accepts both shapes, forwards an old
      daemon's `content` and `shownRange`, and drops `diff`; verify with `mutate.test.ts` cases
      that fail on the old shape and a hub mapping test (scenarios "The stored edit carries display
      data and no diff", "A stored write is status only").
- [x] 4.2 Add the `edit` and `write` text renderers, with the cut-region marker and the legacy
      forms for a stored part without `display` or with `content`; wire them into
      `renderToolResultForModel`; verify the four-line edit, created-file, cut-region, and legacy
      scenarios against the fixture file and the live/replay equality test extended to `edit` and
      `write`.
- [x] 4.3 UI: `edit.tsx` renders from `display` and falls back to the input-derived diff for parts
      without it; `write.tsx` keeps rendering from input; verify with stories for a new-shape part,
      a legacy part, and a running edit, and `run-story-tests`.
- [x] 4.4 Extend `scripts/measure-tool-results.mjs` with the `edit` and `write` rows from live
      package calls on a temporary copy; verify that it reproduces the proposal's rows.
- [x] 4.5 Docs: `apps/api/src/prompts/tools/{edit,write}.md` and
      `docs/product/reference/tools/{edit,write}.md` describe the text shapes and the legacy
      forms; `docs/product/operator/machines.md` orders the hub before the daemon; dated
      `CHANGELOG.md` entry; verify with `pnpm lint:markdown`.
- [x] 4.6 SR: self-review the parent-relative diff; run the code-review and ponytail-review passes;
      fix with new commits; re-measure the authored size.
- [x] 4.7 GR: mark ready and run the Ready-PR monitoring loop until CI is green and the bot
      feedback is processed.

## 5. Grep and bash

Create `tool-result-model-text/grep-bash` from `tool-result-model-text/mutation-text` with
`$gh-stack`.

- [x] 5.1 Add the `grep` text renderer: notice first, `## <locator>` per run of passages,
      `*N:` match rows from absolute `matches`, blank line between passages, the capped-passage
      marker, `[warnings: …]`, continuation line with the cursor; verify the two-passage,
      overlapping-scope, warnings, and capped-file scenarios.
- [x] 5.2 Measure the grep page budget on the neutralized rendering in `grep/page.ts` and
      `apps/api/src/tools/grep.ts`; replace `grepCursorFieldUnits` and the placeholder hash with
      the continuation line's width; delete `measureNativeModelOutput` and keep
      `serializeNativeModelOutput` in `serialization.ts`; verify `page.test.ts` at exactly 15,000
      code units and the "budget ends a page early" scenario.
- [x] 5.3 Record `wallTimeMs` in the managed watcher, SSH, and Machine bash producers and add it
      as an optional wire field; carry it on success and in the `command_failed` and `timed_out`
      messages; drop `operation` and `executor` and map them away from an old daemon; verify with
      `bash.test.ts`, `ssh-bash.test.ts`, and the Machine call test (scenarios "Wall time is
      reported", "A timeout names the elapsed time", "An old daemon reports no wall time").
- [x] 5.4 Add the `bash` text renderer in `packages/bash-executor` with `exit <code>[, <seconds>
      s]`, `[stderr]`, `(no output)`, `[output cut at the bound]`, and the `truncationNotice`
      line, and compose the `command_failed` message with it in `bash-result.ts`; wire both
      renderers into `renderToolResultForModel`; verify the silent-command, labelled-stderr,
      failing-command, cut-output, and legacy scenarios and the live/replay equality test extended
      to `grep` and `bash`.
- [x] 5.5 UI: `bash.tsx` shows wall time and stops parsing `executor`; `grep.tsx` unchanged;
      verify with a story and `run-story-tests`.
- [x] 5.6 Extend `scripts/measure-tool-results.mjs` with the `grep` and `bash` rows; verify that
      it reproduces the proposal's table.
- [x] 5.7 Docs: `apps/api/src/prompts/tools/{grep,bash}.md` and
      `docs/product/reference/tools/{grep,bash}.md`; dated `CHANGELOG.md` entry; verify with
      `pnpm lint:markdown`.
- [x] 5.8 SR: self-review the parent-relative diff; run the code-review and ponytail-review passes;
      fix with new commits; re-measure the authored size.
- [x] 5.9 GR: mark ready with `Closes #1419` and `Closes #917`; run the Ready-PR monitoring loop
      until CI is green and the bot feedback is processed.

## 6. Finalize

Enter `tool-result-model-text/finalize` from `tool-result-model-text/grep-bash` with `$gh-stack`
before `$openspec-sync-specs` writes any canonical spec.

- [x] 6.1 Run `$openspec-sync-specs`; verify with `pnpm exec openspec validate --specs` that the
      new `tool-result-rendering` spec (24 requirements), the thirteen modified requirements, and
      the five added `native-file-tools` requirements validate, and read the merged
      `native-file-tools`, `media-attachments`, `grep-tool`, `bash-execution`, `knowledge-tools`,
      and `tool-calling` blocks for wording consistency with their neighbours.
      Verified after the archive: every delta requirement body and scenario equals its canonical
      block byte-for-byte; `pnpm exec openspec validate --specs` reports 54 passed and 0 failed.
      `--specs --strict` still fails the pre-existing ">500 characters" warnings, unchanged from
      `e3533929` (335 warnings, same per-spec multiset), because STE forbids dividing a modified
      requirement.
- [x] 6.2 Archive readiness: `openspec status --change tool-result-model-text --json` reports every
      artifact complete and every task above checked; verify with
      `pnpm exec openspec validate --all --strict`, `pnpm lint:markdown`, `pnpm format:check`, and
      `git diff --check`.

## Workflow follow-up

- Run `$openspec-archive-change` after 6.2; preserve checked task history.
- Publish the finalize PR as draft with `$gh-stack`; SR and GR are post-archive gates.
- Merge each layer only through `$gh-stack` with Leo's explicit permission.
