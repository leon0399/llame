# Tasks

## Delivery stack

```text
master <- remote-machines/proposal <- remote-machines/implementation <- remote-machines/finalize
```

- `remote-machines/proposal` (parent `master`): owns only `proposal.md`,
  `design.md`, the `remote-machines` spec, and this file. No issue: the
  feature ships as one experimental change by Leo's decision.
- `remote-machines/implementation` (parent `remote-machines/proposal`): owns
  the whole experimental feature in one layer, estimated at 6,000 to 7,000
  authored lines plus generated OpenAPI, Drizzle, and lockfile churn. This
  exceeds the about-2,000-line layer budget; the exception is recorded here
  and in the PR body, by Leo's explicit decision not to split.
- `remote-machines/finalize` (parent `remote-machines/implementation`): owns
  only spec synchronization, task records, and archive movement.

Create and move between layers with `$gh-stack`; implement with
`$openspec-apply-change`. Implementation starts only after Leo approves the
published proposal revision. Every layer completes self-review (SR) of its
actual parent-relative draft diff before draft to ready, then the GitHub
review (GR) loop of bots and current-head CI per CONTRIBUTING.md.

## 1. Proposal layer (`remote-machines/proposal`)

- [ ] 1.1 Validate the change with `pnpm exec openspec validate remote-machines --strict`, `pnpm lint:markdown`, `pnpm format:check`, and `git diff --check`, all passing
- [ ] 1.2 Run `$iterative-review-refinement` with at least two independent reviewers, verify each finding against code or specs, and commit each round separately
- [ ] 1.3 Self-review the published draft PR diff, mark it ready, and obtain Leo's approval of the published revision

## 2. Shared packages (`remote-machines/implementation`)

- [ ] 2.1 Move Workspace MCP config parsing and interpolation, bounded stdio framing, and bounded fetch from `apps/api/src/mcp` into shared `@workspace/*` packages with rename detection, and verify the existing `apps/api` MCP unit and integration tests pass unchanged
- [ ] 2.2 Add the Machine protocol package (frames with stream ids, handshake with protocol and daemon versions, method and envelope types, 1 MiB frame cap) and verify unit tests cover framing, oversize rejection, and version mismatch

## 3. Machine daemon (`remote-machines/implementation`)

- [ ] 3.1 Create `apps/machine` with the `llame-machine` bin and `roots add|remove|list` storing canonical roots, and verify a test that a path outside the roots and a symbolic-link escape both return `path_not_registered` ("Registered roots bound every Machine address")
- [ ] 3.2 Implement `serve --stdio` with `roots.list`, `fs.read`, `fs.edit`, `fs.write` over `packages/native-file-tools`, and verify results equal local calls for selectors, listings, and media ("Native file tools behave identically on a Machine")
- [ ] 3.3 Implement `proc.bash` and `proc.cancel` over `packages/bash-executor` with additive `env`, deadline refusal, and process-group termination when stdin closes, and verify tests for remote `pwd`, cancel, expired request, and caller loss ("Bash runs on a Machine through its working directory", "Machine mutations use the native effect fence")
- [ ] 3.4 Implement `mcp.servers` and the `mcp.*` relay with Machine-side interpolation, stdio and Streamable HTTP backends, and protected-value reporting, and verify tests with the stdio fixture and a local HTTP MCP fixture on `localhost` ("Workspace MCP servers of a Machine Workspace run from the Machine")

## 4. Hub configuration and sessions (`remote-machines/implementation`)

- [ ] 4.1 Add the `machines` section to the loader, `RawInstanceConfig`, `BUILT_IN_DEFAULTS`, and `llame.config.schema.json`, and verify boot-failure tests for an invalid name, a missing identity, and a missing known-hosts file ("Machine configuration is validated at startup")
- [ ] 4.2 Add the worker SSH session manager with the pinned `ssh` argument set, handshake, stream multiplexing, idle close, and status writes, and verify tests that assert the exact `ssh` arguments including jump order and that a fake unreachable route yields `machine_unavailable` with reason `unreachable` ("The hub reaches a Machine only through pinned SSH", "The Machine session is versioned and multiplexed")

## 5. Locators, tools, and permissions (`remote-machines/implementation`)

