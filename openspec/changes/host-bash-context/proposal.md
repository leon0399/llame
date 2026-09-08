## Why

The alpha `bash` tool shipped in #697 refuses every command on a worker for the
rest of that process's life after one command exceeds its deadline (#733), and
it returns output with every absolute path and every `Error:` line silently
rewritten or deleted (#735). Both come from the same three facts: the timeout
path classifies a confirmed kill as `outcome_unknown`, the resulting fence is
keyed to a process-wide working directory that nothing releases, and the
sanitizer was written for a boundary the alpha never had. The attempt ledger
that the spec calls durable is three module-level collections (#734). One delta
to `bash-execution` resolves all three, because they amend the same
requirement block.

## What Changes

- A timeout whose process tree is proven stopped is a known `timed_out` result
  with its bounded partial output. `outcome_unknown` is reserved for an
  unproven stop after timeout, cancellation, or host failure.
- The command attempt is recorded in the durable Run event log before the
  process starts and its result after, through the same pre-effect fence the
  native mutations use. A Run resumed on any worker after an unproven attempt
  does not re-execute it. The process-local directory fence and command-digest
  block list are deleted; an unknown outcome terminates the Run that issued it
  and affects no other Run.
- **BREAKING** `bash` takes an optional per-call `cwd`. Each call is a fresh
  process; nothing persists between calls, and the tool description says so.
  The shipped shared-directory requirement between bash and native file tools
  is reduced to what is true on a host: both operate on the same live host
  filesystem as the same OS user. `workspace_mismatch` and the tautological
  same-directory assertion are removed.
- `bash` takes an optional per-call `env`, additive only. The child starts from
  a fixed base (`PATH`, `LANG`, `HOME`, `TMPDIR`, `USER`, `LOGNAME`, `TERM`).
  Any `env` key that names a base variable is rejected, whichever one it is;
  `PATH` is the case that matters most, since it decides which binary a name
  resolves to. The parent environment is never inherited wholesale.
- Command output is returned as the command produced it, within the bound.
  The passes that rewrite absolute paths to a `[path]` placeholder and delete lines that
  look like stack frames are removed. Redaction of values the host knows to be
  secret stays.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `bash-execution`: the executor-gate requirement admits a per-call working
  directory and additive environment; the shared-directory requirement becomes
  a same-filesystem requirement; the bounded-result requirement stops requiring
  output rewriting; the unknown-effects requirement gains a durable attempt,
  classifies a proven-stopped timeout as known, and scopes an unknown outcome
  to its Run.

## Impact

`packages/bash-executor`: `watch.ts` deadline settlement, `attempt-ledger.ts`
(shrinks to per-session state), `sanitize.ts` (two passes and `WIDENING_KEYS`
deleted, `env` and `cwd` admitted), `execute.ts` spawn environment,
`workspace.ts` and `types.ts` (`workspace_mismatch`,
`fileToolsWorkingDirectory`, and `BashExecutorContext` fields removed,
`timed_out` added). `apps/api/src/tools/bash.ts`: input schema, attempt
recording through `NativeFilesRepository`, result mapping, tool description.
`apps/api/src/runs/native-files-repository.ts`: `operation` admits `bash`.
`apps/api/src/prompts/chat-default.md`, `docs/native-files.md`, `SPEC.md` §13.8,
README, and the changelog. No database migration: `native.attempt` and
`native.result` already exist. Issues: closes #733, #734, #735. Permissions,
approval policy, and the Sandbox stay unowned here.
