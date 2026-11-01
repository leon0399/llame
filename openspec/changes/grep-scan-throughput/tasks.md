Track [#1397](https://github.com/leon0399/llame/issues/1397), the ignore-layer
item of [#1392](https://github.com/leon0399/llame/issues/1392), and their PR
layers through [Project tracking](../../../CONTRIBUTING.md#project-tracking).
Carry forward the recorded proposal approval and recheck native blockers
before you start. Keep live status in the Project.

## Delivery stack

Use `$gh-stack` for every branch operation and `$openspec-apply-change` for
each implementation layer, after proposal approval only.

```text
master
  <- grep-scan-throughput/proposal
  <- grep-scan-throughput/stream
  <- grep-scan-throughput/readahead
  <- grep-scan-throughput/bounds
  <- grep-scan-throughput/ignore
  <- grep-scan-throughput/finalize
```

| Layer                            | Parent      | Ownership                                                                                          | Authored estimate | Closes |
| -------------------------------- | ----------- | -------------------------------------------------------------------------------------------------- | ----------------- | ------ |
| `grep-scan-throughput/proposal`  | `master`    | The approved proposal, design, deltas, and this task list.                                         | ~1,800            | none   |
| `grep-scan-throughput/stream`    | `proposal`  | The streamed port read, the incremental scan, the 4 MiB line bound, and a nullable engine budget.  | ~1,500            | none   |
| `grep-scan-throughput/readahead` | `stream`    | The ordered read-ahead window, the unfinished-file rule, call-wide progress, and the thread pool.  | ~1,400            | none   |
| `grep-scan-throughput/bounds`    | `readahead` | Opt-in `tools.grep` bounds, the deadline from the call timeout, and the `fs.grep` request rename.  | ~1,000            | none   |
| `grep-scan-throughput/ignore`    | `bounds`    | `.ignore`, ignore files above the scope, rule-by-rule matching, and the excluded-directory report. | ~1,600            | #1397  |
| `grep-scan-throughput/finalize`  | `ignore`    | Spec sync, task records, and archive movement only.                                                | ~350              | none   |

The proposal layer is about 1,800 authored lines, inside the 2,000-line
review budget. Each implementation layer that ships behavior owns its
reference and operator docs, its prompt text, and a dated `CHANGELOG.md`
entry. The `ignore` layer references #1392 and does not close it; the
other items of #1392 stay open.

## 0. proposal

- [ ] 0.1 Run adversarial review with two independent reviewers per round. Verify each finding against the shipped specs, the engine in `packages/native-file-tools/src/grep/`, `apps/api/src/tools/grep*.ts`, `apps/machine/src/grep*.ts`, and the runner. Commit each round separately.
- [ ] 0.2 Prove the final revision: `pnpm exec openspec validate grep-scan-throughput --strict`, `pnpm lint:markdown`, `pnpm format:check`, `git diff --check`, and a whitespace-normalized diff of each MODIFIED block against canonical that keeps every canonical scenario in order. Record Leo's approval of that revision, including the listed deviations.
- [ ] 0.3 Self-review the proposal diff before the PR is marked ready. Record the review rounds in the PR body.
- [ ] 0.4 Pass the GitHub review and CI gate under Ready-PR monitoring.

## 1. stream

- [ ] 1.1 Add the streamed read to the walk port (design D3) for the host, skill, and Machine ports and the Knowledge walk adapter. The iterator can end with a late refusal; the Machine port uses it for its containment re-check. Verify port tests for a file larger than 1 MiB, a refused link, a FIFO, a Knowledge symbolic link at a component, and a Machine directory swapped for a link during the read.
- [ ] 1.2 Make the engine budget's file, entry, byte, and file-size fields nullable and remove the `fileBytes` constant (design D1). The API keeps passing today's file, entry, and byte numbers and passes `null` for the file size. Verify the existing bound tests pass, except the fixed 1 MiB skip, which moves to a test budget, and that a 2 MiB file is searched.
- [ ] 1.3 Replace whole-file decode and split with the incremental scan (design D3): stream UTF-8 decode with `ignoreBOM`, LF split with CR strip, the 4 MiB byte line bound, joined line pieces, held content counted from the first showable line with the incomplete-passage mark, and incremental windows, merges, and partitions. Verify the "Matching is per logical line with a one-line window" scenarios unchanged, plus "A line longer than 4 MiB skips its file", "A late invalid byte drops the file", "A large log is searched", "A late skip drops the passages", "A cut passage longer than a page loses no line", and "A file that grows past the file-size bound is skipped" with a test budget.
- [ ] 1.4 Update `docs/product/reference/tools/grep.md` (streamed files, the line bound), `apps/api/src/prompts/tools/grep.md`, and add the dated `CHANGELOG.md` entry. Verify `pnpm lint:markdown`.
- [ ] 1.5 Verify the layer: `pnpm --filter @workspace/native-file-tools test`, `pnpm --filter machine test`, focused `apps/api` grep and Knowledge adapter tests, affected `lint` and `typecheck`, `pnpm format:check`, `git diff --check`.
- [ ] 1.6 Self-review the parent-relative diff before the PR is marked ready. Fix accepted findings with new commits.
- [ ] 1.7 Pass the GitHub review and CI gate under Ready-PR monitoring.

## 2. readahead

- [ ] 2.1 Turn the walk into a producer whose events go through one ordered FIFO with the file tasks (design D2): scope starts, coalesced bookkeeping records, and the entry-bound stop, with the producer pause. Run the `read` admission in the producer and count a refusal on take. Catch each task's outcome at creation and surface it only on dequeue. Abort queued tasks on a stop and close their streams. Verify with a delayed fake port and a test budget: "Eight reads are in flight", "A later file that ends first keeps its place", "A stop discards files opened ahead", "Read-ahead does not exceed the file bound", "Files before an entry bound are still searched", "A read refusal counts only for a taken file", and an aborted Knowledge task that raises no unhandled rejection.
- [ ] 2.2 Add the unfinished-file rule with the start point, progress from emitted passages and reached events, call-wide progress through `runGrepScan` and between segments, the single-file scope cursor on the next ordinal, and the deadline check between chunks (design D4, D5). Raise the page reserve for the `[not searched to the end: …]` line when a head task starts. Verify "A file larger than one call is skipped", "An explicit file scope that one call cannot finish is skipped", "An unfinished last file scope ends on the next call", "A cursor on the parent directory is no progress", "A stop after progress resumes at the file", "Progress in an earlier scope counts", and "An emitted passage is progress" with a fake clock.
- [ ] 2.3 Carry `progressed` in the `fs.grep` request and response and `unfinished` in the response, map a daemon single-file `unfinished` to the next ordinal, give the daemon nine tenths of the time left, and render `[not searched to the end: …]` with its framing (design D4, D5, D8). Verify "An unfinished Machine file scope is skipped", "A refused unfinished file is not named", "An unfinished file is named", "A grep report locator stays on its line", a multi-page daemon call whose first page progressed, and a Machine test where a daemon that uses its whole time still delivers its page.
- [ ] 2.4 Set `UV_THREADPOOL_SIZE` to 16 when unset inside `setUpSentry` after `.env.local` loads and before `init`, and at the top of `apps/machine/src/instrument.ts` (design D2). Verify a pool-width probe (16 parallel `pbkdf2` jobs) after startup and that a preset value, including one from `.env.local`, is kept.
- [ ] 2.5 Run the throwaway timing script for both workloads in design Measurements, and record the before/after numbers in the PR body. Do not commit the script.
- [ ] 2.6 Update `docs/product/reference/tools/grep.md` (concurrent reads, the unfinished file), `apps/api/src/prompts/tools/grep.md` (the new output line), and add the dated `CHANGELOG.md` entry. Verify `pnpm lint:markdown`.
- [ ] 2.7 Verify the layer: `pnpm --filter @workspace/native-file-tools test`, `pnpm --filter @workspace/machine-protocol test`, `pnpm --filter machine test`, focused `apps/api` grep tests, affected `lint` and `typecheck`, `pnpm format:check`, `git diff --check`.
- [ ] 2.8 Self-review the parent-relative diff before the PR is marked ready. Fix accepted findings with new commits.
- [ ] 2.9 Pass the GitHub review and CI gate under Ready-PR monitoring.

## 3. bounds

- [ ] 3.1 Add `tools.grep` to the instance configuration (design D1): type, built-in default, loader through the nullable numeric path, a `null` object, published JSON Schema, and `llame.config.jsonc.example`. Verify every scenario of "Operator configuration can bound grep walks".
- [ ] 3.2 Remove `filesExamined`, `entriesListed`, `bytesRead`, and `deadlineMs` from `GREP_LIMITS` and apply the bounds from `tools.grep`, with the byte-bound counting of design D1. Grow the warnings reserve to seven digits. Verify "A default walk has no count bound", "A configured file bound stops the walk early", "A configured byte bound stops the walk", "A byte bound in the first file skips it", the "Walks are bounded" scenarios "File bound stops the walk", "A bound before the first match returns a cursor", and "Oversized file is skipped and counted", and the "Results are ordered…" scenario "A position cursor names a refused entry".
- [ ] 3.3 Derive the call deadline from `ToolContext.timeoutMs` at `executeGrep` entry, with the `tools.callTimeoutSeconds` fallback (design D4). Verify "The default timeout leaves a margin", "A longer timeout gives a longer walk", "A short timeout keeps half of it for the walk", "A call without a timeout in its context uses the configured timeout", "A deadline with no match stays incomplete", and "Deadline returns a partial page" with a fake clock.
- [ ] 3.4 Rename the `fs.grep` request field `budget` to `bounds` with nullable bounds and `fileBytes`, in the protocol, the daemon, and the API Machine segment, and map `invalid_params` from `fs.grep` to Machine unusable (design D8). Verify "Budgets span Machines", "An unset bound travels as null", "A daemon that refuses the request is unusable", and that a request without `bounds` is refused as invalid parameters.
- [ ] 3.5 Run the throwaway timing script again and record in the PR body that a no-match search over this repository returns `complete: true` in one call. Do not commit the script.
- [ ] 3.6 Update `docs/product/reference/tools/grep.md` (Bounds), `docs/product/operator/native-files.md` (`tools.grep`), `docs/product/operator/machines.md` (deploy the API and daemons together), `docs/development/harness-comparison/grep.md` (llame's bounds), `apps/api/src/prompts/tools/grep.md`, and add the dated `CHANGELOG.md` entry with the removed defaults and the `fs.grep` rename marked **Breaking**. Verify `pnpm lint:markdown`.
- [ ] 3.7 Verify the layer: `pnpm --filter @workspace/native-file-tools test`, `pnpm --filter @workspace/machine-protocol test`, `pnpm --filter machine test`, focused `apps/api` grep and `instance-config` tests, affected `lint` and `typecheck`, `pnpm format:check`, `git diff --check`.
- [ ] 3.8 Self-review the parent-relative diff before the PR is marked ready. Fix accepted findings with new commits.
- [ ] 3.9 Pass the GitHub review and CI gate under Ready-PR monitoring.

## 4. ignore

- [ ] 4.1 Replace layer voiding with rule-by-rule matching through one-rule negation instances of `ignore`, tested on each entry's own path (design D6). Pin the `ignore` 7.0.12 negation behavior in a unit test. Verify "A re-included directory keeps the other rules", "An explicit scope searches an ignored directory", "A glob does not override an ignore rule", "A nested ignored directory below an explicit scope is excluded", "An allow list keeps its files", "A negated directory keeps the rule for its files", "A rule that matches a file directly still excludes it", and the "Walk order and links are defined per scheme" scenarios unchanged.
- [ ] 4.2 Read `.ignore` beside `.gitignore`, keep both out of the candidates of a directory scope, and collect ignore files above the prefix: to `/` on the host and to the registered root on a Machine, with the repository limit for `.gitignore` (design D6). Verify "A rule at the repository root applies to a narrower scope", "An ignore file outside a repository applies", "An ignore file is not searched", "A gitignore above the repository does not apply", and "A gitignore outside a repository does not apply above the scope" on the host and on a Machine, and "A Machine repository above the registered root".
- [ ] 4.3 Measure per-rule matching cost on this repository and on `/mnt/d/Projects` before the layer ships, and record it in the PR body.
- [ ] 4.4 Queue excluded-directory events, keep 1,000 per call across scopes and Machine responses, evaluate each locator with and without a final separator against the `read` group, reserve the line on the page, and render the `[ignored …]` line (design D7, D8). Verify "The model learns which directory to scope", "Nested excluded directories are not repeated", "A resumed page does not repeat earlier exclusions", "A refused directory is not named", "A reject with a final separator hides the directory", "Only refused exclusions leave no report", "A large exclusion count is a lower bound", the `tool-call-permissions` scenarios "Directory decisions are not recorded" and "A bypassed Run names every excluded directory", and the `tool-result-rendering` scenarios "Excluded directories render after the warnings", "One excluded directory takes the singular", and "A lower-bound count is marked".
- [ ] 4.5 Update `docs/product/reference/tools/grep.md` (ignore files and the report), `docs/product/operator/native-files.md` (ignore rules), `docs/development/harness-comparison/grep.md` (ignore files), `apps/api/src/prompts/tools/grep.md` (ignore rules and the new output line), and add the dated `CHANGELOG.md` entry. Verify `pnpm lint:markdown`.
- [ ] 4.6 Verify the layer: `pnpm --filter @workspace/native-file-tools test`, `pnpm --filter @workspace/machine-protocol test`, `pnpm --filter machine test`, focused `apps/api` grep and permission tests, affected `lint` and `typecheck`, `pnpm format:check`, `git diff --check`.
- [ ] 4.7 Self-review the parent-relative diff before the PR is marked ready. Fix accepted findings with new commits.
- [ ] 4.8 Pass the GitHub review and CI gate under Ready-PR monitoring with `Closes #1397` in the PR body and a reference to #1392.

## 5. finalize

- [ ] 5.1 Enter `grep-scan-throughput/finalize` with `$gh-stack` before any canonical spec write. Then run `$openspec-sync-specs`. Verify the ADDED requirements appear word for word, and each MODIFIED requirement matches its delta with every canonical scenario kept.
- [ ] 5.2 Confirm archive readiness: `openspec status --change grep-scan-throughput --json` reports every artifact done and every task above is checked. Run `pnpm exec openspec validate --specs --strict`, `pnpm exec openspec validate --all --strict`, `pnpm lint:markdown`, `pnpm format:check`, and `git diff --check`.

## Workflow follow-up

- Archive with `$openspec-archive-change` after 5.2. Then self-review the
  finalize diff, mark it ready, and run Ready-PR monitoring. These SR and GR
  steps are post-archive gates.
- Merge the stack only through `$gh-stack` with Leo's explicit permission.
