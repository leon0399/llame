# Design

## Context

See [proposal.md](proposal.md) for the problem and the confirmed decisions.
Code references are at `94a91ff` (`master`, 2026-11-01).

The engine lives in `packages/native-file-tools/src/grep/` and runs in three
places: the API for host, `kb://`, and `skill://` scopes, and the Machine
daemon for `machine://` scopes (`apps/machine/src/grep.ts:205-240`).

- Bounds are a code-owned constant (`limits.ts:2-18`): 5,000 files, 20,000
  entries, 32 MiB, 1 MiB per file, 30 s.
- The walk is serial. `scanScope` (`scan.ts:93-136`) pulls one candidate from
  the walk generator and awaits `scanFile` (`scan.ts:138-174`): the
  `onCandidate` admission, `port.read`, then `grepFilePassages`. Bound checks
  run before each file (`scan.ts:145-149`).
- A host file read is five sequential libuv operations: `open`, `fstat`, a
  64 KiB chunked `read`, a final `read` that finds EOF, and `close`
  (`apps/api/src/tools/grep-ports.ts:65-88,181-206`).
- Matching decodes the whole file with a fatal `TextDecoder`
  (`scan.ts:312-320`), splits every line (`passages.ts:23-29`), and tests
  each line with `re2js` (`passages.ts:52-63`, `patterns.ts:44`).
- Each directory reads its `.gitignore` (`grep-ports.ts:213-240`) through
  `loadIgnoreLayer` (`walk.ts:177-186`). The walk starts with no layer
  (`walk.ts:65-67`), so no ignore file above the prefix applies. The
  `kb://` and `skill://` ports have no `ignoreFile` (`grep-ports.ts:242-269,
  307-334`).
- The API deadline is `Date.now() + 30_000` (`apps/api/src/tools/grep.ts:179-180`).
  The runner aborts every tool at `tools.callTimeoutSeconds` (default 120) and
  returns `type: "timeout"` with no payload
  (`apps/api/src/tools/runner.ts:119-135,536-541`). `ToolContext` carries
  `timeoutMs` to the tool (`runner.ts:126-131`).
- The Machine request carries `{ files, entries, bytes, deadlineMs, limit,
  pageUnits }` (`packages/machine-protocol/src/types.ts:230-237`), with no
  per-file bound.
- Configuration: `tools.callTimeoutSeconds` and `tools.maxStepsPerRun` resolve
  through `resolveToolNumbers` (`apps/api/src/instance-config/config-loader.ts:256-283`),
  where `null` means no cap and zero fails startup.

### Measurements

Measured on 2026-11-01 on this workstation (WSL2, kernel 6.18, Node
22.23.3) with a throwaway script that wrapped `createHostWalkPort` and called
`runGrepScan` with the shipped limits at `94a91ff`. Search: `senseshift`,
case-insensitive.

| Workload                         | Wall   | Files | Stop         | Reads  | List + ignore | Match/decode |
| -------------------------------- | ------ | ----- | ------------ | ------ | ------------- | ------------ |
| `/mnt/d/Projects` (drvfs), cold  | 31.8 s | 682   | `deadline`   | 27.0 s | 4.3 s         | 0.5 s        |
| `/mnt/d/Projects` (drvfs), warm  | 31.7 s | 1,342 | `deadline`   | 23.2 s | 7.5 s         | 1.0 s        |
| this repository (ext4), no match | 9.0 s  | 2,944 | `byte_bound` | 6.0 s  | 0.6 s         | 2.3 s        |

Replaying the same file reads through the same port with
`UV_THREADPOOL_SIZE=64`:

| Reads in flight | drvfs, 1,342 files | ext4, 2,944 files |
| --------------- | ------------------ | ----------------- |
| 1               | 22.5 s, 22.7 s     | 4.2 s             |
| 4               | 2.7 s              | 1.4 s             |
| 16              | 1.5 s              | 1.2 s             |
| 64              | 1.5 s              | not run           |

This repository holds 4,020 files and 42.1 MiB (`rg --files --hidden`); `rg`
finishes a no-match search in 0.87 s. `rg` over `/mnt/d/Projects` did not
finish in 900 s and reported `Cannot allocate memory (os error 12)` on drvfs
paths. That run used rg's default thread count, so it shows drvfs failure
under high parallelism, not a completion time.

