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
  <- tool-result-artifacts/store-authority
  <- tool-result-artifacts/spill
  <- tool-result-artifacts/bash-spill
  <- tool-result-artifacts/materialize
  <- tool-result-artifacts/grep-paging
  <- tool-result-artifacts/grep-cursorless
  <- tool-result-artifacts/grep-artifact
  <- tool-result-artifacts/web-search-offload
  <- tool-result-artifacts/finalize
```

| Layer                | Parent               | Ownership                                                                                                                                   | Authored estimate | Closes |
| -------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | ------ |
| `proposal`           | `master`             | Proposal, design, deltas, and this task list.                                                                                               | ~3,200            | none   |
| `web-search-text`    | `proposal`           | The `web_search` text shape for the model.                                                                                                  | ~900              | #1525  |
| `store`              | `web-search-text`    | Tables, counter, RLS, writer, the `artifact://` reader and lists, fork copy, prompt-import opt-out, `tools.artifacts.maxBytes`.             | ~1,600            | none   |
| `store-authority`    | `store`              | Finding re-check and its permission exception, projection tests, the `artifact` field through the run loop, settle, and replay.             | ~1,300            | none   |
| `spill`              | `store-authority`    | The spill field, `head` spill in the runner and MCP, JSON parts, line pieces, the cap notice, oversized results.                            | ~1,300            | none   |
| `bash-spill`         | `spill`              | The `bash` byte bound, spill inside the native fence for every outcome and every host, stream parts, head and tail, notices, failed writes. | ~1,600            | none   |
| `materialize`        | `bash-spill`         | Host files, reconcile, sweep, the host directory in notices.                                                                                | ~1,000            | #915   |
| `grep-paging`        | `materialize`        | Internal paging on host and Machine with the cursor field still present, progress and the skipped Machine file.                             | ~1,300            | none   |
| `grep-cursorless`    | `grep-paging`        | Removal of the model-facing `cursor`, the stop rules without it, and the test rewrite.                                                      | ~1,500            | none   |
| `grep-artifact`      | `grep-cursorless`    | The `grep` artifact with findings, the inline head, the remainder and left-out lines, the cut marker, the notice.                           | ~1,700            | #1519  |
| `web-search-offload` | `grep-artifact`      | `webSearch.fetchLimit`, vendor counts, the aggregate cut, the `web_search` artifact with findings.                                          | ~1,300            | #1526  |
| `finalize`           | `web-search-offload` | Spec sync, the `grep-tool` Purpose, task records, and archive movement only.                                                                | ~1,300            | none   |

**Named budget exception: the proposal layer is about 3,200 authored lines.**
The change modifies nine capabilities and adds one. The `grep-tool` delta
removes four requirements and modifies nine, because the cursor is part of
their text. The `web-search` delta modifies twelve, because each one counts
by `limit`. Splitting the proposal would approve the artifact contract
without its first consumers. Every implementation layer stays inside about
2,000 lines.

## 1. proposal

- [x] 1.1 Validate the change: `pnpm exec openspec validate tool-result-artifacts --strict`, `pnpm exec markdownlint-cli2 "openspec/changes/tool-result-artifacts/**/*.md"`, `node scripts/check-markdown-links.mjs`, `pnpm format:check`, `git diff --check`.
  - Evidence: `pnpm exec openspec validate tool-result-artifacts --strict` passes; markdownlint, link check, `pnpm format:check`, and `git diff --check` are clean on 46d0a9f1.
- [x] 1.2 Run two review rounds with at least two independent reviewers each, verify every finding against code or primary sources, and commit each round separately.
  - Evidence: local rounds 1 and 2 (spec consistency and feasibility reviewers; fixes in 5b0381be and be6984e0) and GitHub review round 1 (29 threads; fixes in 46d0a9f1). design.md "Revision history" records each round.
- [x] 1.3 Obtain Leo's approval of the published revision, including each deviation in proposal.md.
  - Evidence: Leo, in chat on 2026-11-02: "Assume spec is approved and further smaller review deviations are acceptible." This approves the published revision 46d0a9f1 and its listed deviations, and accepts smaller deviations found in later review.

## 2. web-search-text

- [x] 2.1 Render `web_search` results and answers as text through the shared rendering function. Verify "Three results render in rank order", "An aggregate answer follows the results", "A snippet cannot start a result", "A title with a line break stays on one line", "A query with a line break stays on one line", and "A web search renders as text".
  - Evidence: `renderWebSearchText` (`apps/api/src/tools/web-search/text.ts`) is registered in `TEXT_RESULT_RENDERERS` (`apps/api/src/tools/model-text.ts:72`). `apps/api/src/tools/web-search/text.test.ts` covers the five scenarios plus the answer output, the note lines, the empty-title and trailing-line-break rules, the date-only host line, Unicode line separators in titles, snippets, and URLs, the cap notice, and both JSON fallbacks (15 tests); `apps/api/src/tools/model-text.test.ts` adds "renders a web search success as its text shape with a text output", "renders a web search failure as the JSON failure text", and "ends a capped web search with the notice, inside the cap". `pnpm exec vitest run --project unit src/tools/web-search src/tools/model-text.test.ts` passes (458 tests, 22 files).
