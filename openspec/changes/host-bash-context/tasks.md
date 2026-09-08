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

- [ ] 1.1 Make `settleDeadline` stop the process group and wait for quiescence as `settleExit` does; a proven stop yields a known `timed_out` result with bounded partial stdout and stderr, an unproven stop yields `outcome_unknown`; verify a package test where a command exceeds a forced deadline with a confirmed-stopped group returns `timed_out` carrying the output written before the kill, and one where a detached descendant survives returns `outcome_unknown`.
- [ ] 1.2 Add `timed_out` to the executor result types and map it in `apps/api/src/tools/bash.ts` to an error result whose message carries the deadline and streams in the `command_failed` layout; verify a unit test on the mapping.
- [ ] 1.3 Record the bash attempt through `NativeFilesRepository.begin` with `operation: 'bash'`, the bound native executor, the delivery sequence, and the resolved working directory as `path` before the process starts, and append `native.result` after; verify an integration test that a replayed tool-call id returns the recorded result without spawning, and that a Run with a bash attempt and no result claimed by another worker id is failed with `outcome_unknown` before the tool loop starts.
- [ ] 1.4 Delete `fencedDirectories`, `isDirectoryFenced`, `clearFence`, `unreplayableDigests`, `refusesUnknownReplay`, `releaseUnknownCommands`, `recoverIncompleteAttempts`, and their exports, shrinking `attempt-ledger.ts` to the per-session state the watcher needs; verify `knip`, lint, and typecheck pass and `recovery.test.ts` is rewritten so an unknown outcome in one call leaves the next call admitted.
- [ ] 1.5 Regression test for #733: a Run ends with `outcome_unknown`, then a bash call in a new Run on the same process is admitted; verify it fails on the parent commit and passes here.
- [ ] 1.6 Update `SPEC.md` §13.8 to describe the durable attempt and the Run-scoped unknown outcome; verify `pnpm lint:markdown` and `pnpm format:check` pass.

## 2. cwd-env

- [ ] 2.1 Extend the `bash` input schema with optional `cwd` and optional `env` (string record), keeping `.strict()`; verify a unit test that an unknown key and a non-string `env` value are rejected before any process starts.
- [ ] 2.2 Resolve `cwd` with `path.resolve(default, cwd)`, require an existing directory, and refuse otherwise with an `unavailable` result in the shape of D4; verify tests for absolute, relative, missing, and file-not-directory arguments, and that a following call without `cwd` runs in the default directory.
- [ ] 2.3 Build the child environment from the declared base (`PATH`, `LANG`, `HOME`, `TMPDIR`, `USER`, `LOGNAME`, `TERM=dumb`) plus the call's `env`, rejecting a key that collides with a base name before the attempt is recorded and counting `env` toward the input bound; verify a test that `env` prints only base names plus the additions and no llame variable, and that `env: { PATH: ... }` is refused with a message naming `PATH`.
- [ ] 2.4 Delete `WIDENING_KEYS` and `parseCommandInput`, `fileToolsWorkingDirectory`, `assertSharedWorkingDirectory`, `workspace_mismatch`, and the `workspace.ts` tautology; verify `knip`, lint, typecheck, and the package tests pass with the removed cases deleted rather than skipped.
- [ ] 2.5 Update the tool description per D8 and add the non-persistence sentence to `chat-default.md`; verify the receipt snapshot test and `pnpm lint:markdown` pass.

## 3. output-fidelity

- [ ] 3.1 Delete `stripHostPaths` and `stripStackTraces`, keeping protected-value redaction and the bounded cut; verify package tests that an absolute path, a `Traceback` block, and a line beginning `Error:` survive verbatim, and that a protected value is still redacted.
- [ ] 3.2 Update `docs/native-files.md` (per-call `cwd` and `env`, default directory, fresh process per call, output returned as produced, Knowledge root discoverability stated), README, and the changelog entry; verify `pnpm lint:markdown` and `pnpm format:check` pass.
- [ ] 3.3 Focused e2e: a chat command that prints a path and exits non-zero renders the path and the exit code; verify it passes in CI.

## 4. finalize

- [ ] 4.1 Run `$openspec-sync-specs`, then `pnpm exec openspec validate --specs --strict`, `--all --strict`, `pnpm lint:markdown`, `pnpm format:check`, and `git diff --check`; verify all pass and record the results in the PR body.
- [ ] 4.2 Confirm every task above is checked, then run `$openspec-archive-change`; verify `openspec status --change host-bash-context --json` reports complete before archiving.
