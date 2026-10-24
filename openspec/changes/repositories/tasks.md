Track no issue: no GitHub issue exists for this change, and Leo decided on
2026-10-24 to proceed without one, as for `remote-machines`. No layer owns
`Closes #N`; each layer references the change by branch name instead. Read
[CONTRIBUTING](../../../CONTRIBUTING.md) for approval, publication, and merge
policy.

## Delivery stack

```text
master <- repositories/proposal <- repositories/schema-and-registration <- repositories/executor-git <- repositories/workspace-worktree <- repositories/finalize
```

- `repositories/proposal` (parent `master`): owns only `proposal.md`,
  `design.md`, the four delta spec files, this file, and the supporting
  research note with its index entries; estimated 600 to 900 authored lines.
- `repositories/schema-and-registration` (parent `repositories/proposal`):
  owns the four tables and their owner isolation, the remote normalization, the
  repository, alias, and checkout API with the local `git.inspect`, and the
  negative isolation tests; estimated 1,600 to 2,000 authored lines.
- `repositories/executor-git` (parent
  `repositories/schema-and-registration`): owns the five typed git methods on
  the protocol, the daemon, and the hub's local executor, plus the handshake
  `methods` list and the `machine_update_required` refusal; estimated 1,500 to
  2,000 authored lines.
- `repositories/workspace-worktree` (parent `repositories/executor-git`): owns
  the `worktree` field on `enter_workspace`, its naming and placement, its two
  permission decisions, adoption, the lease, the guarded removal route, and the
  operator documentation; estimated 1,500 to 2,000 authored lines.
- `repositories/finalize` (parent `repositories/workspace-worktree`): owns only
  spec synchronization, task records, and archive movement; estimated under 200
  authored lines.

Create and move between layers with `$gh-stack`; implement with
`$openspec-apply-change`. Implementation starts only after Leo approves the
published proposal revision. Each layer completes self-review (SR) of its
actual parent-relative draft diff before draft to ready, then the GitHub review
(GR) loop of bots and current-head CI per CONTRIBUTING. Generated churn
(Drizzle metadata, OpenAPI documents and clients) is reported separately from
authored size and counts zero toward the estimate.

`chat-start-location` builds on this change and starts only after this change
is canonical. The project page repository section, the checkout registration
form, and every picker belong to that change; this change ships the API and a
`git.inspect` that works for the local executor.

## 1. Proposal layer (`repositories/proposal`)

- [ ] 1.1 Validate the change with `pnpm exec openspec validate repositories --strict`, `pnpm lint:markdown`, `pnpm format:check`, and `git diff --check`, all passing
- [ ] 1.2 Run `$iterative-review-refinement` with at least two independent reviewers, verify each finding against code or specs, and commit each review round separately
- [ ] 1.3 Self-review the published draft PR diff, mark it ready, and obtain Leo's approval of the published revision

## 2. `repositories/schema-and-registration` — tables, isolation, normalization, owner API, local inspection (design D1, D2, D4)

