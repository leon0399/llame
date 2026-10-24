Track no issue: no GitHub issue exists for this change, and Leo decided on
2026-10-24 to proceed without one, as for `remote-machines`. No layer owns
`Closes #N`; each layer references the change by branch name instead. Read
[CONTRIBUTING](../../../CONTRIBUTING.md) for approval, publication, and merge
policy.

## Delivery stack

Exception to the stack rules, named and one-off: Leo decided on 2026-10-24 that
this proposal and `chat-start-location` publish as ONE PR from
`proposals/repositories-and-chat-start-location`, without `$gh-stack`, with the
research note included, as `remote-machines` did. The measured authored size is
about 1,300 lines for this change's proposal, design, deltas, and tasks, plus
about 410 lines for the research note; `chat-start-location` adds about 1,000.
Splitting the proposal into two PRs is rejected. Implementation stacks start
later from `master`, with `$gh-stack` and one `<change>/...` branch per layer.

```text
proposals/repositories-and-chat-start-location (one PR, both changes, parent master)
master <- repositories/schema-and-registration <- repositories/executor-git <- repositories/workspace-worktree <- repositories/finalize
```

- `proposals/repositories-and-chat-start-location` (parent `master`): owns only
  `proposal.md`, `design.md`, the delta spec files, this file, and the
  supporting research note with its index entries, for this change and for
  `chat-start-location`; measured about 1,300 authored lines here, and
  publishes as one PR without `$gh-stack`.
- `repositories/schema-and-registration` (parent `master`): owns the four
  tables with their composite keys and cascades, the remote normalization, the
  repository, alias, and checkout API with the local `git.inspect`, the gates,
  the isolation tests, and the operator doc; estimated 1,600 to 2,000 authored
  lines, because four tables, six routes, and their tests fit one review.
- `repositories/executor-git` (parent
  `repositories/schema-and-registration`): owns the five typed git methods on
  the protocol, the daemon, and the hub's local executor, the `HelloResult`
  reader, and the handshake `methods` list with the `machine_update_required`
  refusal; estimated 1,500 to 2,000 authored lines, because the methods share
  one package and one test fixture.
- `repositories/workspace-worktree` (parent `repositories/executor-git`): owns
  the `worktree` field on `enter_workspace`, its naming, placement, and three
  permission decisions, the fenced transaction, adoption, the lease, the
  guarded removal route, and the remaining docs; estimated 1,500 to 2,000
  authored lines, because the placement and failure tests carry the size.
- `repositories/finalize` (parent `repositories/workspace-worktree`): owns only
  spec synchronization, task records, and archive movement; estimated under 200
  authored lines, because it moves and re-checks files only.

Create and move between implementation layers with `$gh-stack`; implement with
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

## 1. Proposal layer (`proposals/repositories-and-chat-start-location`)

- [ ] 1.1 Validate the change with `pnpm exec openspec validate repositories --strict`, `pnpm lint:markdown`, `pnpm format:check`, and `git diff --check`, all passing
- [ ] 1.2 Run `$iterative-review-refinement` with at least two independent reviewers, verify each finding against code or specs, and commit each review round separately
- [ ] 1.3 Self-review the published draft PR diff, mark it ready, and obtain Leo's approval of the published revision

## 2. `repositories/schema-and-registration` — tables, isolation, normalization, owner API, local inspection (design D1, D2, D4)

