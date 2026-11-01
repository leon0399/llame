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

The engine change (nullable fields, no `fileBytes` constant) lands in layer 1
with streaming, so the streaming scenarios run without a hidden 1 MiB cut. The
API keeps passing today's file, entry, and byte numbers until layer 2 replaces
them with `tools.grep`.

`maxBytesRead` counts the bytes of files the consumer takes, plus the bytes
read so far of the head file (D2). Read-ahead can read past the bound; those
bytes are discarded and never counted. `maxFileBytes` is checked against the
`fstat` size and again on the streamed byte count, so a file that grows past
the bound during the read is refused, as `readBoundedFileBytes` does today.

Rejected: generous fixed constants (Q1 A), which keep an arbitrary stop; an
operator switch that restores the old four (Q5 B).

### D2: An ordered read-ahead window of 8

The walk generator becomes a producer that runs ahead of the scan. Every walk
event goes into one FIFO in canonical order: a candidate file (with its started
task), a reached entry, a counted entry, a link skip, an excluded directory
(D7), and an entry-bound stop. The consumer dequeues in order and applies each
event to `ScanState` exactly where the serial walk applies it today, so
`position`, `reserveFloor`, warnings, bounds, and the cursor only ever reflect
what the consumer took. The producer pauses while 8 file tasks are queued.

An entry-bound stop is an ordinary queued event. The consumer finishes every
file queued before it and stops when it dequeues the event, so a fast listing
ahead of slow reads cannot strand the walk on the same cursor.

Bounds count a file when the consumer takes it. The producer never starts more
tasks than the file bound leaves. On a deadline or byte-bound stop, the
consumer aborts the queued tasks through a per-call `AbortController`. Each
task's promise is caught when it is created and its outcome is stored with
the task. A failure, such as a Knowledge `GrepScopeFailure`, surfaces only
when the consumer dequeues that task. A discarded task never raises an
unhandled rejection, and its stream closes its file handle on abort or early
return.

The producer also overlaps directory work: one directory's `list`,
`.gitignore`, and `.ignore` reads run together. Directory listing stays
depth-first and is not parallelized across directories, because the
canonical order needs each listing whole before the walk descends.

**Thread pool.** Node runs file system calls on the libuv pool, which defaults
to 4 threads, so 8 tasks would run 4 at a time. The pool starts at its first
use, and `Sentry.init` uses it (round-1 probe: 16 parallel `pbkdf2` jobs took
95–111 ms on a fresh pool sized to 16 and 203–229 ms once `Sentry.init` had
run, with or without a DSN). The API and worker therefore set
`UV_THREADPOOL_SIZE=16` inside `setUpSentry` (`apps/api/src/sentry-setup.ts`),
after `.env.local` loads and before `init`. The daemon sets it at the top of
`apps/machine/src/instrument.ts`. An operator value, including one from
`.env.local`, stays in place. The drvfs replay took 2.7 s with 4 reads in
flight and 1.5 s with 16, on a 64-thread pool.

Several concurrent grep calls in one process share the pool: two calls can
hold 16 reads, and `dns.lookup` for a provider request then waits behind them.
Accepted for a personal instance; the 64-thread replay showed no further gain
past 16, so a larger pool buys nothing for one call.

Rejected: a worker pool (new thread machinery for an I/O-bound cost);
parallel directory listing (breaks canonical order or needs a reorder
buffer of whole subtrees); an operator concurrency setting (Q6).

### D3: Streamed files and incremental passages

The walk port gains a streaming read: `open(rel, signal)` returns the file
size and an async iterator of byte chunks. The iterator can end with a
refusal after its last chunk. The Machine port uses that step for its
containment re-check (`unchanged`, `apps/machine/src/grep-port.ts:137-145`),
which drops the file as `unreadable` when a directory on the path changed
during the read. Host, Machine, and skill ports use `fs.open` with the current
flags and read 64 KiB chunks. The Knowledge adapter streams through
`this.fileSystem.open` after its per-component `lstat` checks
(`apps/api/src/knowledge/knowledge-filesystem.ts:389-405,562-580`).

A file task:

1. Checks `maxFileBytes` against the size when the bound is set, and again
   against the streamed byte count.
2. Probes the first 8 KiB for NUL as today.
3. Decodes with `TextDecoder('utf-8', { fatal: true, ignoreBOM: true })` in
   stream mode, as `stream-read.ts:94-124` already does. A decode error drops
   the file as `invalid_utf8`.
