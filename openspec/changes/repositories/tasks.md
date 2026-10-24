Track no issue: no GitHub issue exists for this change, and Leo decided on
2026-10-24 to proceed without one, as for `remote-machines`. No layer owns
`Closes #N`. Each layer references the change by branch name instead. Read
[CONTRIBUTING](../../../CONTRIBUTING.md) for approval, publication, and merge
policy.

## Delivery stack

Exception to the stack rules, named and one-off. Leo decided on 2026-10-24 that
both changes publish as ONE proposal PR from
`proposals/repositories-and-chat-start-location`. That PR uses no `$gh-stack`
and includes the research note, as `remote-machines` did. On 2026-10-25 he
decided that implementation is one chain from `master`. The chain uses
`$gh-stack`, one `<change>/...` branch per layer, and each change's finalize.

`wc -l` measures about 2,200 authored lines for `repositories` and about 1,800
for `chat-start-location`. The research note adds about 420. A split of the
proposal into two PRs is rejected.

```text
master <- proposals/repositories-and-chat-start-location <- repositories/schema-and-registration <- repositories/executor-git <- repositories/workspace-worktree <- repositories/finalize <- chat-start-location/project-links-api <- chat-start-location/project-links-ui <- chat-start-location/chat-creation <- chat-start-location/composer-chip <- chat-start-location/composer-entry-points <- chat-start-location/finalize
```

- `proposals/repositories-and-chat-start-location` (parent `master`): owns only `proposal.md`, `design.md`, the delta spec files, this file, and the research note that supports it. The note keeps its index entries, for this change and for `chat-start-location`. The layer measures about 2,200 authored lines here. It publishes as one PR without `$gh-stack`.
- `repositories/schema-and-registration` (parent `proposals/repositories-and-chat-start-location`): owns the four tables with their composite keys and cascades, and the remote normalization. It also owns the repository, alias, and checkout API with the local `git.inspect`. The gates, the isolation tests, and the operator doc belong here too. It estimates 1,600 to 2,000 authored lines, because four tables, six routes, and their tests fit one review.
- `repositories/executor-git` (parent `repositories/schema-and-registration`): owns the five typed git methods on the protocol, the daemon, and the hub's local executor. It also owns the `HelloResult` reader. The handshake `methods` list and its `machine_update_required` refusal belong here. It estimates 1,500 to 2,000 authored lines, because the methods share one package and one test fixture.
- `repositories/workspace-worktree` (parent `repositories/executor-git`): owns the `worktree` field on `enter_workspace`, its name rule, placement, and four permission decisions. It also owns the atomic transaction under the fence, adoption, and the lease. The guarded removal route and the remaining docs belong here too. It estimates 1,500 to 2,000 authored lines, because the placement and failure tests carry the size.
- `repositories/finalize` (parent `repositories/workspace-worktree`): owns only spec synchronization, task records, and archive movement. It estimates under 200 authored lines, because it moves and re-checks files only.

Create and move between implementation layers with `$gh-stack`. Implement with
`$openspec-apply-change`. Implementation starts only after Leo approves the
published proposal revision. Each layer completes self-review (SR) of its actual
parent-relative draft diff before draft to ready. Then it runs the GitHub review
(GR) loop of bots and current-head CI per CONTRIBUTING. Generated churn (Drizzle
metadata, OpenAPI documents and clients) is reported separately from authored
size and counts zero toward the estimate.

The `chat-start-location` layers follow `repositories/finalize` in the same
chain, and they start only after this change is canonical. The project page
repository section, the checkout registration form, and every picker belong to
that change. This change ships the API and a `git.inspect` that works for the
local executor.

## 1. Proposal layer (`proposals/repositories-and-chat-start-location`)

- [ ] 1.1 Validate the change with `pnpm exec openspec validate repositories --strict`, `pnpm lint:markdown`, `pnpm format:check`, and `git diff --check`, all green
- [ ] 1.2 Run `$iterative-review-refinement` with at least two independent reviewers. Verify each finding against code or specs, and commit each review round separately.
- [ ] 1.3 Self-review the published draft PR diff, mark it ready, and obtain Leo's approval of the published revision

## 2. `repositories/schema-and-registration` — tables, isolation, normalization, owner API, local inspection (design D1, D2, D4)

