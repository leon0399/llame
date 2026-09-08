## Context

See proposal.md — Why. The shipped alpha (#697, archived design
`2026-09-07-bash-executor`) runs `bash -c` under `spawn` with `cwd`,
`shell: false`, `detached: true`, and an environment of `PATH` and `LANG`
only (`packages/bash-executor/src/execute.ts:210-216`). There is no chroot,
namespace, or path containment, so `cd /etc && cat passwd` already works;
native `read`, `edit`, and `write` carry the same host-OS-user authority on
absolute paths. Bash is the more restricted tool today: one fixed working
directory from `BASH_WORKING_DIRECTORY` or the process cwd, and output that
cannot name a path.

Three shipped requirements are satisfied by accident rather than by the
mechanism they name:

- R1's "model cannot widen execution" scenario is enforced by the zod
  `.strict()` schema in `apps/api/src/tools/bash.ts`, not by `WIDENING_KEYS`,
  whose `parseCommandInput` has no caller outside the package.
- R2's shared-directory guarantee cannot fail: `managedContext()` sets
  `fileToolsWorkingDirectory` from the same value as `workingDirectory`, so
  `assertSharedWorkingDirectory` is a tautology and `workspace_mismatch` is
  unreachable.
- R4's durability claim rests on three module-level collections
  (`attempt-ledger.ts:14-17`); the crash-recovery scenario iterates a `Map`
  the crash destroyed. `isDirectoryFenced` has one caller, `execute.ts:132`,
  so native `edit` and `write` never observe the bash fence either.

The failure chain of #733: `settleDeadline` (`watch.ts:123-128`) kills the
process group and reports unknown unconditionally, while `settleExit` proves
quiescence first. Every unknown outcome aborts the Run
(`run-execution.service.ts:678`), adds the process-wide cwd to
`fencedDirectories`, and adds the command digest to `unreplayableDigests`.
`clearFence`, `releaseUnknownCommands`, and `recoverIncompleteAttempts` are
exported and never called, so the only release is a process restart, and every
later bash call in every Run on that worker is refused meanwhile. The digest
set is the same defect one size smaller: the same shell text is refused for
every Run on the worker until restart.

Prior art surveyed for this change: openclaw, hermes-agent, oh-my-pi, goose,
gemini-cli, deepseek-harness (line cites in #733, #734, #735; unpinned, taken
from fresh clones on 2026-09-07/08). Two facts carried into the decisions
below: no peer strips absolute paths or stack frames from shell output, and no
peer tracks whether a command took effect — `outcome_unknown` is the one
place this work is ahead of the field.

The native file tools already own a durable pre-effect fence:
`NativeFilesRepository.begin` locks the Run, checks the delivery sequence,
binds the executor, refuses a replayed tool-call id through `priorOutcome`,
and appends `native.attempt`; the mutation then appends `native.result`. A Run
claimed on another worker with a `native.attempt` and a bound worker is failed
with `outcome_unknown` before anything re-executes
(`run-execution.service.ts:309-343`).

## Goals / Non-Goals

Goals:

- A command that is killed at its deadline and proven stopped is a known
  result with the output it produced.
- An unknown outcome costs the Run that produced it, nothing else, and the
  spec's durability claim is true rather than deleted.
- The model can name a working directory and add environment variables per
  call, under a base the model cannot replace.
- Command output reaches the model as the command wrote it, within the bound.

Non-goals:

- Permissions, approval policy, and the Sandbox. Every surveyed peer keeps
  approval in a separate layer the shell tool calls into; that layer is
  unowned here and deliberately not claimed.
