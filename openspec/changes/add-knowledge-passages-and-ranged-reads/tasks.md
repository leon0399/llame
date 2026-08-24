## Stack Topology

Each named branch is one gh-stack layer and one PR:

`master <- knowledge-ranges/proposal <- knowledge-ranges/read <- knowledge-ranges/search <- knowledge-ranges/acceptance <- knowledge-ranges/finalize`

The proposal and finalization are mandatory isolated PR boundaries. Runtime implementation remains split by independently reviewable read, search, and acceptance concerns. The finalization PR SHALL run canonical-spec synchronization first and archive the same completed change second. A layer SHALL contain only its stated ownership; fixes to a lower layer are committed there and rebased upstack.

## 0. Proposal Layer (`knowledge-ranges/proposal`)

- [x] 0.1 Explore and grill issue #543, relevant repository contracts, and dedicated agent read-tool references; settle the ranged-read, numbered-line, continuation, passage, cursor, and hash-removal boundaries.
- [x] 0.2 Author and strictly validate the OpenSpec proposal, design, delta specs, and stack-aware tasks without runtime implementation.

## 1. Ranged Read Layer (`knowledge-ranges/read`)

- [x] 1.1 Add failing schema and tool tests for optional zero-based `offset`, optional `limit` from 1 through 2,000, rejected unsafe/out-of-range values, unchanged explicit-space/path requirements, and the new hash-free result shape; verify the focused `knowledge-tools` unit tests fail for the intended missing behavior before implementation.
- [x] 1.2 Add failing filesystem tests for conventional LF/CRLF logical lines, lone-CR content, empty files, terminal delimiters, blank lines, bounded slices, offsets beyond EOF, continuation at whole-line boundaries, one oversized line, complete-file UTF-8 validation, aborts, and files between 64 KiB and 1 MiB; verify the focused adapter tests exercise bounded handle reads and close-on-every-path behavior.
- [x] 1.3 Implement the bounded streaming line reader through the existing safe resolved-file handle, extend the admitted read size to 1 MiB, add `knowledge_range_invalid`, and remove read-path SHA-256 computation; verify the focused filesystem tests pass without weakening path, symlink, trusted-root, byte, timeout, or cancellation checks.
- [x] 1.4 Implement `knowledge_read` range/result shaping with zero-based `offset`, `lineCount`, one-based line-numbered `content`, optional `nextOffset`, and server-only `cutReason`; verify source delimiters remain unchanged, omitted ranges stop at EOF or 2,000 lines, output cuts omit the whole next line visibly, and no `contentHash` or `expectedContentHash` contract remains.
- [x] 1.5 Update affected tool-loop, persistence, replay, and integration fixtures for newly authored ranged-read results while retaining representative historical hash-bearing observations; verify focused Knowledge and Run integration tests pass and no persisted history migration is introduced.
- [x] 1.6 Run affected API unit/integration tests, typecheck, lint, format check, and sequential API build; verify the read layer is independently green before submitting it.

## 2. Passage Search Layer (`knowledge-ranges/search`)

- [x] 2.1 Add failing pure tests for literal occurrence collection, same-line deduplication, one-line context, transitive union of touching/overlapping passages, deterministic partitioning of merged intervals above 2,000 lines, 500-code-point cropping with visible omission, deterministic `(space, path, offset)` order, and multiple passages from one file; verify fixtures cover mixed newline forms and Unicode queries.
- [x] 2.2 Add failing tests for a strict Knowledge-local cursor bound to query and optional selector, malformed/mismatched cursors, deleted anchors, unchanged-corpus continuation, failed spaces before and after the cursor anchor, and explicitly live concurrent-change semantics; verify no generic cursor framework or server-side cursor state is required.
- [x] 2.3 Implement passage extraction and replace `line`, `snippet`, and `contentHash` results with `offset`, `limit`, and `excerpt`; verify returned coordinates can be passed directly to `knowledge_read` and current search safety budgets remain operation-global across all spaces.
- [x] 2.4 Implement opaque keyset continuation and `nextCursor`, including current-access reauthorization on every page and deterministic unchanged-corpus traversal; verify requested result limits expose later passages without claiming snapshot stability or resetting per-call traversal budgets.
- [x] 2.5 Preserve existing explicit-target errors, all-current incomplete successes, bounded warnings, zero-inventory behavior, and payload-cleared `incomplete` outcomes; verify focused unit/integration tests cover one failed space, all failed initial targets, all failed cursor-eligible targets, revocation, global bounds, aborts, and output preflight.
- [x] 2.6 Run affected API unit/integration tests, typecheck, lint, format check, and sequential API build; verify the search layer is independently green before submitting it.

## 3. Acceptance Layer (`knowledge-ranges/acceptance`)

- [ ] 3.1 Verify live Run execution, event persistence, browser reload, ordinary bounded replay, and compaction for new search/read shapes plus historical hash-bearing observations; add only the compatibility handling proven necessary by focused tests.
- [ ] 3.2 Add product-level coverage using a long Markdown note and multiple separated matches to prove whole-file continuation, explicit ranges, multi-page literal passage search, current-call authorization, safe attribution, and absence of model-facing hashes; verify the focused Playwright Knowledge scenario passes.
- [ ] 3.3 Update `SPEC.md`, Knowledge operator/user documentation, coordinated Knowledge declaration rollout/rollback instructions, `ROADMAP.md`, and `CHANGELOG.md` in the shipping layer; verify the docs claim no headings, index, embeddings, stable citations, Git revision, OKF/OpenWiki behavior, or generated synopsis.
- [ ] 3.4 Run all affected tests, typechecks, lints, Markdown lint, formatting, and sequential workspace builds; verify every implementation layer is green and the stack contains no unrelated changes.

## 4. OpenSpec Finalization Layer (`knowledge-ranges/finalize`)

- [ ] 4.1 After implementation evidence exists, mark completed tasks accurately and verify OpenSpec reports every apply-required artifact complete with no unchecked implementation task.
- [ ] 4.2 Run `openspec-sync-specs` to merge the verified `knowledge-tools`, `knowledge-spaces`, and `tool-calling` deltas into canonical specs; verify unrelated requirements remain intact and strict validation passes.
- [ ] 4.3 Verify the synchronized canonical specs, completed active-change artifacts, Markdown lint, formatting, and diff checks; then mark every checkbox complete so archive preflight observes no unfinished task.

After every checkbox is complete, run `openspec-archive-change` in this same finalization layer. Verify the active change is absent, the dated archive contains every artifact including the completed task record, canonical specs remain exactly as synchronized earlier in the PR, and strict validation still passes. The finalization PR SHALL contain only accurate completed-task records, canonical spec synchronization, and the archive move, with no runtime behavior. Archiving is intentionally described after the checklist rather than as a self-referential unchecked task, so the archive preflight can truthfully observe zero incomplete tasks.
