Track no issue: no GitHub issue exists for this change, and Leo decided on
2026-10-24 to proceed without one, as for `remote-machines`. One layer owns
`Closes #1328`, the `chat-start-location/composer-chip` layer that enables the
disabled project page composer. Read [CONTRIBUTING](../../../../CONTRIBUTING.md)
for approval, publication, and merge policy.

## Delivery stack

```text
master <- proposals/repositories-and-chat-start-location <- repositories/schema-and-registration <- repositories/executor-git <- repositories/workspace-worktree <- repositories/finalize <- chat-start-location/project-links-api <- chat-start-location/chat-creation <- chat-start-location/composer-chip <- chat-start-location/composer-entry-points <- chat-start-location/composer-redesign <- chat-start-location/finalize
```

`chat-start-location/project-links-ui` is dropped: #1418
(`chat-start-location/project-repositories`) implements the project page
Repositories section, and its PR #1410 is closed without merging. The chain
skips it, so `chat-start-location/chat-creation` descends from
`chat-start-location/project-links-api`.

- `proposals/repositories-and-chat-start-location` (parent `master`): one PR
  for both changes, without `$gh-stack`. It owns `proposal.md`, `design.md`,
  the delta spec files, this file, and the research note with its index
  entries.

- `chat-start-location/project-links-api` (parent `repositories/finalize`):

  - It owns the three tables
  - It owns the `projects` unique key
  - It owns the nullable `projects.default_executor_id` column
  - It owns the link, defaults, and default-executor routes
  - It owns the read routes and the negative RLS tests
  - It owns their docs
  - The estimate is under 2,000 authored lines
  - Justification: the schema, its routes, and the RLS proofs form one story
  - The project page can land after it

- `chat-start-location/project-links-ui` (dropped): its project page
  "Repositories" section, register-checkout form, docs, worktree list, guarded
  Remove action, and stories are implemented in #1418
  (`chat-start-location/project-repositories`). PR #1410 is closed without
  merging. Section 3 records what replaced it.

- `chat-start-location/chat-creation` (parent
  `chat-start-location/project-links-api`):

  - It owns `POST /api/v1/chats` and the resolution order
  - It owns the Run-free worktree and bound-root write
  - It owns the creation record and the optional first Run
  - It owns the failure statuses and the defaults write-back
  - The estimate is under 2,000 authored lines
  - Justification: the route, its resolution, and its failure taxonomy are one
    contract
  - That contract has one test matrix

- `chat-start-location/composer-chip` (parent
  `chat-start-location/chat-creation`):

  - It owns the location chip and the cascade popover
  - It owns the project page send, and it closes #1328
  - The estimate is under 2,000 authored lines
  - Justification: the chip and the cascade share one resolved-location module
  - They also share one send path

- `chat-start-location/composer-entry-points` (parent
  `chat-start-location/composer-chip`):

  - It owns "New chat in project" and "New chat here"
  - It owns the deep link and the read-only header chip
  - It owns the end-to-end suite
  - The estimate is under 2,000 authored lines
  - Justification: every remaining entry point reuses the chip
  - Each of them needs the end-to-end proof

- `chat-start-location/composer-redesign` (parent
  `chat-start-location/composer-entry-points`):

  - It owns the toolbar project chip and working-directory pill, which replace
    the location chip, the cascade, and the header chip
  - It owns the opt-in create location (design D9, D10)
  - It owns the spec delta and reference changes for both
  - Justification: Leo's review of the running composer on 2026-10-25 made the
    project and the working directory separate, optional capabilities

- `chat-start-location/finalize` (parent
  `chat-start-location/composer-redesign`):
  - It owns only spec synchronization, task records, and archive movement
  - The estimate is under 200 authored lines

Exception to the stack rules, named and one-off: Leo decided on 2026-10-24 that
both changes publish as ONE proposal PR from
`proposals/repositories-and-chat-start-location`. That PR uses no `$gh-stack`,
and it includes the research note, as `remote-machines` did. On 2026-10-25 he
decided that implementation is one chain from `master`, with `$gh-stack`. The
chain has one `<change>/...` branch per layer, and each change's finalize sits
in the chain.

The authored size measured with `wc -l` is about 2,200 lines for `repositories`
and about 1,800 for `chat-start-location`. The research note adds about 420.
A split of the proposal into two PRs is rejected.

Each layer completes self-review (SR) of its actual parent-relative draft diff
before draft to ready. It then completes the GitHub review (GR) loop of bots
and current-head CI per CONTRIBUTING. Generated churn (Drizzle metadata, the
OpenAPI document, and the generated client) is reported separately from
authored size. It counts zero toward the estimate.