### Prior art

Inspected 2026-11-01. Sources: oh-my-pi `dcafcef6`
(`packages/coding-agent/src/tools/grep.ts`, `crates/pi-natives/src/grep.rs`),
OpenCode `ab4d1f3a` (`packages/core/src/tool/plugin/grep.ts`,
`packages/core/src/ripgrep.ts`, `packages/core/src/filesystem.ts`), Claude Code
2.1.316 (`sdk-tools.d.ts`, tools reference), Gemini CLI
(`packages/core/src/tools/ripGrep.ts`), Codex CLI (no grep tool; the model
runs `rg` through `exec_command`).

| Harness     | Scan bounds (files, entries, bytes, file size) | Time                            | Result bound                         | Ignore files                          |
| ----------- | ---------------------------------------------- | ------------------------------- | ------------------------------------ | ------------------------------------- |
| oh-my-pi    | none; first 4 MiB of a larger file             | 30 s, hard error                | 20 files a page, 20 per file, 50 KiB | `.gitignore`, `node_modules` skipped  |
| OpenCode    | none                                           | 30 s, hard error                | 100 lines, 50 KiB                    | rg defaults (`.gitignore`, `.ignore`) |
| Claude Code | none documented                                | exists, value unpublished       | `head_limit` 250 with `offset`       | `.gitignore`                          |
| Gemini CLI  | none                                           | 30 s floor, operator can raise  | 100 matches                          | rg defaults                           |
| Codex CLI   | n/a (shell `rg`)                               | 10 s default, 30 s max per exec | 10,000 output tokens                 | rg defaults                           |

No peer bounds files examined, entries listed, or bytes read. oh-my-pi walks
with 4 workers by default and Gemini runs `rg --threads 4`.

## Goals / Non-Goals

**Goals:** a default search over a mid-size repository finishes in one call;
high-latency mounts use the call's time on parallel I/O; no file is invisible
because of its size; ignore rules match Git and rg closely enough that a
scoped search does not walk build output the repository ignores.

**Non-Goals:** see proposal.md. Additionally: no worker thread or native
regex engine; no change to `re2js`.

## Decisions

### D1: Scan bounds are opt-in operator settings

`GREP_LIMITS` keeps only the request-shape and output bounds (patterns,
scopes, page, passages, line cut, context, passage lines, NUL probe) plus the
new 64 MiB line bound and the read-ahead width. `filesExamined`,
`entriesListed`, `bytesRead`, `fileBytes`, and `deadlineMs` leave the
constant. `GrepBudget` fields for files, entries, bytes, and file bytes become
`number | null`; `null` disables the check. `tools.grep` resolves through the
existing nullable numeric path that `tools.maxStepsPerRun` uses, so
interpolation tokens, `null`, and the zero refusal behave the same way.

Rejected: generous fixed constants (Q1 A), which keep an arbitrary stop; an
operator switch that restores the old four (Q5 B).

### D2: An ordered read-ahead window of 8

`scanScope` keeps a FIFO of up to 8 started file tasks. The walk generator
runs ahead and starts a task for each candidate after its `onCandidate`
admission. The consumer awaits the head task only, so passages, warnings,
bounds, and the cursor advance in canonical order exactly as today. A task
that finishes early waits in the queue with its passages.

Bounds count a file when the consumer takes it. The producer never starts
more tasks than the file bound leaves. On a stop, the consumer aborts the
queued tasks through a per-call `AbortController` and discards their
results; their files were never reached, so the next call opens them again.

The producer also overlaps directory work: one directory's `list`,
`.gitignore`, and `.ignore` reads run together. Directory listing stays
depth-first and is not parallelized across directories, because the
canonical order needs each listing whole before the walk descends.

Node runs file system calls on the libuv pool, which defaults to 4 threads.
With that default, 8 tasks run 4 at a time. The API and daemon entrypoints set
`UV_THREADPOOL_SIZE` to 16 when it is unset, before any asynchronous file
system call, so 8 grep reads leave threads for other work. The drvfs replay
took 2.7 s with 4 reads in flight and 1.5 s with 16, on a 64-thread pool. An
operator value is left in place.

