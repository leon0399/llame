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
  <- name-selector-units/github-anchors
  <- name-selector-units/finalize
```

| Layer                                    | Parent               | Ownership                                                                                                                                                                 | Authored estimate | Closes |
| ---------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | ------ |
| `name-selector-units/proposal`           | `master`             | The approved proposal, design, deltas, and this task list.                                                                                                                | ~2,100            | none   |
| `name-selector-units/input-grammar`      | `proposal`           | The `L` forms, reserved letters, the `L-5` hint, mixed-unit lists, the line-and-column suffix, the refusal messages, and the Machine protocol increment, on every source. | ~1,500            | #1834  |
| `name-selector-units/read-output`        | `input-grammar`      | Read headers, continuations, listing paging, artifact and head-spill notices, bash spill lines, and the E2E read parsers.                                                 | ~1,100            | none   |
| `name-selector-units/search-output`      | `read-output`        | Grep passage locators and range parsers, the grep remainder, Knowledge passage locators, and the grep and Knowledge search cards.                                         | ~1,000            | none   |
| `name-selector-units/authored-selectors` | `search-output`      | Instruction pages, instruction imports, and prompt-import labels.                                                                                                         | ~550              | #1833  |
| `name-selector-units/github-anchors`     | `authored-selectors` | GitHub blob line anchors, the adapter hook, and the anchor-selector conflict.                                                                                             | ~700              | #1835  |
| `name-selector-units/finalize`           | `github-anchors`     | Spec sync, task records, and archive movement only.                                                                                                                       | ~300              | none   |

Every layer is a safe merge point. Input accepts both spellings from the first implementation layer,
so each output layer can merge alone. No layers must merge together. The input-grammar layer carries
every daemon-side grammar change, the line-and-column suffix included, so its one protocol increment
covers them all (design D7). It closes #1834, whose acceptance is the line it reads; the canonical
header of that read ships in `read-output`.

The proposal layer is about 2,100 authored lines, just over the 2,000-line review target. Most of
it is the full STE text of MODIFIED requirements.

Each layer that ships behavior owns its reference and operator docs, its prompt text, and a dated
`CHANGELOG.md` entry. The `authored-selectors` layer closes #1833, because after it every selector
that llame prints or writes is canonical.

Delivery override from Leo (2026-11-22): after each layer, a local multi-agent review (correctness,
simplification, over-engineering) is the main review; the next layer starts once the layer's CI test
jobs are green. Bot review and mutation runs continue in the background and do not gate the next
layer, but no more than one earlier layer may carry open review work.

## 0. proposal

- [x] 0.1 Run adversarial review with two independent reviewers per round: spec consistency, and feasibility against `packages/native-file-tools/src/path.ts`, the scheme locators, the printers, `apps/machine/src/file-targets.ts`, and the GitHub adapter. Verify each finding against code or specs. Commit each round separately.
  - Evidence: rounds 1 (d51b98f35) and 2 (this commit), each with a spec-consistency and a feasibility reviewer; counts in design.md Revision history.
- [x] 0.2 Prove the final revision: `pnpm exec openspec validate name-selector-units --strict`, `pnpm lint:markdown`, `pnpm format:check`, `git diff --check`, and a script that confirms each MODIFIED block keeps every canonical scenario heading in order. Record Leo's approval of that revision.
  - Evidence: strict validation, markdownlint, oxfmt, and the scenario-order script pass on the round-2 revision. Leo approved it in chat on 2026-11-22 ("after which spec is approved"), with the D7 deviation recorded in `.agents/notes/name-selector-units/decisions.md`.
- [x] 0.3 Self-review the proposal diff before the PR is marked ready. Record the review rounds in the PR body.
  - Evidence: the #1885 body records both rounds and the bot triage.
- [x] 0.4 Pass the GitHub review and CI gate under Ready-PR monitoring.
  - Evidence: #1885 resolved every review thread (11), CI passed on the approved head; Indent recorded as a quota-exhausted skip.

## 1. input-grammar

- [x] 1.1 Extend the shape gate and normalization in `packages/native-file-tools/src/path.ts` (design D1, D2): an optional `L`/`l` before each number, `L5-L10`, no letter after `+`, `P`/`M` member shapes that fail, the `L-5` shape with its fixed hint, and one unit per list. Verify `path.test.ts` cases for the scenarios of "Line members can name the L unit", "A selector list names one unit", "A misplaced unit letter is refused with a fixed hint", and "Unit letters are reserved".
- [x] 1.2 Add the canonical formatter to `packages/native-file-tools` (design D4), replace `SELECTOR_FORMS` with the shared message, and update the artifact, job, and skill-catalog listing refusals and the web line-count refusal (design D8). Verify the scenarios of "The shared selector refusal names the lettered forms" and "Other line refusals name the lettered forms", the formatter's own unit tests, and the updated "A refused locator names the spelling that works" (`read.test.ts`, `artifact-reader.test.ts`, `job-reader.test.ts`, `native-files.test.ts`, `web-read/locator.test.ts`, `web-read/result.test.ts`).
- [x] 1.3 Prove that every scheme inherits the gate: `kb://`, `skill://`, `machine://`, `ssh://`, `artifact://`, `job://`, `projects://`, web, and the Machine daemon. Verify "Every text source accepts the letter", "A reserved unit is a selector on a remote path", "A letter outside the reserved set stays on the path", the literal-name scenarios, and "A lettered member on an image is refused" ("A media source refuses a lettered member"), "The hint applies on a remote path" in the locator and daemon tests, including a hub test that a host or `machine://` path with a reserved or misplaced-letter suffix is a selector, not a filename.
- [x] 1.4 Verify in `tool-call-permissions` tests, under "A read selector of any spelling is removed before the resource match" and "The literal-name gap covers the new selector shapes", every scenario: a reject on a file refuses its `L`, misplaced-letter, and line-and-column spellings, and an exact allow admits `/tmp/file:L1-2` and `/tmp/file:12:5`.
- [x] 1.5 Recognize `:N:M` in `splitSelectorSuffix` and the web splitter after `:raw` and `:outline`, widen those two patterns to claim a `:N:M` tail as a refused shape, admit `N:M` at the gate, and read it as the member `N` (design D3). Verify the scenarios of "A line and column suffix reads the line" (line selection; its header spelling closes in 2.1) and "A line and column does not combine with a representation" on host and every listed source, and the split order in "Read selectors and context are deterministic".
- [x] 1.6 Prove that the Machine daemon probes the whole written text: a daemon test where `x:12:5` exists as a file and one where only `x` exists. Update the pinned `withoutReadSelector('https://example.test/a:5:6')` case in `locator-projection.test.ts`, which now projects to `https://example.test/a`.
- [x] 1.7 Increment `PROTOCOL_VERSION` from 2 to 3 in `packages/machine-protocol` (design D7). Verify "A daemon without unit-letter selectors is not used" in `machine-session.test.ts`, and check `docs/product/operator/machines.md` for the version.
- [x] 1.8 Update `docs/product/reference/selectors.md`, the locator reference pages, and `apps/api/src/prompts/tools/read.md` for the input forms and the line-and-column suffix, add the unit letter to `docs/product/glossary.md`, and add the dated `CHANGELOG.md` entry that tells operators to update every Machine daemon with this release. Verify `pnpm lint:markdown`.
- [x] 1.9 Verify the layer: `pnpm --filter @workspace/native-file-tools test`, `pnpm --filter machine test`, focused `apps/api` locator, permission, Machine session, and web-read tests, affected `lint` and `typecheck`, `pnpm format:check`, `git diff --check`. The PR carries `Closes #1834`.
- [ ] 1.10 Run the local multi-agent review of the parent-relative diff before the PR is marked ready. Fix accepted findings with new commits.
- [ ] 1.11 Pass the GitHub review and CI gate under Ready-PR monitoring.