- [ ] 2.1 Add `repositories`, `repository_aliases`, `checkouts`, and `worktree_leases` to `apps/api/src/db/schema/` with the columns; unique `(owner_user_id, id)` on every parent, unique `(owner_user_id, executor_id, path)` on checkouts, the CHECK enumerations for `kind` and `origin`, the composite owner foreign keys of design D2 (checkouts to repositories, a worktree checkout to its parent, leases to checkouts, leases to chats, aliases to repositories) each with `ON DELETE CASCADE`, and owner policies declared with `pgPolicy` plus `.enableRLS()`; generate the migration and hand-append only `FORCE ROW LEVEL SECURITY` with the header rationale that `apps/api/src/db/AGENTS.md` requires; verify `pnpm --filter api db:generate` reports no second diff, the migration applies to an empty database and to one that already holds projects and chats, a `pg_class` query shows `relforcerowsecurity` true for all four tables, an insert that names another owner's repository fails with `23503`, a repository delete drops its checkout and lease rows, and a main-checkout delete drops its worktree rows ("Repositories are owner-scoped records with a display name", "Checkouts record one repository on one executor", "Repository and checkout deletion cascades records and never files")
- [ ] 2.2 Add the pure remote normalization function with its unit tests: scheme and userinfo removal, host lowercasing with path case kept, one trailing `.git` and trailing slash removed, the `git@host:path` form, a URL that carries a token, and a string that is not a remote; verify a table-driven test proves `git@github.com:leon0399/llame.git` and `https://github.com/leon0399/llame` normalize equal and that no output contains a credential ("The canonical remote comes from the `origin` remote")
- [ ] 2.3 Add `packages/git-executor` with `inspect` only: argv arrays with `--end-of-options` before caller values, the fixed environment (`GIT_TERMINAL_PROMPT=0`, `LC_ALL=C`, `GIT_OPTIONAL_LOCKS=0`), `-c core.hooksPath=<empty dir>`, `-c core.fsmonitor=false`, a per-call timeout, an `invalid_input` refusal for a value that starts with `-`, and a typed result that carries bounded standard error; verify unit tests with real git in temporary repositories per the `temp-git-repo-tests` skill for toplevel, `commonDir`, `linked` and `mainWorktree` on a linked worktree, remotes, branch, head, a repository with no remote, a path that is not a repository, a timeout, and a repository whose config sets `core.fsmonitor` and a hook ("Executors expose typed git operations", "Git calls cannot run repository hooks or monitors", "Git calls place caller values after `--end-of-options`")
- [ ] 2.4 Add the repositories and aliases API (`POST`/`GET /api/v1/repositories`, `PATCH`/`DELETE /api/v1/repositories/:id`, `POST /api/v1/repositories/:id/aliases`) with DTOs, owner scoping, display-name segment validation, alias uniqueness, and OpenAPI regeneration; verify controller and service tests for creation, a duplicate normalized remote as a conflict, an invalid display name, alias declaration, and deletion, and a clean second OpenAPI generation ("Repositories are owner-scoped records with a display name", "The canonical remote comes from the `origin` remote")
- [ ] 2.5 Add the checkout API for the local executor: `POST /api/v1/checkouts`, `GET /api/v1/checkouts?repositoryId=` with each worktree row listing its lease chat and the ids of the owner's chats whose binding root equals its path, `PATCH /api/v1/checkouts/:id` with `worktreeBase` on a main row only, and `DELETE /api/v1/checkouts/:id`; gate every route that runs git on a configured executor (a non-Machine id must equal the serving process's `tools.nativeExecutorId`, else 503 `executor_unavailable`), on `enter_workspace` in `tools.allowed`, and on the submitted and canonical paths passing the `enter_workspace` group in `default` mode (403 `permission_denied`); map failures as 404, 409, 422, 403, 503 with a typed code, and 502 `git_failed` with redacted standard error; registration inspects the path, stores the canonical toplevel or Machine locator, fills the repository from the inspected origin, adopts a main checkout when none exists, accepts a repository or remote input only as a selector, and rejects a mismatch; verify integration tests for a first registration, a repeated registration as a conflict, an origin mismatch, a remote-less clone, a linked worktree recorded as a worktree row with its main clone as parent, a Machine checkout path equal to a binding root, `PATCH` on a main row, `PATCH` with a relative base as 422, `PATCH` on a worktree row as 422, an unallowed path as 403 with no git call, a mismatched local executor id as 503, the 502 mapping for a git failure and a timeout, a `GET` that lists the lease chat and two bound chats, and a `DELETE` that removes rows only ("A Machine checkout stores the canonical Machine locator", "A main checkout can carry a worktree base directory", "Checkout lists report the lease chat and every bound chat", "Checkout registration inspects the path on its executor", "Registration and removal need a configured executor", "Registration and removal obey the host access policy", "Registration and removal map failures to typed statuses", "Worktree checkouts are children of a main checkout")
- [ ] 2.6 Add negative isolation integration tests: a cross-owner `SELECT` returns no rows, a cross-owner `UPDATE` or `DELETE` affects 0 rows and leaves owner A's rows unchanged, and an `INSERT` with owner A's owner id fails with `42501`; cover a checkout that names owner A's `repositoryId`, an alias declared on owner A's repository, a worktree parent on owner A's checkout, and a lease that names owner A's chat, and verify the API answers 404 for a foreign id before the mapping ("Repository records are isolated per owner")
- [ ] 2.7 Create `docs/product/operator/repositories.md` with the catalog and the registration API, and add the dated `CHANGELOG.md` entry; verify `pnpm lint:markdown`
- [ ] 2.8 Verify the layer locally with `pnpm --filter api lint`, `typecheck`, and focused unit tests, `pnpm --filter api test:integration` for the new suites, `pnpm --filter git-executor test`, and a clean second OpenAPI generation
- [ ] 2.9 SR: self-review the parent-relative diff against `REVIEW_GUIDE.md` and this layer's tasks, fix accepted findings, then mark ready
- [ ] 2.10 GR: complete the ready-PR monitoring loop with terminal passing CI and no actionable unresolved feedback

