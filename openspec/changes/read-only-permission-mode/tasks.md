Track [#1548](https://github.com/leon0399/llame/issues/1548) and its PR layers
through [Project tracking](../../../CONTRIBUTING.md#project-tracking).
Implementation waits for Leo's approval of the published proposal revision.
Keep live status in the Project.

## Delivery stack

Use `$gh-stack` for every branch operation and `$openspec-apply-change` for
each implementation layer, after proposal approval only.

```text
master
  <- read-only-permission-mode/proposal
  <- read-only-permission-mode/api
  <- read-only-permission-mode/web
  <- read-only-permission-mode/finalize
```

| Layer      | Parent     | Ownership                                                                                                              | Authored estimate | Closes |
| ---------- | ---------- | ---------------------------------------------------------------------------------------------------------------------- | ----------------- | ------ |
| `proposal` | `master`   | Proposal, design, deltas, and this task list.                                                                          | ~1,100            | none   |
| `api`      | `proposal` | The mode value, configuration, migration, effective mode, the ceiling, the reason, Workspace MCP, live protocol, docs. | ~1,400            | none   |
| `web`      | `api`      | The composer selector, send, Continue, and Regenerate for `read-only`, the regenerated client, stories.                | ~400              | #1548  |
| `finalize` | `web`      | Spec sync, task records, and archive movement only.                                                                    | ~700              | none   |

Generated output (the Drizzle snapshot, `openapi.json`, the web client) counts
zero and is reported separately in each PR.

## 1. proposal

- [x] 1.1 Validate the change: `pnpm exec openspec validate read-only-permission-mode --strict`, `pnpm exec markdownlint-cli2 "openspec/changes/read-only-permission-mode/**/*.md"`, `node scripts/check-markdown-links.mjs`, `pnpm format:check`, `git diff --check`.
  - Evidence: all five pass on 4695a150.
- [x] 1.2 Run two review rounds with at least two independent reviewers each, verify every finding against code or primary sources, and commit each round separately.
  - Evidence: local rounds 1 and 2 (spec-consistency and feasibility reviewers; fixes in dbabb02a and 98d697fd). design.md "Revision history" records each round.
- [ ] 1.3 Obtain Leo's approval of the published revision, including the D9 deviation in proposal.md.
- [ ] 1.4 SR: self-review the draft PR diff against [REVIEW_GUIDE.md](../../../REVIEW_GUIDE.md) before ready; GR: run [Ready-PR monitoring](../../../CONTRIBUTING.md#ready-pr-monitoring) to exit.

## 2. api

- [ ] 2.1 Add `read-only` to `PERMISSION_MODES`, the configuration schema enum, and `resolvePermissionModes`; generate the migration for `runs_permission_mode_check`. Verify with the config-loader test for "Read-only is enabled explicitly", chat-send tests for "Enabled read-only is accepted" and "Disabled read-only creates nothing", and an integration test that stores a `read-only` Run.
- [ ] 2.2 Resolve the effective mode as `read-only` for every `read-only` Run, whatever the enabled list of the worker (design D2). Verify with run-execution tests for "Read-only stays read-only on a process that does not enable it" and "Withdrawing read-only does not widen a queued Run", and a `web_search` test for "Read-only removes a rejected host".
- [ ] 2.3 Add the call-level ceiling to `admit.ts`, call it in `runTool` right after `admitToolCall` and in `previewToolPermission`, and keep `decidePermission` and `evaluatesPermission` treating `read-only` as `default` (design D3, D4). Verify with runner tests for each scenario of "A read-only attempt admits only reads and plain Workspace transitions" and "A read-only attempt rejects worktree entry" on host and `machine://` paths, "A remote command is rejected before host resolution", and "Read-only evaluates an admitted call as default".
- [ ] 2.4 Add `permission_mode_read_only` to the reason vocabulary, its fixed text, and the transcript allowlist (design D5). Verify with tests for "The ceiling reason wins over a policy reject", "The rejection text is fixed", "Invalid arguments are refused before the ceiling", and "The decision survives a reload privately".
- [ ] 2.5 For a `read-only` attempt, skip Workspace MCP start but keep the stale-client stop, pass no Workspace MCP key to composition, the dynamic resolver, or the attempt hold, add `WorkspaceMcpClients.stopStale` (with the stop-epoch bump) and `listUnstarted`, list once for each binding, and list servers at entry from the existing readers with `not started in a read-only Run` (design D6). Verify with integration tests for every scenario of the two `mcp-tools` requirements, including the `machine://`, malformed-file, and same-root cases, and for "A read-only turn reports the Workspace MCP tools as removed".
- [ ] 2.6 Add chat-creation tests for "A read-only request creates its worktree" and "read-only on a process without read-only stores nothing", and the `workspace-entry` scenario "A chat-creation request establishes the first binding" with `read-only` (design D7; no code change expected).
- [ ] 2.7 Extend the permission-mode table tests and the "A read-only turn keeps the prompt prefix" receipt and declaration check in `run-execution-tools.integration.test.ts`.
- [ ] 2.8 Regenerate `openapi.json` and the API live protocol (`pnpm --filter api generate:live-protocol`); verify a second generation of each produces no diff, and extend `live-protocol.contract.test.ts` with a `read-only` Run record.
- [ ] 2.9 Document `read-only` in `docs/product/reference/permission-modes.md`, `apps/api/llame.config.jsonc.example`, `docs/product/operator/native-files.md`, `README.md`, and `SPEC.md`, including the egress non-goal; add a dated `CHANGELOG.md` entry. Verify with `pnpm lint:markdown`.
- [ ] 2.10 Run `pnpm --filter api lint`, `typecheck`, the focused unit and integration files above, `pnpm format:check`, and `git diff --check`.
- [ ] 2.11 SR before ready; GR through Ready-PR monitoring.

## 3. web

- [ ] 3.1 Regenerate the web client and the web live protocol, and widen the mode union in `chat-context.tsx`.
- [ ] 3.2 Add `read-only` to the selector details with a non-destructive trigger, widen `isPermissionMode`, and send any non-default mode from the composer, creation, Continue, and Regenerate (design D8). Verify with selector, transport, and Turn-action stories or tests for "Read-only is sent when selected", a Continue with `read-only` that sends `permissionMode: "read-only"`, and the existing `bypass` scenarios.
- [ ] 3.3 Run Storybook tests for the selector and return preview URLs; run `pnpm --filter web lint` and `typecheck`.
- [ ] 3.4 Add the web part of the `CHANGELOG.md` entry. Verify with `pnpm lint:markdown`.
- [ ] 3.5 SR before ready; GR through Ready-PR monitoring.

## 4. finalize

- [ ] 4.1 Enter `read-only-permission-mode/finalize` with `$gh-stack` before `$openspec-sync-specs` writes any canonical spec.
- [ ] 4.2 Run `$openspec-sync-specs`; update the `permission-modes` Purpose to describe three modes, with the turn display limited to `bypass` (design D9) and every mode reported on the Run and its context receipt; check that each MODIFIED block keeps every canonical scenario and that the deliberately unchanged readings in proposal.md still hold against the synced text.
- [ ] 4.3 Prove archive readiness: `openspec status --change read-only-permission-mode --json` reports every artifact done and every task above checked; `pnpm exec openspec validate --specs --strict` and `pnpm exec openspec validate --all --strict` pass.

## Workflow follow-up

- Archive with `$openspec-archive-change` after readiness, then publish the finalize PR, self-review it, mark it ready, and run Ready-PR monitoring.
- Merge only with Leo's explicit permission, through `$gh-stack`.
