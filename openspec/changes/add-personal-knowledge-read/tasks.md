## Delivery Stack

Implement this OpenSpec change as a linear stack, followed by a separate specification-sync/archive layer:

```text
(master) <- knowledge-read/proposal <- knowledge-read/storage <- knowledge-read/tools <- knowledge-read/product <- knowledge-read/archive
```

- `knowledge-read/proposal` owns only this complete OpenSpec change and introduces no application behavior.
- `knowledge-read/storage` owns `knowledge.root`, stable identity, RLS, bounded local resolution, and authenticated self-service provisioning. It fulfills #519 and exposes no model tool.
- `knowledge-read/tools` owns live filesystem traversal, search/read behavior, tool registration, availability, persistence, and tenant-scoped integration. It fulfills #520.
- `knowledge-read/product` owns browser acceptance and ship-time documentation and completes parent #213.
- `knowledge-read/archive` is created only after the implementation stack is verified. It syncs the delta specs and archives this change as a separate final layer.

If a higher-layer test exposes a lower-layer defect, check out the owning branch, fix and commit it there, run `gh stack rebase --upstack`, then return with `gh stack top`. Do not hide lower-layer fixes in the top PR.

## 0. Initialize and Maintain the Stack

- [x] 0.1 Start from `master`, confirm `origin/master` is the trunk and `remote.pushDefault` is configured, enable Git rerere, then create and publish `knowledge-read/proposal` before writing implementation code.
- [x] 0.2 Create `knowledge-read/storage` directly above the proposal layer and keep it empty until the revised proposal is committed, published, and revalidated.
- [ ] 0.3 After committing each implementation layer, create only its immediate successor with `gh stack add`; carry no uncommitted changes across a layer boundary.
- [ ] 0.4 Inspect ownership and bases with `gh stack view --json`; publish updates with `gh stack submit --auto --open`; inspect again and never merge a layer without Leo's explicit permission.

## 1. `knowledge-read/storage`: Configuration, Identity, and Self-Service Provisioning

- [x] 1.1 Add failing instance-config tests for optional `knowledge.root`, absolute interpolated paths, closed-schema rejection, absent default, public-path omission, and configuration loading without filesystem probes; then implement the schema, typed configuration, loader, examples, and focused tests.
- [x] 1.2 Add the `knowledge_spaces` Drizzle schema with a globally stable opaque ID and unique owner linkage; generate the migration, hand-append `FORCE ROW LEVEL SECURITY` because Drizzle emits only ENABLE, and record the exception in the API migration ledger with regeneration requirements. Verify schema tests, migration regeneration, and real-Postgres absent-identity, cross-owner, and table-owner negative cases.
- [x] 1.3 Implement the tenant-scoped Knowledge Space repository from failing unit and integration tests; verify create-or-get concurrency, one-space-per-owner enforcement, explicit owner filters, portable logical projection without host or owner leakage, and unchanged identity across a local-binding projection round trip.
- [x] 1.4 Implement the trusted local resolver and bodyless `PUT /api/v1/me/knowledge-space` create-or-get endpoint from failing tests. Return only the stable logical ID; verify `@CurrentUser()` ownership, unauthenticated 401, selector-shaped payload rejection, stable-ID child allocation, idempotent retry after partial directory failure, containment, missing/unusable root behavior, and symlink/non-directory refusal. Regenerate and verify the committed OpenAPI document and Orval client without adding a management UI.
- [x] 1.5 Add focused API and real-Postgres integration coverage proving two owners provision distinct directories and cannot resolve or mutate each other's linkage or filesystem binding. Run affected API tests, typecheck, lint, and sequential build; commit only storage/provisioning files before creating `knowledge-read/tools`.

## 2. `knowledge-read/tools`: Live Search, Read, and Run Integration