- [x] 2.1 Add `repositories`, `repository_aliases`, `checkouts`, and `worktree_leases` to `apps/api/src/db/schema/`.
  - Add the columns, unique `(owner_user_id, id)` on every parent, and unique `(owner_user_id, executor_id, path)` on checkouts.
  - Add a nullable `branch` on checkouts, and the CHECK enumerations for `kind` and `origin`.
  - Add `base_commit` to `worktree_leases`, with the HEAD that `git.worktreeAdd` reports.
  - Add the composite owner foreign keys of design D2, each with `ON DELETE CASCADE`.
  - The foreign keys cover checkouts to repositories and a worktree checkout to its parent. They also cover leases to checkouts, leases to chats, and aliases to repositories.
  - Declare owner policies with `pgPolicy` plus `.enableRLS()`.
  - Generate the migration, and hand-append only `FORCE ROW LEVEL SECURITY` with the header rationale that `apps/api/src/db/AGENTS.md` requires.
  - Verify that `pnpm --filter api db:generate` reports no second diff.
  - Verify that the migration applies to an empty database and to one that already holds projects and chats.
  - Verify that a `pg_class` query shows `relforcerowsecurity` true for all four tables.
  - Verify that an insert that names another owner's repository fails with `23503`.
  - Verify that a checkout with a null branch is accepted. Verify that a lease row needs no unique key beyond its primary key.
  - Verify that a repository delete drops its checkout and lease rows. Verify that a main-checkout delete drops its worktree rows.
  - Name the requirements: "Repositories are owner-scoped records with a display name", "Checkouts record one repository on one executor", "Worktree leases are informational ownership receipts", "Repository and checkout deletion cascades records and never files".
- [x] 2.2 Add the pure remote normalization function with its unit tests.
  - Cover scheme and userinfo removal, and a lowercase host with path case kept.
    Cover the removal of one `.git` and the slash at the end.
  - Cover the `git@host:path` form, a URL that carries a token, and a string that is not a remote.
  - Verify a table-driven test proves that `git@github.com:leon0399/llame.git` and `https://github.com/leon0399/llame` normalize equal.
  - Verify that no output contains a credential ("The canonical remote comes from the `origin` remote").
- [x] 2.3 Add `packages/git-executor` with `inspect` only.
  - Use argv arrays, and refuse a name, branch, or base ref that starts with `-`.
  - Put `--end-of-options` (or `--` where the subcommand takes it) before each remaining caller value.
  - Use absolute paths and the fixed environment on every call (`GIT_TERMINAL_PROMPT=0`, `LC_ALL=C`, `GIT_OPTIONAL_LOCKS=0`).
  - Also use `-c core.hooksPath=<empty dir>`, `-c core.fsmonitor=false`, a per-call timeout, and a typed result that carries bounded standard error.
  - Verify unit tests with real git in temporary repositories per the `temp-git-repo-tests` skill.
  - The tests cover toplevel, `commonDir`, `linked` and `mainWorktree` on a linked worktree, remotes, branch, and head.
  - They also cover a repository with no remote, a path that is not a repository, and a timeout.
  - They also cover a repository whose config sets `core.fsmonitor` and a hook ("Executors expose typed git operations", "Git calls cannot run repository hooks or monitors", "Git calls refuse option-like caller values").
- [x] 2.4 Add the repositories and aliases API (`POST`/`GET /api/v1/repositories`, `PATCH`/`DELETE /api/v1/repositories/:id`, `POST /api/v1/repositories/:id/aliases`).
  - Use DTOs, owner scope, display-name segment validation, alias uniqueness, and OpenAPI regeneration.
  - Verify controller and service tests for creation, a duplicate normalized remote as a conflict, and an invalid display name.
  - They also cover alias declaration and deletion.
  - Verify a clean second OpenAPI generation ("Repositories are owner-scoped records with a display name", "The canonical remote comes from the `origin` remote").