4. Splits lines on LF, stripping one trailing CR, as `source-lines.ts:65-67`
   does; a CR at a chunk end needs no special case. It counts UTF-8 bytes per
   line; a line above 64 MiB drops the file as `oversized`. A line is held as
   an array of decoded pieces and joined once for the test, so V8 does not
   flatten a rope of many concatenations.
5. Tests each full line, then keeps only its 512-unit display cut.
6. Builds windows, merges, and partitions incrementally with the current
   rules. It keeps rendered content only up to the page units the call has
   left (at most 15,000) and keeps the start line, end line, and matched lines
   of later passages, at most 21 (20 plus the knowledge that a twenty-first
   exists). A page can never show more than the units left, so content past
   them is dead weight; a later call scans the file again, as a resumed passage
   cursor does today.
7. Reads to EOF before the file gives its passages, so a late invalid byte or
   oversized line drops the file. This keeps every hit readable by `read`,
   which refuses a file that is not valid UTF-8.

**Memory.** A line of 64 MiB of UTF-8 bytes can decode to as many as 64 Mi
UTF-16 code units, which is 128 MiB as a two-byte string, plus its pieces
until the join. Eight tasks could hold eight such lines. To keep the Q13
limit without a 2 GiB worst case, one process-wide slot admits a line above
8 MiB: a task that grows a line past 8 MiB waits for the slot and releases it
after the line's test. The worst case is then about 8 × 32 MiB for lines up to
8 MiB, plus one 256 MiB large line, plus 8 × 64 KiB chunks and 8 × 30 KB of held
content: about 0.5 GiB. The round-1 review measured the unmitigated worst case
at 0.9–1.4 GiB; Q13 was accepted on 512 MiB, so this slot is how the design
meets it.

Rejected: a whole-file prefilter (Q3 scope; an anchored pattern such as `\A`
changes meaning on the whole text); keeping the whole file (memory grows with
file size); lowering the line limit (contradicts Q13).

### D4: The deadline comes from the call timeout

`executeGrep` computes `deadlineAt = start + timeoutMs − margin` at its first
statement, before scope resolution, so Knowledge lookups, skill resolution,
and host probes spend the walk's own time. The margin is
`min(timeoutMs / 2, max(5_000, timeoutMs / 10))`. With the default 120 s
timeout the walk stops at 108 s. `ToolContext.timeoutMs` is optional
(`apps/api/src/tools/types.ts:112-113`); without it, grep uses
`tools.callTimeoutSeconds` from the instance configuration, as the other
bounded tools fall back to their own default (`machine-call.ts:51-55`).

The consumer checks the deadline before it takes each file, and the head task
checks it between chunks, so one large file cannot overrun it. A listing in
progress is not abortable (`readdir`), so a stop can still arrive late by one
directory listing.

The Machine segment gives the daemon nine tenths of the time left
(`grep-machine.ts:340,370,467` pass all of it today) and keeps the full time
for its own abandon. The tenth is the reply margin: a daemon that uses its
whole budget still answers, so its page, cursor, and `unfinishedFile` are
not lost.

Rejected: a fixed larger deadline (Q4 B); a separate setting (Q4 C).

### D5: A file one call cannot finish

**Start point and progress.** The start point is the entry that the incoming
cursor names, or the start of the first scope when the call has no cursor.
The call progresses when the consumer takes an entry that sorts after the
start point by `(scopeIndex, compareRel)`. The walk re-reaches the cursor's own
directory on resume (`walk.ts:171`), so "position is set" is not progress.

**Call-wide progress.** Progress belongs to the call, not to one engine run.
`runGrepScan` takes `progressed` as an input and returns it. The API passes it
from segment to segment, and the `fs.grep` request carries it to the daemon.

**The stop.** When the deadline or the byte bound stops the head task inside a
file and the call has not progressed, the scan:

- records the file's relative path as `unfinished`,
- emits a position cursor that names the file as reached, so the next call
  lists it and does not open it,
- and, for a single-file scope, whose walk yields `""` and ignores a cursor
  (`walk.ts:59-63`), emits a position cursor on the next scope ordinal. When
  no scope follows, the result is `complete: true` with `unfinishedFile` set.

The API applies the `read` group to the locator; on a Machine the hub does so
before it names the path. When the call has progressed, the cursor stays before
the file and the next call opens it with a full budget.

Progress is guaranteed only for stops inside a file: a call either takes one
entry or skips one file. A deadline during a slow listing, or a stop before any
entry is reached, returns the incoming cursor as today (`scan.ts:378-389`).
On default settings, a file is skipped only when it takes longer than one
whole call, which at the measured `re2js` rate (33.5 MB in 2.3 s) means more
than about 1.5 GB of text.

### D6: Ignore files, rule by rule