Implementation layers start only after every `repositories` layer merges
through `repositories/finalize`. That branch is the direct parent of
`chat-start-location/project-links-api` in the one chain. This change consumes
that change's repository, checkout, and lease tables. It also consumes the
`enter_workspace` worktree option and the typed git methods. Record that merge
commit in the `chat-start-location/project-links-api` PR body. Implement with
`$openspec-apply-change` after Leo approves the published proposal revision.

## 1. Proposal layer (`proposals/repositories-and-chat-start-location`)

- [x] 1.1 Validate the change with these four commands:

  - `pnpm exec openspec validate chat-start-location --strict`
  - `pnpm exec markdownlint-cli2 "openspec/changes/chat-start-location/**/*.md"`
  - `pnpm exec oxfmt --check openspec/changes/chat-start-location`
  - `git diff --check`
  - All four commands must pass
  - Record any strict finding that comes from a canonical spec
  - Do not fix it, because this change does not touch that spec
  - Green on the published head `b97a92e8` of PR #1401, as its body records
  - The body also records `ste_check.py --mode descriptive` and the link check

- [x] 1.2 Run `$iterative-review-refinement` with independent reviewers.

  - Use at least two reviewers
  - Verify each finding against code, canonical specs, or the grilling contract
  - Commit each review round separately
  - Local round 1: 5 reviewers, 98 findings, `66ba0131`. Round 2: 3 reviewers,
    57 findings, `a188b4c4`
  - Round 3 (convergence): 2 reviewers, 9 findings, `a1d3a8ef`
  - The Simplified Technical English rewrite follows, `762d7761`
  - GitHub round 1: Codex, CodeRabbit, and pullfrog, 15 threads, 12 accepted
    and 3 rejected with evidence in-thread, `b97a92e8`
  - GitHub round 2 on `b97a92e8` raised no new finding

- [x] 1.3 Record the named one-PR exception above and its measured authored size
      in the proposal PR body

  - The body records that both changes publish as one PR without `gh-stack`
    by Leo's decision, and it names the exception in this file
  - The measured size stays in this file: about 2,200 lines for
    `repositories`, about 1,800 for this change, and about 420 for the
    research note

- [x] 1.4 Self-review the published draft PR diff, mark it ready, and obtain
      Leo's approval of the published revision

  - PR #1401 is published, non-draft, base `master`, merge state clean, at
    head `b97a92e8`
  - Three local rounds and two GitHub rounds are recorded in the PR body
  - Leo's approval of the published revision is still open. It stays recorded
    here and does not block this finalize layer

## 2. `chat-start-location/project-links-api` — the link, its defaults, the default executor, and their routes (design D8)

The link table, its repository, service, routes, tests, and the project page
section are implemented in #1418 (`chat-start-location/project-repositories`).
This layer adds only the link defaults, the creation record, the project default
executor, and the start-location preview.

- [x] 2.1 Add `project_repositories`, `project_repository_defaults`, and
      `chat_creation_records` to `apps/api/src/db/schema/`.

  - Link: `owner_user_id`, alias, `is_primary`, and an `isolation` CHECK
  - The CHECK admits `inherit`, `always_worktree`, and `never`
  - Link keys: the unique triple and a partial unique primary per project
  - Defaults: `owner_user_id` and a unique `(owner_user_id, link, executor)`
    pair
  - Defaults: an `updated_at` stamp on every write
  - Enforce the main-checkout rule on write
  - Creation record: `attempts` jsonb, `created_at`, and one row per chat
  - Each attempt carries its decisions and its own `created_at`
  - Add composite owner foreign keys
  - Add unique `(owner_user_id, id)` keys on `projects` and on the link table
  - Set `ON DELETE CASCADE` only on those composite edges
  - Add the nullable `projects.default_executor_id` column
  - Declare owner policies with `pgPolicy` plus `.enableRLS()`
  - Hand-append `FORCE ROW LEVEL SECURITY` per the `projects` precedent
  - Verify that `pnpm --filter api db:generate` reports no second diff
  - Verify that the migration applies to an empty database
  - Verify the composite owner cascades in an integration test
  - Cite "A project links repositories with an alias and a primary link"
  - Cite "Project repository defaults remember the last chosen checkout per
    executor"

