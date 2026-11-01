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
  through `resolveToolNumbers` (`apps/api/src/instance-config/config-loader.ts:256-283`).
  `tools.maxStepsPerRun` is nullable, with `null` as no cap; `tools.callTimeoutSeconds`
  is a required positive integer. Zero fails startup for both.

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
new 4 MiB line bound and the read-ahead width. `filesExamined`,
`entriesListed`, `bytesRead`, `fileBytes`, and `deadlineMs` leave the
constant. `GrepBudget` fields for files, entries, bytes, and file bytes become
`number | null`; `null` disables the check. `tools.grep` resolves through the
existing nullable numeric path that `tools.maxStepsPerRun` uses, so
interpolation tokens, `null`, and the zero refusal behave the same way.

The engine change (nullable fields, no `fileBytes` constant) lands in the
stream layer, so the streaming scenarios run without a hidden 1 MiB cut. The
API keeps passing today's file, entry, and byte numbers until the bounds layer
replaces them with `tools.grep`.

`maxBytesRead` counts the bytes of files the consumer takes, plus the bytes
read so far of the head file (D2), and the walk stops when the count reaches
the bound. Read-ahead can read past the bound; those bytes are discarded and
never counted. `maxFileBytes` is checked against the `fstat` size and again on
the streamed byte count, so a file that grows past the bound during the read
is refused, as `readBoundedFileBytes` does today.

Rejected: generous fixed constants (Q1 A), which keep an arbitrary stop; an
operator switch that restores the old four (Q5 B).

### D2: An ordered read-ahead window of 8

The walk generator becomes a producer that runs ahead of the scan. Walk events
go into one FIFO in canonical order: a scope start, a candidate file with its
started task, and the bookkeeping between two candidates. The consumer
dequeues in order and applies each event to `ScanState` exactly where the
serial walk applies it today, so `scopeIndex`, the per-scope resume,
`position`, `reserveFloor`, warnings, bounds, and the cursor only ever reflect
what the consumer took.

The bookkeeping between two candidates is one coalesced record: the counted
entry delta, the last reached path, the largest continuation width for
`reserveFloor`, the link-skip count, and the excluded directories in order. An
entry-bound stop is its own event. The producer pauses while 8 file tasks are
queued, or while 10,000 events of any kind are queued: candidates, refused
candidates, records, and excluded paths. A walk with few admitted candidates,
or a large tree the `read` group refuses, then cannot run its listing or its
admission far ahead of a slow head task.

The producer runs the `read` admission (`onCandidate`) before it starts a
task, because a task must not open a refused file. The refusal is counted
when the consumer takes the candidate, as `state.readRefused` is today
(`scan.ts:151-153`), so a refusal past the stop never reaches the completion
audit.

An entry-bound stop is an ordinary queued event. The consumer finishes every
file queued before it and stops when it dequeues the event, so a fast listing
ahead of slow reads cannot strand the walk on the same cursor.

Bounds count a file when the consumer takes it. The producer never starts more
tasks than the file bound leaves. On a deadline or byte-bound stop, the
consumer aborts the queued tasks through a per-call `AbortController`. Each
task's promise is caught when it is created and its outcome is stored with the
task. A failure, such as a Knowledge `GrepScopeFailure`, surfaces only when
the consumer dequeues that task. A discarded task never raises an unhandled
rejection, and its stream closes its file handle on abort or early return.

The producer also overlaps directory work: one directory's `list`,
`.gitignore`, and `.ignore` reads run together. Directory listing stays
depth-first and is not parallelized across directories, because the canonical
order needs each listing whole before the walk descends.

**Thread pool.** Node runs file system calls on the libuv pool, which defaults
to 4 threads, so 8 tasks would run 4 at a time. The pool starts at its first
use, and `Sentry.init` uses it. Round-1 and round-2 probes: 16 parallel
`pbkdf2` jobs took 65–111 ms with the size set before `Sentry.init` and
136–229 ms with it set after, with or without a DSN. The API and worker
therefore write `UV_THREADPOOL_SIZE=16` to `setup.env` inside `setUpSentry`
(`apps/api/src/sentry-setup.ts`), after `.env.local` loads and before `init`.
The daemon, a CJS bundle that loads no dotenv, sets it at the top of
`apps/machine/src/instrument.ts`. An operator value, including one from
`.env.local`, stays in place. The drvfs replay took 2.7 s with 4 reads in
flight and 1.5 s with 16, on a 64-thread pool.

