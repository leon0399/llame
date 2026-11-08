# Tasks

Track [#1615](https://github.com/leon0399/llame/issues/1615) under the tracker
[#1614](https://github.com/leon0399/llame/issues/1614), and the PRs of this
change, through [Project tracking](../../../CONTRIBUTING.md#project-tracking).
Implementation waits for Leo's approval of the published proposal.

## Delivery stack

Use `$gh-stack` for every branch operation and `$openspec-apply-change` for
each implementation layer.

```text
master
  <- git-awareness/proposal
  <- git-awareness/executor
  <- git-awareness/machine
  <- git-awareness/snapshot
  <- git-awareness/producer
  <- git-awareness/route
  <- git-awareness/session-details
  <- git-awareness/finalize
```

| Layer             | Parent            | Ownership                                                                                     | Authored estimate | Closes       |
| ----------------- | ----------------- | --------------------------------------------------------------------------------------------- | ----------------- | ------------ |
| `proposal`        | `master`          | Proposal, design, deltas, and this list.                                                      | ~1,100            | none         |
| `executor`        | `proposal`        | `locate` and `state` in `packages/git-executor` and their protocol types, with fixture tests. | ~1,600            | none         |
| `machine`         | `executor`        | Daemon and hub methods, handshake list, removal guard, deletion of `git.status`, docs.        | ~1,500            | none         |
| `snapshot`        | `machine`         | The snapshot service: admission, bounds, normalization, neutralization, template.             | ~1,300            | none         |
| `producer`        | `snapshot`        | The `git` producer, told columns, entry result field, compaction instruction, docs.           | ~1,900            | none         |
| `route`           | `producer`        | The owner route, its DTO, OpenAPI, and the regenerated client.                                | ~700              | none         |
| `session-details` | `route`           | The Repository block in Session details, stories, CHANGELOG.                                  | ~800              | #1615, #1417 |
| `finalize`        | `session-details` | Spec sync, task records, archive.                                                             | ~1,000            | none         |

Generated files count zero and are reported apart: the Drizzle snapshot in
`producer`, `apps/api/openapi.json` and `apps/web/lib/api/generated/` in
`route`. Re-estimate each layer against its parent before publication; split a
layer that grows past about 2,000 authored lines.

## 1. proposal

- [ ] 1.1 Create `git-awareness/proposal` from `master` with `$gh-stack`; write `proposal.md`, `design.md`, the five deltas, and this list; verify `pnpm exec openspec validate git-awareness --strict`, `pnpm lint:markdown`, `pnpm format:check`, `git diff --check`.
- [ ] 1.2 Run two review rounds with two independent reviewers each against code and canonical specs; verify each finding; commit each round separately and record it in the design revision history.
- [ ] 1.3 Obtain Leo's confirmation of the `git.locate` deviation and his publication approval; publish the draft with `$gh-stack`; self-review (SR); mark ready; run the GitHub review loop (GR); obtain Leo's approval of the published revision; update the Project.

## 2. executor

- [ ] 2.1 Create `git-awareness/executor` from `proposal` with `$gh-stack`.
- [ ] 2.2 Add `locateRepository({path, ceiling?})` with a stat walk and no git process, and its protocol result types; verify fixture tests for a directory entry, a `.git` file, a plain folder, and a ceiling that hides `/srv/.git` (scenarios of `The git entry is found without a git process`).
- [ ] 2.3 Add `stateRepository({path, gitEntry, limit, submodules})` with the D2 argv inside one 3 s deadline, the `git_entry_changed` and `output_bound` failures, and its protocol result types; verify fixture tests against real git for every scenario of `The snapshot reports the repository state`, `Ahead and behind are dated by the last fetch`, `Changed paths are listed with the root first`, `The snapshot states each omission`, and `Submodules are listed but not read`, plus `submodules: "check"` on a dirty submodule.
- [ ] 2.4 Verify a fixture repository with 2 staged, 1 unstaged, and 1 untracked file and an upstream matches `git status --porcelain=v2 --branch` field by field; verify `withSlowGit` ends at 3 s as `timed_out`.
- [ ] 2.5 Run `pnpm --filter @workspace/git-executor lint typecheck test:coverage`, `pnpm format:check`, `git diff --check`; publish; SR; ready; GR; update the Project.

## 3. machine

- [ ] 3.1 Create `git-awareness/machine` from `executor` with `$gh-stack`.
- [ ] 3.2 Replace `git.status` with `git.locate` and `git.state` in `GIT_METHODS`, the protocol method maps, the daemon dispatch with registered-root confinement and locator results, and `ExecutorGit` with result readers; verify daemon tests for `Locate starts no git process`, `State refuses a changed git entry`, and `A repository above the registered root is not found`, and hub tests for `A daemon without the state method asks for an update` and `Outdated daemon asks for an update`.
- [ ] 3.3 Move `refuseUnsafe` onto `git.locate` and `git.state` with `submodules: "check"`; delete `statusRepository`, `GIT_STATUS_METHOD`, `readGitStatusResult`, and every test and doc reference; verify the existing guard tests pass unchanged in intent and `Worktree removal reads the state method` passes with a dirty submodule kept.
- [ ] 3.4 Update `docs/product/operator/machines.md` and `docs/product/operator/repositories.md` method lists; add the dated **BREAKING** CHANGELOG entry for daemon updates.
- [ ] 3.5 Run affected `lint`, `typecheck`, and `test:coverage` for `machine-protocol`, `machine`, and `api`, the API integration tests for checkouts on Machines, `pnpm lint:markdown`, `pnpm format:check`, `git diff --check`; publish; SR; ready; GR; update the Project.

## 4. snapshot

- [ ] 4.1 Create `git-awareness/snapshot` from `machine` with `$gh-stack`.
- [ ] 4.2 Add the snapshot service with the D6 sequence and an admission callback; verify unit tests with fake executors for each scenario of `Only a bound Chat has observed git state`, `Git state needs read admission of the git entry`, `Absence lines are fixed messages`, and `The git read is bounded and never blocks entry`.
- [ ] 4.3 Wire admission to `previewToolPermission` and `tools.allowed`; verify tests for each scenario of `The git entry check is a named synthetic read evaluation` and `The git entry check obeys modes and rejects`, including `Read-only mode keeps git state`.
- [ ] 4.4 Add the `git-snapshot.md` template, `normalizeRemote` use, length limits, and `sanitizeAuthoredText`; verify each scenario of `Recent commits and remotes are reported`, `Remote credentials never reach the snapshot`, and `Repository text is untrusted`.
- [ ] 4.5 Run api `lint`, `typecheck`, and focused tests, `pnpm format:check`, `git diff --check`; publish; SR; ready; GR; update the Project.

## 5. producer

- [ ] 5.1 Create `git-awareness/producer` from `snapshot` with `$gh-stack`.
- [ ] 5.2 Add `git_told` and `git_told_from` to `chats` with `pnpm db:generate`; verify migration idempotence and an RLS negative test that owner B cannot read owner A's columns.
- [ ] 5.3 Add `git` to `CONTEXT_ITEM_PRODUCERS` after `workspace`, the `deriveGitContext` step, dispatch writes, checkpoint reset, and the unbound clear; verify each scenario of `The git producer tells changed state`, `The git told state follows the rail rules`, `Exit and detach clear the git told state`, and `Workspace and git snapshots share a turn`.
- [ ] 5.4 Add the `git` field to every successful `enter_workspace` result and mention it in `apps/api/src/prompts/tools/enter_workspace.md`; verify each scenario of `Entry results carry the git snapshot`.
- [ ] 5.5 Name the `git` producer in the compaction instruction; verify `The summary instruction names the git producer`.
- [ ] 5.6 Document the snapshot in `docs/product/reference/` with the absence lines and bounds, update `docs/product/reference/tools/enter-workspace.md` Result, and add the dated CHANGELOG entry.
- [ ] 5.7 Run api `lint`, `typecheck`, `test:coverage`, the API integration suite for chats and compaction, `pnpm lint:markdown`, `pnpm format:check`, `git diff --check`; publish; SR; ready; GR; update the Project.

## 6. route

- [ ] 6.1 Create `git-awareness/route` from `producer` with `$gh-stack`.
- [ ] 6.2 Add `GET /api/v1/chats/:id/git-state` with the allow-all admission and the `status` union DTO; verify each scenario of `The owner reads live git state for a Chat` and an integration test for each scenario of `The git state route is owner-isolated`.
- [ ] 6.3 Regenerate with `pnpm generate:api-client`; verify `pnpm lint:openapi` and a clean second generation diff.
- [ ] 6.4 Run api `lint`, `typecheck`, focused and integration tests, `pnpm format:check`, `git diff --check`; publish; SR; ready; GR; update the Project.

## 7. session-details

- [ ] 7.1 Create `git-awareness/session-details` from `route` with `$gh-stack`.
- [ ] 7.2 Replace `BranchRow` with a Repository block fed by the route on open and window focus; verify stories for each scenario of `Session details shows the live repository state` with Storybook story tests.
- [ ] 7.3 Add the dated CHANGELOG entry; put `Closes #1615` and `Closes #1417` in the PR body.
- [ ] 7.4 Run web `lint`, `typecheck`, `test:coverage`, the story tests, `pnpm format:check`, `git diff --check`; publish; SR; ready; GR; update the Project.

## 8. finalize

- [ ] 8.1 Create `git-awareness/finalize` from `session-details` with `$gh-stack` before any sync write.
- [ ] 8.2 Run `$openspec-sync-specs`; verify `pnpm exec openspec validate --specs --strict` and `pnpm exec openspec validate --all --strict`.
- [ ] 8.3 Confirm every task above is checked and the `session-details` PR lists #1615 and #1417 as closing references.

## Workflow follow-up

- Run `$openspec-archive-change` after readiness; verify `pnpm lint:markdown`, `pnpm format:check`, `git diff --check`; then publish the finalize PR, SR, ready, and GR as post-archive gates.
- Deferred children of #1614: #1616, #1617, #1618.
