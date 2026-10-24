Track no issue: no GitHub issue exists for this change, and Leo decided on
2026-10-24 to proceed without one, as for `remote-machines`. One layer owns
`Closes #1328`, the `chat-start-location/composer-chip` layer that enables the
disabled project page composer. Read
[CONTRIBUTING](../../../CONTRIBUTING.md) for approval, publication, and merge
policy.

## Delivery stack

```text
master <- proposals/repositories-and-chat-start-location <- repositories/schema-and-registration <- repositories/executor-git <- repositories/workspace-worktree <- repositories/finalize <- chat-start-location/project-links-api <- chat-start-location/project-links-ui <- chat-start-location/chat-creation <- chat-start-location/composer-chip <- chat-start-location/composer-entry-points <- chat-start-location/finalize
```

- `proposals/repositories-and-chat-start-location` (parent `master`): one PR
  for both changes, without `$gh-stack`. It owns `proposal.md`, `design.md`,
  the delta spec files, this file, and the research note with its index
  entries.
- `chat-start-location/project-links-api` (parent `repositories/finalize`):
  owns the three tables, the `projects` unique key and nullable
  `projects.default_executor_id` column, the link, defaults, default-executor,
  and read routes, the negative RLS tests, and their docs; estimated under
  2,000 authored lines. Justification: the schema, its routes, and the RLS
  proofs form one migration story, and the project page can land after it.
- `chat-start-location/project-links-ui` (parent
  `chat-start-location/project-links-api`): owns the project page
  "Repositories" section, its register-checkout form and docs, the worktree
  list with the guarded Remove action, and its stories; estimated under 2,000
  authored lines. Justification: one UI surface with one story set reads the
  finished routes.
- `chat-start-location/chat-creation` (parent
  `chat-start-location/project-links-ui`): owns `POST /api/v1/chats`, the
  resolution order, the Run-free worktree and binding write, the creation
  record, the optional first Run, the failure statuses, and the defaults
  write-back; estimated under 2,000 authored lines. Justification: the route,
  its resolution, and its failure taxonomy are one contract with one test
  matrix.
- `chat-start-location/composer-chip` (parent
  `chat-start-location/chat-creation`): owns the location chip, the cascade
  popover, and the project page send; closes #1328; estimated under 2,000
  authored lines. Justification: the chip and the cascade share one
  resolved-location module and one send path.
- `chat-start-location/composer-entry-points` (parent
  `chat-start-location/composer-chip`): owns "New chat in project", "New chat
  here", the deep link, the read-only header chip, and the end-to-end suite;
  estimated under 2,000 authored lines. Justification: every remaining entry
  point reuses the chip and needs the end-to-end proof.
- `chat-start-location/finalize` (parent
  `chat-start-location/composer-entry-points`): owns only spec synchronization,
  task records, and archive movement; estimated under 200 authored lines.

Exception to the stack rules, named and one-off: Leo decided on 2026-10-24 that
both changes publish as ONE proposal PR from
`proposals/repositories-and-chat-start-location`, without `$gh-stack`, with the
research note included, as `remote-machines` did. On 2026-10-25 he decided that
implementation is one chain from `master`, with `$gh-stack`, one `<change>/...`
branch per layer, and each change's finalize in the chain. The authored size
measured with `wc -l` is about 2,200 lines for `repositories` and about 1,800
for `chat-start-location`, and the research note adds about 420. Splitting the
proposal into two PRs is rejected.

Each layer completes self-review (SR) of its actual parent-relative draft diff
before draft to ready, then the GitHub review (GR) loop of bots and current-head
CI per CONTRIBUTING. Generated churn (Drizzle metadata, the OpenAPI document,
and the generated client) is reported separately from authored size and counts
zero toward the estimate.

Implementation layers start only after every `repositories` layer merges
through `repositories/finalize`, which is the direct parent of
`chat-start-location/project-links-api` in the one chain. This change consumes
that change's repository, checkout, and lease tables, its `enter_workspace`
worktree option, and its typed git methods. Record that merge commit in the
`chat-start-location/project-links-api` PR body. Implement with
`$openspec-apply-change` after Leo approves the published proposal revision.

## 1. Proposal layer (`proposals/repositories-and-chat-start-location`)