- [x] 2.5 Add the checkout API for the local executor.
  - `POST /api/v1/checkouts` takes one `path` (an absolute local path in this layer) plus an optional `repositoryId` or `remote` selector.
  - `GET /api/v1/checkouts?repositoryId=` lists every row with the ids of the owner's chats whose bound root equals its path.
  - Each worktree row also lists its lease chat.
  - `PATCH /api/v1/checkouts/:id` takes `worktreeBase` on a main row only, and `DELETE /api/v1/checkouts/:id` deletes the row.
  - Derive the executor from the path, and refuse a `machine://` path with 503 `executor_unavailable` until layer 3 lands.
  - Gate every route that runs git on the configuration of that derived executor (an unset `tools.nativeExecutorId` answers 503 `executor_unavailable`).
  - Gate on `enter_workspace` in `tools.allowed` (403 `tool_not_allowed`).
  - Gate on the submitted, canonical, and inspected main-clone paths that pass the `enter_workspace` group in `default` mode (403 `permission_denied`).
  - Evaluate a Machine path in its locator form only in layer 3.
  - Map failures as 404, 409, and 403, and 503 with a typed code. Use 422 with `not_a_repository` for a non-repository path. Use 502 `git_failed` with redacted standard error.
  - Registration inspects the path, stores the canonical toplevel, and fills the repository from the inspected origin.
  - It adopts a main checkout when none exists, and accepts a repository or remote input only as a selector. It rejects a mismatch.
  - Verify integration tests for a first registration, a repeated registration as a conflict, an origin mismatch, and a remote-less clone.
  - Also cover a linked worktree recorded as a worktree row with its main clone as parent.
  - Also verify a rejected main clone behind an allowed subdirectory as 403. Verify a rejected main clone behind an allowed linked worktree as 403.
  - Also verify `PATCH` on a main row. Verify `PATCH` with a relative base as 422, and `PATCH` with a base on another executor as 422. Verify `PATCH` on a worktree row as 422.
  - Also verify a `machine://` path as 503 `executor_unavailable`, and an unallowed path as 403 with no git call. Verify a missing allow as 403 `tool_not_allowed`.
  - Also verify an unset native id as 503 with no git call and no row. Verify the 502 map for a git failure and a timeout.
  - Also verify a `GET` that lists two bound chats on a main row. Verify the lease chat on a worktree row. Verify a `DELETE` that removes rows only ("A main checkout can carry a worktree base directory", "Checkout lists report the lease chat and every bound chat", "Checkout registration inspects the path on its executor", "Registration and removal need a configured executor", "Registration and removal obey the host access policy", "Registration and removal map failures to typed statuses", "Worktree checkouts are children of a main checkout").
- [x] 2.6 Add negative isolation integration tests.
  - A cross-owner `SELECT` returns no rows.
  - A cross-owner `UPDATE` or `DELETE` affects 0 rows and leaves owner A's rows unchanged.
  - An `INSERT` with owner A's owner id fails with `42501`.
  - Cover a checkout that names owner A's `repositoryId`, and an alias declared on owner A's repository.
  - Cover a worktree parent on owner A's checkout, and a lease that names owner A's chat.
  - Verify the API answers 404 for a foreign id before the map ("Repository records are isolated per owner").
- [x] 2.7 Create `docs/product/operator/repositories.md` with the catalog and the registration API, and add the dated `CHANGELOG.md` entry.
  - State the filter-driver trust boundary
  - Repository hooks and the file-system monitor never run
  - Filter drivers from the repository or user config still run
  - They run as the executor user, which also runs `bash` for the owner
  - Then verify `pnpm lint:markdown`.
- [x] 2.8 Verify the layer locally with `pnpm --filter api lint`, `typecheck`, and focused unit tests. Also run `pnpm --filter api test:integration` for the new suites, `pnpm --filter git-executor test`, and a clean second OpenAPI generation.
- [ ] 2.9 SR: self-review the parent-relative diff against `REVIEW_GUIDE.md` and this layer's tasks, fix accepted findings, then mark ready
- [ ] 2.10 GR: complete the ready-PR monitoring loop with terminal green CI and no actionable unresolved feedback

## 3. `repositories/executor-git` — typed git on the protocol, the daemon, and the local executor (design D4, D6 inputs)