## 3. `repositories/executor-git` — typed git on the protocol, the daemon, and the local executor (design D4, D6 inputs)

- [ ] 3.1 Add `git.inspect`, `git.worktreeAdd`, `git.worktreeList`, `git.worktreeRemove`, and `git.status` to `packages/machine-protocol` with typed parameters and results, and add the optional `methods` list to the `hello` result without changing `PROTOCOL_VERSION`; extend `HelloResult` and its `readHelloResult` reader in `apps/api/src/machines/machine-results.ts` to carry the list, because the reader rebuilds the result and would drop it; verify unit tests for the method constants, the parameter schemas, an old `hello` result without `methods` that still parses, a new result with `methods`, and the path from `session.hello` to the git-call check
- [ ] 3.2 Implement the five methods in `apps/machine/src` over `@workspace/git-executor`, with the root guard applied to every path and to the worktree directory before any git call, argv arrays, the fixed environment, a timeout, and a typed failure that carries bounded standard error; verify tests with real git in temporary repositories inside and outside a registered root, including `path_not_registered` before any git call, a dirty status, a status with and without an upstream, `worktreeAdd` success and failure, `worktreeList`, and `worktreeRemove` ("Machine daemons answer typed git methods", "Worktree directories on a Machine lie inside a registered root")
- [ ] 3.3 Implement the local executor side in `apps/api` over the same package and dispatch by executor id: a value equal to the serving process's `tools.nativeExecutorId` runs in-process, and `machine:<name>` reaches a Machine through the protocol; an id that matches neither, or a request when `tools.nativeExecutorId` is unset, fails as 503 `executor_unavailable`; verify integration tests with the daemon fixture for inspection on a Machine, `machine_unavailable` when the session cannot open, and `executor_unavailable` for an unmatched id and for an unset native id ("Checkout registration inspects the path on its executor", "Executors expose typed git operations", "Registration and removal need a configured executor")
- [ ] 3.4 Verify the outdated-daemon boundary end to end: a daemon whose `hello` result lists no git methods makes `git.inspect` fail as `machine_update_required` before any request, while `read` on that Machine succeeds, and registration answers 503 with `machine_update_required` and stores no row; verify the hub test asserts both paths and the operator-facing message ("Machine daemons answer typed git methods", "Executors expose typed git operations", "Registration and removal map failures to typed statuses")
- [ ] 3.5 Extend `docs/product/operator/repositories.md` with the daemon update step and the typed git surface, and add to `docs/product/operator/machines.md` the note that tells operators to register the parent directory or set `worktree_base` inside a root for Machine worktrees; verify `pnpm lint:markdown`
- [ ] 3.6 Verify the layer locally with `pnpm --filter machine test`, `pnpm --filter machine build`, `pnpm --filter machine-protocol test`, `pnpm --filter git-executor test`, `pnpm --filter api typecheck`, and the touched integration suites
- [ ] 3.7 SR: self-review the parent-relative diff against `REVIEW_GUIDE.md` and this layer's tasks, fix accepted findings, then mark ready
- [ ] 3.8 GR: complete the ready-PR monitoring loop with terminal passing CI and no actionable unresolved feedback

## 4. `repositories/workspace-worktree` — the `worktree` field, adoption, leases, guarded removal, docs (design D3, D5, D6)

