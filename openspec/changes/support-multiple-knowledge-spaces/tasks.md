## 1. Storage and Owner Inventory Layer (`multiple-kb/storage`)

- [ ] 1.1 Add the `knowledge_spaces` name/creation-order fields, remove single-owner uniqueness, preserve existing IDs as `Personal`, and add the serialized 32-space cap using a generated migration; verify schema, migration-contract, migration-upgrade, RLS, FORCE-RLS, duplicate-name, and concurrent-cap integration tests pass.
- [ ] 1.2 Replace the sole-space repository/service assumptions with owner-scoped list, create, rename, oldest-space compatibility, and owned-ID lookup operations; verify unit tests cover deterministic ordering, same-name spaces, cap outcomes, and absent-versus-other-owner non-disclosure.
- [ ] 1.3 Generalize stable-ID child provisioning and add idempotent owned-space ensure while retaining bodyless singular `PUT` behavior; verify focused filesystem/service tests cover independent children, partial-failure repair, symlink refusal, missing roots, and unchanged migrated paths.
- [ ] 1.4 Add authenticated collection list/create/rename/ensure endpoints with closed DTO validation and update OpenAPI; verify controller, API integration, unauthorized, excess-field, cross-tenant, and OpenAPI contract tests pass.
- [ ] 1.5 Run `pnpm --filter api test`, `pnpm --filter api test:integration`, `pnpm --filter api typecheck`, `pnpm --filter api lint`, and `pnpm --filter api build`; verify the layer is green before `gh stack submit`.

## 2. Chat and Run Binding Layer (`multiple-kb/bindings`)

- [ ] 2.1 Add owner-scoped ordered Chat bindings, nullable initialized/revision state, immutable ordered Run snapshots, composite ownership constraints, and RLS/FORCE-RLS policies through a generated migration; verify schema, migration, cross-tenant denial, and explicit-empty persistence tests pass.
- [ ] 2.2 Extend Chat reads and atomic patch replacement with `knowledgeSpaceIds`; verify unit/integration tests cover unique/max validation, all-or-nothing missing and other-owner rejection, monotonically increasing revisions, explicit empty, and no existence oracle.
- [ ] 2.3 Initialize unconfigured Chats once from current inventory and copy bindings on fork; verify integration tests cover zero-inventory deferral, deterministic creation order, no later auto-attachment, explicit-empty stability, and independent fork edits.
- [ ] 2.4 Persist the Knowledge binding upper bound atomically with accepted-turn state and disclose bounded ID/name receipts; verify transaction-failure rollback, same-name distinction, rename-history stability, and queue retry/handoff tests pass.
- [ ] 2.5 Add trusted Run identity and current-authorization intersection resolution to tool execution/candidate context; verify tests cover late attachment exclusion, detachment revocation, ownership loss, empty/not-configured/unavailable manifests, and absence of host or owner details.
- [ ] 2.6 Regenerate OpenAPI and the web client, then run affected API/web tests, typechecks, lints, and sequential builds; verify the layer is green and run `gh stack rebase --upstack` before submission.

## 3. Multi-Space Tool Layer (`multiple-kb/tools`)

- [ ] 3.1 Extend `knowledge_search` with an optional bound-space selector and deterministic all-bound traversal sharing one operation budget; verify unit tests cover ordinal/path ordering, selector narrowing, global entry/file/byte/output limits, abort/timeout, inaccessible-target whole-call failure, and no partial results.
- [ ] 3.2 Extend `knowledge_read` with optional bound-space selection and single-space compatibility; verify tests cover same-name disambiguation, `knowledge_space_selection_required`, detached/guessed/other-owner non-disclosure, path containment, symlink refusal, bounded reads, and exact hash/content attribution.
- [ ] 3.3 Persist and stream acceptance-time space names/IDs with search/read results and render unambiguous structured citations; verify reconstruction tests preserve historical attribution after rename/file changes and expose no local paths.
- [ ] 3.4 Update packaged tool descriptions and availability/recovery outcomes for `knowledge_space_not_bound`, selection, untrusted names/content, and space-plus-path citation; verify catalog snapshots, context items, and tool-loop tests pass.
- [ ] 3.5 Run focused Knowledge unit/integration suites plus API/web tests, typechecks, lints, and sequential builds; verify the layer is green and run `gh stack rebase --upstack` before submission.

## 4. Product Surface and Acceptance Layer (`multiple-kb/product`)

- [ ] 4.1 Add the authenticated Knowledge Space inventory UI using generated client operations for list, create, and rename, with duplicate-name ID disambiguation and no path/file controls; verify component stories cover empty, populated, duplicate-name, validation, loading, unavailable, and mutation-error states.
- [ ] 4.2 Add an explicit-save current-Chat multi-select that supports zero through 32 spaces and refreshes Chat binding state without silently selecting new inventory; verify stories cover uninitialized defaults, explicit empty, duplicate names, concurrent update failure, and persisted selection.
- [ ] 4.3 Add browser acceptance for creating two spaces, selecting both, searching both, selecting one for read, detaching one before a later Run, reload attribution, cross-account denial, and compatibility with a migrated single space; verify the focused Playwright suite passes against isolated fixtures.
- [ ] 4.4 Update `SPEC.md` authority links, user/operator documentation, `ROADMAP.md`, and `CHANGELOG.md` in the shipping layer; verify `pnpm lint:markdown` and `pnpm format:check` pass and no indexed/search/sync behavior is claimed shipped.
- [ ] 4.5 Run all affected unit, integration, Storybook, E2E, typecheck, lint, OpenAPI, format, and sequential workspace-build checks; verify every stack layer is green, then run `gh stack rebase --upstack`, inspect `gh stack view --json`, and submit the repaired stack for review.

## 5. Post-Merge OpenSpec Finalization

- [ ] 5.1 After every implementation layer merges, sync the delta specifications into canonical specs and archive `support-multiple-knowledge-spaces`; verify `pnpm exec openspec validate --all --strict`, `pnpm lint:markdown`, and `pnpm format:check` pass in the finalization change.