- [x] 2.2 Keep the stored part and the web chat renderer unchanged in this layer. Verify "Reload reproduces the output" and an unchanged web UI story.
  - Evidence: the stored part is still the executor's result object (`toolPartBody` at `apps/api/src/runs/assistant-transcript.ts:396`), which `packages/ui/src/components/custom/web-search.stories.tsx` and its renderer read; a new test in `apps/api/src/runs/assistant-transcript.test.ts` ("stores a web search success as its normalized output, not its text") pins it. Both files under `packages/ui` are absent from the diff.
- [x] 2.3 Measure tokens for 10 representative results in JSON and in text, and put the numbers in the PR body.
  - Evidence: a throwaway script (not committed) rendered 10 representative normalized outputs (29 result entries, one aggregate answer, notes on three) through `renderWebSearchText` and counted `gpt-tokenizer` 4.1.0 `o200k_base` tokens: JSON 2,315 tokens (9,422 UTF-16 units) against text 2,216 tokens (8,236 units), 99 tokens saved (4.3%); per output 5-40 tokens, and the answer output 151 against 110 tokens. The text shape is a structure change, not a token saving: the `>` prefix and its space cost back most of the quoting the JSON shape pays for. The numbers go in the PR body.
- [x] 2.4 Update `apps/api/src/prompts/tools/web_search.md` and `docs/product/reference/tools/web-search.md`, and add a dated `CHANGELOG.md` entry. Verify `pnpm lint:markdown`.
  - Evidence: the prompt's `<output>` block describes the text lines; the reference doc gains a "Model-facing text" section with a sample, the block grammar, and the untrusted-text rule; `CHANGELOG.md` has a 2026-11-02 entry. `pnpm lint:markdown` reports 0 issues.
- [x] 2.5 Verify the layer: affected `lint`, `typecheck`, focused `apps/api` web-search and model-text tests, `pnpm format:check`, `git diff --check`.
  - Evidence: `pnpm --filter api lint` and `pnpm --filter api typecheck` pass after `pnpm --filter "api^..." build`; focused runs of `src/tools/web-search`, `src/tools/model-text.test.ts`, `src/runs/assistant-transcript.test.ts`, `src/chats/tool-observation-part.test.ts`, and `src/chats/continue-projection.test.ts` pass (592 tests); `pnpm format:check` over the whole repository and `git diff --check` are clean.
- [ ] 2.6 Self-review the parent-relative diff before the PR is marked ready. Fix accepted findings with new commits.
- [ ] 2.7 Pass the GitHub review and CI gate under Ready-PR monitoring with `Closes #1525`.

## 3. store

- [x] 3.1 Add `tool_artifacts`, `tool_artifact_parts`, and `chats.artifact_seq` with forced RLS and cascade (design D1). Generate the migration with Drizzle and run `pnpm db:provision-rls`. Verify "Another owner cannot read it", "A query without identity reads nothing", and "A deleted Chat leaves no artifact row" in integration tests.
  - Evidence: `20261102174231_large_paper_doll.sql` (FORCE re-appended per AGENTS P1) and `apps/api/src/db/schema/tool-artifacts.ts`; `artifact-store.integration.test.ts` covers ENABLED+FORCED, no identity, another owner, a foreign insert, and the cascade; `tool-artifacts.test.ts` pins the keys, cascades, policies, and counter.
- [x] 3.2 Add the writer: the number in its own transaction, the parts in one transaction, the `(chat_id, run_id, tool_call_id)` key, and the per-part bound. Verify "Numbers increase across tools" and "Concurrent calls get different numbers" with a test producer.
  - Evidence: `tools/artifacts/artifact-writer.ts`; `artifact-store.integration.test.ts` "numbers across tools from one Chat counter", "gives concurrent calls different numbers", "stores the parts, digest, and findings in one transaction", "refuses a part above the byte bound and writes no artifact", "treats a reused tool call id as a failed write".
- [x] 3.3 Register the `artifact` reader with line selectors, `:raw`, `:outline`, 8,000-unit line pieces, the Chat list, and the stream list (design D2). Refuse the scheme in `edit` and `write`. With a test producer, verify:
  - "A range of an artifact is read", "An artifact is read without a native executor", "An unknown part is not found", and "An artifact cannot be edited";
  - "The Chat list names each artifact", "An artifact of a replaced reply stays listed", and "A bash artifact lists its streams";
  - "Another Chat of the same owner cannot read it".
  - Evidence: `tools/artifacts/artifact-reader.ts` registered in `LOCATOR_READERS`; `artifact-store.integration.test.ts` covers the range, the executor-free read, an unknown part, edit/write refusal, the Chat list, a replaced reply, the stream list, another Chat of the owner, long-line pieces, outline/raw, and malformed locators; `artifact-reader.test.ts` "scopes the read to the context Chat" pins the app-layer Chat boundary without a database.