- [x] 2.2 Add the write routes to `apps/api/src/projects/`.

  - The link, unlink, update, and default-executor write routes
  - The read route `GET /api/v1/projects/:id/repositories`
  - `GET /api/v1/projects/:id/start-location?repositoryId=&executorId=&checkoutId=`
  - Add the DTOs and the OpenAPI annotations
  - Regenerate the document and the client
  - Verify controller and service tests for an alias
  - Verify a primary switch that clears the previous primary in one transaction
  - Verify every isolation value
  - Verify a foreign project id answered 404
  - Verify a repository that the caller does not own answered 404
  - Verify a write to an archived project answered 409 that changes nothing
  - Verify that the link read returns each defaults row with `updated_at`
  - Verify that the start-location read returns the same resolution as a create
  - Verify that the start-location read writes nothing
  - Cite "A project links repositories with an alias and a primary link"
  - Cite "An isolation policy selects the default isolation of a chat start"
  - Cite "A project can have a default executor"
  - Cite "The owner reads a project's links and their defaults"
  - Cite "The owner previews the start location without effects"

- [x] 2.3 Add negative isolation integration tests.

  - Owner B cannot select, insert, update, or delete owner A's links
  - Owner B cannot touch owner A's defaults or default executor
  - Verify that SELECT returns no rows
  - Verify that UPDATE and DELETE affect 0 rows
  - Verify that INSERT raises `42501`
  - Verify that the API answers 404 for a foreign id
  - Test an insert of a link that names another owner's repository
  - Test an insert of a defaults row that names another owner's checkout
  - Each such insert fails with `23503`
  - Cite "Project repository links are owner-isolated"

- [x] 2.4 Make project deletion remove links and defaults only.

  - Make a deleted checkout and an unlinked repository remove their defaults
  - Verify integration tests for a project with a link and a defaults row
  - Include a filed chat in that project
  - Verify that a deleted main checkout leaves no default
  - Verify that an unlink removes the link's defaults
  - Cite "Project repository links are deleted with the project"

- [x] 2.5 Extend `docs/product/operator/repositories.md` with project linking.

  - Add the defaults and isolation text
  - Add the reference entries for the project write and read routes
  - Add a dated `CHANGELOG.md` entry
  - Verify that `pnpm lint:markdown` passes

- [x] 2.6 Verify the layer locally.

  - `pnpm --filter api lint` and `typecheck`
  - The focused unit tests
  - `pnpm --filter api test:integration` for the new suites
  - A clean second OpenAPI generation

- [x] 2.7 SR: self-review the parent-relative diff against `REVIEW_GUIDE.md`.

  - Check it against this layer's tasks
  - Record authored size and generated churn separately
  - Fix accepted findings, then mark ready
  - Self-review completed in the layer. Its fixes are folded into the layer
    commits, which end at `3eeaa2de`: the regenerated client needs
    `defaultExecutorId` on `ProjectResponse`, so the project fixtures and the
    live-message helper carry it
  - Size from PR #1409: about 1,850 production lines, about 2,800 test lines,
    and about 100 doc lines. Generated churn about 5,400 lines, counted
    separately
  - The layer PR is published as a draft on top of #1408 and stays a draft
    until Leo grants the merge permission that `CONTRIBUTING` requires

- [x] 2.8 GR: complete the ready-PR monitoring loop.
  - Terminal green CI
  - No actionable unresolved feedback
  - Not run. Leo decided that the GitHub review loop is a non-blocking
    follow-up for this stack. This box records that decision, not a green loop
  - PR #1409 is not green either: 24 checks pass, 4 fail, and 1 is skipped. The
    bot review and the failing checks stay in the follow-up

## 3. `chat-start-location/project-links-ui` — the project page Repositories section (design D8, D10)