- [ ] 3.1 Add `git.inspect`, `git.worktreeAdd`, `git.worktreeList`, `git.worktreeRemove`, and `git.status` to `packages/machine-protocol`.
  - Give them typed parameters and results that carry the `machine://<name>` display prefix through the current display options. `HelloParams` has no Machine name.
  - Make `git.status` report `{ dirty, ahead, upstream?, head }`.
  - Add the optional `methods` list to the `hello` result without a change to `PROTOCOL_VERSION`.
  - Extend `HelloResult` and its `readHelloResult` reader in `apps/api/src/machines/machine-results.ts` to carry the list. The reader rebuilds the result, so it could drop the list.
  - Verify unit tests for the method constants and the parameter schemas with the prefix. Also cover an old `hello` result without `methods` that still parses.
  - Also verify a new result with `methods`, and the path from `session.hello` to the git-call check ("Git methods are additive to the Machine protocol", "Machine git results report locators and rewritten errors").
- [ ] 3.2 Implement the five methods in `apps/machine/src` over `@workspace/git-executor`.
  - Apply the root guard to every path and to the worktree directory before any git call.
  - Use argv arrays, the sanitized environment on every call, a timeout, and a typed failure that carries bounded standard error.
  - Return a Machine locator in every path field. Rewrite each registered-root prefix in standard error to the locator form before it leaves the daemon.
  - Verify tests with real git in temporary repositories inside and outside a registered root.
  - Cover `path_not_registered` before any git call, a dirty status, and a status with and without an upstream. Cover the `head` field in each status result.
  - Cover `worktreeAdd` success and a failure whose text holds no bare registered root.
  - Also cover `worktreeList`, `worktreeRemove`, and `inspect`, which reports locator paths ("Machine daemons answer typed git methods", "Machine git calls run in a sanitized environment", "Machine git results report locators and rewritten errors", "Worktree directories on a Machine lie inside a registered root").
- [ ] 3.3 Implement the local executor side in `apps/api` over the same package, and dispatch by derived executor.
  - An absolute local path runs in-process on the `tools.nativeExecutorId` of the process that serves the API.
  - A `machine://<name>/<abs>` path reaches that Machine through the protocol.
  - An unset `tools.nativeExecutorId`, or a locator that names no configured Machine, fails as 503 `executor_unavailable`.
  - Verify integration tests with the daemon fixture for inspection on a Machine, and `machine_unavailable` when the session cannot open.
  - Also cover `executor_unavailable` for an unmatched locator and for an unset native id.
  - Also cover a registration of `/srv/app` on `machine:nas` that stores the executor `machine:nas` and the path `machine://nas/srv/app`. That path equals a bound root that lists that chat as bound ("Checkout registration inspects the path on its executor", "Executors expose typed git operations", "A Machine checkout stores the canonical Machine locator", "Registration and removal need a configured executor").
- [ ] 3.4 Verify the outdated-daemon boundary end to end.
  - A daemon whose `hello` result lists no git methods makes `git.inspect` fail as `machine_update_required` before any request.
  - On that Machine, `read` still succeeds, and registration answers 503 with `machine_update_required` and stores no row.
  - Verify that the hub test asserts both paths and the operator-facing message ("Machine daemons answer typed git methods", "Git methods are additive to the Machine protocol", "Executors expose typed git operations", "Registration and removal map failures to typed statuses").
- [ ] 3.5 Extend `docs/product/operator/repositories.md` with the daemon update step and the typed git surface.
  - Add to `docs/product/operator/machines.md` the note for Machine worktrees. It tells operators to register the parent directory or set `worktree_base` inside a root.
  - Verify `pnpm lint:markdown`.
- [ ] 3.6 Verify the layer locally with `pnpm --filter machine test`, `pnpm --filter machine build`, `pnpm --filter machine-protocol test`, `pnpm --filter git-executor test`, `pnpm --filter api typecheck`, and the touched integration suites
- [ ] 3.7 SR: self-review the parent-relative diff against `REVIEW_GUIDE.md` and this layer's tasks, fix accepted findings, then mark ready
- [ ] 3.8 GR: complete the ready-PR monitoring loop with terminal green CI and no actionable unresolved feedback

## 4. `repositories/workspace-worktree` — the `worktree` field, adoption, leases, guarded removal, docs (design D3, D5, D6)

