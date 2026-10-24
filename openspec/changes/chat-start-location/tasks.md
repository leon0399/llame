Track no issue: no GitHub issue exists for this change, and Leo decided on
2026-10-24 to proceed without one, as for `remote-machines`. One layer owns
`Closes #1328`, the disabled project page composer this change enables. Read
[CONTRIBUTING](../../../CONTRIBUTING.md) for approval, publication, and merge
policy.

## Delivery stack

```text
master <- chat-start-location/proposal <- chat-start-location/project-links <- chat-start-location/chat-creation <- chat-start-location/composer <- chat-start-location/finalize
```

- `chat-start-location/proposal` (parent `master`): owns only `proposal.md`,
  `design.md`, the two delta spec files, and this file; estimated 500 to 700
  authored lines. The supporting research note
  `docs/research/product-vision/2026-10-24-project-repository-machine-association.md`
  and its index entry belong to the `repositories/proposal` layer. Both
  proposal layers can publish from the shared
  `proposals/repositories-and-chat-start-location` branch that already holds
  them.
- `chat-start-location/project-links` (parent `chat-start-location/proposal`):
  owns the project↔repository link, its per-executor defaults, the project
  default executor, the owner API, and the project page section that edits
  them; estimated 1,800 to 2,000 authored lines.
- `chat-start-location/chat-creation` (parent
  `chat-start-location/project-links`): owns `POST /api/v1/chats`, location
  resolution, the Run-free binding write, worktree creation at start, the optional first
  Run, the failure field, and the defaults write-back; estimated 1,800 to 2,000
  authored lines.
- `chat-start-location/composer` (parent `chat-start-location/chat-creation`):
  owns the location chip, the cascade popover, every entry point, and the
  read-only header chip; closes #1328; estimated 1,800 to 2,200 authored lines.
- `chat-start-location/finalize` (parent
  `chat-start-location/composer`): owns only spec synchronization, task
  records, and archive movement; estimated under 200 authored lines.

Create and move between layers with `$gh-stack`; implement with
`$openspec-apply-change`. Implementation starts only after Leo approves the
published proposal revision. Each layer completes self-review (SR) of its
actual parent-relative draft diff before draft to ready, then the GitHub review
(GR) loop of bots and current-head CI per CONTRIBUTING. Generated churn
(Drizzle metadata, the OpenAPI document, and the generated client) is reported
separately from authored size and counts zero toward the estimate.

This change starts only after the `repositories` change is canonical, which
means every `repositories` layer is merged through
`repositories/finalize`. It consumes that change's repository, checkout, and
lease tables, its `enter_workspace` worktree option, and its typed git methods.
Record the merge commit in the first PR body of this stack.

## 1. Proposal layer (`chat-start-location/proposal`)

- [ ] 1.1 Validate the change with `pnpm exec openspec validate chat-start-location --strict`, `pnpm exec markdownlint-cli2 "openspec/changes/chat-start-location/**/*.md"`, `pnpm exec prettier --check openspec/changes/chat-start-location`, and `git diff --check`, all passing; record any strict finding that comes from a canonical spec this change does not touch instead of fixing it
- [ ] 1.2 Run `$iterative-review-refinement` with at least two independent reviewers, verify each finding against code, canonical specs, or the grilling contract, and commit each review round separately
- [ ] 1.3 Self-review the published draft PR diff, mark it ready, and obtain Leo's approval of the published revision

## 2. `chat-start-location/project-links` — the link, its defaults, the default executor, and the project page section (design D8)