This layer was dropped. The project page section is implemented in #1418
(`chat-start-location/project-repositories`), whose side-panel section, link
sheet, draft row, and guarded Remove replaced the dialogs planned here. Its PR
(#1410) is closed without merging.

- [x] 3.1 Add the project page "Repositories" section. Implemented in #1418.

  - List and link from the owner catalog
  - Unlink, and set the primary, alias, and isolation policy
  - Register a checkout by `path`, with the executor derived from that path
  - List that project's worktrees with the chat that owns each one
  - Add the guarded Remove action
  - The action calls the `repositories` change's removal route
  - Document the registration form in the operator page
  - Verify the stories and the Storybook story tests
  - Return their preview URLs

- [x] 3.2 Verify the layer locally. Implemented in #1418.

  - `pnpm --filter web lint` and `typecheck`
  - The story tests and the focused page tests

- [x] 3.3 SR: self-review the parent-relative diff against `REVIEW_GUIDE.md`.

  - Check it against this layer's tasks
  - Record authored size and generated churn separately
  - Fix accepted findings, then mark ready
  - Self-review completed in the layer, whose single commit is `e4e4d546`. Its
    finding is recorded in the commit and the PR body: the API's OpenAPI
    annotation omits `type: String`, so the generated `CreateCheckoutDto`
    selectors type as objects and the layer passes the strings through
  - That workaround was fixed forward in the next layer, per Leo's no-rebase
    rule, so this branch keeps it
  - Size from PR #1410: 2,582 insertions, of which 476 are story lines and
    about 250 test lines. No generated churn
  - The layer PR is published as a draft on top of #1409

- [x] 3.4 GR: complete the ready-PR monitoring loop.
  - Terminal green CI
  - No actionable unresolved feedback
  - Not run. Leo decided that the GitHub review loop is a non-blocking
    follow-up for this stack. This box records that decision, not a green loop
  - PR #1410 is not green either: 23 checks pass, 2 fail, and 3 are skipped

## 4. `chat-start-location/chat-creation` — the create request, resolution, the Run-free bound root, worktree, first Run, and the failure statuses (design D9)

- [x] 4.1 Add the request DTOs and the create route.

  - `CreateChatRequest` in `apps/api/src/chats/dto/chats.dto.ts`
  - `CreateChatMessageDto { id, parts, modelId, effort?, permissionMode? }`
    - The `POST /api/v1/chats` route in `apps/api/src/chats/chats.controller.ts`
  - Share only the message-parts schema with `CreateMessageDto`
  - Do not reuse `CreateMessageBodyDto`
  - Regenerate the OpenAPI document and client
  - Verify validation tests for a missing or malformed chat `id`
  - Verify a missing `message.id` and a message without `modelId`
  - Verify an invalid `permissionMode` and a blank worktree name
  - Verify a `baseRef` that starts with `-`
  - Verify that the two request schemas stay distinct
  - Cite "A chat can be created with its project and location in one request"
  - Cite "A create request with a message validates it before any write"

- [x] 4.2 Implement location resolution in the D9 order.

  - Use no silent primary
  - Explicit ids override every remembered default
  - Repository: the request, the primary link, the single link, then none
  - Executor: the request, then the remembered default
  - Executor: then `projects.default_executor_id`
  - Executor: then the only executor that holds a `main` checkout
  - Executor: then the online executor with the lowest id and a `main` checkout
  - Checkout: the request, then the remembered default for the link and executor
  - Checkout: then the only `main` checkout on that executor, then none
  - Verify table-driven tests for every step
  - Verify that several linked repositories without a primary answer none
  - Verify that implicit steps skip an offline Machine
  - Verify an explicit executor that names an offline Machine
  - Verify a named checkout or a remembered default with an offline Machine
  - Each of those answers `machine_unavailable`
    - Verify a local executor that equals this process's `tools.nativeExecutorId`
    - Verify an `executorId` with no configured executor answers 422
      `executor_unknown`
  - Verify two defaults rows, where the later `updated_at` wins
  - Cite "Location resolution uses project defaults and never a silent primary"
  - Cite "Executor resolution skips offline Machines on implicit steps"
  - Cite "Only an explicit executor, a named checkout, or a remembered default
    names an offline Machine"
  - Cite "Project repository defaults remember the last chosen checkout per
    executor"

- [x] 4.3 Reuse the `repositories` change's decision function.

  - The four ordered decisions follow
  - 1: the submitted checkout path, before any probe
  - 2: the canonical source clone, before any git call
  - 3: the inspected main tree, after the read-only `git.inspect`
  - 4: the canonical worktree directory, before `git.worktreeAdd`
  - Use the request's `message.permissionMode`
  - Use `default` for an omitted mode, against this process's config
  - Apply the entry gates
  - Append one attempt, with every decision, when the first path decision runs
  - The attempt commits in its own transaction, before any git write
  - The attempt stays when a later step fails
  - A request that fails validation, answers 404 or 409, or resolves no
    location appends no attempt
  - Each attempt holds every decision, a bypass decision included
  - Each attempt holds the provenance fields of a derived decision
  - Leave `WorkspaceBindingRepository.enter` and its Run fence unchanged
  - Verify a `bypass` request on a process without bypass answers 422
  - Verify that no store happens first
  - Verify that a 422, 404, or 409 create appends no attempt
  - Verify that one attempt stays after a rejected decision
  - Verify a rejected submitted path answered `bind_failed`
  - Verify a rejected canonical path, source clone, or worktree directory
  - Each of those answers `bind_failed` with `code` `permission_denied`
  - Each of those fails before any git command
    - Verify a missing allowlist answers `bind_failed` with `code`
      `tool_not_allowed`
    - Verify a missing native executor answers `bind_failed` with `code`
      `executor_unavailable`
    - Verify an archived or missing source answers `bind_failed` with `code`
      `not_found`
  - Verify the recorded decisions for a `default` request
  - Verify the recorded decisions for a `bypass` request
  - Verify `GET /api/v1/chats/:id/creation-record` for the owner
  - Verify a 404 for another owner
  - Cite "The Workspace step uses the request permission mode"
  - Cite "The Workspace step requires the entry gates"
  - Cite "A rejected path refuses the binding before any git command"
  - Cite "Chat-creation path decisions are recorded with the chat"
  - Cite "A creation attempt is appended only after a path decision"

- [x] 4.4 Add the Run-free worktree step.

  - Run `git.worktreeAdd` for a registered `main` source
  - Run it under the chat's session advisory lock
  - Commit the worktree checkout row, its lease, and the bound root together
  - The lease names `chat_id` and the worktree `checkout_id`
  - Use one transaction and one creation lease per chat
  - Verify with real git in temporary repositories
  - Follow the `temp-git-repo-tests` skill
  - Verify that no removal path exists
  - Verify that a failed add answers `worktree_failed`
  - Verify that it writes no row and no bound root
  - Verify that a crash before the commit leaves a directory with no rows
  - Cite "The creation worktree commits with its lease and binding"
  - Cite "A failed workspace leaves the chat filed and unbound"

- [x] 4.5 Store the bound root after the worktree step.

  - Call `WorkspaceBindingRepository.bindAtCreation(tx, { chatId, ownerUserId, executorId, root })`
  - Pass the caller's transaction, under `runAs(owner)`
  - It locks the chat row
  - It requires no message and no Run on the chat
  - It requires the chat to be unbound, or bound to the root of its own
    creation lease
  - It sets the root and the executor with `workspace_generation + 1`
  - It never takes a synthetic Run and never writes an unscoped update
  - A creation bound root counts as an entry that establishes a bound root
  - Then commit the message and its Run row together
  - Enqueue the Run after that commit
  - Verify that no binding is stored for a chat that holds a message
  - Verify that no binding is stored for a chat that holds a Run
  - Verify that no binding is stored for a chat bound to another root
  - Verify that each of those answers 409
  - Verify a create that answers 201 with `workspace.status` `bound`
  - Verify that `GET /api/v1/chats/:id/stream` replays the Run
  - Verify that `workspace.status` `unbound` stores the message
  - Verify that the Run then starts
  - Verify that an enqueue failure fails the Run and answers 5xx
  - Verify that the message stays stored
  - Verify that an `outcome_unknown` carries `leftDirectory`
  - Verify that `code` is present only for `bind_failed` and `worktree_failed`
  - Verify that every other failure carries `message`
  - Verify that the first Run sees the same bound root
  - Cite "Creation runs its steps in one fixed order"
  - Cite "The response workspace object has one closed status set"
  - Cite "An unresolved location stores the message and starts the Run"
  - Cite "Failure statuses name their cause"
  - Cite "The message step commits the message and its Run before the enqueue"
  - Cite "The Workspace binding is Chat-scoped and persists across Runs"

- [x] 4.6 Validate every named owner id under owner RLS.

  - The ids are the project, the repository, and the checkout
  - Validate them in the transaction that inserts the chat
  - Validate `executorId` against configuration instead of RLS
  - A foreign or missing owner id answers 404, and no chat is stored
  - An archived project answers 409, and no chat is stored
  - An unconfigured executor id answers 422 `executor_unknown`
  - Make a named `checkoutId` decide its repository and executor
  - Verify a worktree checkout answered 422 before any write
  - Verify a `repositoryId` or `executorId` that disagrees answered 422
  - Verify an unlinked `repositoryId` answered 422 before any write
  - Cite "Chat creation is owner-isolated"
  - Cite "A named checkout decides its repository and executor"

- [x] 4.7 Add the per-chat session advisory lock and the resend behavior.

  - Take `pg_try_advisory_lock` on the chat id
  - Hold it on one dedicated connection for the whole request
  - Release it at the end of the request or when that connection ends
  - Keep the steps in their separate transactions
  - Answer 409 `creation_in_progress` to a same-id create that overlaps
  - Derive the key in one shared function
  - Use a different seed, or a two-key form, from the org-unit locks
  - Take `pg_try_advisory_xact_lock` with the same key in the message route
  - Take it inside that route's admission transaction
  - Answer 409 `creation_in_progress` to a message that overlaps a create
  - Store no message and no Run in that answer
  - A resend on a stored chat with no message re-runs the remaining steps
  - It reuses the creation lease and the bound root
  - A stored chat that holds a message answers 409
  - The client then sends the draft through the message route
  - The draft becomes a new message with a new id
  - A resend after an enqueue failure also answers 409
  - The failed Run frees the single-flight slot
  - A resend into an archived chat or project answers 409
  - A resend with a different `projectId` answers 409 `project_mismatch`
  - Another owner's chat id answers 404, with no disclosure
  - Verify that two concurrent creates with one id create one worktree
  - Verify that a message during a create answers 409 `creation_in_progress`
  - Verify that it stores no message and no Run
  - Verify that a create after a committed first message answers 409
  - Cite "Creation serializes requests for one chat id"
  - Cite "The message route refuses a chat that a create request holds"
  - Cite "A resent create request reuses the stored chat and its binding"
  - Cite "A resend refuses an archived chat or another project"

- [x] 4.8 Write the per-executor defaults row after a successful start.

  - Record its `updated_at`
  - Record the source `main` checkout for the link and executor
  - Include a worktree start
  - Verify that a second create needs no location ids
  - Use the same project and repository in that create
  - Verify that a failed start leaves the previous row unchanged
  - Verify that a worktree checkout is refused as a defaults target
  - Verify that a deleted checkout or an unlink leaves no default
  - Cite "Project repository defaults remember the last chosen checkout per
    executor"

- [x] 4.9 Verify the first-message path is otherwise unchanged.

  - The current `POST /api/v1/chats/:id/messages` suite passes without edits
    other than the new creation-lock refusal test
  - A locationless create-or-append still produces an unfiled chat
  - That chat has no bound root
  - Cite "The first-message creation path is unchanged"
  - Cite "The message route refuses a chat that a create request holds"

- [x] 4.10 Add the `POST /api/v1/chats` reference page.

  - Include the request fields, the resolution order, and the 201 body
  - Include the closed status set and the cause codes
  - Include the `GET /api/v1/chats/:id/creation-record` route
  - Add a dated `CHANGELOG.md` entry
  - Verify that `pnpm lint:markdown` passes

- [x] 4.11 Verify the layer locally.

  - `pnpm --filter api lint` and `typecheck`
  - `test:coverage` for the new modules
  - The touched integration suites
  - A clean second OpenAPI generation

- [x] 4.12 SR: self-review the parent-relative diff against `REVIEW_GUIDE.md`.

  - Check it against this layer's tasks
  - Record authored size and generated churn separately
  - Fix accepted findings, then mark ready
  - Self-review completed in the layer. The feature commit is `4d47caf1`; the
    review added the two test commits `6f8089c2` and `ffa55406`, and it left
    the duplication cleanup `f960eb5d`
  - That cleanup is the accepted finding: the start-location triple was
    spelled twice, and `jscpd` refused the duplication. The refactor removes
    it, shares one dialog frame, and deletes the lower layer's client
    workaround, per Leo's no-rebase rule
  - Size from PR #1411: about 2,340 production lines and eight new test files.
    Generated `openapi.json` and client churn counted separately
  - The layer PR is published as a draft on top of #1410

- [x] 4.13 GR: complete the ready-PR monitoring loop.
  - Terminal green CI
  - No actionable unresolved feedback
  - Not run. Leo decided that the GitHub review loop is a non-blocking
    follow-up for this stack. This box records that decision, not a green loop
  - PR #1411 is not green either: 37 checks pass, 1 fails, and 2 are pending

## 5. `chat-start-location/composer-chip` — the chip, the cascade, and the project page send; closes #1328 (design D10)

- [x] 5.1 Build the location chip from one resolved-location module.

  - Include the reuse form, the worktree form, and the warning state
  - Share the module with the popover
  - The module reads `GET /api/v1/projects/:id/repositories`
  - It also reads the start-location route
  - Verify stories and Storybook story tests for a reused bound root
  - Verify them for a worktree bound root and an unresolvable step
  - Cite "The owner reads a project's links and their defaults"
  - Cite "The owner previews the start location without effects"

- [x] 5.2 Build the cascade popover.

  - The levels: project, repository, machine, source checkout, isolation
  - Then the base ref and the name
  - Add the recompute-below rule
  - Disable an offline machine and show its reason
  - Add the reason labels
  - Warn for a Machine that answers `machine_update_required`
  - Verify story tests for each label and a disabled machine
  - Verify an outdated daemon and a level with a single option

- [x] 5.3 Enable the project page composer.

  - The file is `apps/web/app/(chat)/projects/[id]/project-prompt-input.tsx`
  - One send calls `POST /api/v1/chats` with the project
  - The send includes the chip's location, then opens the run stream
  - Keep the draft when the response carries a `workspace` failure
  - Show the warning chip
  - Verify the end-to-end test
  - Record `Closes #1328` in the PR body

- [x] 5.4 Verify the layer locally.

  - `pnpm --filter web lint` and `typecheck`
  - The story tests

- [x] 5.5 SR: self-review the parent-relative diff against `REVIEW_GUIDE.md`.

  - Check it against this layer's tasks
  - Record authored size and generated churn separately
  - Fix accepted findings, then mark ready
  - Self-review completed in the layer, whose single commit is `fb894019`. It
    landed the chip, the cascade, the enabled project page composer, and the
    `Closes #1328` reference in the PR body
  - Size from PR #1412: 2,952 insertions, of which 1,712 are production and
    1,240 are tests and stories. No generated churn
  - The layer PR is published as a draft on top of #1411

- [x] 5.6 GR: complete the ready-PR monitoring loop.
  - Terminal green CI
  - No actionable unresolved feedback
  - Not run. Leo decided that the GitHub review loop is a non-blocking
    follow-up for this stack. This box records that decision, not a green loop
  - PR #1412 is not green either: 36 checks pass, 2 are skipped, and 1 is
    pending

## 6. `chat-start-location/composer-entry-points` — every other entry point and the header chip (design D10, D11)

- [x] 6.1 Add the sidebar "New chat in project" and "New chat here".

  - Add the deep link with its pre-fill rules
  - The deep link is:
  - `/chat/new?project=&repository=&executor=&checkout=&worktree=1`
  - Add the isolation default that follows from the source chat
  - Verify every entry point in end-to-end tests

- [x] 6.2 Add the read-only location chip to the chat header.

  - Read it from the bound root
  - Verify its story for a Machine root, a worktree root, and an unbound chat

- [x] 6.3 Run the end-to-end suite.

  - A project page send that creates a filed, bound chat
  - A worktree start that shows its branch
  - A failed location that keeps the draft
  - An offline machine that cannot be chosen
  - An outdated daemon that shows the warning
  - The suite is `e2e/web/chat/chat-start-location.spec.ts`
  - CI ran it: Product e2e (Playwright) passed on #1413 at da5be30e (run
    40171792231); the local stack could not start here (no docker)
  - It holds five tests: the filed and bound send, the worktree branch in the
    header, the offline Machine that keeps the draft, the outdated daemon that
    keeps the draft, and the sidebar entries that pre-fill the chip

