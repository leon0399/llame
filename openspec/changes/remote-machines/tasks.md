# Tasks

## Delivery stack

```text
master <- remote-machines/proposal <- remote-machines/implementation <- remote-machines/finalize
```

- `remote-machines/proposal` (parent `master`): owns only `proposal.md`,
  `design.md`, the `remote-machines` spec, and this file. No issue: the
  feature ships as one experimental change by Leo's decision.
- `remote-machines/implementation` (parent `remote-machines/proposal`): owns
  the whole experimental feature in one layer, re-estimated at 9,000 to 12,000
  authored lines plus generated OpenAPI, AsyncAPI, Drizzle, and lockfile churn.
  This exceeds the about-2,000-line layer budget; the exception is recorded here
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

- [ ] 2.1 Move Workspace MCP config parsing and interpolation, bounded stdio framing, the guarded HTTP fetch, and bounded fetch from `apps/api/src/mcp` into shared `@workspace/*` packages with their tests (rename detection), add knip entries and workspace scripts, and verify the moved tests and the `apps/api` MCP suites pass
- [ ] 2.2 Add the Machine protocol package (frames, stream ids, credits, chunking, handshake, heartbeat, method and envelope types, shared bounds) and verify unit tests for framing, oversize rejection, stream-id non-reuse, dropped late frames, and version mismatch
- [ ] 2.3 Add a byte-buffer media preparation entry point to `packages/native-file-tools` and verify it produces the same media result as a local `readFile` of the same bytes

## 3. Machine daemon (`remote-machines/implementation`)

- [ ] 3.1 Create `apps/machine` with the bundled `llame-machine` bin and `roots add|remove|list` over a root-owned roots file, and verify tests that `serve` refuses a writable roots file or binary with `daemon_misconfigured`
- [ ] 3.2 Implement root enforcement (lexical check, nearest-existing-ancestor realpath, post-open re-check, fixed-text refusal, hidden out-of-root link targets, protected-path refusals) and verify tests for absent and existing out-of-root paths, read and create through a symlink escape, a dangling link, and writes to the roots file and `~/.ssh/authorized_keys` under a home root ("Registered roots bound every Machine address", "The Machine's trust anchors are outside agent reach")
- [ ] 3.3 Implement `roots.list`, `fs.stat`, `fs.list`, `fs.read`, `fs.edit`, `fs.write`, and `fs.bytes` with Machine-locator results, and verify equality with local results for selectors, listings, mutations, and a 5 MiB image ("Native file tools behave identically on a Machine", "Machine results report Machine locators, not host paths")
- [ ] 3.4 Implement `proc.bash` and `proc.cancel` with the shared bounds and managed base environment, budget refusal and in-flight expiry, and process-group termination on stdin close and heartbeat loss, and verify tests for remote `pwd`, cancel, exhausted budget, and caller loss ("Bash runs on a Machine through its working directory")
- [ ] 3.5 Implement `mcp.servers` and the relay with Machine-side interpolation, guarded HTTP fetch, stdio and Streamable HTTP backends, stderr diagnostics, and protected values returned by `mcp.open`, and verify tests with the stdio fixture and a local HTTP fixture on `localhost`, including a config change between discovery and start and no secrets in daemon logs ("Workspace MCP servers of a Machine Workspace run from the Machine", "Machine-resolved secrets are redacted on the hub")

## 4. Hub configuration and sessions (`remote-machines/implementation`)

- [ ] 4.1 Add the `machines` section to the loader, `RawInstanceConfig`, `BUILT_IN_DEFAULTS`, and `llame.config.schema.json`, reject a `machine:` prefix on `tools.nativeExecutorId`, and verify boot-failure tests for an invalid name, an option-shaped destination, an interpolated route field, a missing identity, and a missing known-hosts file, plus a test that without the section no Machine surface exists ("Machine configuration is validated at startup", "Machines exist only when the operator configures them")
- [ ] 4.2 Add the session manager with the generated `-F` configuration, once-per-attempt reachability, multiplexing, idle close, and status writes, and verify integration tests against a real `sshd` and jump host that an unpinned jump key fails with `host_key_mismatch`, a polluted user SSH config has no effect, a black-holed hop fails within the connect timeout, and two concurrent operations share one session ("Every SSH hop is pinned and isolated from ambient configuration", "The Machine session is versioned and multiplexed")

## 5. Locators, tools, and permissions (`remote-machines/implementation`)

- [ ] 5.1 Add the `machine://` branch to locator dispatch with the grammar, canonical reporting and re-encoding, bare and root-list forms, unbound fences, per-Machine mutation serialization, media through `fs.bytes`, and the pre-dispatch versus post-dispatch error rule, and verify tests for `machine_not_found`, round-trip of a `#` filename, `machine_unavailable` before dispatch, and `outcome_unknown` after a session loss for `edit`, `write`, and `bash` ("Machine locators name a configured Machine and an absolute path", "Machine mutations use the native effect fence", "Machine listings are addressable")
- [ ] 5.2 Offer `read`, `edit`, `write`, `bash`, `enter_workspace`, and `exit_workspace` when Machines are configured without a local executor, and verify a test that they operate on Machine locators while local host paths return `executor_unavailable`
- [ ] 5.3 Add the Machine branch to `resolveWorkspacePath` with a fail-closed throw on non-absolute roots, migrate all six call sites, refuse bare absolute paths and `cwd` in a Machine Workspace, and verify per-call-site tests
- [ ] 5.4 Extend permission projection with decoded canonical text and the two-text reject rule for Machine locators, `bash` `cwd`, `enter_workspace`, and Machine skill reads, and verify tests that a `%2E` spelling cannot bypass a `.ssh` reject or the W1/W2 rejects, a `^/`-anchored rule does not admit a Machine path, and a Machine rule does not admit another Machine ("Permission rules match canonical Machine locators")
- [ ] 5.5 Update tool descriptions and Workspace narration to state remote host authority and no cross-owner isolation, and verify the tool-description test and a narration snapshot ("Machine execution is disclosed as remote host authority")

