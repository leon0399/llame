# Tasks

Tracks issue [#936](https://github.com/leon0399/llame/issues/936); follow-ups #1364 to #1369 are blocked by it.

## Delivery stack

```text
remote-machines-stack/status-bar <- ssh-locator/proposal <- ssh-locator/shared-ssh <- ssh-locator/read <- ssh-locator/bash <- ssh-locator/finalize
```

The stack sits on the remote-Machines stack because it reuses that SSH
transport; it rebases onto `master` as those layers merge.

- `ssh-locator/proposal` (parent `remote-machines-stack/status-bar`): owns only
  `proposal.md`, `design.md`, the `ssh-locator` spec, and this file.
- `ssh-locator/shared-ssh` (parent `ssh-locator/proposal`): moves the SSH safety
  configuration, spawn seam, and failure classification out of
  `apps/api/src/machines` into a shared module with no behavior change.
  Estimate about 500 authored lines, mostly renames.
- `ssh-locator/read` (parent `ssh-locator/shared-ssh`): the `ssh` section, the
  locator grammar, resolved permission projection, and `read` of files and
  directories, with refusals for other tools and Workspace entry. Estimate
  about 1,900 authored lines.
- `ssh-locator/bash` (parent `ssh-locator/read`): `bash` with an `ssh://` `cwd`,
  its attempt record, outcomes, and prerequisites, plus the `bash` description
  changes. Estimate about 1,700 authored lines. Owns `Closes #936`.
- `ssh-locator/finalize` (parent `ssh-locator/bash`): owns only spec
  synchronization, task records, and archive movement.

Create and move between layers with `$gh-stack`; implement with
`$openspec-apply-change`. Implementation starts only after Leo approves the
published proposal revision. Every layer completes self-review (SR) of its
actual parent-relative draft diff before draft to ready, then the GitHub
review (GR) loop of bots and current-head CI per
[CONTRIBUTING.md](../../../CONTRIBUTING.md). Re-estimate each layer at its
boundary and request a named exception before publishing one over the budget.

## 1. Proposal layer (`ssh-locator/proposal`)

- [ ] 1.1 Validate the change with `pnpm exec openspec validate ssh-locator --strict`, `pnpm lint:markdown`, `pnpm format:check`, and `git diff --check`, all passing
- [ ] 1.2 Run `$iterative-review-refinement` with at least two independent reviewers, verify each finding against code or specs, and commit each round separately
- [ ] 1.3 Self-review the published draft PR diff, mark it ready, and obtain Leo's approval of the published revision

## 2. Shared SSH transport (`ssh-locator/shared-ssh`)

- [ ] 2.1 Move the safety-block renderer, generated-file lifecycle, spawn seam, destination formatting, and stderr classification into a shared SSH module that the Machine connector calls, keeping only the `llame-machine serve --stdio` tail in Machine code, and verify with rename detection that the move is the bulk of the diff and that the Machine unit and `pnpm --filter api test:integration` Machine suites pass unchanged
- [ ] 2.2 Run the affected workspace `lint`, `typecheck`, and `test:coverage`, `pnpm format:check`, and `git diff --check`, all passing
- [ ] 2.3 Self-review the parent-relative draft diff, mark it ready, and complete the GitHub review and CI loop

## 3. Remote reads (`ssh-locator/read`)

- [ ] 3.1 Add the `ssh` section to the loader, `RawInstanceConfig`, and `llame.config.schema.json` with the `machines.ssh` path rules and defaults, and verify boot-failure tests for an interpolated path and an unknown key and a test that without the section `ssh://` is the unknown-scheme `invalid_path` with no process started ("ssh locators exist only when the operator enables them", "SSH settings are validated at startup")
- [ ] 3.2 Add the `ssh://` parser for the strict authority and decoded path, including the bare-locator message, and verify unit tests for option-shaped hosts, metacharacters in host and user, passwords, empty user or port, out-of-range ports, IPv6 literals, `%23` round-trip, encoded `/` and NUL, and a missing path ("ssh locators name a strictly spelled destination", "ssh locator paths are absolute and decoded once")
- [ ] 3.3 Add resolution through `ssh -F <generated> -G` and the resolved projection for `read` in permission evaluation, with the reject-either/allow-resolved rule and `ssh_unavailable` reason `config` on failure, and verify tests that an alias cannot bypass an address reject, an allow is scoped to its resolved host, a `^/` rule does not admit a remote path, a `%2E` spelling cannot bypass a `.ssh` reject, and a failed resolution starts no connection ("Permission rules match the resolved ssh locator")
- [ ] 3.4 Add the `ssh` branch to locator dispatch with the stdin read script, start marker, file and directory handling, bounds, and error mapping, and `unsupported_operation` for `edit` and `write`, and verify unit tests for marker parsing and failure classification plus Testcontainers integration tests on the remote-Machines sshd fixture with a plain-login key: a file with a selector, a 2 MiB file (`file_too_large`, transfer bounded), a binary file, a FIFO, a missing path, a 1,500-entry directory, an unreadable directory, an unpinned key, a rejected key, a host reached through the bastion alias, and `write` starting no process ("Remote file reads are bounded UTF-8 text", "Remote directory reads are bounded listings", "ssh connections use llame's SSH safety options", "ssh locators support only read and bash cwd")
- [ ] 3.5 Refuse `ssh://` in `enter_workspace` and keep Workspace projection from producing it, and verify tests for refused entry and an explicit `ssh://` read inside a Machine Workspace ("ssh locators support only read and bash cwd", "ssh locators extend local-only argument forms")
- [ ] 3.6 Replace the commented OMP bullet in `prompts/tools/read.md` with the `ssh://` form, bounds, and remote-authority disclosure, and verify the tool-description test ("ssh execution is disclosed as remote host authority")
- [ ] 3.7 Add `docs/product/operator/ssh.md` (enabling, pinned keys, included configuration and its `Match exec`, `CanonicalizeHostname`, `ProxyCommand`, and `SendEnv` caveats, resolved-locator rules with host-scoped allow examples, threats T1 to T6), `docs/product/reference/locators/ssh.md` and its index row, the `read` tool reference, `native-files.md`, `SPEC.md` §13.7, and a dated `CHANGELOG.md` entry, and verify `pnpm lint:markdown` and `node scripts/check-markdown-links.mjs` pass
- [ ] 3.8 Run `pnpm lint`, the affected workspace `typecheck` and `test:coverage`, the `ssh://` integration suite, `pnpm format:check`, and `git diff --check`, all passing
- [ ] 3.9 Self-review the parent-relative draft diff against REVIEW_GUIDE.md, mark it ready, and complete the GitHub review and CI loop

## 4. Remote bash (`ssh-locator/bash`)

- [ ] 4.1 Offer `bash` when the `ssh` section is present without a local executor, and verify a test that an `ssh://` `cwd` runs remotely while a local `cwd` returns `executor_unavailable` ("ssh locators extend local-only argument forms")
- [ ] 4.2 Add the `ssh://` `cwd` projection for permission evaluation through the resolution from 3.3, and verify tests that a `bash` reject on the resolved `cwd` refuses an alias spelling and that a selector on `cwd` is `invalid_path` ("Permission rules match the resolved ssh locator", "Bash runs remotely through an ssh working directory")
- [ ] 4.3 Run remote `bash` through the stdin script with `cd`, exported `env`, base-variable refusal, local bounds, and the unbound native attempt, and verify integration tests for `pwd`, a nonzero exit status, `env` absent from every argv on both hosts, a `PATH` collision starting no process, and output truncation at the local bound ("Bash runs remotely through an ssh working directory")
- [ ] 4.4 Map timeouts, cancellation, and post-start connection loss to `outcome_unknown` and pre-start failures to typed refusals, including `ssh_unsupported_host` for a host without `bash` or `sh`, and verify integration tests for a timed-out `sleep`, an unreachable host, a fixture variant without `bash` where `read` still works, and a unit test for the Windows shell classification ("Remote bash outcomes after start are never replayed", "Missing remote prerequisites are named")
- [ ] 4.5 Add the negative isolation integration test: user A runs remote `bash`, user B's API reads of native attempts and Run events return none of A's rows ("Hub-held state stays owner-isolated for ssh operations")
- [ ] 4.6 Update `prompts/tools/bash.md` with the `ssh://` `cwd` sentence, the remote-authority disclosure, and the `cwd` guidance (inside a Workspace omit `cwd` or pass a relative one; outside pass an absolute one; never `cd` inside `command`), and verify the tool-description test ("ssh execution is disclosed as remote host authority")
- [ ] 4.7 Update `docs/product/operator/ssh.md`, the locator reference, the `bash` tool reference, and the `CHANGELOG.md` entry for remote `bash`, and verify `pnpm lint:markdown` passes
- [ ] 4.8 Run `pnpm lint`, the affected workspace `typecheck` and `test:coverage`, the `ssh://` integration suite, `pnpm format:check`, and `git diff --check`, all passing
- [ ] 4.9 Smoke both tools against a real external host through one jump host, recording the transcript in the PR body
- [ ] 4.10 Self-review the parent-relative draft diff against REVIEW_GUIDE.md, mark it ready, and complete the GitHub review and CI loop

## 5. Finalize readiness (`ssh-locator/finalize`)

- [ ] 5.1 Enter `ssh-locator/finalize` with `$gh-stack` before any canonical spec is written, then run `$openspec-sync-specs` and verify `openspec/specs/ssh-locator/spec.md` matches the delta
- [ ] 5.2 Verify every task above is checked and `pnpm exec openspec validate --specs --strict` and `pnpm exec openspec validate --all --strict` pass

## Workflow follow-up

- Archive the change with `$openspec-archive-change` after 5.2.
- Self-review the finalize diff, mark it ready, and run the GitHub review and CI loop.
- Merge the stack through `$gh-stack` only with Leo's explicit permission.