**Layers.** At scope start, the host port walks up from the prefix to `/`; the
Machine daemon walks up to the registered root that holds the prefix. At each
directory it collects `.ignore`, and it collects `.gitignore` up to and
including the nearest directory that holds `.git` (a directory or a worktree
file). Inside the scope each directory adds its own pair. In one directory
`.ignore` sits deeper than `.gitignore`. Neither file is a search candidate:
`isCandidate` already drops `.gitignore` (`walk.ts:128-129`) and drops
`.ignore` the same way. Knowledge and skill ports stay without ignore files.

**Why rule by rule.** `ignore` 7.0.12 decides a path through its ancestors: a
probe showed rule `build` matching `build/a.js` through both `test()` and
`checkIgnore()`. A layer that excludes a parent therefore also excludes
everything below it. That is the root of the #1392 defect and of the
explicit-scope problem. Today's code voids a whole layer after a deeper
re-include (`walk.ts:193-235`), which over-includes.

**Matching.** Each rule compiles to its own `ignore` instance. Git splits rules
in two:

- A rule with no slash except a final one (`node_modules/`, `*.log`, `build*`,
  `*`) matches the entry name at any depth. The walk tests it against the
  entry's base name, with a final `/` for a directory. A leading `**/` with no
  other slash (`**/node_modules`) is the same rule and is tested the same way.
- Any other rule (`/build`, `docs/*.md`, `a/**`) is relative to its layer
  directory. The walk tests it against the path relative to that layer, which
  `ignore` evaluates through the path's ancestors. Its verdict does not count
  when the same rule also matches the entry's parent directory `D`, because
  then the verdict is inherited from `D`. `D` was entered, so it is the scope
  directory, a directory above it, or a directory that a deeper rule included
  again. The parent test is skipped when `D` is the layer directory itself,
  where the relative path is empty and `ignore` throws `path must not be
  empty`.

In a layer, the last counted matching rule decides, negation included. Across
layers, the deepest layer with a counted verdict decides. The walk never
excludes the scope directory or a directory above it.

Round 1 checked these against `git check-ignore` and `rg --files`:

| Rules                                                   | Path                                 | Result              |
| ------------------------------------------------------- | ------------------------------------ | ------------------- |
| `node_modules/` at the root, scope `node_modules/react` | `node_modules/react/index.js`        | searched            |
| same                                                    | `node_modules/react/x/node_modules/` | excluded            |
| `build/`, `*.log` at the root; `!build/` in `src`       | `src/build/a.js` / `src/build/a.log` | searched / excluded |
| `*`, `!*/`, `!*.ts`                                     | `src/b.ts` / `src/a.js`              | searched / excluded |
| `build*`, `!build-tools/`                               | `build-tools/build.sh`               | excluded            |
| `*.bak`, scope `archive.bak`                            | `archive.bak/old.bak`                | excluded            |

Ceiling: a rule with a slash that matches the scope directory, or a directory
a deeper rule included again, does not exclude entries below it that it also
matches directly. Example: `a/**` with scope `repo/a/b` searches
`repo/a/b/c`, where `rg` skips it. The reference doc records it.

