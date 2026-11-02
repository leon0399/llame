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
  <- tool-result-artifacts/bash-spill
  <- tool-result-artifacts/materialize
  <- tool-result-artifacts/grep-walk
  <- tool-result-artifacts/grep-artifact
  <- tool-result-artifacts/web-search-offload
  <- tool-result-artifacts/finalize
```

| Layer                | Parent               | Ownership                                                                                                                                                                                                                      | Authored estimate | Closes |
| -------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------- | ------ |
| `proposal`           | `master`             | Proposal, design, deltas, and this task list.                                                                                                                                                                                  | ~3,000            | none   |
| `web-search-text`    | `proposal`           | The `web_search` text shape for the model.                                                                                                                                                                                     | ~900              | #1525  |
| `store`              | `web-search-text`    | Tables, counter, RLS, writer, the `artifact://` reader and lists, finding re-check, permission projection, the `artifact` field through the run loop and replay, fork copy, prompt-import opt-out, `tools.artifacts.maxBytes`. | ~1,900            | none   |
| `spill`              | `store`              | The spill field, `head` spill in the runner and MCP, JSON parts, the cap notice, failed and oversized writes, no artifact without a reader.                                                                                    | ~1,400            | none   |
| `bash-spill`         | `spill`              | The `bash` stream bound, spill inside the native fence for every outcome, stream parts, head and tail rendering, the artifact notice.                                                                                          | ~1,500            | none   |
| `materialize`        | `bash-spill`         | Host files, reconcile, sweep, the host directory in notices.                                                                                                                                                                   | ~1,000            | #915   |
| `grep-walk`          | `materialize`        | Internal paging on host and Machine, cursor removal, stop and progress rules.                                                                                                                                                  | ~1,700            | none   |
| `grep-artifact`      | `grep-walk`          | The `grep` artifact with findings, the inline head, the remainder line, the cut marker, the notice.                                                                                                                            | ~1,600            | #1519  |
| `web-search-offload` | `grep-artifact`      | `webSearch.fetchLimit`, vendor counts, the aggregate cut, the `web_search` artifact with findings.                                                                                                                             | ~1,200            | #1526  |
| `finalize`           | `web-search-offload` | Spec sync, the `grep-tool` Purpose, task records, and archive movement only.                                                                                                                                                   | ~1,200            | none   |

**Named budget exception: the proposal layer is about 3,000 authored lines.**
The change modifies nine capabilities and adds one. The `grep-tool` delta
removes four requirements and modifies nine, because the cursor is part of
their text. The `web-search` delta modifies twelve, because each one counts
by `limit`. Splitting the proposal would approve the artifact contract
without its first consumers. Every implementation layer stays inside about
2,000 lines.

## 1. proposal

- [ ] 1.1 Validate the change: `pnpm exec openspec validate tool-result-artifacts --strict`, `pnpm exec markdownlint-cli2 "openspec/changes/tool-result-artifacts/**/*.md"`, `node scripts/check-markdown-links.mjs`, `pnpm format:check`, `git diff --check`.
- [ ] 1.2 Run two review rounds with at least two independent reviewers each, verify every finding against code or primary sources, and commit each round separately.
- [ ] 1.3 Obtain Leo's approval of the published revision, including each deviation in proposal.md.

## 2. web-search-text

- [ ] 2.1 Render `web_search` results and answers as text through the shared rendering function. Verify "Three results render in rank order", "An aggregate answer follows the results", "A snippet cannot start a result", "A title with a line break stays on one line", "A query with a line break stays on one line", and "A web search renders as text".
- [ ] 2.2 Keep the stored part and the web chat renderer unchanged in this layer. Verify "Reload reproduces the output" and an unchanged web UI story.
- [ ] 2.3 Measure tokens for 10 recorded results in JSON and in text, and put the numbers in the PR body.
- [ ] 2.4 Update `apps/api/src/prompts/tools/web_search.md` and `docs/product/reference/tools/web-search.md`, and add a dated `CHANGELOG.md` entry. Verify `pnpm lint:markdown`.
- [ ] 2.5 Verify the layer: affected `lint`, `typecheck`, focused `apps/api` web-search and model-text tests, `pnpm format:check`, `git diff --check`.
- [ ] 2.6 Self-review the parent-relative diff before the PR is marked ready. Fix accepted findings with new commits.
- [ ] 2.7 Pass the GitHub review and CI gate under Ready-PR monitoring with `Closes #1525`.

