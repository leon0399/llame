## Delivery stack

Use `$gh-stack` and `$openspec-apply-change` after proposal approval.
`native-read-directory-listing/finalize` must archive before the first
implementation layer (see design Migration Plan); rebase this stack on that merge and re-verify the
`native-file-tools` MODIFIED blocks against the main spec.

```text
master
  <- kb-locator/proposal
  <- kb-locator/locator
  <- kb-locator/mutations
  <- kb-locator/finalize
```

`locator` closes #691. `mutations` closes #702. `finalize` archives and updates
the #701 tracker.

## 1. locator

- [x] 1.1 Add `scheme://` recognition ahead of selector splitting in `packages/native-file-tools` and refuse unimplemented schemes with `invalid_path` on `read`, `edit`, and `write`; verify unit tests cover `kb://` with and without selectors, `vault://x`, a literal absolute filename containing `://`, and that no file named after a scheme is created.
- [x] 1.2 Add the `kb://` resolver step in `apps/api/src/tools/native-files.ts`: parse `<space-id>`/`<path>`, resolve the binding under `runAs` via the Knowledge resolver, apply Knowledge path rules plus `:` rejection and per-component symlink refusal, then call the native reader on the resolved host path with `followSymlinks: false` so the package opens with `O_NOFOLLOW`; verify unit tests for absent, other-owner, and malformed identifiers return an identical `knowledge_space_not_found`, and binding failure returns `knowledge_space_unavailable`, with no host path in any result, and a symlink swapped in at the target after validation returns `not_found`.
- [x] 1.3 Add `notice`, Space identifier, display name, and locator to `kb://` read and listing results, keeping content verbatim; verify a note containing `<system>` reads back byte-identical and the result carries the notice.
- [x] 1.4 Support `kb://<id>` and `kb://<id>/` directory reads through the shipped listing and reject bare `kb://`; verify listing header is the locator and every entry kind renders as native listings do.
- [x] 1.5 Widen candidate resolution and advertisement so `read`, `edit`, and `write` are admitted when `tools.nativeExecutorId` or `knowledge.root` is configured; verify tests that a Knowledge-root-only process advertises all three, `kb://` reads succeed, and an absolute path returns `executor_unavailable`.
- [x] 1.6 Skip the executor bind for `kb://` reads; verify a `kb://` read on a Run leaves `runs.workerId` null and a later absolute-path read still binds.
- [x] 1.7 Replace `knowledge_search` passage `offset`/`limit` with a one-based `locator`, update ordering wording, the tool description, and the `read` description's `kb://` sentence, and add the `chat-default.md` line; verify search tests assert the locator string, that passing it unchanged to `read` returns the passage window, and that no zero-based field remains.
- [x] 1.8 Delete `knowledgeReadTool`, the legacy envelope in `knowledge-filesystem-read.ts`, the Markdown-only and 1 MiB read policy for `kb://`, registry and candidate-resolver entries, and prompt/docs/README/SPEC/e2e-config mentions; verify `knip`, lint, and typecheck pass and `rg knowledge_read` matches only historical-rendering code, the changelog, and archived changes.
- [x] 1.9 Keep `tool-observation-part.ts` rendering historical `knowledge_read` parts and make a bound Run's request for `knowledge_read` fail closed through the existing unavailable refusal; verify a unit test with a persisted historical part and an integration test with a snapshot naming the removed tool.
- [x] 1.10 Port the Knowledge acceptance suite and `e2e/web/chat/knowledge-tool.spec.ts` plus `e2e/support/model-server.ts` to `read(kb://...)` driven by the search locator; verify the e2e passes in CI and covers LF/CRLF/lone-CR, terminal delimiter, continuation, and the other-owner negative case.
- [x] 1.11 Update `docs/knowledge.md` (reference `docs/native-files.md` as the read surface, drop `knowledge_read` from the allowlist example, state the boot rejection), `docs/native-files.md`, README, and SPEC; verify `pnpm lint:markdown` and `pnpm format:check` pass.

## 2. mutations

- [x] 2.1 Route `kb://` `edit` and `write` through the resolver from 1.2 and the native mutation functions; verify integration tests for exact edit, ambiguous edit, create-only write, `file_exists`, and other-owner refusal with no mutation.
- [x] 2.2 Make `NativeFilesRepository.begin` take an optional executor and skip the `runs.workerId` bind for `kb://`, recording the locator as the attempt target; verify a retry on a different worker returns `outcome_unknown` without `executor_unavailable` and never re-executes the mutation.
- [x] 2.3 Create missing intermediate directories on `write` for every scheme and fail `not_regular_file` when an intermediate is a file; verify package unit tests for absolute paths and integration tests for `kb://`.
- [x] 2.4 Confirm `kb://` mutations bypass no fence path and that `bash` admission is unchanged; verify the existing native fence and bash tests pass unmodified.

## 3. finalize

- [ ] 3.1 Run `$openspec-sync-specs`, then `pnpm exec openspec validate --specs --strict`, `--all --strict`, `pnpm lint:markdown`, `pnpm format:check`, and `git diff --check`; verify all pass and record the results in the PR body.
- [ ] 3.2 Add the dated `CHANGELOG.md` entry including the `tools.allowed` breaking note and update the #701 tracker checkboxes; verify `pnpm lint:markdown` passes.
- [ ] 3.3 Confirm every task above is checked, then run `$openspec-archive-change`; verify `openspec status --change kb-locator --json` reports complete before archiving.
