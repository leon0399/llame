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
  <- add-grep-tool/knowledge
  <- add-grep-tool/host
  <- add-grep-tool/machine
  <- add-grep-tool/finalize
```

| Layer                     | Parent      | Ownership                                                                           | Authored estimate | Closes |
| ------------------------- | ----------- | ----------------------------------------------------------------------------------- | ----------------- | ------ |
| `add-grep-tool/proposal`  | `master`    | The approved proposal, design, deltas, and this task list.                          | ~1,100            | none   |
| `add-grep-tool/engine`    | `proposal`  | Shared engine in `packages/native-file-tools`: matcher, scan, glob, ignore, cursor. | ~1,300            | none   |
| `add-grep-tool/knowledge` | `engine`    | Tool contract, registry, admission, `kb://` and `skill://` ports, resolver, docs.   | ~1,400            | none   |
| `add-grep-tool/host`      | `knowledge` | Host port, Workspace default scope, executor gate, deadline.                        | ~900              | none   |
| `add-grep-tool/machine`   | `host`      | `fs.grep` protocol method, daemon handler, Machine port, operator docs, changelog.  | ~1,000            | #1381  |
| `add-grep-tool/finalize`  | `machine`   | Spec sync, task records, and archive movement only.                                 | ~250              | none   |

## 0. proposal

- [ ] 0.1 Run adversarial review with two independent reviewers per round. Verify each finding against the shipped specs, `native-files.ts`, `locator-projection.ts`, `value-selection.ts`, `evaluator.ts`, `assistant-transcript.ts`, and `knowledge-filesystem-search.ts`. Commit each round separately.
- [ ] 0.2 Prove the final revision: `pnpm exec openspec validate add-grep-tool --strict`, `pnpm lint:markdown`, `pnpm format:check`, `git diff --check`, and a whitespace-normalized diff of each MODIFIED block against canonical that keeps every canonical scenario in order. Record Leo's approval of that revision.
- [ ] 0.3 Self-review the proposal diff before the PR is marked ready. Record the review rounds in the PR body.
- [ ] 0.4 Pass the GitHub review and CI gate under Ready-PR monitoring.

## 1. engine

- [ ] 1.1 Move `re2js` to `packages/native-file-tools` and add `ignore` (design D2, D4). Verify `pnpm --filter @workspace/native-file-tools typecheck` and `pnpm --filter api typecheck`.
- [ ] 1.2 Implement `packages/native-file-tools/src/grep/` (design D1, D6, D9). Parts: pattern compile, logical-line scan, one-line window, merge, 2,000-line partition, 512-unit line cut. More parts: 15,000-unit page budget, page bounds, warnings, and the cursor codec with its input hash. The cursor codec also carries the position kind for a bound stop, the cut end line, and the resolved scope ordinal. Verify unit tests for every scenario of "The grep tool accepts one strict input object", "Matching is per logical line with a one-line window", and "Results are ordered, bounded, and paged by a keyset cursor".
- [ ] 1.3 Implement the walker over the abstract port (design D1, D4). Parts: depth-first byte order, the 5,000-file, 20,000-entry, 32 MiB, and 30 s bounds. More parts: the NUL, UTF-8, and 1 MiB skips, the `.git` prune, the `ignore` stack, and the resume of position and passage cursors without opens. Verify unit tests with an in-memory port for every scenario of "Walks are bounded" and the gitignore, `.git`, hidden, and host-link scenarios of "Walk order and links are defined per scheme".
- [ ] 1.4 Implement the glob matcher, the lexical normalization, and the literal-prefix split (design D3). Verify unit tests for the scope grammar scenarios: `%2A` as a literal, the `..` resolution, the end separator rule, and a colon in a host scope. Also verify the refusal of `{`, `[`, a glob in a Space identifier, and a colon in a skill scope.
- [ ] 1.5 Verify the layer: `pnpm --filter @workspace/native-file-tools test`, `pnpm --filter @workspace/native-file-tools lint`, `pnpm --filter @workspace/native-file-tools typecheck`, `pnpm format:check`, `git diff --check`.
- [ ] 1.6 Self-review the parent-relative diff before the PR is marked ready. Fix accepted findings with new commits.
- [ ] 1.7 Pass the GitHub review and CI gate under Ready-PR monitoring.