## 3. store

- [ ] 3.1 Add `tool_artifacts`, `tool_artifact_parts`, and `chats.artifact_seq` with forced RLS and cascade (design D1). Generate the migration with Drizzle and run `pnpm db:provision-rls`. Verify "Another owner cannot read it", "A query without identity reads nothing", and "A deleted Chat leaves no artifact row" in integration tests.
- [ ] 3.2 Add the writer: the number in its own transaction, the parts in one transaction, the unique tool-call key, and the per-part bound. Verify "Numbers increase across tools" and "Concurrent calls get different numbers" with a test producer.
- [ ] 3.3 Register the `artifact` reader with line selectors, `:raw`, `:outline`, the Chat list, and the stream list (design D2). Refuse the scheme in `edit` and `write`. Verify "A range of an artifact is read", "An artifact is read without a native executor", "An unknown part is not found", "An artifact cannot be edited", "The Chat list names each artifact", "A bash artifact lists its streams", and "Another Chat of the same owner cannot read it", with artifacts that a test producer writes.
- [ ] 3.4 Apply the finding re-check (design D5) and its permission exception. Verify "A new reject withholds a grep finding", "A withheld file leaves the outline", "A web result is withheld after a reject", "A web result without an allow stays visible", "A bypassed Run sees every finding", "A bash part has no finding to check", and "Finding decisions are not recorded", with a test producer that writes findings.
- [ ] 3.5 Add projection tests for `artifact://`. Verify both scenarios of "Artifact locators match as their logical text".
- [ ] 3.6 Carry the `artifact` field from the runner to the stored part, the run event, continue projection, and the chat DTO, and emit `Artifact:` in replay (design D6, D8). Verify the three scenarios of "A replayed pair keeps its artifact locator", "A checkpoint does not carry the artifact", and "An old artifact still reads".
- [ ] 3.7 Copy the cited artifacts and the counter in `copyOwnedChat` (design D11). Verify the five scenarios of "A fork copies the artifacts that its copied parts name".
- [ ] 3.8 Skip `artifact://` in prompt imports. Verify "An artifact marker stays prose" and the changed "A marker for each read scheme gets an outcome".
- [ ] 3.9 Add `tools.artifacts.maxBytes` to the loader, the published schema, and `apps/api/llame.config.jsonc.example`. Verify both scenarios of "Operator configuration bounds tool-result artifacts".
- [ ] 3.10 Add `docs/product/reference/tools/artifacts.md`, the `read` reference and prompt text for the scheme, and the `^artifact://` allow in `docs/product/operator/native-files.md` (design D13). Add a dated `CHANGELOG.md` entry. Verify `pnpm lint:markdown`.
- [ ] 3.11 Verify the layer: `pnpm --filter api lint`, `typecheck`, focused unit tests, the API integration suite with the isolation tests, `pnpm format:check`, `git diff --check`.
- [ ] 3.12 Self-review the parent-relative diff before the PR is marked ready. Fix accepted findings with new commits.
- [ ] 3.13 Pass the GitHub review and CI gate under Ready-PR monitoring.

## 4. spill

- [ ] 4.1 Add the `spill` field and `head` spill at the runner and the MCP cap sites (design D3, D6). Verify "An MCP result keeps its head", "A spilled MCP result names its artifact", "A long JSON result is read by lines", and "A small result creates no artifact".
- [ ] 4.2 Handle failed and oversized writes, and Runs that cannot read artifacts. Verify "A failed write keeps the inline result", "An MCP result above the bound is not stored", and "A grep-only Run gets no artifact" with an MCP result.
- [ ] 4.3 Update `docs/product/reference/tools/mcp-tools.md` and `model-output.md`, and add a dated `CHANGELOG.md` entry. Verify `pnpm lint:markdown`.
- [ ] 4.4 Verify the layer: affected `lint`, `typecheck`, `test:coverage` for `packages/runtime-safety`, focused `apps/api` runner and MCP tests, `pnpm format:check`, `git diff --check`.
- [ ] 4.5 Self-review the parent-relative diff before the PR is marked ready. Fix accepted findings with new commits.
- [ ] 4.6 Pass the GitHub review and CI gate under Ready-PR monitoring.

## 5. bash-spill

