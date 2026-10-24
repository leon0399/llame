Track no issue: no GitHub issue exists for this change, and Leo decided on
2026-10-24 to proceed without one, as for `remote-machines`. One layer owns
`Closes #1328`, the `chat-start-location/composer-chip` layer that enables the
disabled project page composer. Read [CONTRIBUTING](../../../CONTRIBUTING.md)
for approval, publication, and merge policy.

## Delivery stack

```text
master <- proposals/repositories-and-chat-start-location <- repositories/schema-and-registration <- repositories/executor-git <- repositories/workspace-worktree <- repositories/finalize <- chat-start-location/project-links-api <- chat-start-location/project-links-ui <- chat-start-location/chat-creation <- chat-start-location/composer-chip <- chat-start-location/composer-entry-points <- chat-start-location/finalize
```

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

- `chat-start-location/project-links-ui` (parent
  `chat-start-location/project-links-api`):

  - It owns the project page "Repositories" section
  - It owns its register-checkout form and docs
  - It owns the worktree list with the guarded Remove action
  - It owns its stories
  - The estimate is under 2,000 authored lines
  - Justification: one UI surface with one story set reads the finished routes

- `chat-start-location/chat-creation` (parent
  `chat-start-location/project-links-ui`):

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

- `chat-start-location/finalize` (parent
  `chat-start-location/composer-entry-points`):
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

- [ ] 1.1 Validate the change with these four commands:

  - `pnpm exec openspec validate chat-start-location --strict`
  - `pnpm exec markdownlint-cli2 "openspec/changes/chat-start-location/**/*.md"`
  - `pnpm exec oxfmt --check openspec/changes/chat-start-location`
  - `git diff --check`
  - All four commands must pass
  - Record any strict finding that comes from a canonical spec
  - Do not fix it, because this change does not touch that spec

- [ ] 1.2 Run `$iterative-review-refinement` with independent reviewers.

  - Use at least two reviewers
  - Verify each finding against code, canonical specs, or the grilling contract
  - Commit each review round separately

- [ ] 1.3 Record the named one-PR exception above and its measured authored size
      in the proposal PR body

- [ ] 1.4 Self-review the published draft PR diff, mark it ready, and obtain
      Leo's approval of the published revision

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

- [ ] 2.7 SR: self-review the parent-relative diff against `REVIEW_GUIDE.md`.

  - Check it against this layer's tasks
  - Record authored size and generated churn separately
  - Fix accepted findings, then mark ready

- [ ] 2.8 GR: complete the ready-PR monitoring loop.
  - Terminal green CI
  - No actionable unresolved feedback

## 3. `chat-start-location/project-links-ui` — the project page Repositories section (design D8, D10)

- [ ] 3.1 Add the project page "Repositories" section.

  - List and link from the owner catalog
  - Unlink, and set the primary, alias, and isolation policy
  - Register a checkout by `path`, with the executor derived from that path
  - List that project's worktrees with the chat that owns each one
  - Add the guarded Remove action
  - The action calls the `repositories` change's removal route
  - Document the registration form in the operator page
  - Verify the stories and the Storybook story tests
  - Return their preview URLs

- [ ] 3.2 Verify the layer locally.

  - `pnpm --filter web lint` and `typecheck`
  - The story tests and the focused page tests

- [ ] 3.3 SR: self-review the parent-relative diff against `REVIEW_GUIDE.md`.

  - Check it against this layer's tasks
  - Record authored size and generated churn separately
  - Fix accepted findings, then mark ready

- [ ] 3.4 GR: complete the ready-PR monitoring loop.
  - Terminal green CI
  - No actionable unresolved feedback

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

- [ ] 4.12 SR: self-review the parent-relative diff against `REVIEW_GUIDE.md`.

  - Check it against this layer's tasks
  - Record authored size and generated churn separately
  - Fix accepted findings, then mark ready

- [ ] 4.13 GR: complete the ready-PR monitoring loop.
  - Terminal green CI
  - No actionable unresolved feedback