## 2. knowledge

- [ ] 2.1 Register the `grep` tool in `apps/api/src/tools/registry.ts` with the strict input schema, `read_only` classification, and packaged `prompts/tools/grep.md` in `TOOL_PROMPT_IDS` (design D8). Rename the unregistered example id to `never_registered` in `instance-config/prompt-loader.test.ts` and `prompts/tool-descriptions.test.ts`. Verify `tools.allowed: ["grep"]` boots, `tools.promptFiles.grep` is a valid key, and the renamed scenarios pass.
- [ ] 2.2 Implement admission (design D5). Parts: per-scope `grep` evaluation with the submitted arguments and the projected prefix, and the Workspace root as the omitted scope. All-fields traversal covers patterns, cursor, every submitted scope, and every prefix. Accept `scopes` in `declared-fields.ts` and `policy-provider.ts`. More parts: the first rejection as the call decision, and per-file `read` evaluation with a refused count in the completion audit only. Then the `not_found` rule for a refused exact file, the walk of a refused directory scope, absent-group rejection, and one bypass decision. Verify tests for every scenario of "Each scope is admitted against the grep group on its literal prefix", "Every hit is a locator that the read group admits", and the `tool-call-permissions` requirement "Grep scopes are admitted per scope and files per hit".
- [ ] 2.3 Implement the Knowledge and skill ports and the `kb://` and `skill://` scope backends. Bare `kb://` covers every current Space of the owner with a per-Space access re-check. Bare `skill://` covers the effective catalog without unselected manual-only entries. Emitted locators encode `*` and `?`. A result with a `kb://` passage carries the closed Knowledge untrusted-content notice. The payload-cleared replay of an incomplete `grep` result carries outcome `incomplete` in `chats/tool-observation-part.ts`. Verify tests for the Knowledge symbolic-link refusal, `knowledge_space_unavailable`, `knowledge_space_not_configured`, and `knowledge_space_not_found` for another owner. Also verify the skill link and link-loop scenarios, the no-source scenario, the bare-scope order and cursor invalidation, and the `a%2A.md` round trip. Also verify the "A Knowledge passage carries the notice" and "Incomplete grep stays incomplete after payload clearing" scenarios.
- [ ] 2.4 Admit `grep` in the candidate resolver for a Knowledge root or an operator skill source (design D8). Verify the "Knowledge root alone admits grep", "No backend leaves grep unavailable", and `knowledge-tools` "Knowledge root makes grep eligible" scenarios, with host and Machine backends still absent in this layer.
- [ ] 2.5 Verify that a grep call appends no `native.attempt` event.
- [ ] 2.6 Record the `re2js` spike: time one call over 32 MiB of Markdown in a test fixture and write the number into design D2 risks.
- [ ] 2.7 Add `docs/product/reference/tools/grep.md` and the `read` description line. Verify `pnpm lint:markdown`.
- [ ] 2.8 Verify the layer: focused `apps/api` tests from 2.1 to 2.5, `pnpm --filter api lint`, `pnpm --filter api typecheck`, `pnpm format:check`, `git diff --check`.
- [ ] 2.9 Self-review the parent-relative diff before the PR is marked ready. Fix accepted findings with new commits.
- [ ] 2.10 Pass the GitHub review and CI gate under Ready-PR monitoring.

## 3. host