- [ ] 5.1 Raise the host and `ssh://` stream bound to `tools.artifacts.maxBytes` in bytes, with the `ssh://` multiplier at 1 (design D4). Verify "A host stream larger than the old bound is kept" and "Oversized output is bounded".
- [ ] 5.2 Spill inside the native fence before `native.result`, for success, `command_failed`, and `timed_out`. Verify "A large bash output is stored", "A build that fails keeps its log tail inline", "A timeout with large output is stored", "A retried bash call reuses its artifact", "A bash artifact has one part for each stream", and "Only stdout spills".
- [ ] 5.3 Render the head, the omitted-range line, the tail, and the artifact notice. Verify "A long log keeps its tail", "A result only the cap shortened carries no bound marker", "A bound cut and a cap cut carry both lines", and "A notice without a host file".
- [ ] 5.4 Update `docs/product/reference/tools/bash.md` and the `bash` prompt text, and add a dated `CHANGELOG.md` entry. Verify `pnpm lint:markdown`.
- [ ] 5.5 Verify the layer: affected `lint`, `typecheck`, `test:coverage` for `packages/bash-executor`, focused `apps/api` bash and ssh tests, `pnpm format:check`, `git diff --check`.
- [ ] 5.6 Self-review the parent-relative diff before the PR is marked ready. Fix accepted findings with new commits.
- [ ] 5.7 Pass the GitHub review and CI gate under Ready-PR monitoring.

## 6. materialize

- [ ] 6.1 Write host files after the commit when `bash` is allowlisted and the Run has a native executor (design D10). Verify "A bash artifact becomes files" and "Without bash no file is written".
- [ ] 6.2 Reconcile at attempt start and before each `bash` call by size and time. Verify "A reboot loses the files", "A changed file is repaired before bash", and "Reconcile touches only its own Chat" with a temporary `TMPDIR`.
- [ ] 6.3 Sweep directories not seen for 7 days at worker start and attempt start. Verify "An idle Chat directory is removed" with a fake clock.
- [ ] 6.4 Name the host directory in notices, or the host-only text for a Machine Workspace and `ssh://`. Verify "The host path is shown with bash", "A Machine Workspace is told where the files are", and "A notice with a host file".
- [ ] 6.5 Update `docs/product/operator/native-files.md` (host files, `TMPDIR`, no isolation, sweep) and the artifacts reference, and add a dated `CHANGELOG.md` entry. Verify `pnpm lint:markdown`.
- [ ] 6.6 Verify the layer: affected `lint`, `typecheck`, focused tests, `pnpm format:check`, `git diff --check`.
- [ ] 6.7 Self-review the parent-relative diff before the PR is marked ready. Fix accepted findings with new commits.
- [ ] 6.8 Pass the GitHub review and CI gate under Ready-PR monitoring with `Closes #915`.

## 7. grep-walk

- [ ] 7.1 Drive engine pages and `fs.grep` pages internally until the scopes end, a bound, or the deadline, with a Machine page under one protocol message (design D7). Keep the engine cursor and page stop for the daemon. Verify "A full inline part does not stop the walk", "Budgets span Machines", and "A dropped Machine passage never names the cursor".
- [ ] 7.2 Remove the model-facing `cursor`. Verify "A cursor is refused", "A stopped walk returns no cursor", "A bound before the first match leaves an empty result", "File bound stops the walk", "Deadline returns a partial result", and the changed deadline, operator-bound, and byte-bound scenarios.
- [ ] 7.3 Apply progress within the call. Verify "A file larger than the call is named", "A stop after progress names no file", "A refused unfinished file is not named", "A daemon time budget skips one file", "A byte bound in the first file skips it", and "A resumed page does not repeat earlier exclusions".
- [ ] 7.4 Verify the unchanged skip and stream rules: "Binary file is skipped and counted", "A line longer than 4 MiB skips its file", "A late invalid byte drops the file", "Oversized file is skipped and counted", "A large log is searched", and "A late skip drops the passages".
- [ ] 7.5 Measure, with a throwaway script, a broad walk of this repository and of `/mnt/d/Projects`: time, result size, and the stop. Put the numbers in the PR body. Do not commit the script.
- [ ] 7.6 Verify the layer: `pnpm --filter @workspace/native-file-tools test` and `test:coverage`, `pnpm --filter machine test`, `pnpm --filter @workspace/machine-protocol test`, focused `apps/api` grep tests, affected `lint` and `typecheck`, `pnpm format:check`, `git diff --check`.
- [ ] 7.7 Self-review the parent-relative diff before the PR is marked ready. Fix accepted findings with new commits.
- [ ] 7.8 Pass the GitHub review and CI gate under Ready-PR monitoring.