Several concurrent grep calls in one process share the pool: two calls can
hold 16 reads, and `dns.lookup` for a provider request then waits behind them.
Accepted for a personal instance; the 64-thread replay showed no further gain
past 16, so a larger pool buys nothing for one call.

Rejected: a worker pool (new thread machinery for an I/O-bound cost); parallel
directory listing (breaks canonical order or needs a reorder buffer of whole
subtrees); an operator concurrency setting (Q6).

### D3: Streamed files and incremental passages

The walk port gains a streaming read: `open(rel, signal)` returns the file
size and an async iterator of byte chunks. The iterator can end with a refusal
after its last chunk. The Machine port uses that step for its containment
re-check (`unchanged`, `apps/machine/src/grep-port.ts:137-145`), which drops
the file as `unreadable` when a directory on the path changed during the read.
Host, Machine, and skill ports use `fs.open` with `O_NONBLOCK` and read 64 KiB
chunks; host and Machine ports also keep `O_NOFOLLOW`. Today the skill port
opens with a blocking `open(file, 'r')` (`grep-ports.ts:319`), so an exact
`skill://` scope on a FIFO can block before any abort check, and the Knowledge
filesystem port opens with `O_RDONLY | O_NOFOLLOW` only
(`apps/api/src/knowledge/knowledge-filesystem-node-port.ts:12-16`), so a FIFO at
a Knowledge leaf passes the `lstat` checks and blocks the open. Every streaming
port, the Knowledge port included, therefore opens without blocking and refuses a non-regular file as
`unreadable` after `fstat`. The Knowledge adapter streams through `this.fileSystem.open`
after its per-component `lstat` checks
(`apps/api/src/knowledge/knowledge-filesystem.ts:389-405,562-580`).

A file task:

1. Checks `maxFileBytes` against the size when the bound is set, and again
   against the streamed byte count.
2. Probes the first 8 KiB for NUL as today.
3. Decodes with `TextDecoder('utf-8', { fatal: true, ignoreBOM: true })` in
   stream mode, as `stream-read.ts:94-124` already does. A decode error drops
   the file as `invalid_utf8`.
4. Splits lines on LF, stripping one trailing CR, as `passages.ts:23-29`
   does; a CR at a chunk end needs no special case. It counts UTF-8 bytes per
   line; a line above 4 MiB drops the file as `oversized`. A line is held as
   an array of decoded pieces and joined once for the test, so V8 does not
   flatten a rope of many concatenations.
5. Tests each full line, then keeps only its 512-unit display cut.
6. Builds windows, merges, and partitions incrementally with the current
   rules, at most 21 passages (20 plus the knowledge that a twenty-first
   exists). It keeps rendered content for at most 15,000 code units, counted
   from the first line the page can show: the line after `cursor.endLine` in
   the cursor's passage, and passages after `cursor.startLine`. Passages
   before that point are dropped as `continuation` drops them today. A passage
   whose content stops at the held limit is marked incomplete;
   `appendGrepFile` treats it as one that does not fit, so it can only be cut,
   and only within its held lines. A later call scans the file again, as a
   resumed passage cursor does today.
7. Reads to EOF before the file gives its passages, so a late invalid byte or
   oversized line drops the file. This keeps every hit readable by `read`,
   which refuses a file that is not valid UTF-8.

**Memory.** A 4 MiB line of UTF-8 bytes decodes to at most 4 Mi UTF-16 code
units, 8 MiB as a two-byte string, plus its pieces until the join. Eight tasks
then hold at most about 128 MiB of line text, plus 8 × 64 KiB chunks and
8 × 30 KB of held content.

**CPU.** `re2js` tests one line at a time on the event loop and cannot be
interrupted inside a test. Round 2 measured a no-match `(?i)senseshift` over a
64 MiB line at 0.6 s on random text and 3.6 s on other text, and an 8-term
case-insensitive alternation at 17 s. That is why the line bound is 4 MiB and
not the 64 MiB that Q13 accepted: at 4 MiB the same tests cost about 0.04–1.1 s
per pattern. Today's 1 MiB file bound already caps a line at 1 MiB. The
proposal lists this as a deviation for Leo to confirm.