- [ ] 2.1 Add the two tables and the nullable `projects.default_executor_id` column to `apps/api/src/db/schema/`: the link with its alias, `is_primary`, and an `isolation` CHECK over `inherit`, `always_worktree`, and `never`, the unique pair, and a partial unique primary per project; the per-executor defaults with a unique pair and the main-checkout rule enforced on write; owner policies through the parent project, and hand-appended `ENABLE` and `FORCE ROW LEVEL SECURITY` per the `projects` precedent; verify `pnpm --filter api db:generate` reports no second diff, the migration applies to an empty database and to one that holds projects and chats, and `pg_class.relforcerowsecurity` is true for both tables ("A project links repositories with an alias, a primary, and an isolation policy", "A project can have a default executor")
- [ ] 2.2 Add the link, unlink, update, and default-executor routes to `apps/api/src/projects/` with DTOs and OpenAPI annotations, regenerate the document and the client, and verify controller and service tests for an alias, a primary switch that clears the previous primary in one transaction, every isolation value, a foreign project id answered 404, a repository the caller does not own answered 404, and a worktree checkout refused as a defaults target ("Project repository defaults remember the last chosen checkout per executor")
- [ ] 2.3 Add negative isolation integration tests: owner B cannot select, insert, update, or delete owner A's links, defaults, or default executor, and the API answers 404 for a foreign id; verify the database answers `42501` before the API maps it ("Project repository links are owner-isolated")
- [ ] 2.4 Make project deletion remove links and defaults only, leaving chats, their history, and their path strings intact; verify the integration test for a project with a link, a defaults row, and a filed chat ("Project repository links are deleted with the project")
- [ ] 2.5 Add the project page "Repositories" section: list and link from the owner catalog, unlink, set the primary, alias, and isolation policy, register a checkout by executor and path with the optional repository or remote selector, and list that project's worktrees with the owning chat and the guarded Remove action that calls the `repositories` change's removal route; verify the stories and Storybook story tests and return their preview URLs
- [ ] 2.6 Extend `docs/product/operator/repositories.md` with project linking, defaults, isolation, and the registration form, add the reference entries for the project routes, and add a dated `CHANGELOG.md` entry; verify `pnpm lint:markdown` passes
- [ ] 2.7 Verify the layer locally with `pnpm --filter api lint`, `typecheck`, the focused unit tests, `pnpm --filter api test:integration` for the new suites, `pnpm --filter web test`, and a clean second OpenAPI generation
- [ ] 2.8 SR: self-review the parent-relative diff against `REVIEW_GUIDE.md` and this layer's tasks, record authored size and generated churn separately, fix accepted findings, then mark ready
- [ ] 2.9 GR: complete the ready-PR monitoring loop with terminal passing CI and no actionable unresolved feedback

## 3. `chat-start-location/chat-creation` — the create request, resolution, the Run-free binding, worktree, first Run, and the failure field (design D9)

- [ ] 3.1 Add `CreateChatRequest` to `apps/api/src/chats/dto/chats.dto.ts` and the `POST /api/v1/chats` route to `apps/api/src/chats/chats.controller.ts`, sharing only the message-parts schema with `CreateMessageDto`, and regenerate the OpenAPI document and client; verify validation tests for a missing or malformed `id`, a message without `modelId`, an invalid `permissionMode`, a blank worktree name, and the two schemas staying distinct
- [ ] 3.2 Implement location resolution in the documented order with no silent primary, and verify table-driven tests for every default step: the request, the primary, the only linked repository, several linked repositories without a primary answered none, an offline executor skipped, and no checkout answered none ("Location resolution uses project defaults and never a silent primary")
- [ ] 3.3 Implement the Workspace step of creation: the shared path decisions for the source checkout and, when a worktree is requested, the computed worktree directory, both under the chat's permission mode with `default` for an omitted mode, leaving `WorkspaceBindingRepository.enter` and its Run fence unchanged; verify tests that a rejected submitted path and a rejected canonical path each answer `bind_failed` with the permission code, that a bypass mode records both decisions as bypass, and that the existing Workspace entry suite passes unchanged ("Creation order is chat record, workspace, worktree, then first Run")
- [ ] 3.4 Create the worktree through the `repositories` change's method when the request asks for one, and verify with real git in temporary repositories per the `temp-git-repo-tests` skill that the worktree checkout row, the lease, and the later binding agree, and that a failed add answers `worktree_failed` with no row and no binding written
- [ ] 3.5 Store the binding after the worktree step with `workspace_generation + 1`, then store the message and enqueue the first Run only after that, and verify an integration test where the create answers 201, `GET /api/v1/chats/:id/stream` replays the Run, a failed location stores no binding and no message and enqueues nothing, and the response carries the `workspace` status ("A failed workspace leaves the chat filed and unbound")
- [ ] 3.6 Add idempotency and isolation: a second create with an existing client id answers 409 and writes nothing, and a second owner cannot create into another owner's project, name another owner's repository, or bind another owner's checkout ("Chat creation is idempotent by client id", "Chat creation is owner-isolated")
- [ ] 3.7 Write the per-executor defaults row after a successful start, and verify that a second create with the same project and repository needs no location ids, and that a failed start leaves the previous row unchanged ("Project repository defaults remember the last chosen checkout per executor")
- [ ] 3.8 Verify the first-message path is unchanged: the existing `POST /api/v1/chats/:id/messages` suite passes without edits, and a locationless create-or-append still produces an unfiled chat ("The first-message creation path is unchanged")
- [ ] 3.9 Add the `POST /api/v1/chats` reference page with the request fields, the resolution order, the 201 body, and the failure statuses, and add a dated `CHANGELOG.md` entry; verify `pnpm lint:markdown` passes
- [ ] 3.10 Verify the layer locally with `pnpm --filter api lint`, `typecheck`, `test:coverage` for the new modules, the touched integration suites, and a clean second OpenAPI generation
- [ ] 3.11 SR: self-review the parent-relative diff against `REVIEW_GUIDE.md` and this layer's tasks, record authored size and generated churn separately, fix accepted findings, then mark ready
- [ ] 3.12 GR: complete the ready-PR monitoring loop with terminal passing CI and no actionable unresolved feedback