- [ ] 1.1 Validate the change with `pnpm exec openspec validate chat-start-location --strict`, `pnpm exec markdownlint-cli2 "openspec/changes/chat-start-location/**/*.md"`, `pnpm exec prettier --check openspec/changes/chat-start-location`, and `git diff --check`, all passing; record any strict finding that comes from a canonical spec this change does not touch instead of fixing it
- [ ] 1.2 Run `$iterative-review-refinement` with at least two independent reviewers, verify each finding against code, canonical specs, or the grilling contract, and commit each review round separately
- [ ] 1.3 Record the named one-PR exception above and its measured authored size in the proposal PR body
- [ ] 1.4 Self-review the published draft PR diff, mark it ready, and obtain Leo's approval of the published revision

## 2. `chat-start-location/project-links-api` — the link, its defaults, the default executor, and their routes (design D8)

- [ ] 2.1 Add `project_repositories`, `project_repository_defaults`, and `chat_creation_records` to `apps/api/src/db/schema/`: the link with its `owner_user_id`, alias, `is_primary`, and an `isolation` CHECK over `inherit`, `always_worktree`, and `never`, the unique triple and the partial unique primary per project; the per-executor defaults with `owner_user_id`, a unique `(owner_user_id, link, executor)` pair, an `updated_at` stamp on every write, and the main-checkout rule enforced on write; the creation record with `decisions` jsonb, `created_at`, and one row per chat; composite owner foreign keys with unique `(owner_user_id, id)` keys on `projects` and the link table and `ON DELETE CASCADE` only on those composite edges; add the nullable `projects.default_executor_id` column; declare owner policies with `pgPolicy` plus `.enableRLS()` and hand-append `FORCE ROW LEVEL SECURITY` per the `projects` precedent; verify `pnpm --filter api db:generate` reports no second diff, the migration applies to an empty database, and an integration test shows the cascades of the composite owner edges ("A project links repositories with an alias and a primary link", "Project repository defaults remember the last chosen checkout per executor")
- [ ] 2.2 Add the link, unlink, update, and default-executor write routes to `apps/api/src/projects/`, and the two read routes `GET /api/v1/projects/:id/repositories` and `GET /api/v1/projects/:id/start-location?repositoryId=&executorId=&checkoutId=`, with DTOs and OpenAPI annotations, regenerate the document and the client, and verify controller and service tests for an alias, a primary switch that clears the previous primary in one transaction, every isolation value, a foreign project id answered 404, a repository the caller does not own answered 404, a write to an archived project answered 409 that changes nothing, the link read returning each defaults row with `updated_at`, and the start-location read returning the same resolution as a create with no write ("A project links repositories with an alias and a primary link", "An isolation policy selects the default isolation of a chat start", "A project can have a default executor", "The owner reads a project's links and their defaults", "The owner previews the start location without effects")
- [ ] 2.3 Add negative isolation integration tests: owner B cannot select, insert, update, or delete owner A's links, defaults, or default executor; verify that SELECT returns no rows, UPDATE and DELETE affect 0 rows, INSERT raises `42501`, the API answers 404 for a foreign id, and an insert of a link or defaults row that names another owner's repository or checkout fails with `23503` ("Project repository links are owner-isolated")
- [ ] 2.4 Make project deletion remove links and defaults only, and make a deleted checkout and an unlinked repository remove their defaults; verify integration tests for a project with a link, a defaults row, and a filed chat, for a deleted main checkout that leaves no default, and for an unlink that removes the link's defaults ("Project repository links are deleted with the project")
- [ ] 2.5 Extend `docs/product/operator/repositories.md` with project linking, defaults, and isolation, add the reference entries for the project write and read routes, and add a dated `CHANGELOG.md` entry; verify `pnpm lint:markdown` passes
- [ ] 2.6 Verify the layer locally with `pnpm --filter api lint`, `typecheck`, the focused unit tests, `pnpm --filter api test:integration` for the new suites, and a clean second OpenAPI generation
- [ ] 2.7 SR: self-review the parent-relative diff against `REVIEW_GUIDE.md` and this layer's tasks, record authored size and generated churn separately, fix accepted findings, then mark ready
- [ ] 2.8 GR: complete the ready-PR monitoring loop with terminal passing CI and no actionable unresolved feedback