## 2. read-output

- [x] 2.1 Use the canonical formatter in `model-text.ts` for headers, continuations, outline and raw forms, and listing paging. Verify the MODIFIED `tool-result-rendering` scenarios of "Results that carry content render as text", "The read header names the source and the shown lines", "The read header carries the source total when it is stored", "A count of one takes the singular noun", "Continuation is one bracketed notice line", "The continuation count names the source lines after the cut", and "A job read renders as text", plus "A listing reports no range" and the header of "A compiler location reads its line" in `native-file-tools`.
- [x] 2.2 Write `L` in `runtime-safety` `artifact-notice.ts` and `result-truncation.ts`, and in the bash spill template. Verify "An artifact notice is one bracketed line", "A head result names the artifact in its cap notice", and "A long log keeps its tail".
- [x] 2.3 Update the E2E read-header and continuation parsers in `e2e/support/model-server.ts` to accept both spellings, the read continuation assertions in `e2e/web/chat/knowledge-tool.spec.ts`, and `scripts/measure-tool-results.mjs` with its fixture. Verify the focused Knowledge E2E spec.
- [x] 2.4 Update `apps/api/src/prompts/tools/read.md`, `bash.md`, and `web_search.md`, `docs/product/reference/tools/read.md`, `tools/model-output.md`, and the locator pages that show printed headers, and add the dated `CHANGELOG.md` entry. Verify `tool-descriptions.test.ts` and `pnpm lint:markdown`.
- [x] 2.5 Verify the layer: `pnpm --filter @workspace/native-file-tools test`, `pnpm --filter @workspace/runtime-safety test`, focused `apps/api` model-text, bash-spill, artifact, Machine-result, and job tests, affected `lint` and `typecheck`, `pnpm format:check`, `git diff --check`.
- [ ] 2.6 Run the local multi-agent review of the parent-relative diff before the PR is marked ready. Fix accepted findings with new commits.
- [ ] 2.7 Pass the GitHub review and CI gate under Ready-PR monitoring.

