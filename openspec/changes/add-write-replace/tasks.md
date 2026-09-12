Track [#796](https://github.com/leon0399/llame/issues/796) and its PR layers
through [Project tracking](../../../CONTRIBUTING.md#project-tracking). Carry
forward the recorded proposal approval and recheck native blockers before
starting; keep live status in the Project.

## Delivery stack

The implementation layer owns closing #796 once its acceptance list is
satisfied. Use `$gh-stack` and `$openspec-apply-change` after proposal
approval; do not create implementation branches before it:

```text
master
  <- add-write-replace/proposal
  <- add-write-replace/replace-mode
  <- add-write-replace/finalize
```

## 1. replace-mode

- [x] 1.1 Add `replaceFile` beside `createFile` in `packages/native-file-tools` over the existing `publishFile({ create: false, mode })` path, with `realpath`, regular-file, and mode-capture preconditions mirroring `editFile`; verify package unit tests cover the four flag-by-existence cells, dangling symlink → `not_found`, symlink-to-file → target replaced and link preserved, directory → `not_regular_file`, permission bits preserved, empty-content truncation, and invalid-UTF-8 leaving bytes unchanged.
- [x] 1.2 Add the boolean `replace` argument to the `write` tool schema (strict, absent ≡ false), dispatch to `replaceFile`, resolve `kb://` replace targets with the leaf required to exist and no directory creation, and update the tool description plus the `file_exists` and replace-`not_found` messages; verify tool integration tests cover all four cells on both schemes, `kb://` missing leaf or parent → `not_found` with nothing created, the Knowledge envelope with no resolved host path, and selector rejection unchanged.
- [x] 1.3 Extend the native-files acceptance suite to the replace mode; verify a recovered open replace attempt returns `outcome_unknown` without re-execution and a settled replace replays its stored result, on both an absolute path and a `kb://` locator.
- [x] 1.4 Update `docs/native-files.md` (call shape, four-outcome table, error vocabulary), the root `AGENTS.md` native-tools capability line, and add the dated `CHANGELOG.md` entry; verify `pnpm lint:markdown`, `pnpm format:check`, and `git diff --check` pass.
- [x] 1.5 Run the affected workspace `lint`, `typecheck`, and `test:coverage`, the API integration suites for native files, and `pnpm lint`; verify no unrelated workspace or spec changes are in the diff.

## 2. finalize

- [ ] 2.1 Sync the `native-file-tools` delta with `$openspec-sync-specs`, including the capability Purpose wording ("create-only writes" → create-or-replace); verify strict `openspec validate --specs --strict` and `openspec validate --all --strict` pass with `pnpm lint:markdown`, `pnpm format:check`, and `git diff --check`.
- [ ] 2.2 Confirm every task above is checked and `openspec status --change add-write-replace --json` reports completion, then archive with `$openspec-archive-change`; verify the archived change preserves the checked task history.