Rejected: 64 MiB lines (seconds of blocked event loop per line, and a
process-wide slot to keep memory near 0.5 GiB, as v2 proposed); a whole-file
prefilter (Q3 scope; an anchored pattern such as `\A` changes meaning on the
whole text); keeping the whole file (memory grows with file size).

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
checks it between chunks and between the pattern tests of one line. Two waits
can still pass the deadline: a listing in progress (`readdir` is not
abortable) and one pattern test of one line (at most about 1 s at the 4 MiB
line bound, D3). The margin covers both from a 2 s call timeout up; below it,
the runner's `timeout` can still win, which `tools.callTimeoutSeconds` makes
the operator's choice. The byte bound is checked between chunks too, so a call
reads at most one 64 KiB chunk past `maxBytesRead`.

The Machine segment gives the daemon nine tenths of the time left
(`grep-machine.ts:340,370,467` pass all of it today) and keeps the full time
for its own abandon. The tenth is the reply margin: a daemon that uses its
whole budget still answers, so its page, cursor, and `unfinished` are not
lost.

Rejected: a fixed larger deadline (Q4 B); a separate setting (Q4 C).

### D5: A file one call cannot finish

**Start point and progress.** The start point is the entry that the incoming
cursor names, or the start of the first scope when the call has no cursor. The
call progresses when the consumer emits a passage, or when it applies a reached
event whose `(scopeIndex, rel)` sorts strictly after the start point by
`compareRel`. A file is reached after its scan (`walk.ts:101`); a directory is
reached when the walk enters it (`walk.ts:145,171`). A candidate or a counted
entry is not progress: both arrive before the file is read, so counting them
would hide the Q14 case. The walk re-reaches the cursor's own directory on
resume (`walk.ts:171`), which does not sort after the start point.

An emitted passage counts so that a resumed cut passage followed by a stop in
the next file keeps the passage cursor and opens that file again.

**Call-wide progress.** Progress belongs to the call. `runGrepScan` takes
`progressed` as an input and returns it. The API passes it from segment to
segment. The `fs.grep` request carries it to the daemon, the response returns
the daemon's own `progressed`, and the hub ORs it in after each daemon page,
including the extra pages that `runDaemonPages` asks for when the `read`
group refuses every passage of a page (`grep-machine.ts:377-391`).

**The stop.** When the deadline or the byte bound stops the head task inside a
file and the call has not progressed, the scan records the file's relative
path as `unfinished` and emits a position cursor that names the file as
reached, so the next call lists it and does not open it. For a single-file
scope, whose walk yields `""` and ignores a cursor (`walk.ts:59-63`), the
cursor is `(scope.index + 1, "")` with `complete: false`, whether or not that
ordinal exists. `readCursor` sets no upper bound on `scopeIndex`
(`cursor.ts:177-179`) and `runGrepScan` skips lower scopes (`scan.ts:86-87`),
so a cursor past the last scope gives an empty `complete: true` page on the
next call. On a Machine the daemon walks its one scope at index 0, so the hub
turns a daemon `unfinished` on a single-file scope into
`(scope.index + 1, "")` itself; `stoppedPosition` (`grep-machine.ts:517-525`)
would otherwise keep the scope index and reopen the file.

The API applies the `read` group to the locator before it names it. A refused
file is not named, and the cursor still moves past it. When the call has
progressed, the cursor stays before the file and the next call opens it with a
full budget.

Progress is guaranteed only for stops inside a file: a call either reaches one
entry, emits one passage, or skips one file. A deadline during a slow listing,
or a stop before any entry is reached, returns the incoming cursor as today
(`scan.ts:378-389`).

### D6: Ignore files, rule by rule

**Layers.** At scope start, the host port walks up from the prefix to `/`; the
Machine daemon walks up to the registered root that holds the prefix. At each
directory it collects `.ignore`, and it collects `.gitignore` up to and
including the repository directory: the nearest directory that holds `.git` (a
directory or a worktree file). A Machine looks for the repository directory
only up to its registered root; without one there, the root is the repository
directory. Inside the scope each directory adds its own pair. In one directory
`.ignore` sits deeper than `.gitignore`. Neither file is a candidate of a
directory scope: `isCandidate` already drops `.gitignore`
(`walk.ts:128-129`) and drops `.ignore` the same way. An exact-file scope
still searches either file, as it does today. Knowledge and skill ports stay
without ignore files.