- [ ] 2.1 Add `repositories`, `repository_aliases`, `checkouts`, and `worktree_leases` to `apps/api/src/db/schema/` with the columns, unique constraints, CHECK enumerations for `kind` and `origin`, and owner policies from design D1 and D2, generate the migration, and hand-append `ENABLE` and `FORCE ROW LEVEL SECURITY` per the `projects` precedent; verify `pnpm --filter api db:generate` reports no second diff, the migration applies to an empty database and to one that already holds projects and chats, and a query against `pg_class` shows `relforcerowsecurity` true for all four tables ("Repositories are owner-scoped and identified by their normalized remote", "Checkouts record where a repository exists on an executor", "Worktree checkouts are children of a main checkout", "Worktree leases are informational ownership receipts")
- [ ] 2.2 Add the pure remote normalization function with its unit tests: scheme and userinfo removal, host lowercasing with path case kept, one trailing `.git` and trailing slash removed, the `git@host:path` form, a URL that carries a token, and a string that is not a remote; verify a table-driven test proves `git@github.com:leon0399/llame.git` and `https://github.com/leon0399/llame` normalize equal and that no output contains a credential ("Repositories are owner-scoped and identified by their normalized remote")
- [ ] 2.3 Add `packages/git-executor` with `inspect` only: argv arrays, the fixed environment (`GIT_TERMINAL_PROMPT=0`, `LC_ALL=C`, `GIT_OPTIONAL_LOCKS=0`), a per-call timeout, and a typed result that carries bounded stderr; verify unit tests with real git in temporary repositories per the `temp-git-repo-tests` skill for toplevel, remotes, branch, head, a repository with no remote, a path that is not a repository, and a timeout
- [ ] 2.4 Add the repositories and aliases API (`POST`/`GET /api/v1/repositories`, `PATCH`/`DELETE /api/v1/repositories/:id`, `POST /api/v1/repositories/:id/aliases`) with DTOs, owner scoping, display-name segment validation, alias uniqueness, and OpenAPI regeneration; verify controller and service tests for creation, a duplicate normalized remote as a conflict, an invalid display name, alias declaration, and deletion, and a clean second OpenAPI generation ("Repositories are owner-scoped and identified by their normalized remote")
- [ ] 2.5 Add `POST /api/v1/checkouts`, `GET /api/v1/checkouts?repositoryId=`, and `DELETE /api/v1/checkouts/:id` for the local executor: registration inspects the path, records the canonical toplevel, fills the repository from the inspected origin, adopts a main checkout when none exists, accepts a repository or remote input only as a selector, and rejects a mismatch; verify integration tests for a first registration, a repeated registration as a conflict, an origin mismatch, a remote-less clone, a linked worktree recorded as a worktree row with its main clone as parent, and a `DELETE` that removes rows only ("Checkout registration inspects the path on its executor", "Worktree checkouts are children of a main checkout")
- [ ] 2.6 Add negative isolation integration tests: owner B cannot select, insert, update, or delete owner A's repositories, aliases, checkouts, or leases, and the API answers 404 for a foreign id; verify the tests fail with `42501` at the database layer before the API mapping ("Repository records are isolated per owner")
- [ ] 2.7 Verify the layer locally with `pnpm --filter api lint`, `typecheck`, and focused unit tests, `pnpm --filter api test:integration` for the new suites, `pnpm --filter git-executor test`, and a clean second OpenAPI generation
- [ ] 2.8 SR: self-review the parent-relative diff against `REVIEW_GUIDE.md` and this layer's tasks, fix accepted findings, then mark ready
- [ ] 2.9 GR: complete the ready-PR monitoring loop with terminal passing CI and no actionable unresolved feedback

## 3. `repositories/executor-git` — typed git on the protocol, the daemon, and the local executor (design D4, D6 inputs)

- [ ] 3.1 Add `git.inspect`, `git.worktreeAdd`, `git.worktreeList`, `git.worktreeRemove`, and `git.status` to `packages/machine-protocol` with typed parameters and results, and add the optional `methods` list to the `hello` result without changing `PROTOCOL_VERSION`; verify unit tests for the method constants, the parameter schemas, and that a `hello` result without `methods` still parses
- [ ] 3.2 Implement the five methods in `apps/machine/src` over `@workspace/git-executor`, with the root guard applied to every path and to the worktree directory before any git call, argv arrays, the fixed environment, a timeout, and a typed failure that carries bounded stderr; verify tests with real git in temporary repositories inside and outside a registered root, including `path_not_registered` before any git call, a dirty status, a status with and without an upstream, `worktreeAdd` success and failure, `worktreeList`, and `worktreeRemove` ("Machine daemons answer typed git methods", "Worktree directories on a Machine lie inside a registered root")
- [ ] 3.3 Implement the local executor side in `apps/api` over the same package and dispatch by executor id (`local` versus `machine:<name>`), so registration reaches a Machine through the protocol; verify integration tests with the daemon fixture for inspection on a Machine and `machine_unavailable` when the session cannot open ("Checkout registration inspects the path on its executor", "Executors expose typed git operations")
- [ ] 3.4 Verify the outdated-daemon boundary end to end: a daemon whose `hello` result lists no git methods makes `git.inspect` fail as `machine_update_required` before any request, while `read` on that Machine succeeds; verify the hub test asserts both and the operator-facing message ("Machine daemons answer typed git methods", "Executors expose typed git operations")
- [ ] 3.5 Document the daemon update step and the typed git surface in `docs/product/operator/machines.md` and `docs/product/operator/repositories.md`, and add the dated `CHANGELOG.md` entry; verify `pnpm lint:markdown`
- [ ] 3.6 Verify the layer locally with `pnpm --filter machine test`, `pnpm --filter machine build`, `pnpm --filter machine-protocol test`, `pnpm --filter git-executor test`, `pnpm --filter api typecheck`, and the touched integration suites
- [ ] 3.7 SR: self-review the parent-relative diff against `REVIEW_GUIDE.md` and this layer's tasks, fix accepted findings, then mark ready
- [ ] 3.8 GR: complete the ready-PR monitoring loop with terminal passing CI and no actionable unresolved feedback

## 4. `repositories/workspace-worktree` — the `worktree` field, adoption, leases, guarded removal, docs (design D3, D5, D6)

