## Delivery stack

Use `$gh-stack` and `$openspec-apply-change` after proposal approval. Each
layer is one PR; keep it draft until its verification passes.

```text
master
  <- host-bash-context/proposal
  <- host-bash-context/timeout-fence
  <- host-bash-context/cwd-env
  <- host-bash-context/output-fidelity
  <- host-bash-context/finalize
```

`timeout-fence` closes #733 and #734. `output-fidelity` closes #735.
`finalize` archives. Every layer references #733, #734, and #735.

## 1. timeout-fence

- [x] 1.1 Make `settleDeadline` stop the process group and wait for it to empty as `settleExit` does; an empty group yields a known `timed_out` result with bounded partial stdout and stderr, a group that stays alive yields `outcome_unknown`; map an undefined pid and a synchronous `spawn` throw to a known `unavailable` refusal instead of `outcome_unknown`; verify a package test where a command exceeds a forced deadline returns `timed_out` carrying the output written before the kill, one where a backgrounded child in the same group ignores `SIGKILL` for longer than the quiescence budget returns `outcome_unknown`, and one where the spawn fails with no pid returns `unavailable` and, when an attempt was recorded, appends it as the attempt's known result.
- [x] 1.2 Add `timed_out` to the executor result types and map it in `apps/api/src/tools/bash.ts` to an error result whose message carries the deadline, both streams, and whether either was cut, in the `command_failed` layout; verify a unit test on the mapping including the truncation note.
- [x] 1.3 Split `executeManagedBash` at its admission seam so `bash.ts` runs admission first (which reserves the process slot and releases it on any refusal or failed `begin`), records the attempt through `NativeFilesRepository.begin` with `operation: 'bash'`, the bound native executor, the delivery sequence, and the resolved working directory as `path`, then runs the admitted request and appends `native.result`; add bash to the pre-execute progress gate via `isHostCapabilityTool`; widen the two recovery messages to "host command or mutation"; verify an integration test that a refused call writes no `native.attempt`, that a Run with a bash attempt and no result claimed by another worker id is failed with `outcome_unknown` before the tool loop starts, and that the existing repository replay tests still pass with `operation: 'bash'`.
- [x] 1.4 Delete `fencedDirectories`, `isDirectoryFenced`, `clearFence`, `unreplayableDigests`, `refusesUnknownReplay`, `releaseUnknownCommands`, `recoverIncompleteAttempts`, and their exports, shrinking `attempt-ledger.ts` to the per-session state the watcher needs; replace them with a live-group quarantine set: an unknown outcome whose group is still alive is kept by pgid, admission re-probes and re-signals each entry and refuses while any is alive, and an empty group is dropped; verify `knip`, lint, and typecheck pass and `recovery.test.ts` is rewritten so an unknown outcome with a `SIGKILL`-resistant survivor refuses the next admission until the survivor exits, after which the next call is admitted, and an unknown outcome with no survivor leaves the next call admitted.
- [x] 1.5 Regression test for #733: a Run ends with `outcome_unknown` with no surviving process, then a bash call in a new Run on the same process is admitted; verify it fails on the parent commit and passes here.
- [x] 1.6 Rewrite `SPEC.md` §13.8 once to state the durable attempt, the Run-scoped unknown outcome, and that the command contract (working directory, environment, output, result shapes) is owned by the `bash-execution` spec, so later layers do not re-edit it; add this layer's dated changelog entry; verify `pnpm lint:markdown` and `pnpm format:check` pass.

## 2. cwd-env

- [x] 2.1 Extend the `bash` input schema with optional `cwd` and optional `env` (string record), keeping `.strict()`; verify a unit test that an unknown key and a non-string `env` value are rejected before any process starts.
- [x] 2.2 Resolve `cwd` with `path.resolve(default, cwd)`, require an enterable directory (`opendir` probe) before the attempt is recorded, and refuse otherwise with an `unavailable` result in the shape of D4; verify tests that absolute and relative arguments run successfully, missing, regular-file, and mode-`000` arguments return `unavailable` with no `native.attempt` written, and a following call without `cwd` runs in the default directory.
- [x] 2.3 Build the child environment from the declared base (managed `PATH`, `LANG=C.UTF-8`, `HOME`, `TMPDIR`, `USER`, `LOGNAME` when set, `TERM=dumb`) plus the call's `env`, rejecting a key that collides with a base name before the attempt is recorded and counting `env` toward the input bound; verify at the executor seam that the initial spawn environment contains exactly that base plus the additions, then run an actual `bash` wrapper regression with a unique sentinel in the llame process environment and confirm the sentinel is absent while allowing Bash/launcher-generated `PWD`, `SHLVL`, `_`, and other runtime variables in `env` output; verify `env: { PATH: ... }` is refused with a message naming `PATH`.
- [x] 2.4 Delete `WIDENING_KEYS` and `parseCommandInput`, `fileToolsWorkingDirectory`, `assertSharedWorkingDirectory`, `workspace_mismatch`, and the `workspace.ts` tautology; verify `knip`, lint, typecheck, and the package tests pass with the removed cases deleted rather than skipped.
- [x] 2.5 Update the tool description per D8, add the non-persistence sentence to `chat-default.md`, and add this layer's dated changelog entry; verify the receipt snapshot test and `pnpm lint:markdown` pass.

## 3. output-fidelity

- [ ] 3.1 Delete `stripHostPaths` and `stripStackTraces`, keeping protected-value redaction and the bounded cut; verify package tests that an absolute path, a `Traceback` block, and a line beginning `Error:` survive verbatim, that a protected value is still redacted, and an API-level test that a bash result containing `</tool-result>` still reaches the model escaped.
- [ ] 3.2 Update `docs/native-files.md` (per-call `cwd` and `env`, default directory, fresh process per call, output returned as produced, Knowledge root discoverability stated), README, and add this layer's dated changelog entry; verify `pnpm lint:markdown` and `pnpm format:check` pass.
- [ ] 3.3 Focused e2e: a chat command that prints a path and exits non-zero renders the path and the exit code; verify it passes in CI.

## 4. finalize

- [ ] 4.1 Run `$openspec-sync-specs`, then `pnpm exec openspec validate --specs --strict`, `--all --strict`, `pnpm lint:markdown`, `pnpm format:check`, and `git diff --check`; verify all pass and record the results in the PR body.
- [ ] 4.2 Confirm every task above is checked, then run `$openspec-archive-change`; verify `openspec status --change host-bash-context --json` reports complete before archiving.