## 3. `chat-start-location/project-links-ui` — the project page Repositories section (design D8, D10)

- [ ] 3.1 Add the project page "Repositories" section: list and link from the owner catalog, unlink, set the primary, alias, and isolation policy, register a checkout by `path` with the executor derived from that path, and list that project's worktrees with the owning chat and the guarded Remove action that calls the `repositories` change's removal route; document the registration form in the operator page; verify the stories and Storybook story tests and return their preview URLs
- [ ] 3.2 Verify the layer locally with `pnpm --filter web lint`, `typecheck`, the story tests, and the focused page tests
- [ ] 3.3 SR: self-review the parent-relative diff against `REVIEW_GUIDE.md` and this layer's tasks, record authored size and generated churn separately, fix accepted findings, then mark ready
- [ ] 3.4 GR: complete the ready-PR monitoring loop with terminal passing CI and no actionable unresolved feedback

## 4. `chat-start-location/chat-creation` — the create request, resolution, the Run-free binding, worktree, first Run, and the failure statuses (design D9)

- [ ] 4.1 Add `CreateChatRequest` and `CreateChatMessageDto { id, parts, modelId, effort?, permissionMode? }` to `apps/api/src/chats/dto/chats.dto.ts` and the `POST /api/v1/chats` route to `apps/api/src/chats/chats.controller.ts`, sharing only the message-parts schema with `CreateMessageDto` and not reusing `CreateMessageBodyDto`; regenerate the OpenAPI document and client; verify validation tests for a missing or malformed chat `id`, a missing `message.id`, a message without `modelId`, an invalid `permissionMode`, a blank worktree name, a `baseRef` that starts with `-`, and the two request schemas staying distinct ("A chat can be created with its project and location in one request", "A create request with a message validates it before any write")
- [ ] 4.2 Implement location resolution in the D9 order with no silent primary and with explicit ids overriding every remembered default: the request, the primary link, the single link, then none; executor from the request, the remembered default, `projects.default_executor_id`, the only executor that holds a `main` checkout, then the online executor with the lowest id that holds a main checkout of the repository; checkout from the request, the remembered default for the link and executor, then the only `main` checkout on that executor; verify table-driven tests for every step, for several linked repositories without a primary answered none, for implicit steps that skip an offline Machine, for an explicit executor or remembered default that names an offline Machine answered `machine_unavailable`, for a local executor that equals this process's `tools.nativeExecutorId`, for an explicit `executorId` that names no configured executor answered 422 `executor_unknown`, and for two defaults rows where the later `updated_at` wins ("Location resolution uses project defaults and never a silent primary", "Executor resolution skips offline Machines on implicit steps", "Only an explicit executor or remembered default names an offline Machine", "Project repository defaults remember the last chosen checkout per executor")
- [ ] 4.3 Implement the Workspace step of creation by reusing the `repositories` change's decision function, with the four ordered decisions: the submitted checkout path before any probe, the canonical source clone before any git call, the inspected main working tree after the read-only `git.inspect`, and the canonical worktree directory before `git.worktreeAdd`; use the request's `message.permissionMode` with `default` for an omitted mode, evaluated against this process's config; apply the entry gates; record every decision, including a bypass decision, in the chat's creation record with the provenance fields of a derived decision; leave `WorkspaceBindingRepository.enter` and its Run fence unchanged; verify tests for a `bypass` request on a process without bypass answered 422 before any store, a rejected submitted path, a rejected canonical path, a rejected source clone, and a rejected worktree directory each answered `bind_failed` with `code` `permission_denied` before any git command, a missing allowlist answered `bind_failed` with `code` `tool_not_allowed`, a missing native executor answered `bind_failed` with `code` `executor_unavailable`, an archived or missing source answered `bind_failed` with `code` `not_found`, the recorded decisions for a `default` request and for a `bypass` request, and `GET /api/v1/chats/:id/creation-record` answered for the owner and 404 for another owner ("The Workspace step uses the request permission mode", "The Workspace step requires the entry gates", "A rejected path refuses the binding before any git command", "Chat-creation path decisions are recorded with the chat")
- [ ] 4.4 Add the Run-free worktree step: run `git.worktreeAdd` for a registered `main` source under the chat's per-creation lock, then commit the worktree checkout row, its lease with `chat_id` and a null `tool_call_id`, and the binding in one transaction, with one creation lease per chat; verify with real git in temporary repositories per the `temp-git-repo-tests` skill that no removal path exists, that a failed add answers `worktree_failed` with no row and no binding written, and that a crash before the commit leaves a directory with no rows ("The creation worktree commits with its lease and binding", "A failed workspace leaves the chat filed and unbound")
- [ ] 4.5 Store the binding after the worktree step with `workspace_generation + 1`, because a creation binding counts as an entry that establishes a binding; then commit the message and its Run row together and enqueue the Run after that commit; verify integration tests where the create answers 201 with `workspace.status` `bound` and `GET /api/v1/chats/:id/stream` replays the Run, where `workspace.status` `unbound` stores the message and starts the Run, where an enqueue failure fails the Run and answers 5xx with the message stored, where a `outcome_unknown` carries `leftDirectory`, where `code` is present only for `bind_failed` and `worktree_failed` and every other failure carries `message`, and where the same binding is visible to the first Run ("Creation runs its steps in one fixed order", "The response workspace object has one closed status set", "An unresolved location stores the message and starts the Run", "Failure statuses name their cause", "The message step commits the message and its Run before the enqueue", "The Workspace binding is Chat-scoped and persists across Runs")
- [ ] 4.6 Validate every named owner id (project, repository, checkout) under owner RLS in the transaction that inserts the chat, and validate `executorId` against configuration instead of RLS: a foreign or missing owner id answers 404 with no chat stored, an archived project answers 409 with no chat stored, and an unconfigured executor id answers 422 `executor_unknown`; make a named `checkoutId` decide its repository and executor, with a worktree checkout, a disagreeing `repositoryId` or `executorId`, and an unlinked `repositoryId` each answered 422 before any write ("Chat creation is owner-isolated", "A named checkout decides its repository and executor")
- [ ] 4.7 Add the per-chat advisory lock and the resend behavior: take `pg_try_advisory_xact_lock` on the chat id for the whole request and answer 409 `creation_in_progress` to an overlapping same-id create; a resend on the owner's stored chat that holds no message re-runs the remaining steps and reuses the creation lease and binding, a stored chat that holds a message answers 409 and the client uses the message route, a resend into an archived chat or project answers 409, a resend with a different `projectId` answers 409 `project_mismatch`, and another owner's chat id answers 404 with no disclosure; verify that two concurrent creates with one id create one worktree ("Creation serializes requests for one chat id", "A resent create request reuses the stored chat and its binding", "A resend refuses an archived chat or another project")
- [ ] 4.8 Write the per-executor defaults row with its `updated_at` after a successful start, recording the source `main` checkout for the link and executor, including a worktree start; verify that a second create with the same project and repository needs no location ids, that a failed start leaves the previous row unchanged, that a worktree checkout is refused as a defaults target, and that a deleted checkout or an unlink leaves no default ("Project repository defaults remember the last chosen checkout per executor")
- [ ] 4.9 Verify the first-message path is unchanged: the existing `POST /api/v1/chats/:id/messages` suite passes without edits, and a locationless create-or-append still produces an unfiled chat with no binding ("The first-message creation path is unchanged")
- [ ] 4.10 Add the `POST /api/v1/chats` reference page with the request fields, the resolution order, the 201 body, the closed status set, the cause codes, and the `GET /api/v1/chats/:id/creation-record` route, and add a dated `CHANGELOG.md` entry; verify `pnpm lint:markdown` passes
- [ ] 4.11 Verify the layer locally with `pnpm --filter api lint`, `typecheck`, `test:coverage` for the new modules, the touched integration suites, and a clean second OpenAPI generation
- [ ] 4.12 SR: self-review the parent-relative diff against `REVIEW_GUIDE.md` and this layer's tasks, record authored size and generated churn separately, fix accepted findings, then mark ready
- [ ] 4.13 GR: complete the ready-PR monitoring loop with terminal passing CI and no actionable unresolved feedback