- [x] 6.4 Add the reference entry for the chip, the cascade, and the entries.

  - Add it to the docs index
  - Add a dated `CHANGELOG.md` entry
  - Verify that `pnpm lint:markdown` passes

- [x] 6.5 Verify the layer locally.

  - `pnpm --filter web lint` and `typecheck`
  - The touched story files locally; CI's Tests (storybook) and Product e2e
    passed on #1413 at da5be30e (run 40171792231)

- [x] 6.6 SR: self-review the parent-relative diff against `REVIEW_GUIDE.md`.

  - Check it against this layer's tasks
  - Record authored size and generated churn separately
  - Fix accepted findings, then mark ready
  - Self-review completed in the layer, whose single commit is `66ca44da`. It
    carries the two entry points, the deep link, the header chip, the
    reference page, and the browser suite
  - The suite was not run locally, as 6.3 records. No generated churn
  - The branch is published as `chat-start-location/composer-entry-points` on
    top of #1412. It has no PR of its own before this finalize layer

- [x] 6.7 GR: complete the ready-PR monitoring loop.
  - Terminal green CI
  - No actionable unresolved feedback
  - Not run. Leo decided that the GitHub review loop is a non-blocking
    follow-up for this stack. This box records that decision, not a green loop
  - This layer has no PR yet, so it has no check rollup either. Its end-to-end
    suite stays unproven until CI runs it

