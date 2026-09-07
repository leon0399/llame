## Delivery stack

This proposal consumes the approved and landed `native-file-tools` contract.
Handoff base: `native-file-tools/finalize` merged as
`2d8e16e12dac83a02ebfe14bd8ec30f5c6418a88` (`docs: finalize native file tools
specification (#696)`). Tracking: [#697](https://github.com/leon0399/llame/issues/697).
Use `$gh-stack` and `$openspec-apply-change` after proposal approval:

```text
master
  <- bash-executor/proposal
  <- bash-executor/contract
  <- bash-executor/native-host
  <- bash-executor/file-context
  <- bash-executor/recovery
  <- bash-executor/acceptance
  <- bash-executor/finalize
```

## 1. contract

- [x] 1.1 Create the `packages/bash-executor` contract with command input, bounded result, executor context, attempt receipt, cancellation, and unknown-outcome types; verify no Git, Markdown, URL, or permission implementation is imported.
- [x] 1.2 Define safe command metadata and result sanitization; verify host paths, credentials, stack traces, and unbounded output cannot enter model-visible results.
- [x] 1.3 Define same-directory handoff with `native-file-tools`; verify adapters cannot claim success while using a different working directory.

## 2. managed-executor-contract

- [ ] 2.1 Implement the managed-executor contract with trusted working-directory context, bounded command execution, and explicit isolation/secrets prerequisites; verify direct host bash is not advertised.
- [ ] 2.2 Define ordinary configured tools (`bash`, `grep`, `rg`, `jq`, and Python where installed) without making any one tool the canonical editor; verify command names/arguments remain bounded by the future managed host contract.
- [ ] 2.3 Add output, input, duration, process, secret-boundary, and cancellation requirements; verify the capability remains unavailable when any required boundary is missing.

## 3. file-context

- [ ] 3.1 Run native `read`, `edit`, and `write` and bash against one live directory; verify each direction sees the other's known changes.
- [ ] 3.2 Add same-path and concurrent-process tests; verify known sequential calls observe current bytes and unsupported shared-directory guarantees fail closed.

## 4. recovery

- [ ] 4.1 Persist an attempt identity before command start and record known completion only after process-tree quiescence; verify normal completion, timeout, cancellation, host crash, and surviving descendants.
- [ ] 4.2 Mark uncertain effects `outcome_unknown`, fence the context, and prohibit automatic replay; verify a new tool-call ID cannot rerun the unknown command.

## 5. acceptance

- [ ] 5.1 Add an alpha workflow that reads a file, runs `grep`/`jq` or Python, edits a file, rereads it, and reports bounded output; verify the same path and bytes are used throughout.
- [ ] 5.2 Run package/runtime contract tests, typecheck, lint, build, `pnpm lint:markdown`, `pnpm format:check`, and `git diff --check`; verify no direct host bash, Git submit, Markdown processor, or URL loader is claimed.

## 6. finalize

- [ ] 6.1 Sync the `bash-execution` spec and record the future managed-Sandbox and permission proposals; verify strict OpenSpec validation and no native host authority is accidentally described as tenant isolation.
- [ ] 6.2 Archive only after every task is checked and acceptance evidence is complete; run strict specs/all validation and final formatting gates.