## 6. Machine Workspaces (`remote-machines/implementation`)

- [ ] 6.1 Accept Machine locators in `enter_workspace` via `fs.stat`, store the canonical root and `machine:<name>` executor without binding the Run, route relative paths, and keep `exit_workspace` working offline, and verify integration tests ("Workspace entry accepts Machine locators")
- [ ] 6.2 Add the `chats.workspace_told_available` migration and change preparation for `machine:` executors to keep the binding while unreachable, narrate one unavailability and one recovery transition, check roots with `fs.stat` when reachable, and detach as `executor_absent` narrated as a removed Machine, and verify integration tests ("An unreachable Machine does not detach its Workspace")
- [ ] 6.3 Add the Machine instruction scope, Machine trigger recognition, and Machine prompt-import resolution, and verify tests that a Machine `AGENTS.md` loads and an ancestor above the root does not ("Machine instruction files are discovered within the containing root")
- [ ] 6.4 Add the asynchronous Machine skill snapshot with an in-memory catalog filesystem and Machine skill reads, and verify a test that a Machine Workspace skill is offered and its files are read from the Machine ("Machine Workspace skills come from the Machine")
- [ ] 6.5 Add the `McpServerClient` transport factory, `MachineTransport`, hub-side Machine discovery through `mcp.servers`, and the executor-qualified client key, and verify tests for tool advertisement, redaction of Machine-resolved values, unavailable hub-only variables, and channel loss behaving as a crashed server ("Machine Workspace MCP lifetime follows local Workspace rules")
- [ ] 6.6 Add the negative isolation integration test: users A and B bound to Workspaces on one Machine with a same-named server see only their own binding, declarations, and results ("Hub-held Chat state stays owner-isolated on shared Machines")

## 7. Status and UI (`remote-machines/implementation`)

- [ ] 7.1 Add the `machines_status` migration with forced RLS and an identity-required SELECT policy, the per-minute probe job declared in `asyncapi.queues.yaml`, derived status, and `GET /api/v1/machines`, regenerate OpenAPI, AsyncAPI, and clients with a clean second generation, and verify tests for failing-hop position, closed reasons, a crashed holder reading offline, refusal without identity, and no route details in the response ("Machine status is derived from contact and visible", "Authenticated users can see Machines and their Workspace's Machine status")
- [ ] 7.2 Add the read-only Machines settings section and the Machine state in the Workspace indicator with polling, and verify their stories and Storybook tests, returning preview URLs

## 8. Documentation and layer verification (`remote-machines/implementation`)

- [ ] 8.1 Add `docs/product/operator/machines.md` (configuration, daemon install, root-owned roots, `authorized_keys` forced command and jump-host lines, sshd `ClientAliveInterval`, Machine-scoped allows and anchored rejects, threats T1 to T10), the `machine://` locator reference page, updates to the `read`, `edit`, `write`, `bash`, `enter_workspace`, and instruction-file reference pages, `native-files.md`, both indexes, the `SPEC.md` sections on placement and native host authority, and an experimental `CHANGELOG.md` entry, and verify `pnpm lint:markdown` passes
- [ ] 8.2 Run `pnpm lint`, the affected workspaces' `typecheck` and `test:coverage`, `pnpm --filter api test:integration` for the Machine suites, `pnpm --filter machine build`, `pnpm format:check`, and `git diff --check`, all passing, and record whether the mutation matrix covers the new packages
- [ ] 8.3 Smoke the flow on a real box: one jump host, enter a Machine Workspace, run `read`, `edit`, `bash`, a 5 MiB image read, and a Workspace MCP tool, stop the daemon to observe offline narration and status, restart it to observe recovery, and record the transcript in the PR body
- [ ] 8.4 Self-review the published draft PR diff against REVIEW_GUIDE.md, record the size exception and generated churn separately in the PR body, mark it ready, and complete the GitHub review and CI loop

## 9. Finalize readiness (`remote-machines/finalize`)

- [ ] 9.1 Enter `remote-machines/finalize` with `$gh-stack` before any canonical spec is written, then run `$openspec-sync-specs` and verify `openspec/specs/remote-machines/spec.md` matches the delta
- [ ] 9.2 Verify every task above is checked and `pnpm exec openspec validate --specs --strict` and `pnpm exec openspec validate --all --strict` pass

## Workflow follow-up

- Archive the change with `$openspec-archive-change` after 9.2.
- Self-review the finalize diff, mark it ready, and run the GitHub review and CI loop.
- Merge the stack through `$gh-stack` only with Leo's explicit permission.