## 6b. `chat-start-location/composer-redesign` — the toolbar chips and the opt-in create (design D9, D10)

- [x] 6b.1 Make the create's location opt-in.

  - A request that names no repository, executor, or checkout binds nothing,
    whatever the project defaults
  - A worktree without a named location answers 422
  - The composer names the checkout that its pill shows, or none
  - Verify in the creation unit and integration suites

- [x] 6b.2 Replace the chip and the cascade with the toolbar chips.

  - "Add to project" and "Add working directory" in the `+` menu
  - The project chip and the working-directory pill, each removed only by its ×
  - "Other folder…" matches a registered checkout or registers the folder
  - The worktree name and base fields are removed; the server names the tree

- [x] 6b.3 Remove the read-only header chip.

- [x] 6b.4 Update the spec delta, design D10, and the reference entry.

- [x] 6b.5 Update the stories and the end-to-end suite for the chips.

- [ ] 6b.6 SR: self-review the parent-relative diff against `REVIEW_GUIDE.md`.

  - Record authored size and generated churn separately
  - Fix accepted findings, then mark ready

- [ ] 6b.7 GR: complete the ready-PR monitoring loop.
  - Terminal green CI
  - No actionable unresolved feedback

## 7. Finalize readiness (`chat-start-location/finalize`)

