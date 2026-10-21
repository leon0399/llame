Track [#1381](https://github.com/leon0399/llame/issues/1381) and its PR layers
through [Project tracking](../../../CONTRIBUTING.md#project-tracking). Carry
forward the recorded proposal approval and recheck native blockers before you
start. Keep live status in the Project.

## Delivery stack

Use `$gh-stack` for every branch operation and `$openspec-apply-change` for
each implementation layer, after proposal approval only.

```text
master
  <- add-grep-tool/proposal
  <- add-grep-tool/engine
  <- add-grep-tool/host
  <- add-grep-tool/machine
  <- add-grep-tool/finalize
```

| Layer                    | Parent     | Ownership                                                                                    | Authored estimate | Closes |
| ------------------------ | ---------- | -------------------------------------------------------------------------------------------- | ----------------- | ------ |
| `add-grep-tool/proposal` | `master`   | The approved proposal, design, deltas, and this task list.                                   | ~700              | none   |
| `add-grep-tool/engine`   | `proposal` | Shared engine, tool contract, registry entry, admission, `kb://` and `skill://` ports, docs. | ~1,500            | none   |
| `add-grep-tool/host`     | `engine`   | Host port, Workspace default scope, glob walker with ignore rules, executor gate.            | ~1,100            | none   |
| `add-grep-tool/machine`  | `host`     | `fs.grep` protocol method, daemon handler, Machine port, operator docs, changelog.           | ~900              | #1381  |
| `add-grep-tool/finalize` | `machine`  | Spec sync, task records, and archive movement only.                                          | ~250              | none   |

## 0. proposal

- [ ] 0.1 Run adversarial review with two independent reviewers per round. Verify each finding against the shipped specs, `native-files.ts`, `locator-projection.ts`, `value-selection.ts`, and `knowledge-filesystem-search.ts`. Commit each round separately.
- [ ] 0.2 Prove the final revision: `pnpm exec openspec validate add-grep-tool --strict`, `pnpm lint:markdown`, `pnpm format:check`, `git diff --check`, and a whitespace-normalized diff of each MODIFIED block against canonical that keeps every canonical scenario in order. Record Leo's approval of that revision.
- [ ] 0.3 Self-review the proposal diff before the PR is marked ready. Record the review rounds in the PR body.
- [ ] 0.4 Pass the GitHub review and CI gate under Ready-PR monitoring.

## 1. engine

- [ ] 1.1 Move `re2js` to `packages/native-file-tools` and add `ignore` (design D2, D4). Verify `pnpm --filter @workspace/native-file-tools typecheck` and `pnpm --filter api typecheck`.
- [ ] 1.2 Implement `packages/native-file-tools/src/grep/`: pattern compile, logical-line scan, one-line window, merge, 2,000-line partition, 512-unit line cut, page bounds, warnings, and the cursor codec (design D1, D6, D9). Verify unit tests for the scenarios of "The grep tool accepts one strict input object", "Matching is per logical line with a one-line window", and "Results are ordered, bounded, and paged by a keyset cursor".
- [ ] 1.3 Implement the glob matcher and the literal-prefix split (design D3). Verify unit tests for the scope grammar scenarios. Cover the refusal of `{`, `[`, a glob in a Space identifier, and a read selector on a scope.
- [ ] 1.4 Register the `grep` tool in `apps/api/src/tools/registry.ts` with the strict input schema, `read_only` classification, and packaged `prompts/tools/grep.md` in `TOOL_PROMPT_IDS` (design D8). Verify `tools.allowed: ["grep"]` boots, `tools.promptFiles.grep` is a valid key, and the renamed `tools.find` scenarios of `instance-config` and `tool-prompt-templates` pass.
- [ ] 1.5 Implement admission (design D5): per-scope `grep` evaluation on the literal prefix, per-file `read` evaluation with derived decision records, absent-group rejection, and bypass records. Verify tests for "Each scope is admitted against the grep group on its literal prefix" and "Every hit is a locator that the read group admits". Cover the negative scenario where a `read` reject hides `.env` beneath an admitted scope and the cross-owner Space scenario.
- [ ] 1.6 Implement the Knowledge and skill ports and the `kb://` and `skill://` scope backends. Bare `kb://` covers every current Space of the owner. Bare `skill://` covers the catalog. Verify tests for the Knowledge symbolic-link refusal, `knowledge_space_not_configured`, and a hit that `read` resolves to the same lines.
- [ ] 1.7 Admit `grep` in the candidate resolver for a Knowledge root or a skill source (design D8). Verify the "Knowledge root alone admits grep" and "No backend leaves grep unavailable" scenarios, with host and Machine backends still absent in this layer.
- [ ] 1.8 Record the `re2js` spike: time one call over 32 MiB of Markdown in a test fixture and write the number into design D2 risks.
- [ ] 1.9 Add `docs/product/reference/grep.md` and the `read` description line. Verify `pnpm lint:markdown`.
- [ ] 1.10 Verify the layer: `pnpm --filter @workspace/native-file-tools test`, focused `apps/api` tests from 1.4 to 1.7, `pnpm --filter api lint`, `pnpm --filter api typecheck`, `pnpm format:check`, `git diff --check`.
- [ ] 1.11 Self-review the parent-relative diff before the PR is marked ready. Fix accepted findings with new commits.
- [ ] 1.12 Pass the GitHub review and CI gate under Ready-PR monitoring.

## 2. host

- [ ] 2.1 Implement the host port over the bound native executor (design D1, D4): the `.git` prune, the `ignore` stack, the hidden-entry rule, the link rule, and the NUL, UTF-8, and 1 MiB skips. Verify tests for "Walks are bounded and never follow links". Cover the gitignored directory, the explicit gitignored file, the binary skip count, and the 5,000-file bound.
- [ ] 2.2 Implement the Workspace default scope and relative scope projection through the Workspace path projection rule. Verify the "Omitted scopes inside a Workspace" and "Omitted scopes without a Workspace" scenarios, and that the error names no Space identifier, Machine name, or host path.
- [ ] 2.3 Gate host scopes on accepted native host authority and admit `grep` in the candidate resolver for that authority. Verify "Host scope without an executor" and the `tool-calling` scenario "Grep is admitted by any serving backend".
- [ ] 2.4 Verify the 30-second deadline returns a partial result with `complete: false` and a `deadline` entry in `warnings`, with a fake clock.
- [ ] 2.5 Update `docs/product/operator/native-files.md` with the grep permission group and the per-file `read` rule. Verify `pnpm lint:markdown`.
- [ ] 2.6 Verify the layer: `pnpm --filter @workspace/native-file-tools test`, focused `apps/api` tests, `pnpm --filter api lint`, `pnpm --filter api typecheck`, `pnpm format:check`, `git diff --check`.
- [ ] 2.7 Self-review the parent-relative diff before the PR is marked ready. Fix accepted findings with new commits.
- [ ] 2.8 Pass the GitHub review and CI gate under Ready-PR monitoring.

## 3. machine

- [ ] 3.1 Add `fs.grep` to `packages/machine-protocol` with its request and response types (design D7). Verify the protocol tests and `pnpm --filter @workspace/machine-protocol typecheck`.
- [ ] 3.2 Implement the daemon handler in `apps/machine` over the shared engine with a host port. Apply every bound locally and report paths relative to the display prefix. Verify daemon tests for a glob scope, an ignore rule, and a page cursor.
- [ ] 3.3 Implement the Machine port and `machine://` scope backend in `apps/api`. Render locators through `formatMachineLocator`, evaluate the `read` group per file on the Machine locator, and map method-not-found. Verify "Machine search runs on the Machine", "Unknown Machine fails the call", and a negative test that no host path appears in any result field.
- [ ] 3.4 Admit `grep` in the candidate resolver for a configured Machine. Verify the advertisement scenario with a Machine as the only backend.
- [ ] 3.5 Add the dated `CHANGELOG.md` entry and the Machine section of the operator docs. Verify `pnpm lint:markdown`.
- [ ] 3.6 Verify the layer: `pnpm --filter @workspace/machine-protocol test`, `pnpm --filter machine test`, focused `apps/api` tests, affected `lint` and `typecheck`, `pnpm format:check`, `git diff --check`.
- [ ] 3.7 Self-review the parent-relative diff before the PR is marked ready. Fix accepted findings with new commits.
- [ ] 3.8 Pass the GitHub review and CI gate under Ready-PR monitoring with `Closes #1381` in the PR body.

## 4. finalize

- [ ] 4.1 Enter `add-grep-tool/finalize` with `$gh-stack` before any canonical spec write, then run `$openspec-sync-specs`. Verify the `grep-tool` capability appears word for word and each MODIFIED requirement matches its delta with every canonical scenario kept.
- [ ] 4.2 Confirm archive readiness: `openspec status --change add-grep-tool --json` reports every artifact done and every task above is checked. Run `pnpm exec openspec validate --specs --strict`, `pnpm exec openspec validate --all --strict`, `pnpm lint:markdown`, `pnpm format:check`, and `git diff --check`.

## Workflow follow-up

- Archive with `$openspec-archive-change` after 4.2. Then self-review the
  finalize diff, mark it ready, and run Ready-PR monitoring. These SR and GR
  steps are post-archive gates.
- Merge the stack only through `$gh-stack` with Leo's explicit permission.