- [ ] 5.1 Add the `machine://` branch to locator dispatch for `read`, `edit`, `write`, bare and root listings, unbound fences, and the `machine_not_found` and `machine_unavailable` errors, and verify integration tests through a test session transport ("Machine locators name a configured Machine and an absolute path", "Machine listings are addressable")
- [ ] 5.2 Extend `bash` `cwd` projection to Machine locators and Machine-bound relative paths, and verify tests for absolute and relative Machine `cwd`
- [ ] 5.3 Extend permission projection for `machine://`, `bash` `cwd`, and `enter_workspace`, and verify the negative tests that a local rule does not admit a Machine path and a Machine rule does not admit another Machine ("Permission rules match canonical Machine locators")
- [ ] 5.4 Update tool descriptions and Workspace narration to state remote host authority, and verify the tool-description test and a narration snapshot ("Machine execution is disclosed as remote host authority")

## 6. Machine Workspaces (`remote-machines/implementation`)

- [ ] 6.1 Accept Machine locators in `enter_workspace`, store the canonical Machine root and `machine:<name>` executor, route relative paths, and keep `exit_workspace` working offline, and verify integration tests ("Workspace entry accepts Machine locators")
- [ ] 6.2 Change Run preparation for `machine:` executors to keep the binding while unreachable, narrate one unavailability and one recovery transition, and detach as `executor_absent` when the Machine is no longer configured, and verify integration tests ("An unreachable Machine does not detach its Workspace")
- [ ] 6.3 Load the instruction chain and Workspace skills through Machine reads, and verify a test that a Machine `AGENTS.md` enters the chain ("Machine Workspaces load instruction files and skills from the Machine")
- [ ] 6.4 Add the injectable transport path to `McpServerClient`, `MachineTransport`, and the executor-qualified client key, and verify tests for tool advertisement, redaction of Machine-resolved values, unavailable hub-only variables, and channel loss behaving as a crashed server ("Machine Workspace MCP lifetime follows local Workspace rules")
- [ ] 6.5 Add the negative isolation integration test: users A and B bound to Workspaces on one Machine with a same-named server see only their own binding, declarations, and results ("Machine use preserves owner isolation of Chat state")

## 7. Status and UI (`remote-machines/implementation`)

- [ ] 7.1 Add the `machines_status` table migration without RLS, the scheduled probe job, derived status, and `GET /api/v1/machines`, regenerate OpenAPI and the client with a clean second generation, and verify tests for failing-hop recording and a crashed holder reading offline ("Machine status is derived from contact and visible")
- [ ] 7.2 Add the read-only Machines settings section and the Machine state in the Workspace indicator with polling, and verify their stories and Storybook tests, returning preview URLs ("Owners can see Machines and their Workspace's Machine status")

## 8. Documentation and layer verification (`remote-machines/implementation`)

- [ ] 8.1 Add `docs/product/operator/machines.md` (configuration, daemon install, roots, `authorized_keys` forced command, threats T1 and T2), the `machine://` locator reference page, updates to the `read`, `edit`, `write`, `bash`, and `enter_workspace` reference pages and both indexes, and an experimental entry in `CHANGELOG.md`, and verify `pnpm lint:markdown` passes
- [ ] 8.2 Run `pnpm lint`, the affected workspaces' `typecheck` and `test:coverage`, `pnpm --filter api test:integration` for the Machine suites, `pnpm --filter machine build`, `pnpm format:check`, and `git diff --check`, all passing
- [ ] 8.3 Smoke the flow on a real box: one jump host, enter a Machine Workspace, run `read`, `edit`, `bash`, and a Workspace MCP tool, stop the daemon to observe offline narration and status, restart it to observe recovery, and record the transcript in the PR body
- [ ] 8.4 Self-review the published draft PR diff against REVIEW_GUIDE.md, record the size exception and generated churn separately in the PR body, mark it ready, and complete the GitHub review and CI loop

## 9. Finalize readiness (`remote-machines/finalize`)

- [ ] 9.1 Enter `remote-machines/finalize` with `$gh-stack` before any canonical spec is written, then run `$openspec-sync-specs` and verify `openspec/specs/remote-machines/spec.md` matches the delta
- [ ] 9.2 Verify every task above is checked and `pnpm exec openspec validate --specs --strict` and `pnpm exec openspec validate --all --strict` pass

## Workflow follow-up

- Archive the change with `$openspec-archive-change` after 9.2.
- Self-review the finalize diff, mark it ready, and run the GitHub review and CI loop.
- Merge the stack through `$gh-stack` only with Leo's explicit permission.