Rejected: a worker pool (new thread machinery for an I/O-bound cost);
parallel directory listing (breaks canonical order or needs a reorder
buffer of whole subtrees); an operator concurrency setting (Q6).

### D3: Streamed files and incremental passages

The walk port gains a streaming read: `open(rel, signal)` returns the file
size and an async iterator of byte chunks, or a refusal. Host, Machine, and
skill ports use `fs.open` with the current flags and read 64 KiB chunks. The
Knowledge adapter gains the same streamed read under its existing
symbolic-link and containment checks.

A file task:

1. Checks `maxFileBytes` against the size when the bound is set.
2. Probes the first 8 KiB for NUL as today.
3. Decodes with `TextDecoder('utf-8', { fatal: true })` in stream mode. A
   decode error drops the file as `invalid_utf8`.
4. Splits lines incrementally with the native `read` line rules, including a
   CRLF that straddles a chunk boundary. A line buffer above 64 MiB drops the
   file as `oversized`.
5. Tests each full line, then keeps only its 512-unit display cut, so a held
   passage costs about 2,000 cut lines at most.
6. Builds windows, merges, and partitions incrementally with the current
   rules, keeping at most 21 passages (20 plus the knowledge that a twenty-first
   exists).
7. Reads to EOF before the file gives its passages, so a late invalid byte or
   oversized line drops the file. This keeps every hit readable by `read`,
   which refuses a file that is not valid UTF-8.

A resumed passage cursor in a file scans that file again from its start, as
today.

Memory: 8 tasks × (64 MiB line ceiling + 64 KiB chunk + held cut passages).
The worst case is about 512 MiB when 8 single-line files of about 64 MiB run
together. Q13 accepted that.

Rejected: a whole-file prefilter (Q3 scope; an anchored pattern such as `\A`
changes meaning on the whole text); keeping the whole file (memory grows with
file size).

### D4: The deadline comes from the call timeout

`grep.ts` computes `deadlineAt = start + timeoutMs − margin`, with
`margin = min(timeoutMs / 2, max(5_000, timeoutMs / 10))`. With the default
120 s timeout the walk stops at 108 s. `timeoutMs` comes from `ToolContext`,
which the runner always sets. The Machine segment keeps passing the time left
(`grep-machine.ts:340,370,467`). The daemon keeps its own `deadlineMs`.

The consumer checks the deadline before it takes each file and inside the
streamed read between chunks, so one large file cannot overrun it.

Rejected: a fixed larger deadline (Q4 B); a separate setting (Q4 C).

### D5: A file one call cannot finish

A stop inside a file (deadline or byte bound, between chunks) asks whether the
call reached any entry after its start point. The scan already tracks the last
reached entry (`ScanState.position`, `scan.ts:46`). When the call reached
none, the file is the reason the walk cannot advance: the result names it in
`unfinishedFile`, and the cursor becomes a position cursor that names the
file as reached. Otherwise the cursor stays before the file, and the next call
opens it with a full budget.

The rule guarantees progress: a call either reaches one entry or skips one
file. A file that takes longer than one whole call is the only file the rule
skips, which on default settings means more than about 1.5 GB of text at the
measured `re2js` rate (33.5 MB in 2.3 s).

### D6: Ignore files, rule by rule

**Layers.** At scope start, the host port walks up from the prefix to `/`; the
Machine daemon walks up to the registered root that holds the prefix. At each
directory it collects `.ignore`, and it collects `.gitignore` up to and
including the nearest directory that holds `.git` (a directory or a worktree
file). Inside the scope each directory adds its own pair as today. In one
directory `.ignore` sits deeper than `.gitignore`. Knowledge and skill ports
stay without ignore files.

**Matching.** `ignore` 7.0.12 decides a path through its ancestors: a probe on
2026-11-01 showed rule `build` matching `build/a.js` through both `test()` and
`checkIgnore()`. That is the root of the #1392 defect and of the scope
problem, because a layer that excludes a parent also excludes everything
below it. Today's code voids a whole layer after a deeper re-include
(`walk.ts:193-235`), which over-includes.

Each rule compiles to its own `ignore` instance. For an entry `E` whose
parent directory `D` the walk already entered, a rule's verdict on `E` counts
only if that rule does not also match `D`. In a layer, the last counted
matching rule decides, negation included. Across layers, the deepest layer
with a counted verdict decides. The walk never tests the scope directory or a
directory above it.

