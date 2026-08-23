## 1. Storage and API Layer (`multiple-kb/storage`)

- [ ] 1.1 Add name and timestamp fields, remove owner uniqueness, and migrate each existing stable ID and child as `Personal`; verify schema, upgrade, RLS/FORCE-RLS, duplicate-name, and concurrent-owner integration tests pass.
- [ ] 1.2 Replace singleton repository/service assumptions with owner-scoped create, list, retrieve, rename, and exact-owned-ID query primitives; verify missing and other-owner identifiers are indistinguishable and no owner count cap exists.
- [ ] 1.3 Make provisioning directory-first and authority-row-second without recovery deletion; verify filesystem/service tests cover usable children before commit, database-failure orphans, symlink refusal, missing roots, and preserved migrated paths.
- [ ] 1.4 Replace bodyless singleton `PUT` with authenticated collection/item REST operations and the Knowledge-local `(createdAt, id)` opaque cursor; verify DTO, malformed-cursor, deterministic pagination, unauthorized, excess-field, cross-tenant, and OpenAPI contract tests pass.
- [ ] 1.5 Run the affected API unit/integration tests, typecheck, lint, migration checks, and sequential build; verify the storage layer is green before submitting it.

## 2. Multi-Space Tool Layer (`multiple-kb/tools`)

- [ ] 2.1 Remove owner-inventory gating and the obsolete `knowledge_space_not_configured` manifest/recovery path from accepted-turn Knowledge candidates while retaining allowlist and configured-root gates; verify zero inventory advertises callable tools whose calls return `knowledge_space_not_configured`, and update availability receipt/reminder tests.
- [ ] 2.2 Resolve current owner resources inside every tool invocation, rechecking each target before open; verify later additions appear, later removals fail, guessed/absent/other-owner IDs are indistinguishable, and no root or owner detail leaks.
- [ ] 2.3 Extend `knowledge_search` with optional `knowledgeSpaceId`, deterministic all-current traversal, and one shared operation budget; verify selector narrowing, ordering, live file changes, global limits, timeout, cancellation, and zero-inventory behavior.
- [ ] 2.4 Return bounded call-level warnings and `complete: false` when one space-scoped failure leaves usable all-space results; verify explicit-target, all-target, and global-limit failures remain top-level errors with no false completeness.
- [ ] 2.5 Require explicit `knowledgeSpaceId` for every `knowledge_read`; verify omission fails before filesystem access and same-named spaces, containment, symlink refusal, bounded reads, and exact hash/content attribution remain safe.
- [ ] 2.6 Persist response-time space names/IDs with Knowledge results; verify reload and rename/file-change history retain exact call-time attribution.
- [ ] 2.7 Run focused Knowledge and tool-loop unit/integration suites plus affected API typecheck, lint, and sequential build; verify the tool layer is green before submitting it.

## 3. Incomplete Replay Layer (`multiple-kb/replay`)

- [ ] 3.1 Map a payload-cleared successful Knowledge search with `complete: false` to ledger outcome `incomplete` in the generic run/observation pipeline without adding a third `ToolResult.status`; verify full payload, durable event, compaction, and later model replay preserve the distinction.
- [ ] 3.2 Preserve existing `success`, exact error, pairing, omission, and budget behavior for every other tool observation; verify focused generic run/observation tests and affected API typecheck, lint, and sequential build pass before submitting the layer.

## 4. Acceptance Layer (`multiple-kb/acceptance`)

- [ ] 4.1 Regenerate the API client for the breaking Knowledge REST surface and remove the singleton operation without adding a web management page; verify generated-client and affected web typecheck/build checks pass.
- [ ] 4.2 Add end-to-end coverage for creating, listing, retrieving, and renaming duplicate-named spaces; current multi-space search; explicit reads; live addition/revocation; incomplete all-space search; reload attribution; and cross-account denial.
- [ ] 4.3 Update `SPEC.md` authority links, operator/user documentation, `ROADMAP.md`, and `CHANGELOG.md` in the shipping layer; verify no UI, upload, indexing, sync, or lifecycle behavior is claimed shipped.
- [ ] 4.4 Run all affected tests, typechecks, lints, OpenAPI checks, formatting, Markdown lint, and sequential workspace builds; verify all stack layers are green and the repaired stack is ready for review.

## 5. OpenSpec Finalization Layer (`multiple-kb/finalize`)

- [ ] 5.1 After the acceptance layer is complete, verify the implementation tasks above have evidence and mark them complete; verify OpenSpec reports complete planning artifacts and `tasks.md` contains no unchecked implementation task.
- [ ] 5.2 Apply `openspec-sync-specs` to merge the delta requirements into canonical `knowledge-spaces`, `knowledge-tools`, and `tool-calling` specs; verify unrelated canonical requirements remain and strict OpenSpec validation passes.
- [ ] 5.3 Apply `openspec-archive-change` in the same finalization PR; verify the active change is absent, the dated archive contains every artifact, and strict OpenSpec validation still passes.
- [ ] 5.4 Run `pnpm lint:markdown`, `pnpm format:check`, and `git diff --check`; verify the finalization PR contains only canonical spec synchronization, completed task records, and the archive move—no implementation behavior.