## 8. grep-artifact

- [ ] 8.1 Render the artifact text with findings while the walk runs, and stop at the artifact bound. Verify "The artifact bound stops the walk", "A broad search stops at the bound", "Twenty-first passage is marked", "A later file that ends first keeps its place in the artifact", "Each expansion of a bare scope takes its own ordinal", and "A grep artifact is Markdown".
- [ ] 8.2 Render the inline head, the remainder line, the cut marker, and the notice. Verify "The budget ends the inline part early", "A cut first passage continues in the artifact", "A cut passage longer than a page loses no line", "The next files are named with their ranges", "The remainder line names two files", "A cut passage does not claim a capped file", "A cut twentieth passage carries both markers", "No match", and "Inline lines keep their numbers in the artifact".
- [ ] 8.3 Reserve inline room for the report and notice lines. Verify the scenarios of "The excluded-directory report is filtered and bounded" and "Excluded directories render after the warnings".
- [ ] 8.4 Verify the `grep` findings with the real producer: "A new reject withholds a grep finding" and "A file keeps a later withheld finding".
- [ ] 8.5 Update `docs/product/reference/tools/grep.md`, `apps/api/src/prompts/tools/grep.md`, and `docs/development/harness-comparison/grep.md`, and add a dated `CHANGELOG.md` entry. Verify `pnpm lint:markdown`.
- [ ] 8.6 Verify the layer: as task 7.6.
- [ ] 8.7 Self-review the parent-relative diff before the PR is marked ready. Fix accepted findings with new commits.
- [ ] 8.8 Pass the GitHub review and CI gate under Ready-PR monitoring with `Closes #1519`.

## 9. web-search-offload

- [ ] 9.1 Add `webSearch.fetchLimit` to the loader, the published schema, and the example. Verify both scenarios of "Operator configuration sets the web search fetch size" and the changed `webSearch` declaration scenarios.
- [ ] 9.2 Send the fetch size to each vendor and cut the aggregate to it (design D9). Verify "The engine clamps a large limit", "A small limit passes unchanged", "Flat groups keep the limit", and the aggregate and removal scenarios.
- [ ] 9.3 Write the `web_search` artifact with findings, and store the inline output with the locator. Verify "Twenty results with a limit of ten", "Reading the artifact sends no request", "Default limit", "Oversized output drops trailing entries", "A maximal answer keeps a citation", the three attached-answer scenarios, "Reload reproduces the output", and "A web result is withheld after a reject" with the real producer.
- [ ] 9.4 Update `docs/product/operator/web-search.md` (fetch size and cost), `docs/product/reference/tools/web-search.md`, and the `web_search` prompt text, and add a dated `CHANGELOG.md` entry. Verify `pnpm lint:markdown`.
- [ ] 9.5 Verify the layer: affected `lint`, `typecheck`, focused web-search and instance-config tests, `pnpm format:check`, `git diff --check`.
- [ ] 9.6 Self-review the parent-relative diff before the PR is marked ready. Fix accepted findings with new commits.
- [ ] 9.7 Pass the GitHub review and CI gate under Ready-PR monitoring with `Closes #1526`.

## 10. finalize

- [ ] 10.1 Enter `tool-result-artifacts/finalize` with `$gh-stack` before any canonical spec write. Then run `$openspec-sync-specs`. Verify the ADDED requirements appear word for word, each MODIFIED requirement matches its delta with every canonical scenario kept, and each REMOVED requirement is gone.
- [ ] 10.2 Rewrite the `grep-tool` Purpose in `openspec/specs/grep-tool/spec.md`: results are bounded inline and stored whole as an artifact, with no keyset cursor.
- [ ] 10.3 Confirm archive readiness: `openspec status --change tool-result-artifacts --json` reports every artifact done and every task above is checked. Run `pnpm exec openspec validate --specs --strict`, `pnpm exec openspec validate --all --strict`, `pnpm lint:markdown`, `pnpm format:check`, and `git diff --check`.

## Workflow follow-up

- Archive with `$openspec-archive-change` after 10.3. Then self-review the
  finalize diff, mark it ready, and run Ready-PR monitoring. These SR and GR
  steps are post-archive gates.
- Merge the stack only through `$gh-stack` with Leo's explicit permission.