## 4. `chat-start-location/composer` — the chip, the cascade, every entry point, and the header chip; closes #1328 (design D10, D11)

- [ ] 4.1 Build the location chip with the reuse form, the worktree form, and the warning state, from one resolved-location module shared with the popover; verify stories and Storybook story tests for a reuse binding, a worktree binding, and an unresolvable step
- [ ] 4.2 Build the cascade popover with project, repository, machine, source checkout, isolation, base ref, and name, the recompute-below rule, an offline machine disabled with its reason, and the reason labels; verify story tests for each label, a disabled machine, and a level that resolves to a single option
- [ ] 4.3 Enable the project page composer in `apps/web/app/(chat)/projects/[id]/project-prompt-input.tsx` so one send calls `POST /api/v1/chats` with the project and the chip's location, then opens the run stream; keep the draft when the response carries a `workspace` failure and show the warning chip; verify the end-to-end test and record `Closes #1328` in the PR body
- [ ] 4.4 Add the sidebar "New chat in project", "New chat here", and the deep link `/chat/new?project=&repository=&executor=&checkout=&worktree=1`, including the pre-fill rules and the isolation default that follows from the source chat; verify every entry point in end-to-end tests
- [ ] 4.5 Add the read-only location chip to the chat header from the binding, and verify its story for a Machine root, a worktree root, and an unbound chat
- [ ] 4.6 Run the end-to-end suite for a project page send that creates a filed, bound chat, a worktree start that shows its branch, a failed location that keeps the draft, and an offline machine that cannot be chosen
- [ ] 4.7 Add the reference entry for the chip, the cascade, and the entry points to the docs index, and add a dated `CHANGELOG.md` entry; verify `pnpm lint:markdown` passes
- [ ] 4.8 Verify the layer locally with `pnpm --filter web lint`, `typecheck`, the story tests, and the end-to-end suite for the touched specs
- [ ] 4.9 SR: self-review the parent-relative diff against `REVIEW_GUIDE.md` and this layer's tasks, record authored size and generated churn separately, fix accepted findings, then mark ready
- [ ] 4.10 GR: complete the ready-PR monitoring loop with terminal passing CI and no actionable unresolved feedback

## 5. Finalize readiness (`chat-start-location/finalize`)

- [ ] 5.1 Enter `chat-start-location/finalize` with `$gh-stack` before any canonical spec is written, then run `$openspec-sync-specs` and verify `openspec/specs/chat-creation/spec.md` holds the capability purpose and all seven requirements, and `openspec/specs/projects/spec.md` holds the five added requirements without losing a canonical scenario
- [ ] 5.2 Verify every task above is checked, `pnpm exec openspec validate --specs` and `pnpm exec openspec validate --all` pass, and record any strict-validation failure with evidence that it also fails on `master`
- [ ] 5.3 Verify `pnpm lint:markdown`, `pnpm format:check`, and `git diff --check` pass on the finalize diff, and record the archive readiness in the PR body

## Workflow follow-up

- Archive the change with `$openspec-archive-change` after 5.3, and preserve
  the checked task history.
- After archive movement, self-review the finalize diff including every
  relative link that gained one `../`, mark the PR ready, and run the ready-PR
  monitoring loop as the finalize SR and GR gates.
- Monitor CI, bot reviews, and review threads on the finalize PR for at least
  15 minutes per `CONTRIBUTING.md`.
- Merge the stack through `$gh-stack` only with Leo's explicit permission.
