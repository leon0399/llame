# Tasks

Track [#1615](https://github.com/leon0399/llame/issues/1615) under the tracker
[#1614](https://github.com/leon0399/llame/issues/1614), and the PRs of this
change, through [Project tracking](../../../CONTRIBUTING.md#project-tracking).
Implementation waits for Leo's approval of the published proposal, including
deviations V1-V5.

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
  <- git-awareness/entry-result
  <- git-awareness/route
  <- git-awareness/session-details
  <- git-awareness/finalize
```

| Layer             | Parent            | Ownership                                                                                               | Authored estimate | Closes       |
| ----------------- | ----------------- | ------------------------------------------------------------------------------------------------------- | ----------------- | ------------ |
| `proposal`        | `master`          | Proposal, design, deltas, and this list.                                                                | ~1,500            | none         |
| `executor`        | `proposal`        | `locate` and `state` in `packages/git-executor`, the truncation flag, protocol types, fixture tests.    | ~1,800            | none         |
| `machine`         | `executor`        | Daemon and hub methods with root confinement and deadlines, removal guard, `git.status` deletion, docs. | ~1,700            | none         |
| `snapshot`        | `machine`         | The snapshot service: admission, failure mapping, bounds, quoting, remotes, neutralization, template.   | ~1,400            | none         |
| `producer`        | `snapshot`        | Told columns and migration, Chat fixtures, the `git` producer, precedence, checkpoint and exit rules.   | ~1,800            | none         |
| `entry-result`    | `producer`        | The `enter_workspace` `git` field, tool prompt, compaction instruction, reference docs, CHANGELOG.      | ~700              | none         |
| `route`           | `entry-result`    | The owner route, its DTO, OpenAPI, and the regenerated client.                                          | ~700              | none         |
| `session-details` | `route`           | The Repository block in Session details, stories, CHANGELOG.                                            | ~800              | #1615, #1417 |
| `finalize`        | `session-details` | Spec sync, task records, archive.                                                                       | ~1,500            | none         |

Generated files count zero and are reported apart: the Drizzle snapshot in
`producer`, `apps/api/openapi.json` and `apps/web/lib/api/generated/` in
`route`. Re-estimate each layer against its parent before publication; split a
layer that grows past about 2,000 authored lines.

## 1. proposal

- [ ] 1.1 Create `git-awareness/proposal` from `master` with `$gh-stack`; write `proposal.md`, `design.md`, the five deltas, and this list; verify `pnpm exec openspec validate git-awareness --strict`, `pnpm lint:markdown`, `pnpm format:check`, `git diff --check`.
- [ ] 1.2 Run two review rounds with two independent reviewers each against code, git, and canonical specs; verify each finding; commit each round separately and record it in the design revision history.
- [ ] 1.3 Obtain Leo's confirmation of deviations V1-V5 and his publication approval; publish the draft with `$gh-stack`; self-review (SR); mark ready; run the GitHub review loop (GR); obtain Leo's approval of the published revision; update the Project.

## 2. executor

- [ ] 2.1 Create `git-awareness/executor` from `proposal` with `$gh-stack`.
- [ ] 2.2 Add a `truncated` flag to `run.ts` and an `output_bound` member to `GitFailure`; verify a test that a stdout above 1 MiB reports `truncated`.
- [ ] 2.3 Add `locateRepository({path, ceiling?})` with a stat walk and no git process, and its protocol result types; verify fixture tests for `A subdirectory root finds the repository entry`, `A linked worktree uses its own .git file`, `A plain folder is not a repository`, and a ceiling that returns `no_repository_in_root`.
- [ ] 2.4 Add `stateRepository({path, gitEntry, limit, submodules, timeoutMs})` with the D1 re-locate and `--git-dir`/`--work-tree` pinning, the D2 argv, `log.showSignature=false`, and the `git_entry_changed`, `output_bound`, and `outside_registered_root` failures; verify `An invalid nearest entry does not expose a parent repository` and a repository config with `log.showSignature` and a `gpg.program` marker that never runs.
- [ ] 2.5 Verify executor fixture tests against real git for `Fields match git`, `A detached HEAD is reported`, `A rebase in progress is reported`, `A merge conflict is reported`, `An am session is not reported as a rebase`, `An unborn branch is reported`, `Behind is dated`, `A linked worktree sees the main clone's fetch`, `No update record`, `A gone upstream is reported`, `Paths are relative to a subdirectory root`, `Root paths come first`, `Paths above the bound are counted` (entries and `omitted`), `An untracked directory is one entry`, `A submodule is listed without its state`, and `Five commits are listed`, plus `submodules: "check"` on a dirty submodule and a 3 s timeout as `timed_out`.
- [ ] 2.6 Run `pnpm --filter @workspace/git-executor` and `@workspace/machine-protocol` `lint`, `typecheck`, `test:coverage`, `pnpm format:check`, `git diff --check`; publish; SR; ready; GR; update the Project.

## 3. machine

- [ ] 3.1 Create `git-awareness/machine` from `executor` with `$gh-stack`.
- [ ] 3.2 Replace `git.status` with `git.locate` and `git.state` in `GIT_METHODS`, the method maps, the daemon dispatch with the outermost-root ceiling, gitdir, common directory, and alternate checks, and locator results; verify daemon tests for `Locate starts no git process`, `State refuses a changed git entry`, `A repository above the registered root is not found`, and `An outside common directory is refused`.
- [ ] 3.3 Add `locate` and `state` to `ExecutorGit` with result readers and a 5 s wall-clock deadline with an abort signal for model-facing calls; verify hub tests for `A daemon without the state method asks for an update`, `Outdated daemon asks for an update`, `Handshake with an old daemon still succeeds`, and a session that does not open within 5 s.
- [ ] 3.4 Move `refuseUnsafe` onto `git.locate` and `git.state` with `submodules: "check"` and the 10 s default; delete `statusRepository`, `GIT_STATUS_METHOD`, `readGitStatusResult`, and every test and doc reference; verify the existing scenarios of `Worktree removal is owner-initiated and guarded`, every scenario of `Worktree removal reads a complete worktree state` (`A gone upstream fails closed`, `A dirty submodule keeps the worktree`, `An unreadable state keeps the worktree`, `Worktree removal reads the state method`), and `Locate starts no git process` of `Executors expose typed git operations`.
- [ ] 3.5 Update `docs/product/operator/machines.md` and `docs/product/operator/repositories.md` method lists; add the dated **BREAKING** CHANGELOG entry for daemon updates.
- [ ] 3.6 Run affected `lint`, `typecheck`, and `test:coverage` for `machine-protocol`, `machine`, and `api`, the API integration tests for checkouts on Machines, `pnpm lint:markdown`, `pnpm format:check`, `git diff --check`; publish; SR; ready; GR; update the Project.

## 4. snapshot

- [ ] 4.1 Create `git-awareness/snapshot` from `machine` with `$gh-stack`.
- [ ] 4.2 Add the snapshot service with the D6 sequence, an admission callback, and the failure map; verify service tests with fake executors that render each line of `Absence reasons are a closed list` and the service outcome of `An offline Machine is reported`, `An outdated daemon is reported`, `A git failure is reported without its error text`, `Too much status output is reported`, `A changed entry is a git failure`, `A slow repository times out`, `A slow Machine session times out`, `A repository above the registered root is not reported as absent`, and `A linked worktree with an outside main clone is refused`.
- [ ] 4.3 Wire model admission to `tools.allowed` and `previewToolPermission`; verify service tests for `A rejected git directory starts no git process`, `Read absent from the allowlist`, `A linked worktree needs only its own entry`, `Bash permission does not substitute`, `A bash reject does not hide git state`, `The git entry path is the evaluated value`, and `A reject clause refuses the git entry`.
- [ ] 4.4 Add `git-snapshot.md`, remote normalization with query, fragment, and host-less handling, length limits, C-style path quoting, and `sanitizeAuthoredText`; verify `A path that read rejects is listed`, `A newline in a file name cannot forge a line`, `A fork reports both remotes`, `A token in a remote URL is removed` (rendered body), `A local remote hides its path`, `A branch name cannot close the envelope`, `A commit subject cannot grant capabilities`, and `Two observations of an unchanged repository match`.
- [ ] 4.5 Run api `lint`, `typecheck`, and focused tests, `pnpm format:check`, `git diff --check`; publish; SR; ready; GR; update the Project.

## 5. producer

- [ ] 5.1 Create `git-awareness/producer` from `snapshot` with `$gh-stack`.
- [ ] 5.2 Add `git_told` and `git_told_from` to `chats` with `pnpm db:generate` and update every Chat fixture; verify migration idempotence and `Another owner cannot read or write the git told state` as an RLS integration test.
- [ ] 5.3 Observe once per attempt outside the transaction, add `git` to `CONTEXT_ITEM_PRODUCERS` after `workspace`, and add `deriveGitContext`, dispatch writes, checkpoint reset, and the unbound clear; verify `An unbound Chat gets no git state`, `A bound Chat gets git state`, every scenario of `The git producer tells changed state`, `The git told state follows the rail rules`, and `Exit and detach clear the git told state`, `Workspace and git snapshots share a turn`, `Read-only mode keeps git state`, and the item outcome of `A slow repository times out` (the Run continues).
- [ ] 5.4 Run api `lint`, `typecheck`, `test:coverage`, the API integration suites for chats and compaction, `pnpm format:check`, `git diff --check`; publish; SR; ready; GR; update the Project.

## 6. entry-result

- [ ] 6.1 Create `git-awareness/entry-result` from `producer` with `$gh-stack`.
- [ ] 6.2 Pass the snapshot service through the tool context and add the `git` field to every successful `enter_workspace` result; mention it in `apps/api/src/prompts/tools/enter_workspace.md`; verify `Entry narrates git state`, `Re-entry refreshes the state`, `Entry succeeds on a failed read`, and that the field leaves `git_told` unchanged.
- [ ] 6.3 Name the `git` producer and the `git` result field in the compaction instruction; verify `The summary instruction names the git sources`.
- [ ] 6.4 Document the snapshot, its absence lines, and its bounds in `docs/product/reference/`, update `docs/product/reference/tools/enter-workspace.md` Result, and add the dated CHANGELOG entry.
- [ ] 6.5 Run api `lint`, `typecheck`, `test:coverage`, `pnpm lint:markdown`, `pnpm format:check`, `git diff --check`; publish; SR; ready; GR; update the Project.

## 7. route

- [ ] 7.1 Create `git-awareness/route` from `entry-result` with `$gh-stack`.
- [ ] 7.2 Add `GET /api/v1/chats/:id/git-state` with the route admission and the `status` union DTO; verify `The owner sees a branch switch at once`, `Tool permissions do not gate the route`, `An unbound Chat has no git state`, `A binding on another executor is unavailable`, and integration tests for `Another owner cannot read the state`, `An anonymous request is refused`, and `The route hides remote credentials`.
- [ ] 7.3 Regenerate with `pnpm generate:api-client`; verify `pnpm lint:openapi` and a clean second generation diff. The route is an internal client API; its CHANGELOG line ships in `session-details`.
- [ ] 7.4 Run api `lint`, `typecheck`, focused and integration tests, `pnpm format:check`, `git diff --check`; publish; SR; ready; GR; update the Project.

## 8. session-details

- [ ] 8.1 Create `git-awareness/session-details` from `route` with `$gh-stack`.
- [ ] 8.2 Replace `BranchRow` with a Repository block fed by the route on open and window focus, and keep `RepositoryRow`; verify stories for `Session details shows the live branch` and `Session details shows an absence line` with Storybook story tests.
- [ ] 8.3 Add the dated CHANGELOG entry; put `Closes #1615` and `Closes #1417` in the PR body.
- [ ] 8.4 Run web `lint`, `typecheck`, `test:coverage`, the story tests, `pnpm format:check`, `git diff --check`; publish; SR; ready; GR; update the Project.

## 9. finalize

- [ ] 9.1 Create `git-awareness/finalize` from `session-details` with `$gh-stack` before any sync write.
- [ ] 9.2 Run `$openspec-sync-specs`; verify `pnpm exec openspec validate --specs --strict` and `pnpm exec openspec validate --all --strict`.
- [ ] 9.3 Confirm every task above is checked and the `session-details` PR lists #1615 and #1417 as closing references.

## Workflow follow-up

- Run `$openspec-archive-change` after readiness; verify `pnpm lint:markdown`, `pnpm format:check`, `git diff --check`; then publish the finalize PR, SR, ready, and GR as post-archive gates.
- Deferred children of #1614: #1616, #1617, #1618.