- [x] 3.4 Copy the cited artifacts and the counter in `copyOwnedChat` with `INSERT … SELECT` (design D11). Verify the five scenarios of "A fork copies the artifacts that its copied parts name".
  - Evidence: `apps/api/src/chats/fork-artifacts.ts` and the `artifactSeq` inherited value; `fork-artifacts.integration.test.ts` covers the copied locator and counter, the deleted source, the after-prefix artifact, the shared fork, and another Chat's artifact.
- [x] 3.5 Skip `artifact://` in prompt imports. Verify "An artifact marker stays prose" and the changed "A marker for each read scheme gets an outcome".
  - Evidence: `prompt-imports.ts` skips the scheme; `prompt-imports.test.ts` "keeps an artifact marker as prose and records nothing", plus the artifact-filtered marker loop and the added scheme in the accepted list.
- [x] 3.6 Add `tools.artifacts.maxBytes` to the loader, the published schema, and `apps/api/llame.config.jsonc.example`. Verify both scenarios of "Operator configuration bounds tool-result artifacts".
  - Evidence: `llame-config.ts`, `config-loader.ts` (floor 131,072), `llame.config.schema.json` (`artifactMaxBytesOrToken`), and the example; `config-loader.test.ts` covers the default, the file/token value, the below-floor refusal, a fraction, and an unknown field.
- [x] 3.7 Add `docs/product/reference/locators/artifact.md`, the `read` reference and prompt text for the scheme, and the `^artifact://` allow in `docs/product/operator/native-files.md` (design D13). Add a dated `CHANGELOG.md` entry. Verify `pnpm lint:markdown`.
  - Evidence: the new reference, the `read` reference/prompt additions, the locator and tools indexes, the operator section and field-allow example, and the 2026-11-02 changelog entry; `pnpm lint:markdown` reports 0 issues.
- [x] 3.8 Verify the layer: `pnpm --filter api lint`, `typecheck`, focused unit tests, the API integration suite with the isolation tests, `pnpm format:check`, `git diff --check`.
  - Evidence: `lint` and `typecheck` clean; the focused unit suites (662 tests) and `artifact-store`, `fork-artifacts`, and `fork-chat` integration suites pass; `pnpm format:check` and `git diff --check` clean.
- [ ] 3.9 Self-review the parent-relative diff before the PR is marked ready. Fix accepted findings with new commits.
- [ ] 3.10 Pass the GitHub review and CI gate under Ready-PR monitoring.

## 4. store-authority

- [x] 4.1 Apply the finding re-check and its permission exception (design D5). With a test producer that writes findings, verify:
  - "A new reject withholds a grep finding", "A withheld file leaves the outline", and "A bash part has no finding to check";
  - "A web result is withheld after a reject", "A web result without an allow stays visible", and "A bypassed Run sees every finding";
  - "Finding decisions are not recorded".
  - Evidence: `tools/artifacts/findings.ts` (parse/validate the stored document, withhold the served findings before selection, `[withheld]` lines keep their numbers, malformed fails closed, bypass parses and evaluates nothing) wired into `artifact-reader.ts`; the served window includes the readers' one-line context growth and the 2,000-line read bound, and host-path findings are judged without the Workspace root. `findings.test.ts` covers both rules, context lines before and after the window, the comma branch, bypass and the verdict cache (policy-read counter), no policy, multi-citation answers, Markdown sections/raw, malformed and undefined records, and last lines without a terminator; `artifact-findings.integration.test.ts` (Testcontainers) covers each named scenario with a real producer and live policy, including a bash part under a whole-tool reject, the outline, and `onDerivedDecision` never firing.
- [x] 4.2 Add projection tests for `artifact://`. Verify both scenarios of "Artifact locators match as their logical text".
  - Evidence: `locator-projection.test.ts` "artifact locator permission projection" (selector-free logical text, no host-path substitution, a `^artifact://bash-` reject, a `^artifact://` allow) and `artifact-findings.integration.test.ts` "reaches only the Chat of an allowed artifact locator" (the allow admits the call and another Chat still returns `not_found`).