**Why rule by rule.** `ignore` 7.0.12 decides a path through its ancestors: a
probe showed rule `build` matching `build/a.js` through both `test()` and
`checkIgnore()`. A layer that excludes a parent therefore also excludes
everything below it. That is the root of the #1392 defect and of the
explicit-scope problem. Today's code voids a whole layer after a deeper
re-include (`walk.ts:193-235`), which over-includes.

**Matching.** `ignore` 7.0.12 passes only the `ignored` verdict down from an
ancestor, never `unignored`. So a one-rule instance built as a negation,
`ignore().add('!' + rule)` (or the rule itself when it starts with `!`),
reports `test(path).unignored` exactly when the rule's pattern matches that
path itself. Probes on 2026-11-01:

| Rule            | Path                          | Own-path match |
| --------------- | ----------------------------- | -------------- |
| `node_modules/` | `node_modules/react/`         | no             |
| `node_modules/` | `node_modules/react/index.js` | no             |
| `node_modules/` | `a/node_modules/`             | yes            |
| `docs/**`       | `docs/keep/a.md`              | yes            |
| `build/`        | `src/build/a.js`              | no             |
| `*`             | `src/a.js`                    | yes            |
| `/build`        | `x/build`                     | no             |
| `a/**`          | `a/b/c`                       | yes            |
| `logs/**`       | `logs/`                       | no             |
| `docs/*.md`     | `docs/sub/b.md`               | no             |

Each rule of a layer compiles once into such an instance, with its sign kept
beside it. For an entry, the walk tests each layer's rules against the
entry's path relative to that layer, with a final `/` for a directory. In a
layer, the last rule whose pattern matches decides, negation included. Across
layers, the deepest layer with a deciding rule wins. Because the walk never
enters an excluded directory, a match on an ancestor never needs to decide a
descendant. The walk never tests the scope directory or a directory above it.

The round-2 review ran this method against `git ls-files -o
--exclude-standard` and `rg --files --hidden` in 26 repositories, and it
matched `rg` in all of them. These included the v2 table rows, the explicit
scopes, `docs/**` with `!docs/keep/`, the allow list `*`, `!*/`, `!src/**`,
anchored and directory-only rules, escapes, character classes, `**/foo/bar`,
and `a/**/b`.

A unit test pins the negation behavior to `ignore` 7.0.12, so a dependency
upgrade that changes it fails CI.

