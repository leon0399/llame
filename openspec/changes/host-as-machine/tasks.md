Track [#1831](https://github.com/leon0399/llame/issues/1831) and its PR layers through
[Project tracking](../../../CONTRIBUTING.md#project-tracking). Implementation waits for Leo's
approval of the published proposal revision. Keep live status in the Project.

## Delivery stack

Use `$gh-stack` for every branch operation and `$openspec-apply-change` for each implementation
layer, after proposal approval only.

```text
master
  <- host-as-machine/proposal
  <- host-as-machine/daemon-identity
  <- host-as-machine/host-machine
  <- host-as-machine/file-tools
  <- host-as-machine/git
  <- host-as-machine/workspace-context
  <- host-as-machine/finalize
```

Every implementation layer is a safe intermediate merge boundary, and the host works at each one
(design D8). The state after each layer:

- `daemon-identity`: every daemon reports an instance id and static facts at protocol version 2,
  and the installation binds Machine names and refuses a mismatch. The host is still the in-process
  executor under `tools.nativeExecutorId`.
- `host-machine`: the host is a `machines.hosts` entry under `machines.local`, stored ids are
  Machine names, every result and permission decision uses canonical `machine://` locators, and
  the snapshot names the current Machine. Host families still run in process, and other workers
  reach the host over SSH.
- `file-tools`: host file tools and grep run through the daemon under registered roots.
- `git`: host git and worktrees run through the daemon, and `ExecutorGit` has no local surface.
- `workspace-context`: host Workspace MCP, instruction files, Workspace skills, and prompt imports
  run through the daemon. Only host `bash` and background jobs stay in process.

| Layer               | Parent              | Ownership                                                                                                                                                                                                             | Authored estimate | Closes |
| ------------------- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | ------ |
| `proposal`          | `master`            | Proposal, design, deltas, and this task list.                                                                                                                                                                         | ~4,500            | none   |
| `daemon-identity`   | `proposal`          | The instance id, the `hello` facts, protocol version 2, the binding and `machines:forget`, the status API and settings view, and the listing line.                                                                    | ~1,600            | none   |
| `host-machine`      | `daemon-identity`   | `machines.local` and `machines.default`, the local child transport, boot validation, the locator rule, the layer-2 interceptions, permission normalization, the migration, the web executor labels, and the snapshot. | ~3,800            | none   |
| `file-tools`        | `host-machine`      | Host file tools and grep through the daemon, and the deletion of their host branches.                                                                                                                                 | ~1,500            | none   |
| `git`               | `file-tools`        | Host git and worktrees through the daemon, and the deletion of the `ExecutorGit` local surface.                                                                                                                       | ~1,200            | none   |
| `workspace-context` | `git`               | Host Workspace MCP, instruction files, Workspace skills, and prompt imports through the daemon, and the deletion of their host scopes.                                                                                | ~1,800            | #1831  |
| `finalize`          | `workspace-context` | Spec sync, task records, and archive movement only.                                                                                                                                                                   | ~2,500            | none   |

Estimates are low confidence. `host-machine` exceeds the ~2,000-line target because deleting
`tools.nativeExecutorId` changes the config, the stored ids, the locator rule, and permission
projection at once, and no subset leaves the host working. About 88 files reference
`nativeExecutorId`, the `machine:` prefix, or its parse helpers, and the web app reads the prefix.
Re-measure before publication, and split the web labels into their own layer if they push it past
~4,000. The `remote-machines` to `machines` move is a separate chore PR after the archive (design
D13). Drizzle snapshots, regenerated OpenAPI and
orval clients, and lockfiles count zero. Report their churn in the PR, and re-measure each layer
against its parent before publication.

## 1. proposal

- [x] 1.1 Validate: `pnpm exec openspec validate host-as-machine --strict`, `pnpm lint:markdown`
      (which runs the ADR prose check on the three new ADRs), `pnpm format:check`,
      `git diff --check`, and the STE check on every delta.
  - Evidence: OpenSpec reports the change valid under `--strict`. markdownlint reports 0 issues on
    the change and `docs/adr`, and the link check, `scripts/check-prose.mjs`, `oxfmt --check`, and
    `git diff --check` are clean. The STE checker reports no error in added or rewritten
    requirement prose. Some scenario sentences copied from canonical specs stay above 25 words.
- [x] 1.2 Run two review rounds with two independent reviewers each, verify each finding against
      code or primary sources, and commit each round separately. Record each round in the design
      revision history.
  - Evidence: round 1 (spec 7 P1, 6 P2; feasibility 10 P1, 7 P2) fixed in `c8644cc00`. Round 2
    (spec 1 P1, 1 P2; feasibility 7 P2) fixed in `d827c21ac`. Design revision history v2 and v3
    record them. Round 2 still changed substance, so the review has not converged, and the GitHub
    review loop is the next round.
- [ ] 1.3 Resolve H19 with Leo, and update the deltas if he switches H4 or overturns H18.
- [ ] 1.4 Self-review the published draft PR (SR), mark it ready, and run the GitHub review loop
      (GR) per [CONTRIBUTING.md](../../../CONTRIBUTING.md#pr-contract).
- [ ] 1.5 Obtain Leo's approval of the published revision.

## 2. daemon-identity

- [x] 2.1 Daemon: create and keep `instance.json` with an exclusive create, report `instanceId`,
      `buildId`, and the static facts in `hello`, and print them in `llame-machine --version`
      (design D1). Verify in `apps/machine` tests that two concurrent first starts agree on one id
      and that a second start keeps it.
- [x] 2.2 Protocol: bump `PROTOCOL_VERSION` to 2 and type the new `hello` fields in
      `packages/machine-protocol`. Verify that a version 1 peer fails with
      `incompatible_version` and every operation on it returns `machine_unavailable` with that
      reason.
- [x] 2.3 Binding: add the `machine_bindings` table with forced RLS, and `facts` and
      `facts_captured_at` to `machines_status`. Bind or compare in the awaited session-open path,
      refuse a different id with `machine_identity_mismatch` and the `identity_mismatch` reason,
      fail with `machine_unavailable` when the binding cannot be read, and add
      `pnpm --filter api machines:forget <name>` under the system marker (design D2). Verify the
      `remote-machines` identity scenarios in an API integration test: no tool request reaches a
      mismatched daemon, a concurrent call during the bind gets no unverified session, an unreadable
      binding fails closed, and a removed and re-added name keeps its binding after the status
      prune.
- [x] 2.4 Status and listing: return the facts and their capture time from
      `GET /api/v1/machines`, show OS, architecture, and daemon version in the settings Machines
      section, and add OS and architecture to each `machine://` listing line. Regenerate the
      OpenAPI document and client. Verify the listing scenario and the story for the settings
      section.
- [x] 2.5 Docs: add "Machine instance id" to `docs/product/glossary.md`, describe identity,
      `machines:forget`, and the protocol bump in `docs/product/operator/machines.md`, and add a
      dated `CHANGELOG.md` entry that says every Machine needs the new daemon.
- [x] 2.6 Focused checks: `pnpm --filter machine test`, `pnpm --filter api lint`,
      `pnpm --filter api typecheck`, the changed test files, OpenAPI lint and second-generation
      clean diff, `pnpm format:check`, `git diff --check`.
- [ ] 2.7 SR before ready; GR per [CONTRIBUTING.md](../../../CONTRIBUTING.md#ready-pr-monitoring).

## 3. host-machine

- [x] 3.1 Config: add `machines.local` and `machines.default` with whole-value `{env:...}`, make
      `destination` optional, delete `tools.nativeExecutorId`, and add the boot failures of
      design D3. Verify each boot failure in config-loader tests, with the error naming the field.
- [x] 3.2 Local transport: spawn `LLAME_MACHINE_COMMAND serve --stdio` for the `machines.local`
      entry with the base environment (design D4), and probe only reachable entries. Verify that a
      database URL and `SENTRY_AUTH_TOKEN` in the worker environment do not reach the child, that a
      missing command reports `machine_unavailable`, that no call falls back to in-process
      execution, and "A worker that cannot reach a host entry records nothing".
- [x] 3.3 Locator rule: one resolution for bare, relative, `file:`, and `machine://` paths on the
      current Machine, and the `file://<other>` refusal (design D6). Intercept
      `machine://<local>/...` at every dispatch point that D8 lists, and route it to the in-process
      target until each family moves. Require the identity-checked handshake before any in-process
      host operation. Verify the `native-file-tools` and `remote-machines` locator scenarios, "A
      wrong local name is refused before host bash", and a test that a host-bound Chat reaches no
      `MachineConnector` method for the families that have not moved.
- [x] 3.4 Canonical results and permissions: report canonical `machine://` locators for host
      results and in the artifact notice (`tool-artifacts`, `tool-result-rendering`), normalize every path parameter and `bash` `cwd` before matching, and fail startup on
      a `^/` path regex (design D7). Verify the `tool-call-permissions` scenarios, including the
      negative scenario that an allow for one Machine does not admit another, the reject in another
      bare spelling, and the all-fields reject, and the `workspace-entry` submitted-path decision.
- [x] 3.5 Migration: the custom migration of design D5 under the P2 wrapping. Verify in an
      integration test that a host-bound Chat keeps its binding as `machine://<id>/...`, that
      `machine:<name>` loses its prefix, that an invalid id or a unique-index collision fails the
      migration with a named error and changes nothing, that `workspace_told` and
      `chat_creation_records` worktree directories are rewritten, that the SQL root encoding equals
      `formatMachineLocator` for each encoded character, and that `chat_jobs.executor` is
      untouched.
- [x] 3.6 Binding and detach: bind Workspace entry to the Machine name, detach a Chat bound to an
      unreachable entry with `executor_mismatch`, and resolve chat-creation executors by Machine
      name. Accept a canonical `machine://<checkout executor>/` worktree base in `checkouts.service.ts`. Verify the `workspace-entry` and `chat-creation` scenarios and that a bare worktree base on a remote Machine checkout is stored on that Machine.
- [x] 3.7 `bash` routing: run in process for this process's `machines.local`, run daemon
      `proc.bash` elsewhere, and refuse `async` with the placement-neutral hint (design D9). Verify
      the `bash-execution` scenarios.
- [x] 3.8 Advertisement: gate tools on `machines.default` (design D11). Verify the `tool-calling`
      advertisement scenarios.
- [x] 3.9 Snapshot: one Workspace snapshot prompt for both states, told again when the current
      Machine changes, and unavailable and recovered items keyed on the current Machine (design
      D10). Verify the `context-injection` scenarios.
- [x] 3.10 Development and tests: make `dev` and the integration suites depend on `machine#build`,
      set `LLAME_MACHINE_COMMAND` and `LLAME_MACHINE_CONFIG_DIR` in development, and write the
      development roots file (design D12). Verify that `pnpm dev` starts, completes an identity handshake with the development daemon child, and serves a host read in process.
- [x] 3.11 Web: replace the `machine:` prefix logic in `start-location.ts` and
      `project-repository-policy.ts` with Machine names from `GET /api/v1/machines`, update the DTO
      descriptions in `checkoutResponse` and `startLocationResponse`, regenerate the OpenAPI
      document and the orval client, and update the stories. Verify the start-location tests and
      the Storybook story tests.
- [x] 3.12 Prompts: update `read.md`, `edit.md`, `write.md`, `grep.md`, `bash.md`,
      `enter_workspace.md`, and `exit_workspace.md` for the current Machine and canonical results,
      and update `llame.config.jsonc.example` to the canonical recommended policy (design D7).
- [x] 3.13 Docs: update `SPEC.md` sections 1.1, 13.7, 13.9, and 15 (H16), the glossary ("Default
      Machine"), the operator runbooks (`machines.md`, `native-files.md`, `chat-creation.md`,
      `repositories.md`, `knowledge.md`, `ssh.md`, `web-read.md`, `skills.md`, `index.md`), the
      tool reference pages, `apps/api/llame.config.jsonc.example`, and a dated `CHANGELOG.md` entry
      with the upgrade steps of the design migration plan.
- [x] 3.14 Focused checks: `pnpm --filter api lint`, `pnpm --filter api typecheck`, the changed
      test files, the API integration suite for the migration, `pnpm lint:markdown`,
      `pnpm format:check`, `git diff --check`.
- [ ] 3.15 SR before ready; GR per [CONTRIBUTING.md](../../../CONTRIBUTING.md#ready-pr-monitoring).

## 4. file-tools

- [x] 4.1 Route host `read`, `edit`, and `write` through the daemon and delete their host branches.
      Keep the native mutation fence on the Machine name. Verify that a host read outside the
      registered roots fails with `path_not_registered`, and that an unavailable host daemon fails
      the call with `machine_unavailable`.
- [x] 4.2 Route host grep scopes through `fs.grep` and delete the host walk port. Keep the
      Knowledge and skill walk ports. Verify the `grep-tool` scenarios.
- [x] 4.3 Move host file and grep integration tests to a real daemon child, and stop file
      mutations and Workspace entry from pinning `runs.worker_id` (design D15). Keep the pin for
      in-process host `bash`. Verify "A Machine mutation is fenced on any worker" and that `pnpm dev`
      serves a host read through the daemon child.
- [x] 4.4 Docs: `native-files.md` and the tool reference pages, and a dated `CHANGELOG.md` entry
      that names the newly refused host calls.
- [x] 4.5 Focused checks as in 3.14.
- [ ] 4.6 SR before ready; GR per [CONTRIBUTING.md](../../../CONTRIBUTING.md#ready-pr-monitoring).

## 5. git

- [x] 5.1 Delete the `ExecutorGit` local surface, route host git and worktrees through the daemon,
      and register host checkouts through it. Verify the `repositories` scenarios against a real
      daemon child.
  - Evidence: `ExecutorGit` has one `MachineConnector` dependency and no local branch; every git
    method and both path probes are `MachineConnector.request` calls. `checkouts.integration`
    registers, adopts, and lists through the real `llame-machine` child over `tmpdir` roots, and
    adds `path_not_registered` (403 `permission_denied`) and `machine_unavailable` (503) at that
    seam. `chat-git-state.integration` reads the branch, the credential-free remote, and the
    throttle through the same child. `git-snapshot` probes reachability for the host Machine too.
- [x] 5.2 Docs: `repositories.md`, the Workspace entry reference, and a dated `CHANGELOG.md`
      entry.
  - Evidence: `repositories.md` and `enter-workspace.md` state that host git runs on the host
    daemon under its registered roots, and the 2026-11-22 `CHANGELOG.md` entry names every host
    call that now fails with `path_not_registered` and the `llame-machine roots add` restore.
- [ ] 5.3 Focused checks as in 3.14.
- [ ] 5.4 SR before ready; GR per [CONTRIBUTING.md](../../../CONTRIBUTING.md#ready-pr-monitoring).

## 6. workspace-context

- [ ] 6.1 Host Workspace MCP through `mcp.open`, with interpolation against the daemon child's
      environment (H18). Verify "Worker secrets do not reach a host Workspace server", the
      `mcp-tools` interpolation scenarios, and the `remote-machines` Workspace MCP scenarios against
      a real daemon child.
- [ ] 6.2 Host instruction files and Workspace skills through the daemon, and the deletion of the
      host scopes. Keep operator skill directories in process. Verify the `instruction-files`
      registered-root scenarios and "Host Workspace skills come from the host Machine daemon".
- [ ] 6.3 Prompt imports on the current Machine through the daemon. Verify the existing
      `prompt-imports` scenarios against a real daemon child.
- [ ] 6.4 Confirm that no host-path branch remains in file tools, grep, git, Workspace MCP,
      instruction files, Workspace skills, or prompt imports, and that host `bash` and background
      jobs are the only in-process host families.
- [ ] 6.5 Docs: `skills.md`, `mcp-tools.md`, the instruction-file and prompt-import references,
      and a dated `CHANGELOG.md` entry.
- [ ] 6.6 Focused checks as in 3.14.
- [ ] 6.7 SR before ready; GR per [CONTRIBUTING.md](../../../CONTRIBUTING.md#ready-pr-monitoring).
      This PR carries `Closes #1831`.

## 7. finalize

Enter `host-as-machine/finalize` from `host-as-machine/workspace-context` with `$gh-stack` before
`$openspec-sync-specs` writes.

- [ ] 7.1 Run `$openspec-sync-specs`, inspect `openspec status --change host-as-machine --json`
      and this file, and stop on any incomplete artifact or unchecked task.

- [ ] 7.2 Check MODIFIED requirements and cross-capability wording for semantic consistency, then
      run `pnpm exec openspec validate --specs --strict` and
      `pnpm exec openspec validate --all --strict`.
- [ ] 7.3 Run `$openspec-archive-change` after readiness is proved.

SR and GR for finalize follow archive movement, as post-archive gates. After the merge, a separate
chore PR moves `openspec/specs/remote-machines` to `openspec/specs/machines`, rewrites its Purpose
for the host Machine, and updates every link (design D13).