- [x] 4.3 Carry the `artifact` field in both `ToolResult` variants through `runTool`, `tool.completed`, `toolActivityPart`, `StoredToolPart`, `priorOutcome`, continue projection, and the chat DTO (design D6). Emit `Artifact:` in replay (design D8). Verify the three scenarios of "A replayed pair keeps its artifact locator", "A checkpoint does not carry the artifact", and "An old artifact still reads".
  - Evidence: the error variant gains `artifact` (`packages/runtime-safety/src/types.ts`), `truncateOversizedResult` pins it like a media locator so `runTool` cannot shorten it (`result-truncation.test.ts`, 112 package tests), `toolActivityPart`/`ToolActivityPart` copy and validate it and `toolResultFromPayload` keeps it (`assistant-transcript.test.ts`), `StoredToolPart` validates it and the packaged framing renders `Artifact:` in both the full and cleared pair (`tool-observation-part.test.ts`: line position, survives clearing, absent, invalid, dropped pair), `priorOutcome` keeps it (`native-files-repository.test.ts`), the Continue state keeps it (`continue-projection.test.ts`), and the history DTO passes it through (`chats.dto.test.ts`). The checkpoint request carries the locator line but no artifact field or content (`compaction.test.ts`), and an artifact still reads after a checkpoint row exists (`artifact-findings.integration.test.ts`).
- [x] 4.4 Update the artifacts reference with the re-check, and add a dated `CHANGELOG.md` entry. Verify `pnpm lint:markdown`.
  - Evidence: `docs/product/reference/locators/artifact.md` "Finding re-check"; the 2026-11-02 `CHANGELOG.md` entry; `pnpm lint:markdown` reports 0 issues.
- [x] 4.5 Verify the layer: as task 3.8.
  - Evidence: `pnpm --filter @workspace/runtime-safety lint`/`test` (113), `pnpm --filter api lint`, `pnpm exec tsc --noEmit`, the focused unit suites (458 tests across 12 files), `artifact-findings.integration.test.ts` (8 tests), `pnpm lint:markdown`, `oxfmt --check`, and `git diff --check` all pass. The local mutation gate was deferred to CI at the orchestrator's request (host load).
- [ ] 4.6 Self-review the parent-relative diff before the PR is marked ready. Fix accepted findings with new commits.
- [ ] 4.7 Pass the GitHub review and CI gate under Ready-PR monitoring.

## 5. spill

- [x] 5.1 Add the `spill` field and `head` spill at the runner and the MCP cap sites (design D3, D6). Verify "An MCP result keeps its head", "A spilled MCP result names its artifact", and "A long JSON result is read by lines".
  - Evidence: `Tool.spill` (`head` default) in `tools/types.ts`; the runner and the MCP `executeMcpDispatch` call `capToolResult`/`capHeadResult` (`tools/artifacts/spill.ts`), which stores the full rendering through `writeToolArtifact` and returns `truncateOversizedResult` with the artifact clause (`packages/runtime-safety/src/result-truncation.ts`). A Run that cannot read artifacts keeps today's bounded result and no `[full result not stored]` (head spill only; `grep-artifact` counts its files instead). The MCP artifact commits in its own transaction before `native.result`, so a lost append leaves a listed artifact whose reply carries no locator; accepted, because the artifact is complete and the reply is `outcome_unknown`. "An MCP result keeps its head" and "A spilled MCP result names its artifact": `mcp-runtime.service.test.ts` ("persists the truncated result observed by the Run loop", "spills an oversized MCP result and names its artifact") and `tools/artifacts/spill.test.ts`; runner wiring in `runner.test.ts` ("stores an oversized head result and names the artifact", "does not cap a tool-shaped spill result"). "A long JSON result is read by lines": `tools/artifacts/head-spill.integration.test.ts` (Testcontainers) reads `artifact://mcp__docs__fetch-1:1-200`, asserts the numbered head includes the long value and a continuation line.
- [x] 5.2 Handle results above the bound. Verify "An MCP result above the bound is not stored".
  - Evidence: `tools/artifacts/spill.test.ts` ("does not store a rendering above the byte bound", "keeps the inline result when the write fails") and `mcp-runtime.service.test.ts` ("does not store an MCP result above the artifact bound"): no artifact row, no `artifact` field, notice carries `[full result not stored]`.
- [x] 5.3 Update `docs/product/reference/tools/mcp-tools.md` and `model-output.md`, and add a dated `CHANGELOG.md` entry. Verify `pnpm lint:markdown`.
  - Evidence: `mcp-tools.md` Result (head spill, `read("artifact://...:<line>-")`, above-bound marker), `model-output.md` "Oversized results" (`head` vs `tool`, pretty JSON, the notices), and the 2026-11-02 CHANGELOG bullet; `pnpm lint:markdown` passes (0 issues).
- [x] 5.4 Verify the layer: affected `lint`, `typecheck`, `test:coverage` for `packages/runtime-safety`, focused `apps/api` runner and MCP tests, `pnpm format:check`, `git diff --check`.
  - Evidence: `pnpm --filter @workspace/runtime-safety lint` and `test:coverage` (124 tests, CRAP gate), `pnpm --filter api lint`, `pnpm --filter api typecheck`, the focused unit suites (`spill.test.ts`, `runner.test.ts`, `mcp-runtime.service.test.ts` — 159 tests), the integration file above, `pnpm format:check`, `pnpm lint:markdown`, and `git diff --check` all pass.