Rejected: v2's parent-match discount (over-excludes after a negation and
over-includes after a same-layer re-include); dropping a whole ancestor layer
that excludes the scope (loses `*.log` from the root inside an explicit
scope); the private per-rule regular expressions (`_rules._rules[i].regex`),
which the public negation instance makes unnecessary; writing a gitignore
matcher (a second implementation of Git's pattern rules).

Cost: rules × entries tests. A 100-rule `.gitignore` over 100,000 entries is
10 million `ignore` tests in the worst case; ignore files in practice hold
tens of rules. Measured in the ignore layer before it ships.

**Reading ancestor files.** The walk reads ancestor ignore files without the
`read` group, as it reads in-scope ignore files today. Their content never
reaches the result; it only removes entries. A model can infer a rule only
from which directories are excluded, and the excluded-directory report names
only locators that the `read` group admits.

### D7: Excluded-directory report

The producer adds an excluded directory to the coalesced record where it
declines to enter it (D2), so the record follows canonical order and starts at
the start point (D5). Nested excluded directories are never seen, because the
walk does not enter their parent. Entries before the start point are listed
without evaluation, so a resumed page does not repeat earlier exclusions.

Each reported locator is spelled as a scope: a literal `%`, `*`, `?`, `[`,
`]`, `{`, or `}` becomes `%25`, `%2A`, `%3F`, `%5B`, `%5D`, `%7B`, or `%7D`.
`packages/native-file-tools/src/grep/scope.ts:26-51` refuses a raw bracket or
brace today, so a Next.js `app/[id]` directory is otherwise unsearchable as a
scope. The `read` filter evaluates the raw path, not the spelling.

Host scopes decode nothing today: `buildHostScope` uses `split.prefix` as
written (`apps/api/src/tools/grep-scopes.ts:269-275`), unlike `splitScopePath`
for `kb://` and `skill://` (`grep-scope-shape.ts:66-74`). So the canonical
"`%2A` names the literal character" holds only for those schemes. Host paths
decode exactly the seven spellings in the literal prefix, in one pass, and no
other sequence, so an ordinary path that holds `%41` keeps its meaning and
`%252A` decodes to `%2A`, not `*`. `projectGrepScope`'s host branch
(`grep-admission.ts:96-97`) projects that decoded prefix, so a reject written
against `app/[id]` still refuses `app/%5Bid%5D`.

A Machine scope is a `machine://` locator, whose grammar already decodes every
`%XX` once (`decodeMachinePath`, `machine-locator.ts:114-124`) in the Machine
projection (`grep-admission.ts:106`). `formatMachineLocator` already writes `%`
as `%25`, so a reported Machine locator only adds the six glob spellings. The
Machine walk probes the same fully decoded prefix that admission sees, and the
hub sends that decoded path to the daemon. Narrowing Machine decoding to seven
spellings would split admission from the probe.

The engine records the first 1,000 excluded directories per call across every
scope, and sets `atLeast` when it excludes more. A Machine returns its own list
under the same cap; the API merges lists in scope order and applies the cap
again. The cap counts recorded directories, before the `read` filter. The API
evaluates the `read` group on each locator twice, as written and with a final
`/`, because literal clauses are substring matches and a reject written
`/home/u/.ssh/` must hide `/home/u/.ssh`. It counts the admitted ones and keeps
the first five. These evaluations are not recorded one by one and do not enter
the refused-file audit count (`tool-call-permissions` delta).

**Page room.** The page reserve grows as records arrive, the way `onReach`
grows `reserveFloor` for a position cursor today (`scan.ts:108-115`). An
excluded directory raises the reserve to the full `[ignored …]` line, which
the renderer caps at 2,000 code units by leaving out locators that do not fit.
A head task raises it for `[not searched to the end: <locator>]` when it
starts. The warnings reserve stops being a constant: it grows with the
rendered `[warnings: …]` line as counts arrive, because an unbounded walk has
no largest count.

Rejected: reporting excluded files (noise from `*.log` and similar); a count
without names (the model cannot recover without guessing).

### D8: `fs.grep` changes in place

The request field `budget` is renamed `bounds` and becomes `{ files, entries,
bytes, fileBytes, deadlineMs, limit, pageUnits, progressed }`, with the first
four `number | null`. The response adds `progressed: boolean`, `ignored: {
paths, atLeast } | undefined`, and `unfinished: string | undefined`, both
paths relative to the display prefix. `PROTOCOL_VERSION` stays 1 (Q15).

The rename makes an old daemon fail. Today's daemon reads named fields and
ignores unknown ones (`apps/machine/src/grep.ts:68-101`), so it would accept a
request with all four bounds set and run with the old bounds and ignore rules.
Without `budget`, `requireRecord` throws `invalid_params`
(`apps/machine/src/grep.ts:69-70`, `params.ts:92-100`). Today
`machineProtocolFailureResult` maps that to `invalid_input`
(`machine-call.ts:172-177`), which tells the model its own arguments were
wrong. `machineGrepFailure` (`grep-machine.ts:534-538`) therefore maps
`invalid_params` from `fs.grep` to Machine unusable: the API validates the
patterns and owns the cursor and the bounds, so the only cause is a daemon of
another build.

### D9: Proof

- A fake walk port with a fixed delay per read and an in-flight counter.
  The test asserts a maximum of 8 in flight, that 8 are reached, and that
  passages keep canonical order when later files finish first.
- A pool-width probe after startup (16 parallel `pbkdf2` jobs) for the
  `UV_THREADPOOL_SIZE` default, not only a check that a preset value is kept.
- A unit test that pins the `ignore` 7.0.12 negation behavior (D6).
- Unit tests for every scenario in the delta specs.
- Before/after timings of the two workloads above, run with the same
  throwaway script, recorded in the read-ahead and bounds layer PR bodies. The
  bounds layer must show a no-match search over this repository with
  `complete: true`.

## Risks / Trade-offs

- [Unbounded default walks run until the deadline on huge trees] → the call
  timeout bounds them, `tools.grep` restores bounds per instance, and the
  cursor continues.
- [One line test blocks the event loop] → the 4 MiB line bound keeps a test to
  about 1 s per pattern in the worst measured case (D3).
- [Worker memory] → about 128 MiB of line text for 8 tasks (D3).
- [Reading to EOF after the twentieth passage costs time on large files] →
  needed so that every hit stays readable; D5 skips a file one call cannot
  finish.
- [`UV_THREADPOOL_SIZE` is process-wide] → set only when unset; 16 threads cost
  little memory; concurrent grep calls share the pool (D2).
- [Per-rule ignore matching costs CPU] → measured before the ignore layer
  ships.
- [The D6 method depends on how `ignore` 7.0.12 passes verdicts to
  descendants] → a pinned unit test fails CI if an upgrade changes it.
- [drvfs fails under high parallelism (`ENOMEM` in the rg run)] → 8 reads per
  call.
- [An old Machine daemon fails `machine://` grep] → accepted (Q15); the
  request rename makes the failure certain instead of silent, and it reports
  as Machine unusable.

## Migration Plan

No data migration. Operators who relied on the old bounds set `tools.grep`.
The CHANGELOG entry lists the removed defaults and the `fs.grep` change.
Deploy the API and every Machine daemon together; the operator Machine doc
says so. Rollback is a revert of the layer; no persisted state depends on it.

## Open Questions

None.

## Revision history

- **v6 (2026-11-01):** Leo confirmed the numeric deviations ("the numbers are
  reasonable"). Closed the two pullfrog threads left open at the review cap:
  the seven-spelling decode applies to host scopes only, in one pass, and a
  Machine scope keeps full `machine://` decoding on both the probe and the
  admission side; the `%25` round trip has a scenario.

- **v5 (2026-11-01):** GitHub review, iteration 2 (cubic, pullfrog: 6
  threads). Accepted: the keyset requirement now defines a cursor on a scope
  start; host and Machine scopes decode exactly seven literal spellings and the
  admission sees the decoded prefix (host scopes decoded nothing, so the
  report spelling did not round-trip); the Knowledge filesystem port also opens
  without blocking; D1 says "reaches"; tasks 2.2 and 3.2 match D4 and D7.

- **v4 (2026-11-01):** GitHub review, iteration 1 (cubic, pullfrog,
  CodeRabbit: 16 threads). Accepted: the byte bound stops when the count
  reaches it and `maxFileBytes` skips above it; a position cursor can name a
  scope start, for a stop before the first entry and for a skipped single-file
  scope; `bypass` attempt wording; deadline checks between pattern tests and
  the byte bound between chunks; every streaming port opens without blocking
  (the skill port blocks on a FIFO today); the producer pauses on queued
  events of any kind; the warnings reserve grows with the rendered line;
  reported locators are spelled as scopes and `%5B`/`%5D`/`%7B`/`%7D` are
  literal in a scope; the `callTimeoutSeconds` nullability and `passages.ts`
  citations; the Knowledge notice wording. Rejected with evidence: setting
  `UV_THREADPOOL_SIZE` in-process (two probes show it takes effect before the
  first pool use); keeping a newline in a rendered locator (the framing rule
  exists to stop an unprefixed line, and the `## <locator>` header already
  folds).

- **v3 (2026-11-01):** Review round 2 (two reviewers: 0 P0, 16 P1, 19 P2;
  every P1 verified against code or a probe). Fixed: rule matching now uses a
  one-rule negation instance of `ignore`, which tests a rule against the
  entry's own path; it matched `rg` in 26 probe repositories and removes the
  v2 ceiling and the v2 negation over-exclusion; the line bound drops from
  64 MiB to 4 MiB because a `re2js` test of a 64 MiB line blocks the event
  loop for seconds (deviation for Leo), and the v2 large-line slot is gone;
  progress counts emitted passages and reached events only; a single-file
  scope skips to the next ordinal with `complete: false`, on the host and on
  a Machine; the `fs.grep` response returns `progressed`; held content counts
  from the first showable line and an incomplete passage can only be cut;
  coalesced walk events with a pause, a scope-start event, and refusal counts
  on take; `invalid_params` from `fs.grep` maps to Machine unusable; the
  Machine repository directory stops at the registered root; the framing rule
  covers the new locators; scenario fixes for the entry bound, the resumed
  report, the parent-directory cursor, the refused unfinished file, the
  deadline with no match, and the 1,000 cap. Rejected: none.
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