Rejected: dropping a whole ancestor layer that excludes the scope (loses
`*.log` from the root inside an explicit scope); the private per-rule regular
expressions of `ignore` (`_rules._rules[i].regex`), which give Git's per-path
result but tie the walk to a private field of one version; writing a
gitignore matcher (a second implementation of Git's pattern rules).

Cost: rules × entries tests. A 100-rule `.gitignore` over 100,000 entries is
10 million `ignore` tests in the worst case; ignore files in practice hold
tens of rules. Measured in the ignore layer before it ships.

**Reading ancestor files.** The walk reads ancestor ignore files without the
`read` group, as it reads in-scope ignore files today. Their content never
reaches the result; it only removes entries. A model can infer a rule only
from which directories are excluded, and the excluded-directory report names
only locators that the `read` group admits.

### D7: Excluded-directory report

The producer queues an excluded-directory event where it declines to enter a
directory (D2), so the record follows canonical order and starts at the start
point (D5). Nested excluded directories are never seen, because the walk does
not enter their parent. Entries before the start point are listed without
evaluation, so a resumed page does not repeat earlier exclusions.

The engine keeps the first 1,000 relative paths per call across every scope,
and sets `atLeast` when it records more. A Machine returns its own list under
the same cap; the API merges lists in scope order and applies the cap again.
The API evaluates the `read` group on each locator twice, as written and with a
final `/`, because literal clauses are substring matches and a reject written
`/home/u/.ssh/` must hide `/home/u/.ssh` (tool-call-permissions). It counts the
admitted ones and keeps the first five. These evaluations are not recorded one
by one and do not enter the refused-file audit count.

**Page room.** The page reserve grows as events arrive, the way `onReach`
grows `reserveFloor` for a position cursor today (`scan.ts:108-115`). An
excluded-directory event raises the reserve to the full `[ignored …]` line,
which the renderer caps at 2,000 code units by leaving out locators that do not
fit. A head task raises it for `[not searched to the end: <locator>]` when it
starts. The warnings reserve grows from six to seven digits per kind, because
an unbounded walk can pass 999,999 skips of one kind.

Rejected: reporting excluded files (noise from `*.log` and similar); a count
without names (the model cannot recover without guessing).

### D8: `fs.grep` changes in place

The request field `budget` is renamed `bounds` and becomes `{ files, entries,
bytes, fileBytes, deadlineMs, limit, pageUnits, progressed }`, with the first
four `number | null`. The response adds `ignored: { paths, atLeast } |
undefined` and `unfinished: string | undefined`, both relative to the display
prefix. `PROTOCOL_VERSION` stays 1 (Q15). The rename is deliberate: today's
daemon reads named fields and ignores unknown ones (`apps/machine/src/grep.ts:68-101`),
so an old daemon would accept a request with all four bounds set and run with
the old bounds and ignore rules. Without `budget`, an old daemon refuses every
new request as invalid parameters, which the API reports as Machine
unusable.

### D9: Proof

- A fake walk port with a fixed delay per read and an in-flight counter.
  The test asserts a maximum of 8 in flight, that 8 are reached, and that
  passages keep canonical order when later files finish first.
- A pool-width probe after startup (16 parallel `pbkdf2` jobs) for the
  `UV_THREADPOOL_SIZE` default, not only a check that a preset value is kept.
- Unit tests for every scenario in the delta specs.
- Before/after timings of the two workloads above, run with the same
  throwaway script, recorded in the read-ahead and bounds layer PR bodies. The
  bounds layer must show a no-match search over this repository with
  `complete: true`.

## Risks / Trade-offs

- [Unbounded default walks run until the deadline on huge trees] → the call
  timeout bounds them, `tools.grep` restores bounds per instance, and the
  cursor continues.
- [Worker memory] → about 0.5 GiB worst case with the large-line slot (D3);
  without the slot, 0.9–1.4 GiB.
- [Reading to EOF after the twentieth passage costs time on large files] →
  needed so that every hit stays readable; D5 skips a file one call cannot
  finish.
- [`UV_THREADPOOL_SIZE` is process-wide] → set only when unset; 16 threads cost
  little memory; concurrent grep calls share the pool (D2).
- [Per-rule ignore matching costs CPU] → measured before the ignore layer
  ships.
- [D6 ceiling for slash rules over an explicit scope] → documented.
- [drvfs fails under high parallelism (`ENOMEM` in the rg run)] → 8 reads per
  call.
- [An old Machine daemon fails `machine://` grep] → accepted (Q15); the
  request rename makes the failure certain instead of silent.

## Migration Plan

No data migration. Operators who relied on the old bounds set `tools.grep`.
The CHANGELOG entry lists the removed defaults and the `fs.grep` change.
Deploy the API and every Machine daemon together; the operator Machine doc
says so. Rollback is a revert of the layer; no persisted state depends on it.

## Open Questions

None.

## Revision history

- **v2 (2026-11-01):** Review round 1 (two reviewers: 1 P0, 27 P1, 24 P2;
  overlapping findings merged). Fixed: rule matching now tests rules with no
  slash against the entry name, which fixes the `*`/`!*/` allow list and the
  nested `node_modules` case (P0); every walk event goes through the ordered
  FIFO, an entry-bound stop is a queued event, and task failures are caught
  (D2); the thread-pool default moves into `setUpSentry` and the daemon's
  `instrument.ts`; the memory bound is corrected and a large-line slot keeps
  it near 0.5 GiB; held content stops at the page units left; D5 defines start
  point, progress, call-wide progress through `progressed`, and the
  single-file scope; the deadline starts at `executeGrep` entry with a
  configuration fallback, and the daemon gets nine tenths of the time left;
  the report is filtered with both locator forms, capped call-wide, reserved
  on the page, and absent when nothing admitted remains; `fs.grep` renames
  `budget` to `bounds` so an old daemon fails; BOM, byte-unit, file-growth,
  and seven-digit warnings fixes; the engine's nullable budget moves into
  layer 1; layer 1 splits in two; a `tool-call-permissions` delta covers the
  directory evaluations. Rejected: none.
- **v1 (2026-11-01):** Initial draft from the grilling record.