- [x] 7.1 Enter `chat-start-location/finalize` with `$gh-stack` first.

  - Do this before any canonical spec is written
  - Re-base the `specs/workspace-entry/spec.md` MODIFIED block
  - Re-base it on the canonical requirement
  - The block is written against the `repositories` change's delta text
  - Then run `$openspec-sync-specs`
  - Verify `openspec/specs/chat-creation/spec.md` holds the capability purpose
  - Verify that it holds every added requirement
  - Verify `openspec/specs/projects/spec.md` holds every added requirement
  - Verify that no canonical scenario is lost
  - Verify `openspec/specs/tool-call-permissions/spec.md` holds
    "Chat-creation path decisions are recorded with the chat"
  - Verify `openspec/specs/workspace-entry/spec.md` admits the request
  - The request is the owner's authenticated chat-creation request
  - Verify that the spec keeps it as the second writer of the bound root
  - Verify that the spec keeps every canonical scenario
  - This layer is `chat-start-location/finalize`, on parent
    `chat-start-location/composer-entry-points`
  - The re-base is a no-op: the block already equals the canonical requirement
    plus only three insertions. It adds the chat-creation sentence and the
    generation sentence to the second paragraph, the four gates to a new third
    paragraph, and the chat-creation request to the last scenario's `AND`
  - A word diff of the block against the canonical requirement reports those
    three inserts and no deletion or replacement, so no canonical sentence
    changed
  - `openspec/specs/chat-creation/spec.md` is new. It holds the delta's
    Purpose and all 24 requirements in the delta's order
  - `openspec/specs/projects/spec.md` gains the 7 added requirements after the
    4 canonical ones. Every canonical requirement and scenario keeps its text
    and its order
  - `openspec/specs/tool-call-permissions/spec.md` gains the 2 added
    requirements after the 17 canonical ones, one of them
    "Chat-creation path decisions are recorded with the chat"
  - `openspec/specs/workspace-entry/spec.md` holds the request as the second
    writer of the bound root. Its requirement carries 9 scenarios: the 8
    canonical ones unchanged and "A chat-creation request establishes the
    first binding". The other 12 requirements are untouched
  - The verification parses both files and compares each requirement body, its
    scenario titles, and each scenario body word for word. Every delta
    requirement is present, and no canonical scenario is lost