- [ ] 4.1 Add the optional `worktree` field to the strict `enter_workspace` schema, plus the pure placement and naming module: the source clone as the toplevel that `git.inspect` reports, the sibling `.llame-worktrees` directory, the `worktree_base` override, the deepest-existing-ancestor canonicalization, the generated name, the `/` to `-` slug, the `llame/<name>` branch rule, and the HEAD base default; update the model-facing description `apps/api/src/prompts/tools/enter_workspace.md` to describe `worktree.name` and `baseRef`, placement, and the worktree path decision; verify unit tests for each rule, for a requested name that contains `/`, a name that starts with `-`, a name with a `.` or `..` segment, `baseRef` `--force`, and for both the local and `machine://` forms of the source clone, and update every fixture that enumerates `enter_workspace` arguments ("Workspace entry can create a worktree of the source clone", "Worktree names, branches, and base refs follow one rule", "Worktree placement follows the source clone and its worktree base")
- [ ] 4.2 Decide in order: the submitted source clone as the `path` decision before any probe, the canonical source clone by `realpath` before any git call except the read-only `git.inspect`, and the computed worktree directory before `git.worktreeAdd` and any write; record the source and worktree canonical decisions with policy provenance; verify tests that a reject on the submitted path refuses before any probe, a reject on the source clone refuses before any git call, a reject on the computed directory refuses before `git worktree add` runs, a symlinked source path and a symlinked `.llame-worktrees` parent each decide on the canonical form, a real-path difference after the add removes the worktree and fails `worktree_failed` with the binding unchanged, and a bypass attempt admits all three without evaluation ("Worktree entry decides the submitted path before any probe", "Worktree entry decides the source clone before any git call", "Worktree entry decides the canonical worktree directory", "Worktree creation verifies the decided path")
- [ ] 4.3 Refuse a Machine worktree directory outside every registered root before any git call, applying the registered-root rule with its nearest existing ancestor and using the daemon guard as the authority, not the hub's cached root list; verify a test with a display name that contains `..`, one with a symlinked parent, and one with a symlinked `.llame-worktrees`, each answered as `path_not_registered` ("Worktree directories on a Machine lie inside a registered root")
- [ ] 4.4 Complete the success path: `git.worktreeAdd`, the worktree checkout row with origin `created` and the source main row as parent, the lease row, and the binding through the existing fence with narration and Workspace MCP start; verify integration tests for the new directory, the branch, the base commit in the result, one generation bump, one narration, a Chat already bound to the source clone that calls with `worktree` and switches the binding with one increment, and a no-op only for a call without `worktree` into the same root ("Workspace entry can create a worktree of the source clone", "Worktree leases are informational ownership receipts")
- [ ] 4.5 Adopt an unregistered source clone in the same call: inspection creates the repository by normalized remote or remote-less, and a main checkout with origin `adopted`, with no project link, and a source that git reports as a linked worktree is adopted as a worktree row under its main clone; verify tests for a remote clone, a remote-less clone, a linked-worktree source, and a second entry that reuses both rows without a duplicate ("An unregistered source clone is adopted on worktree entry")
- [ ] 4.6 Add the failure boundary and the atomic commit: run the checkout, lease, adopted, and binding writes in one fenced transaction keyed by the tool call id, add a `worktree` operation to both native-attempt unions, and replay the recorded result on a retry; a `git worktree add` failure returns `worktree_failed` with redacted standard error, writes no repository, checkout, or lease row, and leaves the binding and `workspace_generation` unchanged; a fence lost after the add or a lost Machine link after the add was sent writes no rows, keeps the binding, and reports `outcome_unknown` for the lost link; verify tests for a branch that already exists, a directory that already exists, a non-repository source path, a git timeout, an offline Machine (`machine_unavailable`), an outdated daemon (`machine_update_required`), adoption followed by a failed add that leaves no repository or checkout, a fence loss after the add, and a queue retry after a committed entry that binds the same root and creates no second worktree ("Worktree creation failure leaves the binding unchanged", "Worktree entry is fenced and atomic")
- [ ] 4.7 Add `DELETE /api/v1/checkouts/:id/worktree` with the gates of task 2.5, the guard sequence (dirty refused, unpushed refused, unknown upstream refused), then `git.worktreeRemove`, then row and lease deletion; verify tests for each refusal with the directory still present, an unallowed path that starts no git call, a repository whose config sets `core.fsmonitor` or a hook that never starts a process, and the success case ("Worktree removal is owner-initiated and guarded", "Registration and removal obey the host access policy", "Git calls cannot run repository hooks or monitors")
- [ ] 4.8 Extend `docs/product/operator/repositories.md` with placement, naming, the guard, and the cascade rule, update `docs/product/reference/tools/enter-workspace.md` and both indexes, add the repository catalog to the placement section of `SPEC.md`, and add this layer's dated `CHANGELOG.md` entry; verify `pnpm lint:markdown`
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
