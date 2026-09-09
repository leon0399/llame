## Delivery stack

Use `$gh-stack` and `$openspec-apply-change` after proposal approval. Each
layer is one PR; keep it draft until its verification passes.

```text
master
  <- kb-locator-recovery/proposal
  <- kb-locator-recovery/encoding
  <- kb-locator-recovery/suggestions
  <- kb-locator-recovery/finalize
```

`encoding` completes #736. `suggestions` completes #737. `finalize` archives
and updates the #701 tracker. Every layer references #736 and #737.

## 1. encoding

- [x] 1.1 Decode each `kb://` path segment with `decodeURIComponent` after the `/` and selector splits in `parseKnowledgeLocator`, mapping `URIError` to `invalid_path`, and refuse a decoded segment containing `/` inside the parser before the segments are rejoined (the joined string reaching `validatePath` cannot show it); verify unit tests that `%20` and a literal space resolve to the same relative path, `%3A` yields a `:` segment, `notes%2Fsecret.md` returns `invalid_path` and never resolves to `notes/secret.md`, `%2E%2E`, `%252E%252E` (a literal `%2E%2E` name, not `..`), and `100%.md` behave as D1 states, a raw `a:b.md` still returns `invalid_path`, and an identifier or selector carrying `%` is refused undecoded.
- [x] 1.2 Delete `isLocatorAddressablePath` and its call in `knowledge-filesystem.ts`, so a `:` path is searched; verify the search test that previously asserted the skip now asserts a passage for `notes/2026-09-08 14:30 standup.md`.
- [x] 1.3 Make `passageLocator` encode a segment only when it contains `:`, `?`, `#`, or `%`, replacing exactly those characters; verify unit tests that a path with spaces is emitted literally, a `:` path is emitted with `%3A`, a `%` path with `%25`, and that every emitted locator passed unchanged to `read` opens the passage (integration).
- [x] 1.4 Add the one-sentence rule to the `read` description and to `chat-default.md`; verify the receipt snapshot test and `pnpm lint:markdown` pass.
- [x] 1.5 Negative isolation test: `notes%2Fsecret.md` (the case only the per-segment check catches), an encoded `..`, and a second owner's identifier open nothing and return `invalid_path` or `knowledge_space_not_found` respectively; verify it passes and that no host path appears in any result.
- [x] 1.6 Update `docs/knowledge.md` and `docs/native-files.md` with the encoding rule and the `%25` cost, and add the dated changelog entry; verify `pnpm lint:markdown` and `pnpm format:check` pass.

## 2. suggestions

- [x] 2.1 In `packages/native-file-tools/src/read.ts`, give `readFailure` the resolved host path, display path, and `followSymlinks`, and on `ENOENT` for a file target without a trailing separator `lstat` the parent and, when `followSymlinks` is false, refuse a symbolic link with the bare error (when true, follow it as the read did); open it once under `DIRECTORY_TRAVERSAL_BUDGET`, sort the names, score them with the D4 pipeline (NFC plus percent-decode normalization of both sides, a string that fails to decode compared as spelled; skip a candidate whose length differs from the request's by more than half the longer; stem/extension split per D4 with a 0.1 penalty after similarity; Damerau-Levenshtein similarity `1 - d/maxLen`; final score at least 0.5; stems under three characters exact-only; token-sorted retry below threshold; case-insensitive; ties by name; stop at 8,000,000 DP cells per miss, retries included, and return no suggestions past it), and append up to five names to the `not_found` message composed from `Dirent.name` only; report a missing parent instead of an empty list; verify package tests for each error class (`notes.txt` finds `notes.md` at 0.9, `%20` for a space, NFD versus NFC, one-character typo, `Notes Standup 2026-09-08.md` finds `2026-09-08 Standup Notes.md` only through the token retry, a request for `100%25.md` finds the sibling `100%.md` and a request for `100%.md` finds `100%25.md` without throwing), the threshold (an unrelated name yields the bare error; `ab` does not find `ac`), the five cap, the missing-parent message, a symlinked parent yielding the bare error with `followSymlinks` false and suggestions with it true, a trailing-separator miss yielding no suggestions, a directory of 10,000 `NAME_MAX`-length names returning the bare error within 200 ms, and that a successful read performs no directory read.
- [x] 2.2 Pass `allowMissing: true` for `kb://` reads in `executeKnowledge`; verify an integration test that a missed `kb://` read returns sibling names from the Space directory, that the message contains no configured root or resolved path, and that an absent or other-owner Space still returns `knowledge_space_not_found` with no names.
- [x] 2.3 Verify `edit` and `write` misses are unchanged: existing mutation tests pass and no suggestion text appears in their results.
- [x] 2.4 Add "suggests similar names when a file is missing" to the `read` description and the dated changelog entry; verify the receipt snapshot test and `pnpm lint:markdown` pass.

## 3. finalize

- [x] 3.1 Run `$openspec-sync-specs`, then `pnpm exec openspec validate --specs --strict`, `pnpm exec openspec validate --all --strict`, `pnpm lint:markdown`, `pnpm format:check`, and `git diff --check`; verify all pass and record the results in the PR body.
- [x] 3.2 Check #736 and #737 in the #701 tracker; verify `pnpm lint:markdown` passes.
- [x] 3.3 Confirm every task above is checked, run `openspec status --change kb-locator-recovery --json` and require `complete`, and only then run `$openspec-archive-change`.
