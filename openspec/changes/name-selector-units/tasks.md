Track [#1833](https://github.com/leon0399/llame/issues/1833), its cutovers
[#1834](https://github.com/leon0399/llame/issues/1834) and
[#1835](https://github.com/leon0399/llame/issues/1835), and their PR layers through
[Project tracking](../../../CONTRIBUTING.md#project-tracking). Carry forward the recorded proposal
approval and recheck native blockers before you start. Keep live status in the Project.

## Delivery stack

Use `$gh-stack` for every branch operation and `$openspec-apply-change` for each implementation
layer, after proposal approval only.

```text
master
  <- name-selector-units/proposal
  <- name-selector-units/input-grammar
  <- name-selector-units/read-output
  <- name-selector-units/search-output
  <- name-selector-units/authored-selectors
  <- name-selector-units/line-column
  <- name-selector-units/github-anchors
  <- name-selector-units/finalize
```

| Layer                                    | Parent               | Ownership                                                                                                                 | Authored estimate | Closes |
| ---------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------- | ----------------- | ------ |
| `name-selector-units/proposal`           | `master`             | The approved proposal, design, deltas, and this task list.                                                                | ~2,000            | none   |
| `name-selector-units/input-grammar`      | `proposal`           | The `L` forms, reserved letters, the `L-5` hint, mixed-unit lists, and the refusal messages, on every source.             | ~1,000            | none   |
| `name-selector-units/read-output`        | `input-grammar`      | Read headers, continuations, listing paging, artifact and head-spill notices, bash spill lines, and the E2E read parsers. | ~1,100            | none   |
| `name-selector-units/search-output`      | `read-output`        | Grep passage locators, the grep remainder, Knowledge passage locators, and the grep and Knowledge search cards.           | ~900              | none   |
| `name-selector-units/authored-selectors` | `search-output`      | Instruction pages, instruction imports, and prompt-import labels.                                                         | ~500              | #1833  |
| `name-selector-units/line-column`        | `authored-selectors` | The `:N:M` form on every text source and its permission scenarios.                                                        | ~450              | #1834  |
| `name-selector-units/github-anchors`     | `line-column`        | GitHub blob line anchors and the anchor-selector conflict.                                                                | ~650              | #1835  |
| `name-selector-units/finalize`           | `github-anchors`     | Spec sync, task records, and archive movement only.                                                                       | ~300              | none   |

Every layer is a safe merge point. Input accepts both spellings from the first implementation layer,
so each output layer can merge alone. No layers must merge together.

The proposal layer is about 2,000 authored lines, at the 2,000-line review target. Most of it
is the full STE text of MODIFIED requirements.

Each layer that ships behavior owns its reference and operator docs, its prompt text, and a dated
`CHANGELOG.md` entry. The `authored-selectors` layer closes #1833, because after it every selector
that llame prints or writes is canonical. The two cutover layers close their own issues.

## 0. proposal

- [ ] 0.1 Run adversarial review with two independent reviewers per round: spec consistency, and feasibility against `packages/native-file-tools/src/path.ts`, the scheme locators, the printers, `apps/machine/src/file-targets.ts`, and the GitHub adapter. Verify each finding against code or specs. Commit each round separately.
- [ ] 0.2 Prove the final revision: `pnpm exec openspec validate name-selector-units --strict`, `pnpm lint:markdown`, `pnpm format:check`, `git diff --check`, and a script that confirms each MODIFIED block keeps every canonical scenario heading in order. Record Leo's approval of that revision.
- [ ] 0.3 Self-review the proposal diff before the PR is marked ready. Record the review rounds in the PR body.
- [ ] 0.4 Pass the GitHub review and CI gate under Ready-PR monitoring.

## 1. input-grammar

- [ ] 1.1 Extend the shape gate and normalization in `packages/native-file-tools/src/path.ts` (design D1, D2): an optional `L`/`l` before each number, `L5-L10`, no letter after `+`, `P`/`M` member shapes that fail, the `L-5` shape with its fixed hint, and one unit per list. Verify `path.test.ts` cases for the scenarios of "Line members can name the L unit", "A selector list names one unit", "A misplaced unit letter is refused with a fixed hint", and "Unit letters are reserved".
- [ ] 1.2 Add the canonical formatter to `packages/native-file-tools` (design D4), replace `SELECTOR_FORMS` with the shared message, and update the artifact, job, and skill-catalog listing refusals and the web line-count refusal (design D8). Verify the scenarios of "The shared selector refusal names the lettered forms" and "Other line refusals name the lettered forms", the formatter's own unit tests, and the updated "A refused locator names the spelling that works" (`read.test.ts`, `artifact-reader.test.ts`, `job-reader.test.ts`, `native-files.test.ts`, `web-read/locator.test.ts`, `web-read/result.test.ts`).
- [ ] 1.3 Prove that every scheme inherits the gate: `kb://`, `skill://`, `machine://`, `ssh://`, `artifact://`, `job://`, `projects://`, web, and the Machine daemon. Verify "Every text source accepts the letter", "A reserved unit is a selector on a remote path", "A letter outside the reserved set stays on the path", the literal-name scenarios, and "A lettered member on an image is refused" ("A source without lines refuses a line member") in the locator and daemon tests.
- [ ] 1.4 Verify in `tool-call-permissions` tests, under "A read selector of any spelling is removed before the resource match" and "The literal-name gap covers the new selector shapes", that a reject on a file refuses its `L` spellings and that an exact allow admits `/tmp/file:L1-2`. The line-and-column parts of those scenarios close in 5.3.
- [ ] 1.5 Increment `PROTOCOL_VERSION` in `packages/machine-protocol` (design D7). Verify the hub refuses a daemon with the previous version in `machine-session.test.ts`, and update the handshake fixtures that pin the number.
- [ ] 1.6 Update `docs/product/reference/selectors.md` and the locator reference pages for the input forms, add the unit letter to `docs/product/glossary.md`, and add the dated `CHANGELOG.md` entry. Verify `pnpm lint:markdown`.
- [ ] 1.7 Verify the layer: `pnpm --filter @workspace/native-file-tools test`, `pnpm --filter machine test`, focused `apps/api` locator, permission, and web-read tests, affected `lint` and `typecheck`, `pnpm format:check`, `git diff --check`.
- [ ] 1.8 Self-review the parent-relative diff before the PR is marked ready. Fix accepted findings with new commits.
- [ ] 1.9 Pass the GitHub review and CI gate under Ready-PR monitoring.

## 2. read-output

- [ ] 2.1 Use the canonical formatter in `model-text.ts` for headers, continuations, outline and raw forms, and listing paging. Verify the MODIFIED `tool-result-rendering` scenarios of "Results that carry content render as text", "The read header names the source and the shown lines", "The read header carries the source total when it is stored", "A count of one takes the singular noun", "Continuation is one bracketed notice line", "The continuation count names the source lines after the cut", and "A job read renders as text", plus "A listing reports no range" in `native-file-tools`.
- [ ] 2.2 Write `L` in `runtime-safety` `artifact-notice.ts` and `result-truncation.ts`, and in the bash spill template. Verify "An artifact notice is one bracketed line", "A head result names the artifact in its cap notice", and "A long log keeps its tail".
- [ ] 2.3 Update the E2E read-header and continuation parsers in `e2e/support/model-server.ts` to accept both spellings, the read continuation assertions in `e2e/web/chat/knowledge-tool.spec.ts`, and `scripts/measure-tool-results.mjs` with its fixture. Verify the focused Knowledge E2E spec.
- [ ] 2.4 Update `apps/api/src/prompts/tools/read.md`, `bash.md`, and `web_search.md`, `docs/product/reference/tools/read.md`, `tools/model-output.md`, and the locator pages that show printed headers, and add the dated `CHANGELOG.md` entry. Verify `tool-descriptions.test.ts` and `pnpm lint:markdown`.
- [ ] 2.5 Verify the layer: `pnpm --filter @workspace/native-file-tools test`, `pnpm --filter @workspace/runtime-safety test`, focused `apps/api` model-text, bash-spill, artifact, Machine-result, and job tests, affected `lint` and `typecheck`, `pnpm format:check`, `git diff --check`.
- [ ] 2.6 Self-review the parent-relative diff before the PR is marked ready. Fix accepted findings with new commits.
- [ ] 2.7 Pass the GitHub review and CI gate under Ready-PR monitoring.

## 3. search-output

- [ ] 3.1 Build grep passage locators with the canonical formatter in `grep/passages.ts`, `grep/page.ts`, `grep-machine.ts`, `grep-artifact.ts`, and `grep-page.ts` `mergeCutPassage`, and the grep remainder line. Make `grepFileLocator`, `passageStartLine`, and `passageEndLine` accept both spellings, and verify the page cursor, scan capping, artifact cut counts, and cut-passage merge with `L` locators and with stored bare ones. Verify "Every hit is a locator that the read group admits", both "The remainder line names the next files" and "The grep remainder line names the next files", and "A stored bare range stays valid".
- [ ] 3.2 Build Knowledge passage locators in the canonical spelling. Verify "Knowledge search scans one or all current spaces deterministically within global bounds", "A colon path is searched with an encoded locator" in particular.
- [ ] 3.3 Make `packages/ui` `grep.tsx` and `knowledge-search.tsx` parse both spellings, and update their stories. Verify Storybook story tests for both cards with a bare and an `L` locator.
- [ ] 3.4 Update `apps/api/src/prompts/tools/grep.md` and `knowledge_search.md`, `docs/product/reference/tools/grep.md`, and `locators/kb.md`, and add the dated `CHANGELOG.md` entry. Verify `tool-descriptions.test.ts` and `pnpm lint:markdown`.
- [ ] 3.5 Verify the layer: `pnpm --filter @workspace/native-file-tools test`, focused `apps/api` grep and Knowledge tests, `pnpm --filter @workspace/ui test`, the Knowledge E2E spec, affected `lint` and `typecheck`, `pnpm format:check`, `git diff --check`.
- [ ] 3.6 Self-review the parent-relative diff before the PR is marked ready. Fix accepted findings with new commits.
- [ ] 3.7 Pass the GitHub review and CI gate under Ready-PR monitoring.

## 4. authored-selectors

- [ ] 4.1 Write instruction pages and instruction imports as `:raw:L<from>-<to>` (`instruction-files.ts`, `instruction-imports.ts`). Verify "A candidate page uses the canonical spelling" and "A read argument that llame writes is canonical" of "llame writes every selector in the canonical spelling", and update the tests that pin `:raw:1-2000`.
- [ ] 4.2 Print prompt-import labels and not-imported lines with the canonical selector, split by the parser of each scheme, and keep a literal-probe target as written (design D5). Verify "Import labels print the canonical selector": "A bare range prints with its unit", "A target that is not imported prints with its unit", and "A literal file name prints as written" in `prompt-imports.test.ts` and `prompt-imports-item.test.ts`.
- [ ] 4.3 Update `apps/api/src/prompts/chat-default.md`, `docs/product/reference/prompt-imports.md`, `instruction-files.md`, and `context-documents.md`, and add the dated `CHANGELOG.md` entry. Verify `pnpm lint:markdown`.
- [ ] 4.4 Verify the layer: focused `apps/api` instruction, prompt-import, and Run execution tests, affected `lint` and `typecheck`, `pnpm format:check`, `git diff --check`. The PR carries `Closes #1833`.
- [ ] 4.5 Self-review the parent-relative diff before the PR is marked ready. Fix accepted findings with new commits.
- [ ] 4.6 Pass the GitHub review and CI gate under Ready-PR monitoring.

## 5. line-column

- [ ] 5.1 Recognize `:N:M` in `splitSelectorSuffix` and the web splitter after `:raw` and `:outline`, admit `N:M` at the gate, and read it as the member `N` (design D3). Verify the scenarios of "A line and column suffix reads the line" and "A line and column does not combine with a representation" on host and every listed source, and the split order in "Read selectors and context are deterministic".
- [ ] 5.2 Prove that the Machine daemon probes the whole written text: a daemon test where `x:12:5` exists as a file and one where only `x` exists.
- [ ] 5.3 Verify "A reject refuses every selector spelling" and "An exact allow admits the new spellings" in `tool-call-permissions` tests, with the line-and-column cases. Update the pinned `withoutReadSelector('https://example.test/a:5:6')` case in `locator-projection.test.ts`, which now projects to `https://example.test/a`.
- [ ] 5.4 Update `docs/product/reference/selectors.md` and `apps/api/src/prompts/tools/read.md`, and add the dated `CHANGELOG.md` entry. Verify `pnpm lint:markdown`.
- [ ] 5.5 Verify the layer: `pnpm --filter @workspace/native-file-tools test`, `pnpm --filter machine test`, focused `apps/api` locator, web-read, and permission tests, affected `lint` and `typecheck`, `pnpm format:check`, `git diff --check`. The PR carries `Closes #1834`.
- [ ] 5.6 Self-review the parent-relative diff before the PR is marked ready. Fix accepted findings with new commits.
- [ ] 5.7 Pass the GitHub review and CI gate under Ready-PR monitoring.

## 6. github-anchors

- [ ] 6.1 Return a `lineAnchor` from `parseWebLocator` for an exact GitHub line-anchor fragment, and drop every other fragment as today (design D6). Verify `web-read/locator.test.ts` cases for `#L10`, `#L10-L20`, `#L10C5-L20C3`, `#L20-L10`, and `#readme`.
- [ ] 6.2 Add the optional `lineAddressed` hook and the render flag to the adapter contract, implement the hook in the GitHub adapter, apply the anchor only to a flagged render, and refuse an anchor with a selector before any request (design D6). Verify every scenario of "GitHub blob line anchors select lines", "A line anchor outside its rule keeps the shipped fragment rule", and "A line anchor and a selector together are refused" with the adapter test fixtures, including that no request carries the fragment.
- [ ] 6.3 Verify "A line anchor does not escape a web reject" in `tool-call-permissions` tests.
- [ ] 6.4 Update `docs/product/reference/locators/web.md`, `docs/product/operator/web-read.md`, the web adapters reference, and `apps/api/src/prompts/tools/read.md`, and add the dated `CHANGELOG.md` entry. Verify `pnpm lint:markdown`.
- [ ] 6.5 Verify the layer: focused `apps/api` web-read, GitHub adapter, and permission tests, affected `lint` and `typecheck`, `pnpm format:check`, `git diff --check`. The PR carries `Closes #1835`.
- [ ] 6.6 Self-review the parent-relative diff before the PR is marked ready. Fix accepted findings with new commits.
- [ ] 6.7 Pass the GitHub review and CI gate under Ready-PR monitoring.

## 7. finalize

- [ ] 7.1 Enter `name-selector-units/finalize` with `$gh-stack` from the `github-anchors` top before `$openspec-sync-specs` writes canonical specs.
- [ ] 7.2 Run `$openspec-sync-specs`. Inspect `openspec status --change name-selector-units --json` and confirm every artifact is done and every earlier task is checked.
- [ ] 7.3 Check MODIFIED requirements and cross-capability wording for semantic consistency, and confirm the active `tool-search` change still applies to `tool-call-permissions`. Verify `pnpm exec openspec validate --specs --strict` and `pnpm exec openspec validate --all --strict`.
- [ ] 7.4 Confirm archive readiness, then run `$openspec-archive-change`. Self-review and the GitHub review gate follow archive movement as post-archive gates.
