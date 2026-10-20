# Tasks

Tracks issue [#936](https://github.com/leon0399/llame/issues/936); follow-ups #1364 to #1369 are blocked by it.

## Delivery stack

```text
master <- ssh-locator/proposal <- ssh-locator/shared-ssh <- ssh-locator/resolve <- ssh-locator/read <- ssh-locator/bash <- ssh-locator/bash-guidance <- ssh-locator/finalize
```

The change reuses the remote-Machines SSH transport, merged on `master`.
Estimates are scaled from the measured Machine layers (#1348 transport and
fixture, #1350 native tools) and include tests and docs.

- `ssh-locator/proposal` (parent `master`): owns only
  `proposal.md`, `design.md`, the delta specs, and this file.
- `ssh-locator/shared-ssh` (parent `ssh-locator/proposal`): moves the SSH safety
  configuration, spawn seam, and failure classification out of
  `apps/api/src/machines` into a shared module with no behavior change.
  Estimate 800 to 1,000 authored lines; extraction from `machine-transport.ts`
  counts as added plus deleted.
- `ssh-locator/resolve` (parent `ssh-locator/shared-ssh`): the `ssh` section,
  the locator grammar, the one-shot runner, bounded resolution, and the
  two-pass admission for `read`, plus the `edit`, `write`, and
  `enter_workspace` refusals. With the section present and no dispatch yet, an
  admitted `ssh://` read is still the unknown-scheme `invalid_path`, so the
  layer fails closed. Estimate about 1,900 authored lines.
- `ssh-locator/read` (parent `ssh-locator/resolve`): remote read scripts,
  markers, file and directory reads, pre-marker classification, the fixture,
  the `read` description, and the operator and reference docs. Estimate about
  2,000 authored lines.
- `ssh-locator/bash` (parent `ssh-locator/read`): `bash` with an `ssh://` `cwd`:
  admission, `env` rules, script, attempt record, and outcomes. Estimate about
  2,000 authored lines.
- `ssh-locator/bash-guidance` (parent `ssh-locator/bash`): the `bash`
  description changes, the negative isolation test, `bash` docs, and the real
  host smoke. Estimate about 700 authored lines. Owns `Closes #936`.
- `ssh-locator/finalize` (parent `ssh-locator/bash-guidance`): owns only spec
  synchronization, task records, and archive movement.

Create and move between layers with `$gh-stack`; implement with
`$openspec-apply-change`. Implementation starts only after Leo approves the
published proposal revision. Every layer completes self-review (SR) of its
actual parent-relative draft diff before draft to ready, then the GitHub
review (GR) loop of bots and current-head CI per
[CONTRIBUTING.md](../../../CONTRIBUTING.md). Re-estimate each layer at its
boundary and request a named exception before publishing one over the budget.

## 1. Proposal layer (`ssh-locator/proposal`)

- [x] 1.1 Validate the change with `pnpm exec openspec validate ssh-locator --strict`, `pnpm lint:markdown`, `pnpm format:check`, and `git diff --check`, all passing
- [x] 1.2 Run `$iterative-review-refinement` with at least two independent reviewers, verify each finding against code or specs, and commit each round separately
- [ ] 1.3 Self-review the published draft PR diff, mark it ready, and obtain Leo's approval of the published revision

## 2. Shared SSH transport (`ssh-locator/shared-ssh`)

- [x] 2.1 Move the safety-block renderer, generated-file lifecycle, spawn seam, and stderr classification into a shared SSH module that the Machine connector calls, keeping the `llame-machine serve --stdio` tail and `sshDestination` in Machine code, and verify that the Machine unit and `pnpm --filter api test:integration` Machine suites pass with only import-path changes
- [x] 2.2 Run the affected workspace `lint`, `typecheck`, and `test:coverage`, `pnpm format:check`, and `git diff --check`, all passing
- [ ] 2.3 Self-review the parent-relative draft diff, mark it ready, and complete the GitHub review and CI loop

## 3. Resolution and admission (`ssh-locator/resolve`)

- [ ] 3.1 Add the `ssh` section to the loader, `RawInstanceConfig`, and `llame.config.schema.json` with the `machines.ssh` path rules and defaults, and verify boot-failure tests for an interpolated path and an unknown key, a test that `ssh: {}` uses the worker user's files, a test that without the section `ssh://` is the unknown-scheme `invalid_path` with no process started, and tests that `identityAgent` renders only into the `ssh://` configuration and is absent by default ("ssh locators are available only with an ssh section", "SSH settings are validated at startup", "The ssh agent is off unless the operator selects it")
- [ ] 3.2 Add the `ssh://` parser and verify unit tests for option-shaped hosts, metacharacters in host and user, passwords, `%` and IPv6 zones, empty user or port, out-of-range ports, an uppercase scheme, IPv6 literals, `%23` round-trip, encoded `/` and NUL, a missing path, and an uppercase host that resolves through the lowercase alias, and the `ssh://`/`ssh:///` message ("ssh locators name a destination with strict spelling", "The host of an ssh locator is lowercase before use", "ssh locator users and ports have a strict form", "ssh locator paths are absolute and decoded one time", "A bare ssh locator tells how to address hosts")
- [ ] 3.3 Add the one-shot runner (byte-exact bounded stdout, bounded stderr, deadline, abort, `-l`/`-p` destination form) and bounded resolution through `ssh -F <generated> -G`, and verify unit tests for user, host, port, and IPv6 parsing, default rendering, a lowercase host in the resolution, an invalid-option config failing as `config`, a hanging `Match exec` stopped by the deadline, and abort ("ssh destinations resolve to a canonical locator before permission evaluation")
- [ ] 3.4 Add the asynchronous two-pass admission for `read` before `evaluateToolPermission`, binding execution to the resolved user, host, and port and treating `ssh://` as refused in the synchronous preview, and verify tests that a submitted-text reject refuses without resolving, an alias cannot bypass an address reject, an all-fields reject sees the resolved text, an allow is scoped to its resolved host, a `^/` rule does not admit a remote path, a `%2E` spelling cannot bypass a `.ssh` reject, `..` is kept, and resolution runs in `bypass` mode ("Permission rules match the resolved ssh locator", "The model selects the remote authority of an ssh locator")
- [ ] 3.5 Return `unsupported_operation` for `edit` and `write`, refuse `ssh://` in `enter_workspace`, keep Workspace projection from producing it, and verify tests that none starts a process and that entry leaves the Chat outside a Workspace ("ssh locators support only read and bash cwd")
- [ ] 3.6 Run the affected workspace `lint`, `typecheck`, and `test:coverage`, `pnpm format:check`, and `git diff --check`, all passing
- [ ] 3.7 Self-review the parent-relative draft diff, mark it ready, and complete the GitHub review and CI loop

## 4. Remote reads (`ssh-locator/read`)

- [ ] 4.1 Extend the sshd fixture with a plain-login key on the box that the bastion also accepts, test files created as root (FIFO, an unreadable directory with a nested file, 1,500 entries, a newline-bearing name, a symlink, an empty file, a 2 MiB file), a `.bashrc` that prints text, and a container variant whose account has only `/bin/sh`, and verify the Machine suites still pass
- [ ] 4.2 Add the `ssh` dispatch branch with the read script, nonce markers, preconditions, file and directory output, and the pre-marker classifier, and verify unit tests for marker parsing, discarded pre-marker bytes, a transfer that reaches its stdout bound, a missing trailer, and the Windows and forced-command classifications ("Remote output starts after a per-call marker", "Missing remote prerequisites are named")
- [ ] 4.3 Verify Testcontainers integration tests: a file with a selector, `.bashrc` noise excluded, a 2 MiB file (`file_too_large`, transfer bounded), a binary file, a FIFO, a missing path, an empty and a symlinked file, a 1,500-entry directory, a newline-bearing name, a symlink entry, an unreadable directory, an empty directory, a directory above the traversal budget (`directory_too_large`, no entries), an unpinned key, an included `StrictHostKeyChecking accept-new`, a rejected key, a read through the bastion alias, a read on the `sh`-only variant, and two users reading the same host ("Remote file reads are bounded UTF-8 text", "Remote file reads number lines as local reads do", "Remote directory reads use the local list form", "Remote directory lists are bounded", "Remote directory reads fail above the traversal budget", "ssh locators extend the local list and import rules", "ssh connection failures have a reason", "ssh connections use the llame SSH safety options", "ssh locators are available only with an ssh section")
- [ ] 4.4 Verify a read of an explicit `ssh://` locator inside a Machine Workspace reaches the `ssh://` host ("ssh locators support only read and bash cwd")
- [ ] 4.4a Plan an `ssh://` prompt-import marker as a direct read when the `ssh` section is present and `read` is allowlisted, give the system read context the SSH client, and verify unit tests that the marker is read once without a probe, stays prose without the section, and that a denied target is named as not imported ("ssh locators are prompt-import targets", "ssh locators extend the local list and import rules")
- [ ] 4.5 Replace the commented OMP bullet in `prompts/tools/read.md` with the `ssh://` form, bounds, and remote-authority disclosure, and verify the tool-description test ("ssh operations are disclosed as remote host authority")
- [ ] 4.6 Add `docs/product/operator/ssh.md` (enabling, pinned keys, included configuration and its `Match exec` (it runs for the resolution and again for the connection), `CanonicalizeHostname` with `CanonicalizePermittedCNAMEs`, `CanonicalDomains`, and `CanonicalizeFallbackLocal`, `ProxyCommand`, `SendEnv`, and `Match host` caveats, lowercase alias spelling with case-sensitive `Host` matching, resolved-locator rules with host-scoped allows and the anchored `..` reject, threats T1 to T6), `docs/product/reference/locators/ssh.md` and its index row, the `read` tool reference, `native-files.md`, `SPEC.md` §13.7, and a dated `CHANGELOG.md` entry, and verify `pnpm lint:markdown` and `node scripts/check-markdown-links.mjs` pass
- [ ] 4.7 Run `pnpm lint`, the affected workspace `typecheck` and `test:coverage`, the `ssh://` integration suite, `pnpm format:check`, and `git diff --check`, all passing
- [ ] 4.8 Self-review the parent-relative draft diff against REVIEW_GUIDE.md, mark it ready, and complete the GitHub review and CI loop

## 5. Remote bash (`ssh-locator/bash`)

- [ ] 5.1 Export the base-variable check and output sanitizer from `packages/bash-executor`, offer `bash` when the `ssh` section is present without a local executor, and verify a test that an `ssh://` `cwd` runs remotely while a local `cwd` returns `executor_unavailable` ("ssh locators extend local-only argument forms")
- [ ] 5.2 Add the two-pass admission for `bash` `cwd` through the resolution from 3.3, and verify tests that a submitted-text reject on `cwd` refuses without resolving, a reject on the resolved `cwd` refuses an alias spelling, a selector on `cwd` is `invalid_path`, a `command` reject refuses without resolving, and a NUL command is refused before any process ("Permission rules match the resolved ssh locator", "Remote bash commands hold no NUL", "The model selects the remote authority of an ssh locator")
- [ ] 5.3 Enforce the `env` key grammar, NUL refusal, and base-variable refusal before any process, and verify unit tests for a key carrying shell text, a NUL value, and `PATH` ("Remote bash environment entries are data")
- [ ] 5.4 Run remote `bash` through the script with the `cd` precondition, exported values, the start marker, the end trailer, stdin empty, local bounds, the shared process slot, and the unbound native attempt, and verify integration tests for `pwd`, `exit 255`, a missing `cwd` refused without running, `env` absent from every argv on both hosts, output truncation, an `ssh://` `cwd` inside a Machine Workspace, and `bash` refused on the `sh`-only variant while `read` works ("Bash runs on a remote host through an ssh working directory", "Remote bash uses the local bounds", "The host can refuse a remote bash call before the command", "Remote bash environment entries are data", "Missing remote prerequisites are named")
- [ ] 5.5 Map timeouts, cancellation, and a missing trailer to `outcome_unknown` and classified pre-session failures to typed refusals, and verify integration tests for a timed-out `sleep`, cancellation mid-session, and an unreachable host ("Remote bash outcomes after start are never replayed", "A remote bash stop before SSH starts is a known outcome")
- [ ] 5.6 Run `pnpm lint`, the affected workspace `typecheck` and `test:coverage`, the `ssh://` integration suite, `pnpm format:check`, and `git diff --check`, all passing
- [ ] 5.7 Self-review the parent-relative draft diff against REVIEW_GUIDE.md, mark it ready, and complete the GitHub review and CI loop

## 6. Bash guidance and delivery (`ssh-locator/bash-guidance`)

- [ ] 6.1 Update `prompts/tools/bash.md` with the `ssh://` `cwd` sentence, the remote-authority disclosure, and the working-directory guidance, and verify the tool-description test ("ssh operations are disclosed as remote host authority", "The bash description tells the model to use cwd")
- [ ] 6.2 Add the negative isolation integration test: user A runs remote `bash`, and user B's API reads of native attempts and Run events return none of A's rows ("Hub state for ssh operations stays isolated for each owner")
- [ ] 6.3 Update `docs/product/operator/ssh.md`, the locator reference, the `bash` tool reference, and the `CHANGELOG.md` entry for remote `bash`, and verify `pnpm lint:markdown` passes
- [ ] 6.4 Run `pnpm lint`, the affected workspace `typecheck` and `test:coverage`, `pnpm format:check`, and `git diff --check`, all passing
- [ ] 6.5 Smoke `read` and `bash` against a real external host through one jump host, recording the transcript in the PR body
- [ ] 6.6 Self-review the parent-relative draft diff against REVIEW_GUIDE.md, mark it ready, and complete the GitHub review and CI loop

## 7. Finalize readiness (`ssh-locator/finalize`)

- [ ] 7.1 Enter `ssh-locator/finalize` with `$gh-stack` before any canonical spec is written, then run `$openspec-sync-specs` and verify `openspec/specs/ssh-locator/spec.md` and the `bash-execution` addition match the deltas
- [ ] 7.2 Verify every task above is checked and `pnpm exec openspec validate --specs --strict` and `pnpm exec openspec validate --all --strict` pass

## Workflow follow-up

- Archive the change with `$openspec-archive-change` after 7.2.
- Self-review the finalize diff, mark it ready, and run the GitHub review and CI loop.
- Merge the stack through `$gh-stack` only with Leo's explicit permission.