## 3. search-output

- [x] 3.1 Build grep passage locators with the canonical formatter in `grep/passages.ts`, `grep/page.ts`, `grep-machine.ts`, `grep-artifact.ts`, and `grep-page.ts` `mergeCutPassage`, and the grep remainder line. Make `grepFileLocator`, `passageStartLine`, `passageEndLine`, `cutToFit` in `grep/page.ts`, and the daemon's `passageOf` in `apps/machine/src/grep.ts` accept both spellings, and verify the page cursor, scan capping, artifact cut counts, and cut-passage merge with `L` locators and with stored bare ones. Verify "Every hit is a locator that the read group admits", both "The remainder line names the next files" and "The grep remainder line names the next files", and "A stored bare range stays valid".
- [x] 3.2 Build Knowledge passage locators in the canonical spelling. Verify "Knowledge search scans one or all current spaces deterministically within global bounds", "A colon path is searched with an encoded locator" in particular.
- [x] 3.3 Make `packages/ui` `grep.tsx` and `knowledge-search.tsx` parse both spellings, and update their stories. Verify Storybook story tests for both cards with a bare and an `L` locator.
- [x] 3.4 Update `apps/api/src/prompts/tools/grep.md` and `knowledge_search.md`, `docs/product/reference/tools/grep.md`, and `locators/kb.md`, and add the dated `CHANGELOG.md` entry. Verify `tool-descriptions.test.ts` and `pnpm lint:markdown`.
- [x] 3.5 Verify the layer: `pnpm --filter @workspace/native-file-tools test`, `pnpm --filter machine test`, focused `apps/api` grep and Knowledge tests, `pnpm --filter @workspace/ui test`, the Knowledge E2E spec, affected `lint` and `typecheck`, `pnpm format:check`, `git diff --check`.
- [ ] 3.6 Run the local multi-agent review of the parent-relative diff before the PR is marked ready. Fix accepted findings with new commits.
- [ ] 3.7 Pass the GitHub review and CI gate under Ready-PR monitoring.