- [x] 2.1 Write failing filesystem-adapter tests for stable-ID child containment, deterministic traversal, regular `.md` admission, traversal/backslash/control rejection, symlink components and entries, path-byte/component limits, disappearing directories, exact-byte SHA-256, invalid UTF-8, timeout, and abort behavior; then implement the narrow live-filesystem adapter.
- [x] 2.2 Write failing `knowledge_search` tests for case-insensitive literal matching, current modified/new files, deterministic per-path ordering, one match per file, first-line snippets, empty results, file and aggregate bounds, and 15,000-unit result preflight; then implement it and verify failures return no partial results.
- [x] 2.3 Write failing `knowledge_read` tests for exact case-sensitive path matching, live file contents, absolute/traversal/backslash/control paths, symlinks, missing/unsupported/invalid/oversized files, exact content hashes, and 15,000-unit result preflight; then implement it and verify successful results remain below the generic truncation cap.
- [x] 2.4 Add both immutable declarations to the static code-owned registry, then add the two missing runtime seams from failing tests: an API-side owner-aware code-owned candidate resolver inside the Run-binding RLS transaction, and a worker-side DI/trusted-context Knowledge resolver for static executors. Bind availability as `knowledge_space_not_configured` or `knowledge_space_unavailable` without a request-path probe; extend the closed availability/recovery vocabularies and verify registry immutability, allowlist, snapshots, recovery, timeout/abort, and mismatched-executor behavior.
- [x] 2.5 Add real-Postgres tool integration tests with two owners containing matching text, guessed/path-shaped identifiers, absent linkage, missing root configuration, unavailable directories, and absent/public identity; verify calls remain owner-scoped and leak no root path or other-owner existence signal.
- [x] 2.6 Verify successful path/hash attribution remains complete through Run events, assistant-message settlement, browser reconstruction, and the existing honest replay-degradation rules. Run affected API unit/integration tests, typecheck, lint, and sequential build; commit only tool/runtime files before creating `knowledge-read/product`.

## 3. `knowledge-read/product`: Hosted Acceptance and Ship Documentation

- [x] 3.1 Extend the Playwright fixture to provision isolated per-worker Knowledge roots and owner spaces, populate live Markdown files without Git, and configure both tool IDs. Use a deterministic model fixture to verify a browser Chat finds a note, the existing generic structured-result rendering visibly includes its Knowledge-relative path, and the answer cites that path; add no dedicated citation component.
- [x] 3.2 Add browser or integration acceptance for two users with identical note text plus a newly changed file, traversal, symlink, oversized-operation, missing-root, and unavailable-directory failures. Cover a separate mounted worker and prove availability remains API-instance-independent while worker resolution fails closed.
- [x] 3.3 Update `SPEC.md`, `ROADMAP.md`, `CHANGELOG.md`, configuration examples, API/operator guidance, and deployment documentation to record self-service provisioning, live filesystem authority, root-mount requirements, response-time attribution, portable identity, and explicit Git deferral to #212.
- [x] 3.4 Run `pnpm --filter api test`, `pnpm --filter api test:integration`, `pnpm --filter api typecheck`, `pnpm --filter api lint`, `pnpm --filter api build`, the focused Playwright Knowledge tests, root `pnpm lint:ast-grep`, `pnpm lint:markdown`, `pnpm format:check`, and `git diff --check`; record environment failures separately and do not infer broader readiness from narrower checks.
- [ ] 3.5 Commit only product-acceptance and ship-documentation files, run `gh stack rebase --upstack` if a lower layer changed, return to the top, publish the implementation stack, and verify every PR diff contains only its named concern.

## 4. `knowledge-read/archive`: Sync and Archive

- [ ] 4.1 Only after tasks 1-3 pass and their PRs are published, create `knowledge-read/archive` above `knowledge-read/product`.
- [ ] 4.2 Run the `openspec-sync-specs` flow to merge this change's delta requirements into canonical specs, preserving unrelated canonical behavior.
- [ ] 4.3 Run the `openspec-archive-change` flow, validate the archived change and canonical specs strictly, and verify no active change remains under `openspec/changes/add-personal-knowledge-read`.
- [ ] 4.4 Commit and publish only the sync/archive result as the final stacked PR layer. Do not merge any layer without Leo's explicit permission.
