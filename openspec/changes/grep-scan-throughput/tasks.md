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
  <- grep-scan-throughput/engine
  <- grep-scan-throughput/bounds
  <- grep-scan-throughput/ignore
  <- grep-scan-throughput/finalize
```

| Layer                           | Parent     | Ownership                                                                                          | Authored estimate | Closes |
| ------------------------------- | ---------- | -------------------------------------------------------------------------------------------------- | ----------------- | ------ |
| `grep-scan-throughput/proposal` | `master`   | The approved proposal, design, deltas, and this task list.                                         | ~1,100            | none   |
| `grep-scan-throughput/engine`   | `proposal` | Ordered read-ahead, streamed files, the 64 MiB line bound, the unfinished-file rule, thread pool.  | ~1,700            | none   |
| `grep-scan-throughput/bounds`   | `engine`   | Opt-in `tools.grep` bounds, the deadline from the call timeout, and the `fs.grep` budget.          | ~900              | none   |
| `grep-scan-throughput/ignore`   | `bounds`   | `.ignore`, ignore files above the scope, rule-by-rule matching, and the excluded-directory report. | ~1,500            | #1397  |
| `grep-scan-throughput/finalize` | `ignore`   | Spec sync, task records, and archive movement only.                                                | ~300              | none   |

Each implementation layer that ships behavior owns its reference and operator
docs, its prompt text, and a dated `CHANGELOG.md` entry. The `ignore` layer
references #1392 and does not close it; the other #1392 items stay open.

## 0. proposal

- [ ] 0.1 Run adversarial review with two independent reviewers per round. Verify each finding against the shipped specs, the engine in `packages/native-file-tools/src/grep/`, `apps/api/src/tools/grep*.ts`, `apps/machine/src/grep.ts`, and the runner. Commit each round separately.
- [ ] 0.2 Prove the final revision: `pnpm exec openspec validate grep-scan-throughput --strict`, `pnpm lint:markdown`, `pnpm format:check`, `git diff --check`, and a whitespace-normalized diff of each MODIFIED block against canonical that keeps every canonical scenario in order. Record Leo's approval of that revision.
- [ ] 0.3 Self-review the proposal diff before the PR is marked ready. Record the review rounds in the PR body.
- [ ] 0.4 Pass the GitHub review and CI gate under Ready-PR monitoring.

## 1. engine

- [ ] 1.1 Add the streamed read to the walk port (design D3) for the host, skill, and Machine-local ports and the Knowledge walk adapter. Verify port tests for a file larger than 1 MiB, a refused link, a FIFO, and a Knowledge symbolic link at a component.
- [ ] 1.2 Replace whole-file decode and split with the incremental scan (design D3): stream UTF-8 decode, the line rules with a CRLF across a chunk boundary, the 64 MiB line bound, cut-line retention, and incremental windows, merges, and partitions. Verify the "Matching is per logical line with a one-line window" scenarios unchanged, plus "A line longer than 64 MiB skips its file", "A late invalid byte drops the file", "A large log is searched", and "A late skip drops the passages".
- [ ] 1.3 Add the ordered read-ahead window of 8 with abort on stop (design D2). Verify with a delayed fake port: at most 8 reads in flight, 8 reached, "A later file that ends first keeps its place", "A stop discards files opened ahead", and "Read-ahead does not exceed the file bound" (with a test budget, before `tools.grep` exists).
- [ ] 1.4 Add the unfinished-file rule and the `unfinishedFile` result field, with the `read` filter on the API side (design D5). Verify "A file larger than one call is skipped" and "A stop after progress resumes at the file" with a fake clock.
- [ ] 1.5 Add `unfinishedFile` to the `fs.grep` response and the daemon (design D8), and the `[not searched to the end: …]` line to the renderer. Verify "An unfinished file is named" and a Machine test where the `read` group refuses the unfinished path.
- [ ] 1.6 Set `UV_THREADPOOL_SIZE` to 16 when unset at the API, worker, and daemon entrypoints before any asynchronous file system call (design D2). Verify a test that a preset value is kept.
- [ ] 1.7 Run the throwaway timing script for both workloads in design Measurements, and record the before/after numbers in the PR body. Do not commit the script.
- [ ] 1.8 Update `docs/product/reference/tools/grep.md` (streamed files, line bound, unfinished file), `apps/api/src/prompts/tools/grep.md`, and add the dated `CHANGELOG.md` entry. Verify `pnpm lint:markdown`.
- [ ] 1.9 Verify the layer: `pnpm --filter @workspace/native-file-tools test`, `pnpm --filter @workspace/machine-protocol test`, `pnpm --filter machine test`, focused `apps/api` grep tests, affected `lint` and `typecheck`, `pnpm format:check`, `git diff --check`.
- [ ] 1.10 Self-review the parent-relative diff before the PR is marked ready. Fix accepted findings with new commits.
- [ ] 1.11 Pass the GitHub review and CI gate under Ready-PR monitoring.

## 2. bounds

- [ ] 2.1 Add `tools.grep` to the instance configuration (design D1): type, built-in default, loader through the nullable numeric path, published JSON Schema, and `llame.config.jsonc.example`. Verify every scenario of "Operator configuration can bound grep walks".
- [ ] 2.2 Remove `filesExamined`, `entriesListed`, `bytesRead`, `fileBytes`, and `deadlineMs` from `GREP_LIMITS`, make the budget fields nullable, and apply them from `tools.grep` (design D1). Verify "A default walk has no count bound", "A configured byte bound stops the walk", and the "Walks are bounded" scenarios "File bound stops the walk", "A bound before the first match returns a cursor", and "Oversized file is skipped and counted".
- [ ] 2.3 Derive the call deadline from `ToolContext.timeoutMs` (design D4). Verify "The default timeout leaves a margin", "A longer timeout gives a longer walk", "A short timeout keeps half of it for the walk", and "Deadline returns a partial page" with a fake clock.
- [ ] 2.4 Change the `fs.grep` budget to nullable bounds plus `fileBytes` in the protocol, the daemon, and the API Machine segment (design D8). Verify "Budgets span Machines" and "An unset bound travels as null".
- [ ] 2.5 Run the throwaway timing script again and record in the PR body that a no-match search over this repository returns `complete: true` in one call. Do not commit the script.
- [ ] 2.6 Update `docs/product/reference/tools/grep.md` (Bounds), `docs/product/operator/native-files.md` (`tools.grep`), `apps/api/src/prompts/tools/grep.md`, and add the dated `CHANGELOG.md` entry with the removed defaults marked **Breaking**. Verify `pnpm lint:markdown`.
- [ ] 2.7 Verify the layer: `pnpm --filter @workspace/native-file-tools test`, `pnpm --filter @workspace/machine-protocol test`, `pnpm --filter machine test`, focused `apps/api` grep and `instance-config` tests, affected `lint` and `typecheck`, `pnpm format:check`, `git diff --check`.
- [ ] 2.8 Self-review the parent-relative diff before the PR is marked ready. Fix accepted findings with new commits.
- [ ] 2.9 Pass the GitHub review and CI gate under Ready-PR monitoring.

## 3. ignore

- [ ] 3.1 Replace layer voiding with rule-by-rule matching (design D6). Verify "A re-included directory keeps the other rules", "An explicit scope searches an ignored directory", "A glob does not override an ignore rule", and the "Walk order and links are defined per scheme" scenarios unchanged.
- [ ] 3.2 Read `.ignore` beside `.gitignore` and collect ignore files above the prefix: to `/` on the host and to the registered root on a Machine, with the `.git` boundary for `.gitignore` (design D6). Verify "A rule at the repository root applies to a narrower scope", "An ignore file outside a repository applies", and "A gitignore above the repository does not apply" on the host and on a Machine.
- [ ] 3.3 Measure per-rule matching cost on this repository and on `/mnt/d/Projects` before the layer ships, and record it in the PR body.
- [ ] 3.4 Record excluded directories with the 1,000-path cap, carry them in the `fs.grep` response, filter them through the `read` group, and render the `[ignored …]` line (design D7, D8). Verify "The model learns which directory to scope", "A refused directory is not named", "Nested excluded directories are not repeated", and "Excluded directories render after the warnings".
- [ ] 3.5 Update `docs/product/reference/tools/grep.md` (ignore files, the report, the D6 ceiling), `docs/product/operator/native-files.md` (ignore rules), `apps/api/src/prompts/tools/grep.md`, and add the dated `CHANGELOG.md` entry. Verify `pnpm lint:markdown`.
- [ ] 3.6 Verify the layer: `pnpm --filter @workspace/native-file-tools test`, `pnpm --filter @workspace/machine-protocol test`, `pnpm --filter machine test`, focused `apps/api` grep tests, affected `lint` and `typecheck`, `pnpm format:check`, `git diff --check`.
- [ ] 3.7 Self-review the parent-relative diff before the PR is marked ready. Fix accepted findings with new commits.
- [ ] 3.8 Pass the GitHub review and CI gate under Ready-PR monitoring with `Closes #1397` in the PR body and a reference to #1392.

## 4. finalize

- [ ] 4.1 Enter `grep-scan-throughput/finalize` with `$gh-stack` before any canonical spec write. Then run `$openspec-sync-specs`. Verify the ADDED requirements appear word for word, and each MODIFIED requirement matches its delta with every canonical scenario kept.
- [ ] 4.2 Confirm archive readiness: `openspec status --change grep-scan-throughput --json` reports every artifact done and every task above is checked. Run `pnpm exec openspec validate --specs --strict`, `pnpm exec openspec validate --all --strict`, `pnpm lint:markdown`, `pnpm format:check`, and `git diff --check`.

## Workflow follow-up

- Archive with `$openspec-archive-change` after 4.2. Then self-review the
  finalize diff, mark it ready, and run Ready-PR monitoring. These SR and GR
  steps are post-archive gates.
- Merge the stack only through `$gh-stack` with Leo's explicit permission.