- [ ] 5.5 Self-review the parent-relative diff before the PR is marked ready. Fix accepted findings with new commits.
- [ ] 5.6 Pass the GitHub review and CI gate under Ready-PR monitoring.

## 6. bash-spill

- [x] 6.1 Add the byte bound to `packages/bash-executor` for the hub context only, with the `ssh://` multiplier at 1 (design D4). Verify "A host stream within the default bound is kept" and "Oversized output is bounded".
  - Evidence: `packages/bash-executor/src/output-bound.test.ts` covers the byte/unit measure and the surrogate-safe byte cut; `packages/bash-executor/src/execute.test.ts` "keeps a 3 MB stream whole under the default byte bound" (8,388,608) and "keeps no byte after an exceeded bound reaches the result"; `apps/api/src/tools/bash.test.ts` "bounds a host stream in bytes from tools.artifacts.maxBytes"; `apps/api/src/tools/ssh-bash-execution.test.ts` expects the byte count without the ×3 multiplier.
- [x] 6.2 Spill inside the native fence before `native.result` on host, `ssh://`, and Machine paths, for success, `command_failed`, and `timed_out`. Verify:
  - "A large bash output is stored", "A build that fails keeps its log tail inline", and "A timeout with large output is stored";
  - "A settled open bash call keeps its artifact" and "A Machine command that fails keeps its tail";
  - "A bash artifact has one part for each stream", "Only stdout spills", and "A one-line JSON stdout is read in pieces".
  - Evidence: `apps/api/src/tools/bash-spill.test.ts` "keeps a failing command's tail in its message and stores the whole stream", "keeps a timed-out command's head and tail and stores its stream", "gives each overflowing stream its own part", "spills only the stream that does not fit", "keeps a failed Machine command's tail and stores the whole stderr" (through `bashTool` and the protocol peer); `apps/api/src/tools/bash-spill.integration.test.ts` stores a 3 MB output and reads it back, and reads a one-line JSON stdout in pieces; `apps/api/src/runs/native-files-repository.test.ts` "keeps the artifact locator of a settled error result"/"...success result" covers the settle replay. Host and `ssh://` spill runs between the executor and the `native.result` append in `runAdmittedBash` and `fencedRemoteCommand`; the Machine spill runs in the fenced `perform`.
- [x] 6.3 Render the head, the omitted-range line, the tail, and the notice. Verify "A long log keeps its tail", "A result only the cap shortened carries no bound marker", "A bound cut and a cap cut carry both lines", and "A bash notice without a host file".
  - Evidence: `apps/api/src/tools/bash-spill.test.ts` "keeps the first 40 lines, names lines 41 to 4880, and keeps the last 120", "carries no bound marker when only the inline preview shortened a stream", "carries both markers when the executor bound also cut the stream", "ends the text with the notice and no host path".
- [x] 6.4 Handle failed writes and Runs that cannot read artifacts. Verify "A failed write keeps the inline result" and "A failed write keeps the bash tail inline".
  - Evidence: `apps/api/src/tools/bash-spill.test.ts` "keeps the inline result when the artifact write fails", "keeps the head, an un-stored omitted line, and the tail when the write fails", "stores nothing when the Run cannot read artifacts", "stores nothing when the read group refuses an artifact locator".
- [x] 6.5 Update `docs/product/reference/tools/bash.md` and the `bash` prompt text, and add a dated `CHANGELOG.md` entry. Verify `pnpm lint:markdown`.
  - Evidence: `docs/product/reference/tools/bash.md` (Result and Bounds), `apps/api/src/prompts/tools/bash.md` (output bullet and the bounded-instruction line), `CHANGELOG.md` (2026-11-02 entry); markdownlint passes on each touched file.
- [x] 6.6 Verify the layer: affected `lint`, `typecheck`, `test:coverage` for `packages/bash-executor`, focused `apps/api` bash, ssh, and Machine call tests, `pnpm --filter machine test`, `pnpm format:check`, `git diff --check`.
  - Evidence: `packages/bash-executor` `tsc -p tsconfig.build.json` and `apps/api` `tsc --noEmit`: clean; `packages/bash-executor` `vitest run --coverage`: 78 tests passed, statements 94.85%, branches 88.68%, lines 96.46% (gates 88/90); focused unit files `src/tools/bash.test.ts` (29), `src/tools/ssh-bash.test.ts` (15), `src/tools/ssh-bash-execution.test.ts`, `src/tools/bash-spill.test.ts`, `src/tools/runner.test.ts`, and `src/tools/machine-call.test.ts` all pass (241 in one run); `src/tools/bash-spill.integration.test.ts` (2, Testcontainers) passes; `apps/machine` `vitest run`: 11 files, 173 tests passed; `oxlint` clean for both packages (the pre-commit hook lints the whole repo); `oxfmt --check`, `git diff --check`, and markdownlint on the touched docs: clean.
- [ ] 6.7 Self-review the parent-relative diff before the PR is marked ready. Fix accepted findings with new commits.
- [ ] 6.8 Pass the GitHub review and CI gate under Ready-PR monitoring.

