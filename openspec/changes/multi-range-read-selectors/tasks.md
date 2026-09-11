## 1. Proposal layer

Delivery stack: `master` <- `multi-range-read-selectors/proposal` <-
`multi-range-read-selectors/implementation` <- `multi-range-read-selectors/finalize`.
Use `$gh-stack` and `$openspec-apply-change`; create implementation layers only
after proposal approval. The proposal layer owns these planning artifacts.

- [ ] 1.1 Review and approve the proposal; verify strict OpenSpec validation and recorded approval before implementation.

## 2. Implementation layer

`multi-range-read-selectors/implementation` owns shared parsing, read execution,
API integration, descriptions, tests, and operator documentation for #705.

- [ ] 2.1 Extend shared selector parsing and preserve comma mode; verify normalization, raw grammar, invalid bounds/members, the 64-member limit, and literal filenames in parser tests.
- [ ] 2.2 Implement bounded multi-range rendering and metadata; verify gaps, EOF, empty files, exact merged ranges, whole-range truncation, oversized first ranges/lines, cancellation, and progress through repeated continuations in reader tests.
- [ ] 2.3 Integrate absolute and Knowledge reads and update descriptions/consumers; verify escaped serialized output plus Knowledge envelopes remain bounded, Knowledge parsing accepts valid comma suffixes and preserves malformed-locator errors, another owner's locator remains unresolvable, and directory/single-range behavior stays unchanged. Reconcile shared parser use with #763 and #770 if they land first.
- [ ] 2.4 Document syntax and continuation examples in the native-file operator documentation; verify each example against tests and record #572's future multi-range hint contract without implementing overviews.
- [ ] 2.5 Run native-file package tests, typecheck, and build, affected API integration tests/typecheck, repository lint and format checks; record actual results and inspect the final diff.

## 3. Finalize layer

`multi-range-read-selectors/finalize` owns canonical spec synchronization,
archive, and completion of #705; only this layer uses `Closes #705`.

- [ ] 3.1 Sync the native-file-tools delta, reconciling any newly merged requirements without overwriting them; verify strict OpenSpec validation and the canonical diff.
- [ ] 3.2 Archive the completed change and update shipped documentation; verify archive checks, Markdown lint, format checks, and issue-closing ownership in the final PR.
