## 1. Projection representation

- [x] 1.1 Update the conversation chunker to retain role-labelled presentation content while deriving role-free normalized lexical content, and increment `CHUNKER_VERSION`.
- [x] 1.2 Update projection/schema and search-core documentation so `content`, `normalized_content`, and generated `fts` have explicit, non-overlapping presentation and retrieval contracts.
- [x] 1.3 Confirm the existing version-staleness rebuild path processes prior-version rows without a schema migration or a one-off data repair.

## 2. Regression coverage

- [x] 2.1 Extend chunker unit tests to assert role labels remain in presentation content but are absent from normalized lexical content, preserving exclusions and literal body text.
- [x] 2.2 Extend projection integration coverage to assert reindexed rows have role-free `normalized_content` and `fts`, retain role-labelled snippet content, and rebuild after the version change.
- [x] 2.3 Extend chat-search integration coverage so exact, prefix, and typo forms of synthetic `user`/`assistant` labels neither match nor affect ranking, while literal occurrences in titles or conversation bodies remain searchable and snippets retain role attribution.

## 3. Verification

- [ ] 3.1 Run targeted API unit and integration tests for the chunker, search index, and chat search, including the RLS harness when the database-backed tests are available.
- [x] 3.2 Run `pnpm --filter api typecheck`, `pnpm --filter api lint`, and `pnpm format:check` (or the repository's equivalent scoped formatting check); resolve failures caused by this change.
- [x] 3.3 Run `openspec validate fix-search-role-tag-leak --strict` and confirm the change is apply-ready.
