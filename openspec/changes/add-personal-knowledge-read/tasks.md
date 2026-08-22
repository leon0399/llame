## Delivery Stack

Implement this one OpenSpec change as one linear five-PR stack:

```text
(master) <- knowledge-read/proposal <- knowledge-read/storage <- knowledge-read/git <- knowledge-read/tools <- knowledge-read/product
```

- `knowledge-read/proposal` owns only this complete OpenSpec change and introduces no application behavior.
- `knowledge-read/storage` owns instance configuration, portable identity, PostgreSQL linkage, and RLS. It exposes no Knowledge tool.
- `knowledge-read/git` owns the native-Git adapter, repository admission, provisioning, bootstrap, and bounded object reads. It exposes no model tool.
- `knowledge-read/tools` owns search/read behavior, tool registration, availability, persistence, and tenant-scoped integration.
- `knowledge-read/product` owns browser acceptance and ship-time documentation. Issue #212 remains a separate future proposal and stack.

If a higher-layer test exposes a lower-layer defect, check out the owning branch, fix and commit it there, run `gh stack rebase --upstack`, then return with `gh stack top`. Do not hide lower-layer fixes in the top PR.

## 0. Initialize and Maintain the Stack

- [x] 0.1 Start from `master`, confirm `origin/master` is the trunk and `remote.pushDefault` is configured, enable Git rerere, then create the bottom proposal branch with `gh stack init knowledge-read/proposal` before writing implementation code.
- [ ] 0.2 After committing the proposal, create each implementation branch only when beginning that layer: `gh stack add knowledge-read/storage`, `gh stack add knowledge-read/git`, `gh stack add knowledge-read/tools`, then `gh stack add knowledge-read/product`; carry no uncommitted changes across a layer boundary.
- [ ] 0.3 Inspect stack ownership and bases only with `gh stack view --json`. After the complete stack passes its checks, publish it with `gh stack submit --auto --open`, inspect it again with `gh stack view --json`, and do not merge any layer without Leo's explicit permission.

## 1. `knowledge-read/storage`: Configuration, Identity, and Owner Linkage

- [ ] 1.1 Add failing instance-config tests for the closed `knowledge.sources` schema, source-key pattern, absolute interpolated roots, empty default, public-path omission, and HTTP-only logical declarations without filesystem probes; then implement the schema, typed configuration, loader, examples, and verify the focused config test suite passes.
- [ ] 1.2 Add the `knowledge_spaces` Drizzle schema with a globally stable opaque `knowledge_space_id`, unique owner/source linkage, and a generated migration including ENABLED and FORCED owner RLS; verify schema tests, migration regeneration, and the real-Postgres absent-identity, cross-owner, and table-owner negative cases pass.
- [ ] 1.3 Implement the tenant-scoped Knowledge Space repository and logical/private binding projections from failing unit and integration tests; verify exact-link idempotency, conflicting replacement refusal, owner-filter defense-in-depth, omission of hosted owner/source data from portable logical results, and unchanged Knowledge Space identity across a local-binding projection round trip.
- [ ] 1.4 Run the affected API unit/integration tests, typecheck, lint, and sequential build; commit only storage-layer files before creating `knowledge-read/git`.

## 2. `knowledge-read/git`: Repository Adapter and Trusted Provisioning

- [ ] 2.1 Add Git to the Nix development shell as a `runs`-worker/provisioning runtime dependency; implement a source-aware worker startup diagnostic and verify no-source and HTTP-only processes start without Git while configured Run consumers report a missing executable loudly.
- [ ] 2.2 Write failing repository fixtures for exact non-bare top-level validation, accepted-ref resolution, one-OID-per-operation behavior, and dirty/untracked working-tree exclusion; then implement the fixed-argument `execFile` Git adapter and verify all content is read through enumerated tree/blob OIDs.
- [ ] 2.3 Implement the operator-only provisioning entrypoint accepting owner ID, configured source key, and a `refs/heads/` ref that passes native complete-ref validation, with no HTTP registration surface; verify focused tests reject unknown users/sources, `HEAD`, short names, tags, revision/peel/reflog expressions, other malformed refs, cross-owner reuse, and replacement while an exact retry succeeds.
- [ ] 2.4 Implement trusted empty-source bootstrap with source-scoped advisory locking, system-authored empty commit creation, compare-and-swap accepted-ref publication, and linkage publication afterward; verify concurrent provisioning and retry-after-partial-publication tests converge on one accepted history.
- [ ] 2.5 Add adversarial tests for non-empty non-repositories, nested and bare repositories, unborn repositories with files, missing accepted refs, malicious ref text, disappearing mounts, and duplicate canonical roots; implement fail-closed source validation, return `knowledge_revision_unavailable` for an accepted ref that cannot resolve to a commit, and verify none of these cases creates or moves a ref.
- [ ] 2.6 Add boundary tests for tree-entry and path-byte/component limits, invalid Git modes, and committed symlink/submodule entries; implement bounded tree admission and blob-by-OID reading and verify failures return no working-tree content or host details.
- [ ] 2.7 Run the adapter/provisioning unit and real-Postgres integration tests, typecheck, lint, and sequential API build; commit only Git/provisioning-layer files before creating `knowledge-read/tools`.

