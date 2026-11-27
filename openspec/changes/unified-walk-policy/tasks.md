Track [#1655](https://github.com/leon0399/llame/issues/1655), its cutovers
[#1893](https://github.com/leon0399/llame/issues/1893) and
[#1894](https://github.com/leon0399/llame/issues/1894), and their PR layers
through [Project tracking](../../../CONTRIBUTING.md#project-tracking). #1655
and [#1654](https://github.com/leon0399/llame/issues/1654) close with
[#1961](https://github.com/leon0399/llame/issues/1961), not here. Carry forward
the recorded proposal approval and recheck native blockers before you start.
Keep live status in the Project.

## Delivery stack

Use `$gh-stack` for every branch operation and `$openspec-apply-change` for
each implementation layer, after proposal approval only.

```text
master
  <- unified-walk-policy/proposal
  <- unified-walk-policy/engine
  <- unified-walk-policy/listing
  <- unified-walk-policy/finalize
```

| Layer                          | Parent     | Ownership                                                                                                                                      | Authored estimate | Closes |
| ------------------------------ | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | ------ |
| `unified-walk-policy/proposal` | `master`   | The approved proposal, design, deltas, and this task list.                                                                                     | ~900              | none   |
| `unified-walk-policy/engine`   | `proposal` | The daemon `walk_policy` module, the widened fixed set in the daemon grep walk, the glossary term, the grep reference page, and the changeset. | ~400              | #1893  |
| `unified-walk-policy/listing`  | `engine`   | The daemon listing omits ignore-ruled entries; the listing presentation skips fixed-set child reads; the read reference page and changeset.    | ~400              | #1894  |
| `unified-walk-policy/finalize` | `listing`  | Spec sync, task records, and archive movement only.                                                                                            | ~300              | none   |

Every layer is a safe merge point. No layers must merge together. The stack
stays linear: the listing layer imports the `walk_policy` module that only the
engine layer creates.

The in-process TypeScript file engine, `knowledge_search`, and the `kb://`
grep leg are out of scope: #1961 deletes them and binds the Knowledge walk to
this policy, which closes #1654 and #1655.

## 0. proposal

- [x] 0.1 Run adversarial review with two independent reviewers per round: spec consistency against `openspec/specs/{grep-tool,native-file-tools,tool-call-permissions}/spec.md`, and feasibility against `crates/machine-grep/src/lib.rs`, `crates/machine-files/src/read.rs`, and `packages/native-file-tools/src/directory-listing.ts`. Verify each finding against code or specs. Commit each round separately.
  - Evidence: round 1 on head `9da00473`, reviewers `chatgpt-codex-connector` and `pullfrog` (Indent skipped, quota-exhausted; CodeRabbit rate-limited, nonblocking). All six findings verified against code and accepted; fixed in the round-1 commit. Round 2 on `d903e87c` (`pullfrog`): one finding, accepted.
- [x] 0.2 Revise the scope to the Rust Machine daemon (2026-11-28): drop the TypeScript walk-policy module, the knowledge layer, and the `knowledge-tools` delta; hand #1654 and #1655 to #1961. Prove the revision: `pnpm exec openspec validate unified-walk-policy --strict`, `pnpm lint:markdown`, `pnpm format:check`, and `git diff --check`.
  - Evidence: Leo directed the daemon-only scope, the presentation-side fixed-set check, and the #1961 handoff in session on 2026-11-28; all four rows pass on the revision commit.
- [x] 0.3 Self-review the proposal diff before the PR is marked ready. Record the review rounds in the PR body.
  - Evidence: each finding was independently verified against the code, the canonical specs, and the archive convention before the fix; dispositions recorded in the PR body.
- [ ] 0.4 Pass the GitHub review and CI gate under Ready-PR monitoring.

## 1. engine

- [ ] 1.1 Create `crates/machine-grep/src/walk_policy.rs` (design D1): the fixed set constant and `is_fixed`, and the ignore machinery moved from `src/lib.rs` (`collect_ignores`, `add_ignore_files`, `ignored`, `is_ignore_file`, the registered-root lookup). Verify `cargo test --locked -p machine-grep`.
- [ ] 1.2 Widen the walk's `.git` check (`Walker::push_children`) to the fixed set, silent, so no fixed-set entry is opened, reported as `ignored`, or skipped as a link. Verify one test per new name in `apps/machine/tests/search.rs`, a test that a gitignored `node_modules` is not reported, and that an explicit scope inside `node_modules` still searches it.
- [ ] 1.3 Add the glossary term "Walk policy" to `docs/product/glossary.md` with its avoid-list, update `docs/product/reference/tools/grep.md` where it names the `.git` prune, and add `.changeset/unified-walk-policy.md` that states the narrowing and tells operators to update every Machine daemon with the release. Verify `pnpm lint:markdown`.
- [ ] 1.4 Verify the layer: `pnpm --filter machine test`, `pnpm --filter machine lint`, `pnpm format:check`, `git diff --check`. The PR carries `Closes #1893`.
- [ ] 1.5 Self-review the parent-relative diff before the PR is marked ready. Fix accepted findings with new commits.
- [ ] 1.6 Pass the GitHub review and CI gate under Ready-PR monitoring.

## 2. listing

- [ ] 2.1 Make `list_directory` (`crates/machine-files/src/read.rs`) collect ignore files from the registered root down to the listed directory and omit each entry an ignore rule excludes, unless the fixed set names it; the total counts only kept entries, and the listed directory is never filtered (design D4). Verify in `apps/machine/tests/files.rs`: an ignored `dist` is absent and uncounted, a gitignored `node_modules` is listed, an ancestor `.ignore` applies, and listing an ignored directory itself returns its entries.
- [ ] 2.2 Make `readChildDirs` in `packages/native-file-tools/src/directory-listing.ts` skip the child read for a fixed-set name, so the entry renders with no block. Verify `directory-listing.test.ts`: `.git` and `node_modules` render without children, a requested `.git` directory lists its entries, and the existing determinism tests pass.
- [ ] 2.3 Update `docs/product/reference/tools/read.md` and the locator pages that describe directory listings, and amend `.changeset/unified-walk-policy.md`. Verify `pnpm lint:markdown`.
- [ ] 2.4 Verify the layer: `pnpm --filter machine test`, `pnpm --filter machine lint`, `pnpm --filter @workspace/native-file-tools test`, its `lint` and `typecheck`, `pnpm format:check`, `git diff --check`. The PR carries `Closes #1894`.
- [ ] 2.5 Self-review the parent-relative diff before the PR is marked ready. Fix accepted findings with new commits.
- [ ] 2.6 Pass the GitHub review and CI gate under Ready-PR monitoring.

## 3. finalize

- [ ] 3.1 Enter `unified-walk-policy/finalize` with `$gh-stack` before any spec synchronization writes.
- [ ] 3.2 Run `$openspec-sync-specs`. Re-read the shipped `grep-tool` and `native-file-tools` requirements before sync, in case another change archived against them first. Verify `pnpm exec openspec validate --specs --strict` and `pnpm exec openspec validate --all --strict`.
- [ ] 3.3 Run `$openspec-archive-change` after readiness is proved. Preserve checked task history and check MODIFIED requirement wording for semantic consistency.
- [ ] 3.4 Publish the finalize PR as draft with `$gh-stack`, self-review its actual diff after archive movement, then mark ready and run the Ready-PR monitoring loop. Post-archive gates, not pre-archive checkboxes.
