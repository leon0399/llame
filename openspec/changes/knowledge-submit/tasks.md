## Delivery stack

This proposal depends on the approved and landed `native-file-tools` contract.
Do not create `knowledge-submit/proposal` from bare `master` until
`native-file-tools/finalize` has landed and the shared reader/deprecation
contract is present. Record that merged base SHA in the proposal handoff. Use
`$gh-stack` and `$openspec-apply-change` after proposal approval:

```text
master
  <- knowledge-submit/proposal
  <- knowledge-submit/provisioning
  <- knowledge-submit/git-adapter
  <- knowledge-submit/runtime
  <- knowledge-submit/acceptance
  <- knowledge-submit/finalize
```

## 1. provisioning

- [ ] 1.1 Modify Knowledge Space provisioning so new Spaces create and validate an empty Git repository with active `main` before inserting the owner row; verify no content commit or staged file exists.
- [ ] 1.2 Add failure tests for missing Git, failed initialization, invalid repository metadata, database rollback, symlink child, and unauthoritative leftover repository; verify safe errors contain no paths or Git diagnostics.
- [ ] 1.3 Update provisioning integration and RLS tests; verify existing Spaces are not scanned, migrated, or initialized by the application.

## 2. git-adapter

- [ ] 2.1 Create a bounded plain-Git adapter with explicit cwd, minimal environment, hooks/helpers/prompts disabled, and safe error mapping; verify it cannot execute repository-controlled hooks or external helpers.
- [ ] 2.2 Implement repository validation for new `main` repositories and operator-prepared existing repositories; verify active-branch discovery and no-branch failure.
- [ ] 2.3 Implement explicit Knowledge-relative path validation and exact-path staging; verify unselected dirty/untracked files remain unstaged and no `git add -A` path exists.
- [ ] 2.4 Implement bounded commit message validation, active-branch commit, commit OID capture, and selected-file result details; verify empty selection, missing path, directory, invalid path, and commit failure.
- [ ] 2.5 Preserve whole selected files as the alpha attribution boundary; verify a selected file containing multiple local edits commits as one file and reports no line-level author.

## 3. runtime

- [ ] 3.1 Add the `knowledge_submit` model-facing operation behind the trusted Knowledge binding and native alpha host; verify it cannot select host roots, repositories, branches, author identity, or unselected paths.
- [ ] 3.2 Record a durable pre-commit submit attempt before staging and Git mutation; verify an open attempt fences queue retries, known commit OIDs can be reconciled, and unknown attempts do not run Git again.
- [ ] 3.3 Record submit provenance in the Run/submit record without Git trailers; verify Chat ID, selected paths, branch, commit OID, and outcome are retained without credentials or host paths.
- [ ] 3.4 Make submit explicit local accepted state and reject any claim of remote review/PR acceptance; verify result wording and structured outcome fields.
- [ ] 3.5 Test submit after native `edit`/`write`, refresh/reopen, active-branch changes, and unrelated worktree dirt; verify selected file behavior and live Knowledge reads.

## 4. acceptance

- [ ] 4.1 Prove new Space creation -> native edit -> explicit path submit -> new Chat live read with one accepted local commit; verify a second owner cannot access the first owner's Space through existing Knowledge authorization.
- [ ] 4.2 Run API/package lint, typecheck, tests, integration, OpenAPI generation/checks, `pnpm lint:markdown`, `pnpm format:check`, and `git diff --check`.
- [ ] 4.3 Document the alpha manual preparation required for existing Spaces and the absence of automatic migration, trailers, jj, line staging, and remote PR handling.

## 5. finalize

- [ ] 5.1 Sync the `knowledge-submit` and `knowledge-spaces` deltas with `$openspec-sync-specs`; verify the current Knowledge read contract remains intact.
- [ ] 5.2 Archive only after every task is checked and the future Chat-trailer/PR workflow is recorded as a follow-up; run strict specs/all validation and formatting gates.