## 7. materialize

- [x] 7.1 Write host files after the commit when `bash` is allowlisted and the Run has a native executor (design D10). Verify "A bash artifact becomes files" and "Without bash no file is written".
  - Evidence: `tools/artifacts/host-files.ts` adds `writeArtifactHostFiles` (`<toolName>-<n>.<md|json|txt>`, `bash-<n>/<stream>.<ext>`, temp name + rename, mtime = `created_at`, every path confined under the Chat directory) and `writeToolArtifact` calls it after the commit only when `hostFiles` is set (`artifact-writer.ts`); `bash-spill.ts` and `artifacts/spill.ts` pass `context.artifactHostFiles`, which `run-execution.service.ts` derives through `hostFilesEnabled` (`bash` in `tools.allowed` plus a `nativeExecutorId`). `$TMPDIR/llame` and `llame/chats` are created `0700` and `lstat`-checked before every use: a symlink, another owner, or any group/other bit refuses writes, reconcile, and sweep with one warning. The shared predicate lives in `tools/artifacts/readable.ts` (`canReadArtifacts`: the `read`-group branch, or host files when `bash` is allowlisted, the Workspace is not a Machine root, and the `bash` group admits); bash's and the head spill's reader gates import it. `host-files.test.ts` "writes a bash artifact as one file for each stream", "writes a single-part artifact with its content extension", "gives a JSON part the .json extension", "writes nothing when the host root is a symbolic link", "writes nothing when the host root is not private", and "refuses a path that leaves the Chat directory" pass in a temporary `TMPDIR`; "writes no file without the host-files capability" covers the no-`bash` case; `readable.test.ts` (8 tests) covers both branches, a Machine Workspace, a rejected and a command-allow `bash` group, and `bypass`; `spill.test.ts` "writes a host file and names its directory for a bash-capable Run" covers the head spill.
- [x] 7.2 Reconcile at attempt start and before each `bash` call by size and time. Verify "A reboot loses the files", "A changed file is repaired before bash", and "Reconcile touches only its own Chat" with a temporary `TMPDIR`.
  - Evidence: `host-files.ts` `reconcileArtifactFiles` reads the Chat's part metadata without bytes (`ArtifactsRepository.listChatPartFiles`), stats every file in parallel by size and mtime, then fetches and writes one stale part at a time with a content-only query (`findPartContent`, one short `runAs` per part); a part that cannot be read or written does not stop the others, and the Chat directory is always touched. `bashTool` reconciles on the host route only, after the executor gate, and `RunExecutionService.restoreArtifactFiles` reconciles at attempt start (after the claim, before the first model request); both warn instead of failing. `host-files.test.ts` "writes every file again when the host lost them", "fetches no content for a file that matches", "repairs a file whose size matches but whose time changed", "repairs a file whose size changed at the stored time", "touches only the Chat it reconciles", "marks the Chat directory as seen", "repairs the other parts when one cannot be read", and "reads no part when the host root is not private" pass with a temporary `TMPDIR`; `bash.test.ts` "restores a Chat artifact file before the command starts" runs a real command that reads the repaired file, and "runs the command when the artifact files cannot be reconciled" covers the failure path; `run-execution.service.test.ts` "restores the Chat artifact files and sweeps stale directories before the first request", "keeps no host file when bash is not allowlisted", "keeps no host file without a native executor", "sweeps stale directories but reads no part for a Chat without artifacts", and "continues the Run when the artifact files cannot be reconciled" cover the attempt-start seam.
- [x] 7.3 Sweep directories not seen for 7 days at worker start and attempt start. Verify "An idle Chat directory is removed" with a fake clock.
  - Evidence: `sweepArtifactDirectories(now = new Date())` removes only UUID-named Chat directories under `$TMPDIR/llame/chats` whose mtime is older than `SWEEP_AFTER_MS` (7 days); `RunsWorkerService.onApplicationBootstrap` calls it only when `hostFilesEnabled` holds, and `restoreArtifactFiles` calls it at most once an hour per worker (`ARTIFACT_SWEEP_INTERVAL_MS`), the smallest of the offered choices. `host-files.test.ts` passes a fixed `NOW`: "removes a Chat directory no attempt reconciled for seven days", "keeps a directory seen exactly seven days ago and removes a millisecond more", "leaves an entry that is not a Chat directory", "removes nothing when the host root is a symbolic link"; `runs-worker.service.test.ts` "removes a Chat artifact directory no attempt reconciled for seven days" and "sweeps nothing when the worker keeps no host files" prove the worker-start call and its gate; `run-execution.service.test.ts` "restores the Chat artifact files and sweeps stale directories before the first request" proves the attempt-start call.