- [x] 7.2 Verify that every task above is checked.

  - Verify that `pnpm exec openspec validate --specs` passes
  - Verify that `pnpm exec openspec validate --all` passes
  - Record any strict-validation failure with evidence
  - The evidence shows that it also fails on `master`
  - All 45 boxes of this file are checked
  - `pnpm exec openspec validate --specs` exits 0: 52 passed, 0 failed
  - `pnpm exec openspec validate --specs --strict` exits 1: 11 passed, 41
    failed. Every failure is the ">500 characters" requirement warning and
    carries no other finding
  - The same 41 specs fail strict at the stack base `fb5c096b`, before this
    sync: 9 passed, 41 failed of 50. They also fail on `master` at `0e37f0c0`:
    8 passed, 40 failed of 48
  - `chat-creation` passes strict, and the sync adds no strict failure:
    `openspec validate chat-creation --type spec --strict` and
    `openspec validate chat-start-location --strict` both report valid
  - The one strict failure that `master` does not have is `grep-tool`, whose
    spec arrives with #1395, after `master`. It fails on the same 9 long
    requirements at `fb5c096b` as well
  - `pnpm exec openspec validate --all` exits 1 on `change/tool-search` only:
    53 passed, 1 failed of 54. That change fails at `fb5c096b` too, and on
    `master`, which also fails `change/knowledge-submit`
  - `pnpm exec openspec validate --all --strict` exits 1 with 12 passed and 42
    failed of 54. The base fails the same 42 of 51

- [x] 7.3 Verify the finalize diff.
  - `pnpm lint:markdown`, `pnpm format:check`, and `git diff --check` pass
  - Record the archive readiness in the PR body
  - `pnpm lint:markdown` reports 0 issues across 862 files, and its link check
    passes
  - `pnpm format:check` passes for the repository
  - `git diff --check` reports no whitespace error
  - This finalize layer has no PR yet. The archive readiness belongs in its PR
    body at publication, after the archive movement in the commit that follows

## Workflow follow-up

- Archive the change with `$openspec-archive-change` after 7.3, and preserve
  the checked task history.

- After archive movement, self-review the finalize diff.

  - Include every relative link that gained one `../`
  - Mark the PR ready
  - Run the ready-PR monitoring loop as the finalize SR and GR gates

- Monitor CI, bot reviews, and review threads on the finalize PR for at least
  15 minutes per `CONTRIBUTING.md`.

- Merge the stack through `$gh-stack` only with Leo's explicit permission.