The same rule gives both behaviors. Under scope `repo/node_modules/react`,
`node_modules/` in `repo/.gitignore` matches the parent of every entry, so it
never counts, and the scope is searched. Under a re-included `src/build`,
`build/` matches the parent and stops counting, while `*.log` matches only
the file and still excludes it.

Ceiling: a rule that matches both an explicit scope and a directory far below
it by name does not exclude the deeper one. Under scope
`repo/node_modules/react`, a nested `.../react/x/node_modules` is searched,
where `rg` would skip it. Accepted, and recorded in the reference.

Cost: rules × entries regular-expression tests. A 100-rule `.gitignore` over
100,000 entries is 10 million `ignore` tests in the worst case; ignore files
in practice hold tens of rules. Measured in layer 3 before it ships.

**Reading ancestor files.** The walk reads ancestor ignore files without the
`read` group, as it reads in-scope ignore files today. Their content never
reaches the result; it only removes entries. A model can infer a rule only
from which directories are excluded, and the excluded-directory report names
only locators that the `read` group admits.

Rejected: dropping a whole ancestor layer that excludes the scope (loses
`*.log` from the root inside an explicit scope); writing a gitignore matcher
(a second implementation of Git's pattern rules); a new dependency (no
installed package evaluates one path without its ancestors).

### D7: Excluded-directory report

The walk records each directory that an ignore rule excludes, at the point it
declines to enter it, in canonical order. Nested excluded directories are
never seen, because the walk does not enter their parent. The engine keeps
the first 1,000 relative paths a call records, and it sets `atLeast` when it
drops one. The API applies the `read` group to each locator, counts the
admitted ones, and keeps the first five. A Machine returns its relative paths
in the `fs.grep` response, and the API applies the same filter.

Rejected: reporting excluded files (noise from `*.log` and similar); a count
without names (the model cannot recover without guessing).

### D8: `fs.grep` changes in place

The budget becomes `{ files, entries, bytes, fileBytes, deadlineMs, limit,
pageUnits }` with the first four `number | null`. The response adds
`ignored: { paths, atLeast } | undefined` and `unfinishedFile:
string | undefined`, both relative to the display prefix. `PROTOCOL_VERSION`
stays 1 and no method is renamed (Q15). A daemon built before this change
fails the call through the existing parameter validation.

### D9: Proof

- A fake walk port with a fixed delay per read and an in-flight counter.
  The test asserts a maximum of 8 in flight, that 8 are reached, and that
  passages keep canonical order when later files finish first.
- Unit tests for every scenario in the delta specs.
- Before/after timings of the two workloads above, run with the same
  throwaway script, recorded in the layer 1 and layer 2 PR bodies. Layer 2
  must show a no-match search over this repository with `complete: true`.

## Risks / Trade-offs

- [Unbounded default walks run until the deadline on huge trees] → the call
  timeout bounds them, `tools.grep` restores bounds per instance, and the
  cursor continues.
- [Worker memory: up to about 512 MiB in the worst case (D3)] → accepted by
  Q13; the line bound skips the file beyond it.
- [Reading to EOF after the twentieth passage costs time on large files] →
  needed so that every hit stays readable; D5 skips a file one call cannot
  finish.
- [`UV_THREADPOOL_SIZE` is process-wide] → set only when unset; 16 threads
  cost little memory; DNS and crypto share the larger pool.
- [Per-rule ignore matching costs CPU] → measured before layer 3 ships; the
  walk already tests every entry against every layer.
- [D6 ceiling: nested same-name directory under an explicit scope] →
  documented.
- [drvfs fails under high parallelism (`ENOMEM` in the rg run)] → the window
  is 8, and the pool is 16.
- [An old Machine daemon fails `machine://` grep] → accepted (Q15).

## Migration Plan

No data migration. Operators who relied on the old bounds set `tools.grep`.
The CHANGELOG entry lists the removed defaults and the `fs.grep` change.
Deploy the API and every Machine daemon together. Rollback is a revert of the
layer; no persisted state depends on it.

## Open Questions

None.

## Revision history

- **v1 (2026-11-01):** Initial draft from the grilling record.