- [x] 7.4 Name the host directory in notices, or the host-only text for a Machine Workspace and `ssh://`. Verify "The host path is shown with bash", "A Machine Workspace is told where the files are", and "A notice with a host file".
  - Evidence: the shared `artifactNotice` (`packages/runtime-safety`) appends `; host files in <directory>`, `; host files on the llame host only` when a call away from the host has `read` as its route, or `; host files in <directory> on the llame host` when only a host `bash` can reach it; bash passes `true` for a Machine call and every `ssh://` command, the head spill passes the Machine Workspace binding, and `bash.ts` drops the unreachable host-bash-in-a-Machine-Workspace expression (the projection sends every cwd there to the Machine). `bash-spill.test.ts` "names the absolute directory of the spilled stream", "names both parts and the directory when both streams spill", "says the files are on the llame host only away from this host", "names the host directory away from this host when only a host bash reads it", the Machine test "tells a Machine Workspace that the files are on the llame host only", the `ssh://` test's host-only assertion, and "keeps no host path when the Run writes no file" pass; `artifact-notice.test.ts` covers the three phrases and a line break in the directory.
- [x] 7.5 Update `docs/product/operator/native-files.md` (host files, `TMPDIR`, no isolation, sweep) and the artifacts reference, and add a dated `CHANGELOG.md` entry. Verify `pnpm lint:markdown`.
  - Evidence: `docs/product/operator/native-files.md` "Host files" (paths and extensions, `$TMPDIR`, the `0700` root and its refusal, reconcile, the shared OS user with no owner isolation, the gated seven-day sweep, the `read` and host-`bash` routes); the artifact reference "Host files" section; the 2026-11-02 `CHANGELOG.md` entry; `pnpm lint:markdown` reports 0 issues.
- [x] 7.6 Verify the layer: affected `lint`, `typecheck`, focused tests, `pnpm format:check`, `git diff --check`.
  - Evidence: `pnpm --filter api lint` clean (whole package); `pnpm exec tsc --noEmit` in `apps/api` clean; focused unit files pass: `tools/artifacts/host-files.test.ts` (19), `tools/artifacts/readable.test.ts` (8), `tools/artifacts/spill.test.ts` (10), `tools/artifacts/artifact-writer.test.ts`, `tools/bash-spill.test.ts` (35), `tools/bash.test.ts` (32), `runs/runs-worker.service.test.ts` (17), `runs/run-execution.service.test.ts` (349), `packages/runtime-safety` artifact-notice (10); `pnpm format:check` clean; `git diff --check` clean. No integration or mutation run was made.
- [ ] 7.7 Self-review the parent-relative diff before the PR is marked ready. Fix accepted findings with new commits.
- [ ] 7.8 Pass the GitHub review and CI gate under Ready-PR monitoring with `Closes #915`.

## 8. grep-paging

- [ ] 8.1 Run each host scope as one engine call with no file limit and a page budget of the artifact bytes left, and loop `fs.grep` pages of 15,000 units on the daemon position (design D7). Keep the model-facing `cursor` in this layer. Verify "Budgets span Machines" and "A dropped Machine passage never names the cursor".
- [ ] 8.2 Apply progress within the call and report a skipped Machine file. Verify "A file larger than the call is named", "A stop after progress names no file", "A refused unfinished file is not named", "A daemon time budget skips one file", "A byte bound in the first file skips it", and "A resumed page does not repeat earlier exclusions".
- [ ] 8.3 Verify the layer: `pnpm --filter @workspace/native-file-tools test` and `test:coverage`, `pnpm --filter machine test`, `pnpm --filter @workspace/machine-protocol test`, focused `apps/api` grep tests, affected `lint` and `typecheck`, `pnpm format:check`, `git diff --check`.
- [ ] 8.4 Self-review the parent-relative diff before the PR is marked ready. Fix accepted findings with new commits.
- [ ] 8.5 Pass the GitHub review and CI gate under Ready-PR monitoring.

## 9. grep-cursorless

- [ ] 9.1 Remove the model-facing `cursor` from the input, the result, the API, and their tests. Verify:
  - "A cursor is refused", "A stopped walk returns no cursor", and "A bound before the first match leaves an empty result";
  - "File bound stops the walk", "Deadline returns a partial result", "A stop discards files opened ahead", and "Files before an entry bound are still searched";
  - the changed deadline, operator-bound, and byte-bound scenarios;
  - the scenarios of the changed `tool-call-permissions` "Grep scopes are admitted per scope and files per hit".
- [ ] 9.2 Verify the unchanged skip and stream rules: "Binary file is skipped and counted", "A line longer than 4 MiB skips its file", "A late invalid byte drops the file", "Oversized file is skipped and counted", "A large log is searched", and "A late skip drops the passages".
- [ ] 9.3 Update `apps/api/src/prompts/tools/grep.md` and `docs/product/reference/tools/grep.md` so the model no longer pages with a cursor, and add a dated `CHANGELOG.md` entry. Verify `pnpm lint:markdown`.
- [ ] 9.4 Measure, with a throwaway script, a broad walk of this repository and of `/mnt/d/Projects`: time, result size, and the stop. Put the numbers in the PR body. Do not commit the script.
- [ ] 9.5 Verify the layer: as task 8.3.
- [ ] 9.6 Self-review the parent-relative diff before the PR is marked ready. Fix accepted findings with new commits.
- [ ] 9.7 Pass the GitHub review and CI gate under Ready-PR monitoring.