- Backgrounding long commands, session persistence between calls, changing
  the deadline value, or Knowledge submit coordination (#212).
- A source of protected values for the redaction pass. It stays inert until
  something introduces model-invisible secrets into the bash process.

## Decisions

### D1: Timeout classification follows the same proof as exit and cancel

`settleDeadline` stops the process group, then waits for the group to empty
exactly as `settleExit` does. Empty is a known `timed_out` result carrying the
bounded stdout and stderr captured before the kill and the deadline that
fired; not provably empty is `outcome_unknown`. The spec listed timeout as
unknown unconditionally because the alpha never proved a kill; the cancel path
already proves one and reports `cancelled` as known, so this aligns the third
path with the other two. Every surveyed peer preserves partial output on
timeout.

The proof is `kill(-pgid, 0)` (`process-tree.ts:4-11`): a process group probe.
A descendant that calls `setsid` leaves the group and is invisible to it; the
shipped spec said "process tree and descendants", which the code never
delivered. The delta says "process group" and states the gap.

The same gap exists on a normal exit today and in the shipped alpha: `bash -c
"setsid work &"` returns a known result the moment the shell exits. Timeout
is not the special case; the proof boundary is. A tree-wide mechanism (a
cgroup, which needs delegation the llame user does not have, or a `/proc`
scan, which loses reparented processes) is a later change if a real case
needs it; none of the surveyed peers has one either. "Remain unknown" is not
an option the probe can implement: it cannot see what it would classify.

The probe is bounded: `waitForProcessGroupQuiescence` polls for 250 ms after
`SIGKILL` and reports the group alive if it is still there at expiry, which is
the unknown branch. The number is an implementation constant; the contract
states only that expiry is unknown.

A process that never started is a known refusal, never unknown. Today
`watch.ts:61-64` maps an undefined pid to `outcome_unknown`, and a `cwd` that
is a regular file makes `spawn` throw synchronously out of the executor. Both
become `unavailable`: nothing executed, so nothing is uncertain.

Alternative: keep timeout unknown and only add a release path. Rejected: it
leaves a clean kill indistinguishable from surviving descendants and aborts
the Run for a command that merely ran long.

### D2: The durable attempt is the native one

`bash` calls `NativeFilesRepository.begin` with `operation: 'bash'`, the bound
native executor, and the resolved working directory as `path` before the
process starts, and appends `native.result` with the tool-call id and the
result after. This is the mechanism the spec described and the alpha did not
build; it already exists a directory away, so the ladder stops at reuse.

The executor is split at its existing seam: admission (`admitExecution`, the
bound, process-limit, tool-set, quarantine, and pre-abort checks) returns
either a refusal or a run request, and `bash.ts` records the attempt between
the two, so a refused call never writes `native.attempt` and never sets
`hasMutation`. Admission reserves the process slot; the increment moves out
of `runAdmitted` so two calls cannot both pass `maxProcesses` while one is
waiting on the durable write, and a refusal or a failed `begin` releases the
slot. A spawn that fails after the attempt is recorded appends a known
`unavailable` result.
Bash also joins the pre-execute progress gate that native tools use
(`run-execution.service.ts:653-657`, keyed on `isHostCapabilityTool`), since
its attempt is now durable for the same reason. The recovery message at
`run-execution.service.ts:333-334` and `native-files-repository.ts:160-162`
widens from "native mutation" to "host command or mutation", because
`hasMutation` cannot tell the two apart.

Consequences, all deletions:

- `fencedDirectories`, `isDirectoryFenced`, `clearFence`,
  `unreplayableDigests`, `refusesUnknownReplay`, `releaseUnknownCommands`,
  and `recoverIncompleteAttempts` go. `attempt-ledger.ts` keeps only the
  per-session state the watcher needs to move from started to known or
  unknown.
- `hasMutation(runId)` becomes true for a Run that ran bash, so a queue
  resume on another worker after a lost worker fails the Run with
  `outcome_unknown` instead of re-executing the command. `priorOutcome` also
  answers a replayed tool-call id, but a re-claim appends a new `run.started`
  first and the delivery-sequence check refuses the stale context before
  `priorOutcome` is consulted, so for bash it is defense in depth rather than
  a live path. The worker-loss refusal is the behavior the spec scenario
  required and nothing implemented.
- A `native.attempt` for bash records the working directory as its `path`.
  Absolute-path native attempts already record absolute host paths in the
  same event, so this adds no new class of stored data.

Alternatives considered:

- Amend the spec to say the ledger is process-local (the route #734 was filed
  under). Rejected once the reuse was measured: it is roughly twenty lines
  against three hundred deleted, and it keeps the one property no peer has.
- Key the process-local sets by Run. Rejected: the Run already aborts on
  `outcome_unknown`, so a per-Run key protects nothing inside the Run, and
  the sets still die with the process.
- openclaw's restart blocker (a live command blocks process shutdown).
  Rejected: it prevents the crash window rather than surviving it, and it
  does not compose with pg-boss ownership of the Run.

### D3: The Run is the fence

An `outcome_unknown` terminates the Run that issued it, as today, and does
nothing else. The shipped "no later operation runs in that context until
recovery proves safety" had no recovery path in llame or any peer, and its
"context" was one directory shared by every Run on the worker by accident of
the alpha. Cross-Run protection through a directory key was a heuristic with
permanent cost: an unknown command can mutate anywhere, the fence was
process-local and invisible to a second worker, and native `edit` and `write`
never consulted it.

What replaces it is narrower and self-releasing: the executor keeps the
process-group ids of attempts that ended unknown because the group was still
alive. Admission re-probes each one, re-sends `SIGKILL`, and refuses the call
while any is alive, naming the surviving attempt; an empty group is dropped
from the set on that probe. The quarantine is keyed to a process that
provably exists, lifts the moment it is gone, and needs no durable state,
because a process cannot outlive its worker and a Run whose worker was lost
is already failed by D2. This is the shipped fence's stated purpose, "until
recovery proves safety", with the proof supplied by the probe instead of by a
restart.

The submit scenario keeps its wording; #212 implements it durably against the
same `native.attempt` events when it lands. The shipped
"does not rerun the command under another tool-call ID" is kept in the
requirement text rather than as a scenario: with the digest set gone, the
guarantee rests on the Run terminating and on the durable attempt, not on a
command fingerprint.

This reverses the recommendation recorded in #733's body ("the directory key
stays for the per-call `cwd`"), which was written before D2's reuse was
measured. Recorded here so the reversal is reviewed, not slipped.

### D4: Per-call `cwd`, resolved against the host default, nothing persists

`cwd` is optional. It is resolved with `path.resolve(default, cwd)` so an
absolute path is taken as given and a relative one is taken from the host
default (`BASH_WORKING_DIRECTORY` or the process cwd). It must be an
enterable directory, probed with `opendir` before the attempt is recorded, so
a directory with mode `000` or one that is a regular file is refused up front;
a `spawn` that still fails with no pid (the directory vanished in between,
`EACCES`) is a known `unavailable` result recorded against the attempt, never
`outcome_unknown`. The preflight refusal records no attempt at all. The
refusal takes openclaw's shape: the command did not run, the argument was
taken literally with no `~` or variable expansion, and the model can list the
parent or create the directory. `cwd` leaves `WIDENING_KEYS`; the whole set is
deleted with `parseCommandInput`, since the zod schema is the boundary that
actually enforces the argument set. A call carrying any other key is refused
by the runner as `invalid_input` before the tool runs, with the runner's
generic message; only the `env` collision below runs inside the tool and can
name its key. The description states that each call is a fresh process. Of the
six peers, hermes and deepseek-harness say so and openclaw does not, and that
omission is the gap a model falls into.

R2 is removed and replaced by a same-filesystem requirement, because a
MODIFIED block must keep its name and its scenarios and the name is now
false. `fileToolsWorkingDirectory`, `assertSharedWorkingDirectory`, and
`workspace_mismatch` go with the tautology they encoded, and the "Mismatched
executor fails closed" scenario is dropped rather than kept: there is one host
and no second executor to mismatch, and a scenario with no reachable path and
no covering task is the shape this proposal removes elsewhere.

### D5: Child environment is a declared base plus additive per-call `env`

Base: `PATH` (the managed value, as today), `LANG=C.UTF-8`, `HOME`, `TMPDIR`,
`USER`, `LOGNAME` copied from the llame process when set, and `TERM=dumb`.
Today's `PATH`-and-`LANG` child cannot read `~/.gitconfig`, has no user site
directory, and cannot resolve a pnpm store. Per-call `env` is a string record;
a key equal to a base name is rejected before the attempt is recorded, and the
refusal names the key. This is an argument-shape rule, not containment: the
model can write `PATH=/x foo` inside the command text on any call. What the
rule buys is that the child's environment as declared is the child's
environment as observed, so a test can assert it and an operator can read it.
Keys and values count toward the existing input bound. The parent environment is never inherited
wholesale, which is the posture the MCP stdio contract already takes and the
opposite of oh-my-pi's `{ ...Bun.env }`.

Adding `HOME` exposes nothing that an absolute path did not already expose;
the child runs as the llame OS user in every case. `env` grants no authority
either: a model that can run arbitrary commands can already `export` anything
inside the command text. The value of the allowlist is that llame's own
credentials are structurally absent, not that the model is contained.

### D6: Output fidelity

`stripHostPaths` and `stripStackTraces` are deleted; `protectedValues`
redaction and the code-point-safe cut at `outputBound` stay. The path pass
rewrote every `/a/b/c` to a `[path]` placeholder and the cwd to `.`, which destroyed
`find`, `ls -R`, `grep -n`, `stat`, `which`, and every build log; the trace
pass deleted any line matching `^\s*(?:at\s+\S+|Exception|Error:|Traceback…)`
with no marker, so a Python traceback vanished and a data line beginning
`Error:` was lost. No surveyed peer does either. The protected-values pass is
inert today because `bash.ts` passes none, and nothing in scope supplies any;
it stays as the seam R3 names.

One rewriting layer is deliberately kept and now named in R3: every non-native
tool result passes through `neutralizeToolResult`
(`apps/api/src/chats/tool-observation-neutralizer.ts`), which entity-escapes
reserved tool delimiters such as `</tool-result>` in the copy the model reads
and passes every other byte through. Bash is not a native file tool and stays
on that path. R3's verbatim guarantee is scoped to the executor result so no
implementer reads it as licence to exempt bash from neutralization.

Knowledge host paths, stated: `AGENTS.md` ("Never expose credentials,
resolved secret values, tokens, or host paths") and `knowledge-tools` §11,
§180, and §212 keep the configured root and resolved host paths out of
`kb://` results and `knowledge_search`. The native `read` on an absolute path
already returns the host path it was given, so the rule has always meant
resolved paths the model did not supply, not every string containing `/`. With the path pass gone, `find / -name '*.md'` prints the
vault's host path into a bash result. That was already reconstructible by
walking `ls` one level at a time and readable with `cat`, so the pass
protected nothing against a model with shell access; the invariant is enforced
where it can be, at the Knowledge tool surface, and that stays. R3 now says
so instead of implying a boundary the alpha never had.

### D7: Result shapes

`timed_out` is an error result whose `message` carries the deadline, the
bounded streams, and whether either stream was cut, in the same layout
`command_failed` uses today, because the tool-result contract is
`{ status, type, message }` for errors. Known results are unchanged. A
rejected `cwd` or `env` collision is `unavailable` with a message naming the
argument, so the model learns the rule from the refusal.

### D8: Tool description

The description states: `bash -c` as the host user; `cwd` optional, literal,
must exist; `env` additive over a fixed base that cannot be replaced; every
call is a fresh process and nothing persists; output is returned as produced
and cut at the bound; a killed command reports `timed_out` with partial
output. `chat-default.md` gains one sentence on non-persistence.

## Threats

- Model sets a base key through `env` → rejected before the attempt with the
  key named. This does not contain the model, which can set `PATH` inside
  the command text; it keeps the declared environment honest (D5).
- llame credentials reach a child → the child receives the declared base and
  the call's `env` only; a test asserts a printed environment holds no llame
  variable.
- A queue retry re-executes a command whose effect is unknown → the
  `native.attempt` is durable and bound to the worker; a resume elsewhere
  fails the Run before the tool loop starts, and a replayed tool-call id
  returns the recorded result.
- An unknown outcome in one Run denies bash to every other Run on the worker
  → the directory fence is deleted; only a provably live process group from
  an unknown attempt refuses admission, and only until it is gone.
- A surviving process from an unknown outcome keeps mutating while another
  Run works → the live-group quarantine above; the escaped-`setsid` case is
  outside the probe and stated as such in D1.
- Host paths of the Knowledge root reach model context through shell output
  → accepted and stated in D6; the `kb://` surface never emits one.
- `cwd` used to probe for directory existence outside the model's authority
  → the model's authority is the whole host filesystem already; the refusal
  message reveals nothing `ls` would not.

## Migration Plan

1. Land the proposal; then `timeout-fence` (D1, D2, D3, D7), `cwd-env` (D4,
   D5, D8), `output-fidelity` (D6), `finalize`. Each shipping layer adds its
   own dated changelog entry and its own `SPEC.md` §13.8 sentence.
2. No database migration and no configuration change.
   `BASH_WORKING_DIRECTORY` keeps its meaning as the default directory.
3. The `bash` input schema and description change, so the deploy follows the
   existing declaration cutover: quiesce Run acceptance, drain Runs bound to
   the prior declaration, deploy matching API and worker binaries, resume.
4. Rollback restores the process-local ledger. The older `hasMutation` does
   not filter by operation, so a rolled-back worker resuming a Run that ran
   bash on the new build fails it with `outcome_unknown`: the conservative
   direction, with no code change needed.

## Risks / Trade-offs

- [A proven-stopped timeout hides a partial mutation from the fence] → the
  same is true of a non-zero exit halfway through a script today; the result
  says the command was killed at the deadline and carries its output, which
  is what the model needs to decide whether to inspect or redo.
- [`hasMutation` now flags Runs that only ran `ls`] → a resume on another
  worker after worker loss fails such a Run with `outcome_unknown`. Accepted:
  a read-only command is not distinguishable from a mutating one by the host,
  and the failure is the conservative direction the spec already chose for
  native mutations.
- [Deleting `WIDENING_KEYS` removes a defense the schema already duplicates]
  → the schema is `.strict()` and is tested; the package no longer pretends
  to own a boundary it never sat on.
- [Unpinned peer line cites] → the design pins none; the issues carry the
  disclosure and each cite was verified against a clone on the stated dates.

## Revision history

- **v3 (2026-09-08):** PR #739 round (Codex, CodeRabbit). Live-group
  quarantine replaces "no other Run is affected": a still-alive group from an
  unknown attempt refuses admission and is re-signalled until empty (Codex
  P1). Process slot reserved at admission, released on refusal (Codex P1).
  Proposal now says process group, and D1 states the gap applies to normal
  exit too and why "remain unknown" is not implementable (Codex P1,
  CodeRabbit major). Preflight `cwd` rejection records no attempt; a
  post-attempt spawn failure records a known refusal (Codex P2). Environment
  scenario names the exact base set (CodeRabbit major). Probe budget named
  in D1 (CodeRabbit minor). Host-path finding answered in D6 with the
  `AGENTS.md` rule quoted and the decision recorded, not changed.

- **v2 (2026-09-08):** Review round 2 (two independent reviewers). R2 becomes
  REMOVED plus ADDED so the name and the mismatched-executor scenario go
  (H-F4, I-F1). `cwd` predicate is "enterable" and a no-pid spawn is a known
  refusal (H-F1). Quiescence is stated as a process-group proof with the
  `setsid` gap named (H-F2). `PATH` claims rewritten as an argument-shape
  rule; base-key collision gets its own scenario and the widening scenario
  covers unknown keys with the runner's generic refusal (H-F3, I-F2). R3
  scoped to the executor result with neutralization named (I-F3). §13.8
  rewritten once in task 1.6 to defer to the spec (I-F4). Admission-before-
  attempt seam, progress gate, recovery message, `priorOutcome` reach, D7/D8
  layer assignment, changelog per layer, `timed_out` truncation note,
  rollback wording, `LANG` pin, BREAKING on both schema bullets, line-range
  cite (H-P2 1-7, I-F5-F9). D3 now records that it reverses #733's own key
  recommendation.
- **v1 (2026-09-08):** Initial proposal; round 1 (plannotator) clarified that
  every base env collision is rejected.

## Open Questions

None that change the specs or tasks. Whether `TERM=dumb` or an absent `TERM`
produces less ANSI noise from tools that probe it can be settled by the
`cwd-env` layer's test without changing the contract.