- [ ] 3.1 Implement the host port over the bound native executor and the host scope backend. Verify the host scenarios of "Walk order and links are defined per scheme" and the explicit gitignored file scenario through `apps/api` tests on a temporary directory.
- [ ] 3.2 Implement the Workspace default scope, relative scope projection through the Workspace path projection rule, and the Machine Workspace host mapping. Verify "Omitted scopes inside a Workspace", "Omitted scopes without a Workspace", "Host scope inside a Machine Workspace", and "Cursor from another Workspace is refused".
- [ ] 3.3 Gate host scopes on accepted native host authority and admit `grep` in the candidate resolver for that authority. Verify "Host scope without an executor" and the `tool-calling` scenario "Grep is admitted by any serving backend".
- [ ] 3.4 Verify the 30-second deadline returns a partial result with `complete: false`, a `deadline` entry, and a cursor, with a fake clock.
- [ ] 3.5 Update `docs/product/operator/native-files.md` with the `grep` permission group, the per-file `read` rule, and the note that the example config does not include the group. Verify `pnpm lint:markdown`.
- [ ] 3.6 Verify the layer: focused `apps/api` tests, `pnpm --filter api lint`, `pnpm --filter api typecheck`, `pnpm format:check`, `git diff --check`.
- [ ] 3.7 Self-review the parent-relative diff before the PR is marked ready. Fix accepted findings with new commits.
- [ ] 3.8 Pass the GitHub review and CI gate under Ready-PR monitoring.

## 4. machine

- [ ] 4.1 Add `fs.grep` to `packages/machine-protocol` with its request, budget, and response types (design D7). Verify the protocol tests and `pnpm --filter @workspace/machine-protocol typecheck`.
- [ ] 4.2 Implement the daemon handler in `apps/machine` over the shared engine with a host port. Resolve the prefix through the root guard, apply the request budget, and report paths relative to the display prefix. Verify daemon tests for a glob scope, an ignore rule, a page cursor, `path_not_registered`, and a consumed budget.
- [ ] 4.3 Implement the Machine port and `machine://` scope backend in `apps/api`. Render locators through `formatMachineLocator` and evaluate the `read` group per file on the Machine locator. Carry the remaining budget across Machine scopes, cut an oversized page, and abandon at the deadline. Build the cursor from emitted passages, and map method-not-found to Machine unusable. Verify "Machine search runs on the Machine", "Machine prefix outside the roots", "Unknown Machine fails the call", "Budgets span Machines", "A dropped Machine passage never names the cursor", and a negative test that no host path appears in any result field.
- [ ] 4.4 Admit `grep` in the candidate resolver for a configured Machine. Verify the advertisement scenario with a Machine as the only backend.
- [ ] 4.5 Add the dated `CHANGELOG.md` entry and the Machine section of the operator docs. Verify `pnpm lint:markdown`.
- [ ] 4.6 Verify the layer: `pnpm --filter @workspace/machine-protocol test`, `pnpm --filter machine test`, focused `apps/api` tests, affected `lint` and `typecheck`, `pnpm format:check`, `git diff --check`.
- [ ] 4.7 Self-review the parent-relative diff before the PR is marked ready. Fix accepted findings with new commits.
- [ ] 4.8 Pass the GitHub review and CI gate under Ready-PR monitoring with `Closes #1381` in the PR body.

## 5. finalize

- [ ] 5.1 Enter `add-grep-tool/finalize` with `$gh-stack` before any canonical spec write. After the sync, set `spec: grep-tool` in `docs/product/reference/tools/grep.md`, which names `native-file-tools` until the capability is canonical. Confirm `remote-machines` is archived. Rebase the `tool-calling` delta onto the canonical text if `knowledge-submit` archived first, so both edits survive. Then run `$openspec-sync-specs`. Verify the `grep-tool` capability and the `tool-call-permissions` addition appear word for word and each MODIFIED requirement matches its delta with every canonical scenario kept.
- [ ] 5.2 Confirm archive readiness: `openspec status --change add-grep-tool --json` reports every artifact done and every task above is checked. Run `pnpm exec openspec validate --specs --strict`, `pnpm exec openspec validate --all --strict`, `pnpm lint:markdown`, `pnpm format:check`, and `git diff --check`.

## Workflow follow-up

- Archive with `$openspec-archive-change` after 5.2. Then self-review the
  finalize diff, mark it ready, and run Ready-PR monitoring. These SR and GR
  steps are post-archive gates.
- Merge the stack only through `$gh-stack` with Leo's explicit permission.
