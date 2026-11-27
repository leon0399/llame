Track [#1655](https://github.com/leon0399/llame/issues/1655), its cutovers
[#1893](https://github.com/leon0399/llame/issues/1893) and
[#1894](https://github.com/leon0399/llame/issues/1894), sibling
[#1654](https://github.com/leon0399/llame/issues/1654), and their PR layers
through [Project tracking](../../../CONTRIBUTING.md#project-tracking). Carry
forward the recorded proposal approval and recheck native blockers before you
start. Keep live status in the Project.

## Delivery stack

Use `$gh-stack` for every branch operation and `$openspec-apply-change` for
each implementation layer, after proposal approval only.

```text
master
  <- unified-walk-policy/proposal
  <- unified-walk-policy/engine
  <- unified-walk-policy/knowledge
  <- unified-walk-policy/listing
  <- unified-walk-policy/finalize
```

| Layer                           | Parent      | Ownership                                                                                                                                           | Authored estimate | Closes       |
| ------------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | ------------ |
| `unified-walk-policy/proposal`  | `master`    | The approved proposal, design, deltas, and this task list.                                                                                          | ~1,500            | none         |
| `unified-walk-policy/engine`    | `proposal`  | The shared walk-policy module, the moved ignore machinery, the widened fixed set in the hub engine and the Rust daemon walk, and the glossary term. | ~900              | #1893        |
| `unified-walk-policy/knowledge` | `engine`    | The Knowledge search walk adopts the policy; the grep Knowledge leg gains ignore readers; prompts, docs, changelog.                                 | ~900              | #1654, #1655 |
| `unified-walk-policy/listing`   | `knowledge` | The shared directory listing applies the policy per entry class, on host and `kb://` listings; docs and changelog.                                  | ~700              | #1894        |
| `unified-walk-policy/finalize`  | `listing`   | Spec sync, task records, and archive movement only.                                                                                                 | ~300              | none         |

Every layer is a safe merge point. No layers must merge together. After the
engine layer merges into `master`, the listing layer MAY start from `master`
as a parallel branch in its own `$gh-stack` stack: its files
(`packages/native-file-tools/src/directory-listing.ts` and its tests) and its
spec requirement (`native-file-tools`) are disjoint from the knowledge layer's,
and task 3.1 needs only the merged engine module. Before that merge, the stack
stays linear as drawn, because the listing layer depends on the engine module
that only the engine layer puts on `master`.

The knowledge layer closes both issues because its merge satisfies each
acceptance: the search walk of #1655 no longer reads infrastructure trees,
and the symlink of #1654 no longer fails a Space. Engine and listing are
cutovers without their own acceptance in those issues.

## 0. proposal

- [x] 0.1 Run adversarial review with two independent reviewers per round: spec consistency against `openspec/specs/{knowledge-tools,grep-tool,native-file-tools}/spec.md`, and feasibility against `packages/native-file-tools/src/grep/walk.ts`, `src/grep/ignore-files.ts`, `src/directory-listing.ts`, `apps/api/src/tools/grep-ports.ts`, and `apps/api/src/knowledge/knowledge-filesystem.ts`. Verify each finding against code or specs. Commit each round separately.
  - Evidence: round 1 on head `9da00473`, reviewers `chatgpt-codex-connector` and `pullfrog` (Indent skipped, quota-exhausted; CodeRabbit rate-limited, nonblocking). All six findings verified against code and accepted; fixed in the round-1 commit.
- [ ] 0.2 Prove the final revision: `pnpm exec openspec validate unified-walk-policy --strict`, `pnpm lint:markdown`, `pnpm format:check`, and `git diff --check`. Record Leo's approval of that revision.
  - Evidence: all four rows pass on the round-1 revision. Leo's approval of the revised scope is pending.
- [x] 0.3 Self-review the proposal diff before the PR is marked ready. Record the review rounds in the PR body.
  - Evidence: each round-1 finding was independently verified against the code, the canonical specs, and the archive convention before the fix; dispositions recorded in the PR body.
- [ ] 0.4 Pass the GitHub review and CI gate under Ready-PR monitoring.

## 1. engine

- [ ] 1.1 Create the shared walk-policy module in `packages/native-file-tools` (design D1): the fixed set constant, the fixed-set skip decision, and the ignore machinery moved from `src/grep/ignore-files.ts`, with the moved unit tests. Verify `pnpm --filter @workspace/native-file-tools test`.
- [ ] 1.2 Widen the engine's `.git` check in `src/grep/walk.ts:194` to the fixed set, silent, and keep the `reach()` resume semantics for every widened name. Verify a walk test per new name and the existing `.git` scenarios, plus the resume-point test for a counted skipped directory.
- [ ] 1.3 Widen the Rust daemon's fixed-set check in `crates/machine-grep/src/lib.rs` (`:670` today), matching the hub set exactly and keeping its silent resume semantics. Verify a walk test per new name in `apps/machine/tests/search.rs`, and run `pnpm --filter machine lint` (`cargo fmt --all --check`, `cargo clippy --locked --workspace --all-targets`).
- [ ] 1.4 Add the glossary term "Walk policy" to `docs/product/glossary.md` with its avoid-list, and add the dated `CHANGELOG.md` entry that tells operators to update every Machine daemon with the release. Verify `pnpm lint:markdown`.
- [ ] 1.5 Verify the layer: `pnpm --filter @workspace/native-file-tools test`, `pnpm --filter machine test` (`cargo test --locked --workspace`), affected `lint` and `typecheck`, `pnpm format:check`, `git diff --check`. The PR carries `Closes #1893`.
- [ ] 1.6 Self-review the parent-relative diff before the PR is marked ready. Fix accepted findings with new commits.
- [ ] 1.7 Pass the GitHub review and CI gate under Ready-PR monitoring.

## 2. knowledge

- [ ] 2.1 Wire `ignoreFiles` and `ignoreAncestors` into `createKnowledgeWalkPort` (`apps/api/src/tools/grep-ports.ts`) through the Knowledge filesystem port, with the refusal rules of design D4. Verify the moved `walk-policy` scenarios on a `kb://` scope, including the repository limit and the ancestor collection above the Space root.
- [ ] 2.2 Make `processSearchEntry` (`apps/api/src/knowledge/knowledge-filesystem.ts:319`) apply the policy: skip fixed-set names before `lstat`, apply the ignore layers, and skip a symbolic link instead of throwing (design D6). Verify the MODIFIED corpus requirement's new scenarios: jj and nested-repository skips, the ignore-excluded vendored tree, and the link skip without a warning.
- [ ] 2.3 Bound the search walk's ignore-file reads outside the Markdown file and byte bounds (design D4). Verify a test where ignore files exist and the content bounds are untouched, and one where a 256 KiB-over ignore file applies no rules.
- [ ] 2.4 Update `apps/api/src/prompts/tools/knowledge_search.md` and `grep.md` where they describe the walked corpus, and `docs/product/reference/tools/knowledge_search.md` and `grep.md` for the policy behavior. Add the dated `CHANGELOG.md` entry that states the corpus narrowing. Verify `tool-descriptions.test.ts` and `pnpm lint:markdown`.
- [ ] 2.5 Verify the layer: `pnpm --filter @workspace/native-file-tools test`, focused `apps/api` knowledge-filesystem and grep knowledge-scope tests, affected `lint` and `typecheck`, `pnpm format:check`, `git diff --check`. The PR carries `Closes #1654` and `Closes #1655`.
- [ ] 2.6 Self-review the parent-relative diff before the PR is marked ready. Fix accepted findings with new commits.
- [ ] 2.7 Pass the GitHub review and CI gate under Ready-PR monitoring.

## 3. listing

- [ ] 3.1 Apply the walk policy in `packages/native-file-tools/src/directory-listing.ts` per entry class (design D5): a fixed-set entry renders with no child read, an ignore-ruled entry does not render and does not count, and the requested directory is never filtered. Verify the MODIFIED listing requirement's new scenarios on a host directory and a `kb://` Space root, including `read repo/.git/` and `read kb://<space>/.git/HEAD`.
- [ ] 3.2 Keep the listing's determinism claim: two reads of an unchanged directory with unchanged ignore files produce identical content. Verify the existing listing tests still pass and the moved ignore reader serves the listing through the same port.
- [ ] 3.3 Update `docs/product/reference/tools/read.md` and the locator pages that describe directory listings, and add the dated `CHANGELOG.md` entry. Verify `pnpm lint:markdown`.
- [ ] 3.4 Verify the layer: `pnpm --filter @workspace/native-file-tools test`, focused `apps/api` native-files listing tests, affected `lint` and `typecheck`, `pnpm format:check`, `git diff --check`. The PR carries `Closes #1894`.
- [ ] 3.5 Self-review the parent-relative diff before the PR is marked ready. Fix accepted findings with new commits.
- [ ] 3.6 Pass the GitHub review and CI gate under Ready-PR monitoring.

## 4. finalize

- [ ] 4.1 Enter `unified-walk-policy/finalize` with `$gh-stack` before any spec synchronization writes.
- [ ] 4.2 Run `$openspec-sync-specs`. The `name-selector-units` change is archived and this delta already carries its `L` selector spelling (reconciled in the 2026-11-27 rebase); re-read the shipped `knowledge-tools` corpus requirement before sync, in case another change archived against it first. Verify `pnpm exec openspec validate --specs --strict` and `pnpm exec openspec validate --all --strict`.
- [ ] 4.3 Run `$openspec-archive-change` after readiness is proved. Preserve checked task history and check MODIFIED requirement wording for semantic consistency.
- [ ] 4.4 Publish the finalize PR as draft with `$gh-stack`, self-review its actual diff after archive movement, then mark ready and run the Ready-PR monitoring loop. Post-archive gates, not pre-archive checkboxes.