- [ ] 4.1 Add the optional `worktree` field to the strict `enter_workspace` schema, plus the pure placement and name module.
  - The module covers the source clone as the toplevel that `git.inspect` reports, the sibling `.llame-worktrees` directory, and the `worktree_base` override.
  - It also covers the deepest-existing-ancestor canonicalization, the generated name, and the `/` to `-` slug. It covers the `llame/<name>` branch rule and the HEAD base default.
  - Update the model-facing description `apps/api/src/prompts/tools/enter_workspace.md` to describe `worktree.name` and `baseRef`, placement, and the worktree path decision.
  - Verify unit tests for each rule. Cover a requested name that contains `/`, and a name that starts with `-`. Also cover a name with a `.` or `..` segment.
  - Also cover `baseRef` `--force`, and a `worktree_base` whose directory does not exist yet. Cover both the local and `machine://` forms of the source clone.
  - Update every fixture that enumerates `enter_workspace` arguments ("The Workspace binding is Chat-scoped and persists across Runs", "Workspace entry can create a worktree of the source clone", "Worktree names, branches, and base refs follow one rule", "Worktree placement follows the source clone and its worktree base").
- [ ] 4.2 Decide in order.
  - First the submitted source clone as the `path` decision, before any probe.
  - Second the canonical source clone by `realpath`, before any git call except the read-only `git.inspect`.
  - Third the inspected main tree: the toplevel, or the `mainWorktree` of a linked worktree by its real path. This decision comes after `git.inspect`, when it differs from the canonical path.
  - Fourth the computed worktree directory, before `git.worktreeAdd` and any write.
  - Add `main_clone` and `worktree_directory` to `DerivedLocatorKind` and `KIND_NAMES` beside `canonical`, and record the three derived decisions with policy provenance.
  - Verify tests that a reject on the submitted path refuses before any probe. Verify that a reject on the source clone refuses before any git call.
  - Verify that a rejected main clone behind an allowed subdirectory refuses with `permission_denied`. The same applies behind an allowed linked worktree, also with `permission_denied`.
  - Verify that a reject on the computed directory refuses before `git worktree add` runs.
  - Verify that a symlinked source path and a symlinked `.llame-worktrees` parent each decide on the canonical form.
  - Verify that a real-path difference after the add removes the worktree and fails `worktree_failed` with the bound root unchanged.
  - Verify that a bypass attempt admits every decision without evaluation. Verify that stored provenance separates `canonical`, `main_clone`, and `worktree_directory` for one call ("Worktree entry decides the submitted path before any probe", "Worktree entry decides the canonical path before any git call", "Worktree entry decides the inspected main clone", "Worktree entry decides the canonical worktree directory", "Worktree creation verifies the decided path").
- [ ] 4.3 Refuse a Machine worktree directory outside every registered root before any git call.
  - Apply the registered-root rule with its nearest ancestor that exists.
  - Use the daemon guard as the authority, not the hub's cached root list.
  - Verify a test with a display name that contains `..`, and one with a symlinked parent. Verify one with a symlinked `.llame-worktrees`. Each test answers `path_not_registered` ("Worktree directories on a Machine lie inside a registered root").
- [ ] 4.4 Complete the success path: `git.worktreeAdd`, the worktree checkout row with origin `created` and the source main row as parent.
  - Write the lease row, and commit the bound root through the current fence with narration and Workspace MCP start.
  - Verify integration tests for the new directory, the branch, and the base commit in the result. Verify one generation bump and one narration.
  - Also cover a Chat already bound to the source clone. It calls with `worktree` and switches the bound root with one increment.
  - Also cover a no-op only for a call without `worktree` into the same root ("Workspace entry can create a worktree of the source clone", "Worktree leases are informational ownership receipts").
- [ ] 4.5 Adopt an unregistered source clone in the same call.
  - Inspection creates the repository by normalized remote or remote-less, and a main checkout with origin `adopted`, with no project link.
  - Inspection adopts a source that git reports as a linked worktree as a worktree row under its main clone.
  - Insert or select on the unique keys inside the worktree transaction, so a concurrent adoption reuses the winner's rows.
  - Verify tests for a remote clone, a remote-less clone, and a linked-worktree source.
  - Also cover a second entry that reuses both rows without a duplicate.
  - Also cover two concurrent worktree entries on one unregistered clone. They record one repository and one main checkout, and both bind ("An unregistered source clone is adopted on worktree entry").
