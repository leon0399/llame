Track [#915](https://github.com/leon0399/llame/issues/915),
[#1519](https://github.com/leon0399/llame/issues/1519),
[#1525](https://github.com/leon0399/llame/issues/1525),
[#1526](https://github.com/leon0399/llame/issues/1526), and their PR layers
through [Project tracking](../../../CONTRIBUTING.md#project-tracking).
Implementation waits for Leo's approval of the published proposal revision.
Keep live status in the Project.

## Delivery stack

Use `$gh-stack` for every branch operation and `$openspec-apply-change` for
each implementation layer, after proposal approval only.

```text
master
  <- tool-result-artifacts/proposal
  <- tool-result-artifacts/web-search-text
  <- tool-result-artifacts/store
  <- tool-result-artifacts/spill
  <- tool-result-artifacts/materialize
  <- tool-result-artifacts/grep
  <- tool-result-artifacts/web-search-offload
  <- tool-result-artifacts/finalize
```

| Layer                | Parent               | Ownership                                                                                                                                                                           | Authored estimate | Closes |
| -------------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | ------ |
| `proposal`           | `master`             | Proposal, design, deltas, and this task list.                                                                                                                                       | ~3,300            | none   |
| `web-search-text`    | `proposal`           | The `web_search` text shape for the model.                                                                                                                                          | ~900              | #1525  |
| `store`              | `web-search-text`    | Tables, counter, RLS, the `artifact://` reader and lists, read-time authority, permission projection, replay locator, fork copy, prompt-import opt-out, `tools.artifacts.maxBytes`. | ~2,000            | none   |
| `spill`              | `store`              | The spill field, generic spill in the runner and MCP, `bash` stream bounds, stream parts, head and tail, the notice line.                                                           | ~1,600            | none   |
| `materialize`        | `spill`              | Host files, reconcile at attempt start and before `bash`, the host path in the notice.                                                                                              | ~900              | #915   |
| `grep`               | `materialize`        | Walk to the end, inline head, remainder line, `grep` artifact, cursor removal.                                                                                                      | ~2,000            | #1519  |
| `web-search-offload` | `grep`               | `webSearch.fetchLimit`, the wider fetch, the `web_search` artifact.                                                                                                                 | ~900              | #1526  |
| `finalize`           | `web-search-offload` | Spec sync, task records, and archive movement only.                                                                                                                                 | ~800              | none   |

**Named budget exception: the proposal layer is about 2,500 authored lines after review (2,016 in the first draft).**
The change modifies ten capabilities. The `grep` delta alone removes four
requirements and modifies eight, because the cursor is part of their text.
Splitting the proposal would approve the artifact contract without its first
consumers. Every implementation layer stays inside about 2,000 lines; the
`store` and `grep` layers are at the limit and get a size check before
publication.

## 1. proposal

- [ ] 1.1 Validate the change: `pnpm exec openspec validate tool-result-artifacts --strict`, `pnpm exec markdownlint-cli2 "openspec/changes/tool-result-artifacts/**/*.md"`, `pnpm format:check`, `git diff --check`.
- [ ] 1.2 Run two review rounds with at least two independent reviewers each, verify every finding against code or primary sources, and commit each round separately.
- [ ] 1.3 Obtain Leo's approval of the published revision, including the host-path exception in proposal.md.

## 2. web-search-text

- [ ] 2.1 Render `web_search` results and answers as text in `apps/api/src/tools/model-text.ts` and a `web_search` text-shape module. Verify the `tool-result-rendering` scenarios "Three results render in rank order", "An aggregate answer follows the results", "A snippet cannot start a result", "A title with a line break stays on one line", and "A web search renders as text".
- [ ] 2.2 Keep the stored part and the web chat renderer unchanged. Verify "Reload reproduces the output" with today's inline results and a web UI story with no diff.
- [ ] 2.3 Measure tokens for 10 recorded results in JSON and in text, and put the numbers in the PR body.
- [ ] 2.4 Update `apps/api/src/prompts/tools/web_search.md`, `docs/product/reference/tools/web_search.md`, and add a dated `CHANGELOG.md` entry. Verify `pnpm lint:markdown`.
- [ ] 2.5 Verify the layer: affected `lint`, `typecheck`, focused `apps/api` web-search and model-text tests, `pnpm format:check`, `git diff --check`.
- [ ] 2.6 Self-review the parent-relative diff before the PR is marked ready. Fix accepted findings with new commits.
- [ ] 2.7 Pass the GitHub review and CI gate under Ready-PR monitoring with `Closes #1525`.

## 3. store

- [ ] 3.1 Add `tool_artifacts`, `tool_artifact_parts`, and `chats.artifact_seq` with forced RLS and cascade (design D1). Generate the migration with Drizzle and run `pnpm db:provision-rls`. Verify "Another owner cannot read it" and "A deleted Chat leaves no artifact" in an integration test, plus a negative test that runs with no identity and reads no row.
- [ ] 3.2 Add the artifact writer: number allocation on the Chat row, one transaction, bound check. Verify "Numbers increase across tools", "Concurrent calls get different numbers", and "A failed write keeps the inline result" in integration tests.
- [ ] 3.3 Register the `artifact` reader in `LOCATOR_READERS` with line selectors, `:raw`, Markdown and JSON handling, the Chat list, and the parts list (design D2). Refuse the scheme in `edit` and `write`. Verify every scenario of "The read tool accepts artifact locators" and "A bare artifact locator lists artifacts", and "Another Chat of the same owner cannot read it".
- [ ] 3.4 Apply read-time authority from `findings` (design D5). Verify "A new reject withholds a finding" and "A bash part has no finding to check" with a fake producer that writes `findings`.
- [ ] 3.5 Project `artifact://` in the permission evaluator. Verify both scenarios of "Artifact locators match as their logical text".
- [ ] 3.6 Emit `Artifact: <locator>` in replay (design D8). Verify the three scenarios of "A replayed pair keeps its artifact locator", and that a pair without an artifact is unchanged.
- [ ] 3.7 Copy the cited artifacts and the counter in the owner fork transaction (design D11). Verify the three scenarios of "A fork copies the artifacts that its copied parts name".
- [ ] 3.8 Skip `artifact://` in prompt imports. Verify "An artifact marker stays prose".
- [ ] 3.9 Add `tools.artifacts.maxBytes` to the loader, schema, and `llame.config.jsonc.example`. Verify both scenarios of "Operator configuration bounds tool-result artifacts".
- [ ] 3.10 Add `docs/product/reference/tools/artifacts.md`, the `read` reference for the scheme, the `read` prompt text, and a dated `CHANGELOG.md` entry. Verify `pnpm lint:markdown`.
- [ ] 3.11 Verify the layer: `pnpm --filter api lint`, `typecheck`, focused unit tests, the API integration suite with the isolation tests, `pnpm format:check`, `git diff --check`.
- [ ] 3.12 Self-review the parent-relative diff before the PR is marked ready. Fix accepted findings with new commits.
- [ ] 3.13 Pass the GitHub review and CI gate under Ready-PR monitoring.

## 4. spill

- [ ] 4.1 Add the `spill` field to tool definitions and spill in the runner and the MCP cap path (design D3, D6). Verify "A large bash output is stored", "A small result creates no artifact", "An MCP result keeps its head", and "A head notice gives the next line".
- [ ] 4.2 Raise the host and `ssh://` stream bound to `tools.artifacts.maxBytes` and store each spilled stream as a part (design D4). Verify "A host stream larger than the old bound is kept", "Oversized output is bounded", "A bash artifact has one part for each stream", and "JSON stdout is a JSON part".
- [ ] 4.3 Render the head, the omitted-range line, and the tail for each spilled stream. Verify "A bash log keeps its tail inline", "A long log keeps its tail", "A head and tail notice gives the omitted range", and the changed `bash` rendering scenarios.
- [ ] 4.4 Render the artifact notice and keep the cap notice last. Verify "A notice without a host file" and "A cap notice renders as a line".
- [ ] 4.5 Update `docs/product/reference/tools/bash.md`, the `bash` prompt text, the artifacts reference, and add a dated `CHANGELOG.md` entry. Verify `pnpm lint:markdown`.
- [ ] 4.6 Verify the layer: affected `lint`, `typecheck`, `test:coverage` where defined, focused `apps/api`, `packages/bash-executor`, and `packages/runtime-safety` tests, `pnpm format:check`, `git diff --check`.
- [ ] 4.7 Self-review the parent-relative diff before the PR is marked ready. Fix accepted findings with new commits.
- [ ] 4.8 Pass the GitHub review and CI gate under Ready-PR monitoring.

## 5. materialize

- [ ] 5.1 Write artifact files after the commit when `bash` is allowlisted and the Run has a native executor (design D10). Verify "A bash artifact becomes files" and "Without bash no file is written".
- [ ] 5.2 Reconcile at attempt start and before each `bash` call. Verify "A reboot loses the files" and "A changed file is repaired before bash" with a temporary `TMPDIR`.
- [ ] 5.3 Name the host path in the notice, or the host-only text in a Machine Workspace. Verify "The host path is shown with bash", "A Machine Workspace is told where the file is", "A notice with a host file", and "A file keeps a later withheld finding".
- [ ] 5.4 Update `docs/product/operator/native-files.md` (host files, `TMPDIR`, no isolation), the artifacts reference, and add a dated `CHANGELOG.md` entry. Verify `pnpm lint:markdown`.
- [ ] 5.5 Verify the layer: affected `lint`, `typecheck`, focused tests, `pnpm format:check`, `git diff --check`.
- [ ] 5.6 Self-review the parent-relative diff before the PR is marked ready. Fix accepted findings with new commits.
- [ ] 5.7 Pass the GitHub review and CI gate under Ready-PR monitoring with `Closes #915`.

## 6. grep

- [ ] 6.1 Remove the page stop and the keyset cursor from the engine and the API, and keep the internal `fs.grep` paging (design D7). Verify "A full inline part does not stop the walk", "A stopped walk returns no cursor", "A cursor is refused", and the changed bound and deadline scenarios.
- [ ] 6.2 Render the artifact text while the walk runs, with `findings`, and stop at the artifact bound. Verify "The artifact bound stops the walk", "A broad search stops at the bound", and "Twenty-first passage is marked".
- [ ] 6.3 Render the inline head and the remainder line. Verify "The budget ends the inline part early", "A cut first passage continues in the artifact", "The next files are named with their ranges", "No match", and "Inline lines keep their numbers in the artifact".
- [ ] 6.4 Name the stopped file in `unfinishedFile` within one call. Verify "A file larger than the call is named", "A refused unfinished file is not named", and "A byte bound in the first file skips it".
- [ ] 6.5 Verify Machine scopes: "A dropped Machine passage never names the cursor", "A resumed page does not repeat earlier exclusions", and "Budgets span Machines".
- [ ] 6.6 Verify `grep-1.md` outlines its files: "A grep artifact is Markdown".
- [ ] 6.7 Measure, with a throwaway script, a broad walk of this repository and of `/mnt/d/Projects`: time, artifact size, and the stop. Put the numbers in the PR body. Do not commit the script.
- [ ] 6.8 Update `docs/product/reference/tools/grep.md`, `apps/api/src/prompts/tools/grep.md`, `docs/development/harness-comparison/grep.md`, and add a dated `CHANGELOG.md` entry. Verify `pnpm lint:markdown`.
- [ ] 6.9 Verify the layer: `pnpm --filter @workspace/native-file-tools test` and `test:coverage`, `pnpm --filter machine test`, `pnpm --filter @workspace/machine-protocol test`, focused `apps/api` grep tests, affected `lint` and `typecheck`, `pnpm format:check`, `git diff --check`.
- [ ] 6.10 Self-review the parent-relative diff before the PR is marked ready. Fix accepted findings with new commits.
- [ ] 6.11 Pass the GitHub review and CI gate under Ready-PR monitoring with `Closes #1519`.

## 7. web-search-offload

- [ ] 7.1 Add `webSearch.fetchLimit` to the loader, schema, and example. Verify both scenarios of "Operator configuration sets the web search fetch size".
- [ ] 7.2 Request the fetch size, cut the aggregate to it, and keep `limit` inline (design D9). Verify "The engine clamps a large limit", "A small limit passes unchanged", "Default limit", and the aggregate scenarios.
- [ ] 7.3 Write the `web_search` artifact with `findings` and store the inline results with the locator. Verify "Twenty results with a limit of ten", "Reading the artifact sends no request", "Oversized output drops trailing entries", and "Reload reproduces the output".
- [ ] 7.4 Update `docs/product/operator/web-search.md` (fetch size and cost), `docs/product/reference/tools/web_search.md`, the `web_search` prompt text, and add a dated `CHANGELOG.md` entry. Verify `pnpm lint:markdown`.
- [ ] 7.5 Verify the layer: affected `lint`, `typecheck`, focused web-search and instance-config tests, `pnpm format:check`, `git diff --check`.
- [ ] 7.6 Self-review the parent-relative diff before the PR is marked ready. Fix accepted findings with new commits.
- [ ] 7.7 Pass the GitHub review and CI gate under Ready-PR monitoring with `Closes #1526`.

## 8. finalize

- [ ] 8.1 Enter `tool-result-artifacts/finalize` with `$gh-stack` before any canonical spec write. Then run `$openspec-sync-specs`. Verify the ADDED requirements appear word for word, each MODIFIED requirement matches its delta with every canonical scenario kept, and each REMOVED requirement is gone.
- [ ] 8.2 Confirm archive readiness: `openspec status --change tool-result-artifacts --json` reports every artifact done and every task above is checked. Run `pnpm exec openspec validate --specs --strict`, `pnpm exec openspec validate --all --strict`, `pnpm lint:markdown`, `pnpm format:check`, and `git diff --check`.

## Workflow follow-up

- Archive with `$openspec-archive-change` after 8.2. Then self-review the
  finalize diff, mark it ready, and run Ready-PR monitoring. These SR and GR
  steps are post-archive gates.
- Merge the stack only through `$gh-stack` with Leo's explicit permission.