## 5. `chat-start-location/composer-chip` — the chip, the cascade, and the project page send; closes #1328 (design D10)

- [ ] 5.1 Build the location chip from one resolved-location module.

  - Include the reuse form, the worktree form, and the warning state
  - Share the module with the popover
  - The module reads `GET /api/v1/projects/:id/repositories`
  - It also reads the start-location route
  - Verify stories and Storybook story tests for a reused bound root
  - Verify them for a worktree bound root and an unresolvable step
  - Cite "The owner reads a project's links and their defaults"
  - Cite "The owner previews the start location without effects"

- [ ] 5.2 Build the cascade popover.

  - The levels: project, repository, machine, source checkout, isolation
  - Then the base ref and the name
  - Add the recompute-below rule
  - Disable an offline machine and show its reason
  - Add the reason labels
  - Warn for a Machine that answers `machine_update_required`
  - Verify story tests for each label and a disabled machine
  - Verify an outdated daemon and a level with a single option

- [ ] 5.3 Enable the project page composer.

  - The file is `apps/web/app/(chat)/projects/[id]/project-prompt-input.tsx`
  - One send calls `POST /api/v1/chats` with the project
  - The send includes the chip's location, then opens the run stream
  - Keep the draft when the response carries a `workspace` failure
  - Show the warning chip
  - Verify the end-to-end test
  - Record `Closes #1328` in the PR body

- [ ] 5.4 Verify the layer locally.

  - `pnpm --filter web lint` and `typecheck`
  - The story tests

- [ ] 5.5 SR: self-review the parent-relative diff against `REVIEW_GUIDE.md`.

  - Check it against this layer's tasks
  - Record authored size and generated churn separately
  - Fix accepted findings, then mark ready

- [ ] 5.6 GR: complete the ready-PR monitoring loop.
  - Terminal green CI
  - No actionable unresolved feedback

## 6. `chat-start-location/composer-entry-points` — every other entry point and the header chip (design D10, D11)

- [ ] 6.1 Add the sidebar "New chat in project" and "New chat here".

  - Add the deep link with its pre-fill rules
  - The deep link is:
  - `/chat/new?project=&repository=&executor=&checkout=&worktree=1`
  - Add the isolation default that follows from the source chat
  - Verify every entry point in end-to-end tests

- [ ] 6.2 Add the read-only location chip to the chat header.

  - Read it from the bound root
  - Verify its story for a Machine root, a worktree root, and an unbound chat

- [ ] 6.3 Run the end-to-end suite.

  - A project page send that creates a filed, bound chat
  - A worktree start that shows its branch
  - A failed location that keeps the draft
  - An offline machine that cannot be chosen
  - An outdated daemon that shows the warning

- [ ] 6.4 Add the reference entry for the chip, the cascade, and the entries.

  - Add it to the docs index
  - Add a dated `CHANGELOG.md` entry
  - Verify that `pnpm lint:markdown` passes

- [ ] 6.5 Verify the layer locally.

  - `pnpm --filter web lint` and `typecheck`
  - The story tests and the end-to-end suite for the touched specs

- [ ] 6.6 SR: self-review the parent-relative diff against `REVIEW_GUIDE.md`.

  - Check it against this layer's tasks
  - Record authored size and generated churn separately
  - Fix accepted findings, then mark ready

- [ ] 6.7 GR: complete the ready-PR monitoring loop.
  - Terminal green CI
  - No actionable unresolved feedback

## 7. Finalize readiness (`chat-start-location/finalize`)

- [ ] 7.1 Enter `chat-start-location/finalize` with `$gh-stack` first.

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

- [ ] 7.2 Verify that every task above is checked.

  - Verify that `pnpm exec openspec validate --specs` passes
  - Verify that `pnpm exec openspec validate --all` passes
  - Record any strict-validation failure with evidence
  - The evidence shows that it also fails on `master`

- [ ] 7.3 Verify the finalize diff.
  - `pnpm lint:markdown`, `pnpm format:check`, and `git diff --check` pass
  - Record the archive readiness in the PR body

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