- [ ] 4.1 Add the optional `worktree` field to the strict `enter_workspace` schema, plus the pure placement and naming module: the sibling `.llame-worktrees` directory, the `worktree_base` override, the generated name, the `/` to `-` slug, the `llame/<name>` branch rule, and the HEAD base default; verify unit tests for each rule, for a requested name that contains `/`, and for both the local and `machine://` forms of the source clone, and update every fixture that enumerates `enter_workspace` arguments ("Workspace entry can create a worktree of the source clone", "Worktree names and branches follow one naming rule")
- [ ] 4.2 Decide the submitted source clone as the `path` decision and the computed worktree directory as the `canonical` decision, both before any git call, and record the canonical decision with policy provenance; verify tests that a reject on the computed directory refuses before `git worktree add` runs, that a reject on the source clone refuses before any probe, and that a bypass attempt admits both without evaluation ("Worktree entry decides the source clone and the worktree path")
- [ ] 4.3 Refuse a Machine worktree directory outside every registered root before any git call, using the daemon guard as the authority and not the hub's cached root list; verify a test with a display name that contains `..` and one with a symlinked parent, each answered as `path_not_registered` ("Worktree directories on a Machine lie inside a registered root")
- [ ] 4.4 Complete the success path: `git.worktreeAdd`, the worktree checkout row with origin `created` and the source main row as parent, the lease row, and the binding through the existing fence with narration and Workspace MCP start; verify integration tests for the new directory, the branch, the base commit in the result, one generation bump, one narration, and a same-root no-op when the source clone is already bound ("Workspace entry can create a worktree of the source clone", "Worktree leases are informational ownership receipts")
- [ ] 4.5 Adopt an unregistered source clone in the same call: inspection creates the repository by normalized remote or remote-less, and a main checkout with origin `adopted`, with no project link; verify tests for a remote clone, a remote-less clone, and a second entry that reuses both rows without a duplicate ("An unregistered source clone is adopted on worktree entry")
- [ ] 4.6 Add the failure boundary: `git worktree add` failure returns `worktree_failed` with redacted stderr, writes no rows, and leaves the binding and `workspace_generation` unchanged; verify tests for a branch that already exists, a directory that already exists, and a non-repository source path ("Worktree creation failure leaves the binding unchanged")
- [ ] 4.7 Add `DELETE /api/v1/checkouts/:id/worktree` with the guard sequence (dirty refused, unpushed refused, unknown upstream refused), then `git worktreeRemove`, then row and lease deletion, and add the row-only cascades for repository and main-checkout deletion; verify tests for each refusal with the directory still present, the success case, a repository delete that removes checkout and lease rows while the directories remain, and a main-checkout delete that removes its worktree rows ("Worktree removal is owner-initiated and guarded", "Repository and checkout deletion cascades records and never files")
- [ ] 4.8 Write `docs/product/operator/repositories.md` (the catalog, registration, placement, naming, the guard, and the cascade rule), update `docs/product/reference/tools/enter-workspace.md` and both indexes, add the repository catalog to the placement section of `SPEC.md`, and add the dated `CHANGELOG.md` entry; verify `pnpm lint:markdown`
- [ ] 4.9 Verify the layer locally with `pnpm --filter api lint`, `typecheck`, focused unit tests, the touched integration suites, `pnpm --filter machine test`, and `pnpm --filter api test:coverage` for the new modules
- [ ] 4.10 SR: self-review the parent-relative diff against `REVIEW_GUIDE.md` and this layer's tasks, fix accepted findings, then mark ready
- [ ] 4.11 GR: complete the ready-PR monitoring loop with terminal passing CI and no actionable unresolved feedback

## 5. Finalize readiness (`repositories/finalize`)

- [ ] 5.1 Enter `repositories/finalize` with `$gh-stack` before any canonical spec is written, then run `$openspec-sync-specs` and verify `openspec/specs/repositories/spec.md`, `workspace-entry`, `remote-machines`, and `tool-call-permissions` each match their delta, including the Purpose section of the new capability
- [ ] 5.2 Verify every task above is checked, `pnpm exec openspec validate --specs` and `pnpm exec openspec validate --all` pass, and record any strict-validation failure with evidence that it also fails on `master`
- [ ] 5.3 Verify `pnpm lint:markdown`, `pnpm format:check`, and `git diff --check` pass on the finalize diff, and record the archive readiness in the PR body

## Workflow follow-up

- Archive the change with `$openspec-archive-change` after 5.3, and preserve the
  checked task history.
- After archive movement, self-review the finalize diff, mark the PR ready, and
  run the ready-PR monitoring loop as the finalize SR and GR gates.
- Merge the stack through `$gh-stack` only with Leo's explicit permission.