- [ ] 4.6 Add the failure boundary and the atomic commit.

  - Run the checkout, lease, adopted, and bound-root writes in one transaction under the current fence. Pass that transaction to `WorkspaceBindingRepository.enter`.
  - Append a `native.attempt` with the new `worktree` operation before `git.worktreeAdd`, and add `'worktree'` to the `NativeFilesRepository.begin` operation union and `MachineMutationTarget.operation`.
  - Append that attempt's `native.result` in the same transaction.
  - Write the `tool-calling` MODIFIED block for "Tool registry with mandatory safety classification"
  - State the worktree attempt there
  - Keep the attempt-free rule for a plain entry and for exit
  - Keep the idempotence of both calls
  - A `git worktree add` failure returns `worktree_failed` with redacted standard error. It writes no repository, checkout, or lease row, and leaves the bound root and `workspace_generation` unchanged.
  - A fence lost after the add writes no row, keeps the bound root, and reports `executor_unavailable` with `leftDirectory`. A lost Machine link after the add was sent reports `outcome_unknown`.
  - Verify tests for a branch that already exists, a directory that already exists, and a non-repository source path. Cover a git timeout and an offline Machine (`machine_unavailable`).
  - Also cover an outdated daemon (`machine_update_required`), and adoption followed by a failed add that leaves no repository or checkout.
  - Also cover a fence loss after the add, and a lost link that reports `outcome_unknown`.
  - Also cover a redelivered Run that carries the recorded attempt that fails as `outcome_unknown` and creates no second worktree ("Worktree creation failure leaves the binding unchanged", "Worktree entry is fenced and atomic").

- [ ] 4.7 Add `DELETE /api/v1/checkouts/:id/worktree` with the gates of task 2.5 and the guard sequence: dirty refused, unpushed refused, unknown upstream refused unless HEAD equals the base commit of the lease.
  - Then run `git.worktreeRemove`, and delete the row and its lease after it succeeds.
  - The branch stays after the removal.
  - Verify tests for each refusal with the directory still present, and for an unallowed path that starts no git call.
  - Verify that a fresh clean worktree with no upstream is removed and its branch remains.
  - Verify that a worktree with a commit after its base and no upstream is refused.
  - Verify that a worktree with no lease and no upstream is refused.
  - Also cover a repository whose config sets `core.fsmonitor` or a hook that never starts a process. Cover the success case ("Worktree removal is owner-initiated and guarded", "Registration and removal obey the host access policy", "Git calls cannot run repository hooks or monitors").
- [ ] 4.8 Extend `docs/product/operator/repositories.md` with placement, the name rule, the guard, and the cascade rule.
  - Update `docs/product/reference/tools/enter-workspace.md` and both indexes.
  - Add the repository catalog to the placement section of `SPEC.md`, and add this layer's dated `CHANGELOG.md` entry.
  - Verify `pnpm lint:markdown`.
- [ ] 4.9 Verify the layer locally with `pnpm --filter api lint`, `typecheck`, focused unit tests, and the touched integration suites. Also run `pnpm --filter machine test`, and `pnpm --filter api test:coverage` for the new modules.
- [ ] 4.10 SR: self-review the parent-relative diff against `REVIEW_GUIDE.md` and this layer's tasks, fix accepted findings, then mark ready
- [ ] 4.11 GR: complete the ready-PR monitoring loop with terminal green CI and no actionable unresolved feedback

## 5. Finalize readiness (`repositories/finalize`)

- [ ] 5.1 Enter `repositories/finalize` with `$gh-stack` before any canonical spec is written. Then run `$openspec-sync-specs`. Verify that `openspec/specs/repositories/spec.md`, `workspace-entry`, `remote-machines`, `tool-call-permissions`, and `tool-calling` each match their delta. That includes the Purpose section of the new capability.
- [ ] 5.2 Verify every task above is checked, and that `pnpm exec openspec validate --specs` and `pnpm exec openspec validate --all` pass. Record any strict-validation failure with evidence that it also fails on `master`.
- [ ] 5.3 Verify `pnpm lint:markdown`, `pnpm format:check`, and `git diff --check` pass on the finalize diff. Record the archive readiness in the PR body.

## Workflow follow-up

- Archive the change with `$openspec-archive-change` after 5.3, and preserve the checked task history.
- After archive movement, self-review the finalize diff, and mark the PR ready. Then run the ready-PR monitoring loop as the finalize SR and GR gates.
- Merge the stack through `$gh-stack` only with Leo's explicit permission.