## 3. `knowledge-read/tools`: Search, Read, and Run Integration

- [ ] 3.1 Write failing unit tests for `knowledge_search` input validation, case-insensitive literal matching, deterministic per-path ordering, one match per file, first-line snippets, empty-result provenance, Markdown-file count, individual/aggregate byte bounds, 15,000-unit serialized-result preflight, UTF-8, timeout, and abort behavior; then implement the tool and verify limit failures return no partial results.
- [ ] 3.2 Write failing unit tests for `knowledge_read` path validation and exact case-sensitive tree matching, including absolute/traversal/backslash/control paths, `.md` admission, symlinks, invalid UTF-8, missing and oversized blobs, and 15,000-unit serialized-result preflight; then implement the tool and verify Knowledge successes remain below the generic 16,000-unit truncation cap.
- [ ] 3.3 Add both tools to the code-owned registry with trusted `ToolContext.userId` resolution and untrusted/stale-content framing; bind owner-specific accept-time availability under RLS as `knowledge_space_not_configured` or `knowledge_source_unavailable` without a request-path filesystem probe; extend the closed manifest parser, persisted DTO validation, model-safe label map, and recovery map with `knowledge_space_configured` and `knowledge_source_restored`; verify both unavailable-to-available transitions, allowlist exclusion, exact declaration snapshots, mismatched-executor refusal, timeout/abort handling, and tool inputs containing no owner/resource/source/ref/root selector.
- [ ] 3.4 Add real-Postgres tool integration tests with two owners whose repositories contain matching text, guessed/path-shaped identifiers, absent linkage, unavailable source, and public/empty identity; verify each successful or failed call remains owner-scoped and leaks no source key, host path, Git stderr, or other-owner existence signal.
- [ ] 3.5 Verify successful search/read provenance remains complete through Run event persistence, assistant-message settlement, and browser reload; verify later replay either retains the complete pair, clears its payload, or omits the complete pair under the existing 8,000-unit pair and 32,000-unit turn/ledger budgets, adding only the minimal integration coverage not already supplied by generic tool-loop tests.
- [ ] 3.6 Run the affected API unit/integration tests, typecheck, lint, and sequential build; commit only tool/runtime-layer files before creating `knowledge-read/product`.

## 4. `knowledge-read/product`: Hosted Acceptance and Ship Documentation

- [ ] 4.1 Extend the Playwright fixture to provision isolated per-worker Git Knowledge Spaces and configure both tool IDs without sharing host locations with the browser; use a deterministic model fixture to verify a browser Chat finds a committed note, the structured tool result and answer cite its repository-relative path, and an uncommitted conflicting note remains excluded.
- [ ] 4.2 Add browser or integration acceptance for two users with identical note text plus traversal, symlink, oversized-operation, and missing-source failures; cover an HTTP-only `LLAME_WORKER_PROFILE=web` API declaring logical keys without accessible mounts plus a separate mounted worker, and prove availability is API-instance-independent while a misconfigured worker fails only at execution; verify every case is closed, tenant-isolated, and visible as the intended structured outcome. Keep concurrent-bootstrap convergence in task 2.4.
- [ ] 4.3 Update `SPEC.md`, `ROADMAP.md`, `CHANGELOG.md`, configuration examples, API/operator guidance, and deployment documentation to record the shipped read boundary, full logical-key declarations on every turn-authoring API, Git plus full source mounts on every `runs` consumer, private/portable split, and explicit exclusions.
- [ ] 4.4 Run `pnpm --filter api test`, `pnpm --filter api test:integration`, `pnpm --filter api typecheck`, `pnpm --filter api lint`, `pnpm --filter api build`, the focused Playwright Knowledge tests, root `pnpm lint:ast-grep`, `pnpm lint:markdown`, `pnpm format:check`, and `git diff --check`; record any environment failure separately and do not claim broader release readiness from narrower checks.
- [ ] 4.5 Commit only product-acceptance and ship-documentation files, run `gh stack rebase --upstack` if any lower layer changed during acceptance, return to the top with `gh stack top`, publish with task 0.3, and verify each PR diff contains only its named concern.