## 10. grep-artifact

- [ ] 10.1 Render the artifact text with findings while the walk runs, and stop at the artifact bound. Verify:
  - "The artifact bound stops the walk", "A broad search stops at the bound", "A full inline part does not stop the walk", and "Twenty-first passage is marked";
  - "A later file that ends first keeps its place in the artifact", "Each expansion of a bare scope takes its own ordinal", and "A grep artifact is Markdown".
- [ ] 10.2 Render the inline head, the remainder line, the left-out line, the cut marker, and the notice. Verify:
  - "The budget ends the inline part early", "A cut first passage continues in the artifact", "A cut passage longer than a page loses no line", and "No match";
  - "The next files are named with their ranges", "The remainder line names two files", "A cut passage does not claim a capped file", and "A cut twentieth passage carries both markers";
  - "Inline lines keep their numbers in the artifact", "A notice without a host file", "A small result creates no artifact", "A grep-only Run gets no artifact", and "A grep result without a reader counts its files".
- [ ] 10.3 Reserve inline room for the report and notice lines. Verify the scenarios of "The excluded-directory report is filtered and bounded" and "Excluded directories render after the warnings".
- [ ] 10.4 Verify the `grep` findings with the real producer: "A new reject withholds a grep finding" and "A file keeps a later withheld finding".
- [ ] 10.5 Update `docs/product/reference/tools/grep.md`, `apps/api/src/prompts/tools/grep.md`, and `docs/development/harness-comparison/grep.md`, and add a dated `CHANGELOG.md` entry. Verify `pnpm lint:markdown`.
- [ ] 10.6 Verify the layer: as task 8.3.
- [ ] 10.7 Self-review the parent-relative diff before the PR is marked ready. Fix accepted findings with new commits.
- [ ] 10.8 Pass the GitHub review and CI gate under Ready-PR monitoring with `Closes #1519`.

## 11. web-search-offload

- [ ] 11.1 Add `webSearch.fetchLimit` to the loader, the published schema, and the example. Verify both scenarios of "Operator configuration sets the web search fetch size" and the changed `webSearch` declaration scenarios.
- [ ] 11.2 Send the fetch size to each vendor and cut the aggregate to it (design D9). Verify "The engine clamps a large limit", "A small limit passes unchanged", "Flat groups keep the limit", and the aggregate and removal scenarios.
- [ ] 11.3 Write the `web_search` artifact with findings for results and answers, and store the inline output with the locator. Verify:
  - "Twenty results with a limit of ten", "A read of the artifact sends no request", "Default limit", and "A web notice continues after the inline results";
  - "Oversized output drops trailing entries", "A maximal answer keeps a citation", and the three attached-answer scenarios;
  - "Reload reproduces the output" and "A web result is withheld after a reject" with the real producer.
- [ ] 11.4 Update `docs/product/operator/web-search.md` (fetch size and cost), `docs/product/reference/tools/web-search.md`, and the `web_search` prompt text, and add a dated `CHANGELOG.md` entry. Verify `pnpm lint:markdown`.
- [ ] 11.5 Verify the layer: affected `lint`, `typecheck`, focused web-search and instance-config tests, `pnpm format:check`, `git diff --check`.
- [ ] 11.6 Self-review the parent-relative diff before the PR is marked ready. Fix accepted findings with new commits.
- [ ] 11.7 Pass the GitHub review and CI gate under Ready-PR monitoring with `Closes #1526`.

## 12. finalize

- [ ] 12.1 Enter `tool-result-artifacts/finalize` with `$gh-stack` before any canonical spec write. Then run `$openspec-sync-specs`. Verify the ADDED requirements appear word for word, each MODIFIED requirement matches its delta with every canonical scenario kept, and each REMOVED requirement is gone.
- [ ] 12.2 Rewrite the `grep-tool` Purpose in `openspec/specs/grep-tool/spec.md`: results are bounded inline and stored whole as an artifact, with no keyset cursor.
- [ ] 12.3 Confirm archive readiness: `openspec status --change tool-result-artifacts --json` reports every artifact done and every task above is checked. Run `pnpm exec openspec validate --specs --strict`, `pnpm exec openspec validate --all --strict`, `pnpm lint:markdown`, `pnpm format:check`, and `git diff --check`.

## Workflow follow-up

- Archive with `$openspec-archive-change` after 12.3. Then self-review the
  finalize diff, mark it ready, and run Ready-PR monitoring. These SR and GR
  steps are post-archive gates.
- Merge the stack only through `$gh-stack` with Leo's explicit permission.