## 5. `chat-start-location/composer-chip` — the chip, the cascade, and the project page send; closes #1328 (design D10)

- [ ] 5.1 Build the location chip with the reuse form, the worktree form, and the warning state, from one resolved-location module shared with the popover that reads `GET /api/v1/projects/:id/repositories` and the start-location route; verify stories and Storybook story tests for a reuse binding, a worktree binding, and an unresolvable step ("The owner reads a project's links and their defaults", "The owner previews the start location without effects")
- [ ] 5.2 Build the cascade popover with project, repository, machine, source checkout, isolation, base ref, and name, the recompute-below rule, an offline machine disabled with its reason, the reason labels, and a warning for a Machine that answers `machine_update_required`; verify story tests for each label, a disabled machine, an outdated daemon, and a level that resolves to a single option
- [ ] 5.3 Enable the project page composer in `apps/web/app/(chat)/projects/[id]/project-prompt-input.tsx` so one send calls `POST /api/v1/chats` with the project and the chip's location, then opens the run stream; keep the draft when the response carries a `workspace` failure and show the warning chip; verify the end-to-end test and record `Closes #1328` in the PR body
- [ ] 5.4 Verify the layer locally with `pnpm --filter web lint`, `typecheck`, and the story tests
- [ ] 5.5 SR: self-review the parent-relative diff against `REVIEW_GUIDE.md` and this layer's tasks, record authored size and generated churn separately, fix accepted findings, then mark ready
- [ ] 5.6 GR: complete the ready-PR monitoring loop with terminal passing CI and no actionable unresolved feedback