## 4. authored-selectors

- [ ] 4.1 Write instruction pages and instruction imports as `:raw:L<from>-<to>` (`instruction-files.ts`, `instruction-imports.ts`). Verify "A candidate page uses the canonical spelling" (instruction-files) and "A read argument that llame writes is canonical" (native-file-tools), and update the tests that pin `:raw:1-2000`.
- [ ] 4.2 Print prompt-import labels and not-imported lines with the canonical selector, split by the parser of each scheme, and keep a literal-probe target and a target with a refused selector as written, through a new unstored `literal` outcome field (design D5). Verify "Import labels print the canonical selector": "A bare range prints with its unit", "A target that is not imported prints with its unit", and "A literal file name prints as written" in `prompt-imports.test.ts` and `prompt-imports-item.test.ts`.
- [ ] 4.3 Update `apps/api/src/prompts/chat-default.md`, `docs/product/reference/prompt-imports.md`, `instruction-files.md`, and `context-documents.md`, and add the dated `CHANGELOG.md` entry. Verify `pnpm lint:markdown`.
- [ ] 4.4 Verify the layer: focused `apps/api` instruction, prompt-import, and Run execution tests, affected `lint` and `typecheck`, `pnpm format:check`, `git diff --check`. The PR carries `Closes #1833`.
- [ ] 4.5 Run the local multi-agent review of the parent-relative diff before the PR is marked ready. Fix accepted findings with new commits.
- [ ] 4.6 Pass the GitHub review and CI gate under Ready-PR monitoring.

## 5. github-anchors

- [ ] 5.1 Return a `lineAnchor` from `parseWebLocator` for an exact GitHub line-anchor fragment, and drop every other fragment as today (design D6). Verify `web-read/locator.test.ts` cases for `#L10`, `#L10-L20`, `#L10C5-L20C3`, `#L20-L10`, and `#readme`.
- [ ] 5.2 Add the optional `lineAddressed` hook and the render flag to the adapter contract, implement the hook in the GitHub adapter, apply the anchor only to a flagged render, and refuse an anchor with a selector before any request (design D6). Verify every scenario of "GitHub blob line anchors select lines", "A line anchor outside its rule keeps the shipped fragment rule", and "A line anchor and a selector together are refused" with the adapter test fixtures, including that no request carries the fragment.
- [ ] 5.3 Verify "A line anchor does not escape a web reject" in `tool-call-permissions` tests.
- [ ] 5.4 Update `docs/product/reference/locators/web.md`, `docs/product/operator/web-read.md`, the web adapters reference, and `apps/api/src/prompts/tools/read.md`, and add the dated `CHANGELOG.md` entry. Verify `pnpm lint:markdown`.
- [ ] 5.5 Verify the layer: focused `apps/api` web-read, GitHub adapter, and permission tests, affected `lint` and `typecheck`, `pnpm format:check`, `git diff --check`. The PR carries `Closes #1835`.
- [ ] 5.6 Run the local multi-agent review of the parent-relative diff before the PR is marked ready. Fix accepted findings with new commits.
- [ ] 5.7 Pass the GitHub review and CI gate under Ready-PR monitoring.

## 6. finalize

- [ ] 6.1 Enter `name-selector-units/finalize` with `$gh-stack` from the `github-anchors` top before `$openspec-sync-specs` writes canonical specs.
- [ ] 6.2 Run `$openspec-sync-specs`. Inspect `openspec status --change name-selector-units --json` and confirm every artifact is done and every earlier task is checked.
- [ ] 6.3 Check MODIFIED requirements and cross-capability wording for semantic consistency, and confirm the active `tool-search` change still applies to `tool-call-permissions`. Verify `pnpm exec openspec validate --specs --strict` and `pnpm exec openspec validate --all --strict`.
- [ ] 6.4 Confirm archive readiness, then run `$openspec-archive-change`. Self-review and the GitHub review gate follow archive movement as post-archive gates.