## 6. `chat-start-location/composer-entry-points` — every other entry point and the header chip (design D10, D11)

- [ ] 6.1 Add the sidebar "New chat in project", "New chat here", and the deep link `/chat/new?project=&repository=&executor=&checkout=&worktree=1`, including the pre-fill rules and the isolation default that follows from the source chat; verify every entry point in end-to-end tests
- [ ] 6.2 Add the read-only location chip to the chat header from the binding, and verify its story for a Machine root, a worktree root, and an unbound chat
- [ ] 6.3 Run the end-to-end suite for a project page send that creates a filed, bound chat, a worktree start that shows its branch, a failed location that keeps the draft, an offline machine that cannot be chosen, and an outdated daemon that shows the warning
- [ ] 6.4 Add the reference entry for the chip, the cascade, and the entry points to the docs index, and add a dated `CHANGELOG.md` entry; verify `pnpm lint:markdown` passes
- [ ] 6.5 Verify the layer locally with `pnpm --filter web lint`, `typecheck`, the story tests, and the end-to-end suite for the touched specs
- [ ] 6.6 SR: self-review the parent-relative diff against `REVIEW_GUIDE.md` and this layer's tasks, record authored size and generated churn separately, fix accepted findings, then mark ready
- [ ] 6.7 GR: complete the ready-PR monitoring loop with terminal passing CI and no actionable unresolved feedback

## 7. Finalize readiness (`chat-start-location/finalize`)

- [ ] 7.1 Enter `chat-start-location/finalize` with `$gh-stack` before any canonical spec is written, re-base the `specs/workspace-entry/spec.md` MODIFIED block on the canonical requirement (it is written against the `repositories` change's delta text), then run `$openspec-sync-specs` and verify `openspec/specs/chat-creation/spec.md` holds the capability purpose and every added requirement, `openspec/specs/projects/spec.md` holds every added requirement without losing a canonical scenario, `openspec/specs/tool-call-permissions/spec.md` holds "Chat-creation path decisions are recorded with the chat", and `openspec/specs/workspace-entry/spec.md` admits the owner's authenticated chat-creation request as the second binding writer and keeps every canonical scenario
- [ ] 7.2 Verify every task above is checked, `pnpm exec openspec validate --specs` and `pnpm exec openspec validate --all` pass, and record any strict-validation failure with evidence that it also fails on `master`
- [ ] 7.3 Verify `pnpm lint:markdown`, `pnpm format:check`, and `git diff --check` pass on the finalize diff, and record the archive readiness in the PR body

## Workflow follow-up

- Archive the change with `$openspec-archive-change` after 7.3, and preserve
  the checked task history.
- After archive movement, self-review the finalize diff including every
  relative link that gained one `../`, mark the PR ready, and run the ready-PR
  monitoring loop as the finalize SR and GR gates.
- Monitor CI, bot reviews, and review threads on the finalize PR for at least
  15 minutes per `CONTRIBUTING.md`.
- Merge the stack through `$gh-stack` only with Leo's explicit permission.
