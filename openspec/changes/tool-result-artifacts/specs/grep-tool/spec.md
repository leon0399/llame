## MODIFIED Requirements

### Requirement: The grep tool accepts one strict input object

The code-owned `grep` tool MUST declare the `read_only` classification. Its
input MUST be one strict object. The tool MUST reject an unknown property as
`invalid_input`.

- `patterns`: an array of 1 to 8 strings. Each string MUST hold 1 to 512
  UTF-8 bytes. The array is a disjunction. A line matches when at least one
  pattern matches it.
- `scopes`: an optional array of 1 to 16 scope strings. The scope grammar is
  defined below.
- `literal`: an optional boolean, default `false`. When `true`, the tool MUST
  match each pattern as literal text.
- `ignoreCase`: an optional boolean, default `false`.
- `limit`: an optional integer from 1 to 20, default 20. It bounds the files
  in the inline part of the result.

The tool MUST compile each pattern with RE2 syntax through a linear-time
engine. When the engine rejects a pattern, the tool MUST fail the call as
`invalid_pattern` with the engine message and the pattern index. The tool
MUST NOT run an engine that backtracks. The tool MUST NOT rewrite a rejected
pattern. The tool MUST NOT record a `native.attempt` effect, because it
mutates nothing.

#### Scenario: Unknown property is refused

- **WHEN** the model submits `{ "patterns": ["x"], "include": "*.ts" }`
- **THEN** the tool returns `invalid_input`
- **AND** no scope is admitted and no file is opened

#### Scenario: Backreference is refused by the engine

- **WHEN** a pattern is `(a)\1`
- **THEN** the tool returns `invalid_pattern` with the engine message and index `0`
- **AND** no scope is admitted and no file is opened

#### Scenario: Literal mode keeps metacharacters

- **WHEN** `literal` is `true` and a pattern is `a.b(`
- **THEN** only lines that contain the text `a.b(` match

#### Scenario: Nine patterns are refused

- **WHEN** `patterns` holds nine strings
- **THEN** the tool returns `invalid_input`

#### Scenario: A cursor is refused

- **WHEN** the model submits `{ "patterns": ["x"], "cursor": "abc" }`
- **THEN** the tool returns `invalid_input`

#### Scenario: No native attempt is recorded

- **WHEN** a grep call runs over a host scope
- **THEN** no `native.attempt` event is appended

### Requirement: The grep deadline derives from the tool call timeout

The walk MUST stop at the call deadline. The call deadline is the call start
plus the tool call timeout, minus a margin. The margin is the larger of 5
seconds and one tenth of the timeout, but at most half of it. Without a
timeout in the call context, the timeout is `tools.callTimeoutSeconds`. At the
call deadline, the result MUST carry the passages found so far,
`complete: false`, and a `deadline` warning.

#### Scenario: The default timeout leaves a margin

- **WHEN** `tools.callTimeoutSeconds` is 120 and the walk does not end
- **THEN** the walk stops 108 seconds after the call starts
- **AND** the tool returns its passages and a `deadline` warning, not a `timeout` error

#### Scenario: A longer timeout gives a longer walk

- **WHEN** `tools.callTimeoutSeconds` is 300
- **THEN** the call deadline is 270 seconds after the call starts

#### Scenario: A short timeout keeps half of it for the walk

- **WHEN** `tools.callTimeoutSeconds` is 6
- **THEN** the call deadline is 3 seconds after the call starts

#### Scenario: A call without a timeout in its context uses the configured timeout

- **WHEN** a grep call runs with no timeout in its call context and `tools.callTimeoutSeconds` is 120
- **THEN** the call deadline is 108 seconds after the call starts

#### Scenario: A deadline with no match stays incomplete

- **WHEN** the call deadline stops the walk before any line matched
- **THEN** the result is `results: []` with `complete: false` and a `deadline` warning

### Requirement: Operator bounds limit a grep walk only when configured

The walk MUST apply a file, entry, byte, or file-size bound only when the
`tools.grep` configuration object sets it. An unset bound MUST NOT stop the
walk. `maxFilesExamined` bounds the files that the walk takes for a match.
`maxEntriesListed` bounds the directory entries that the walk lists. Each
bound applies across every scope of one call.

#### Scenario: A default walk has no count bound

- **WHEN** the `tools.grep` configuration object is absent and a scope holds 30,000 text files of 300 MiB in total
- **THEN** the walk examines every file if the call deadline allows it
- **AND** the result carries no `file_bound`, `entry_bound`, or `byte_bound` warning

#### Scenario: A configured file bound stops the walk early

- **WHEN** `tools.grep.maxFilesExamined` is 3 and a scope holds 10 files with no match
- **THEN** the walk takes 3 files and stops with a `file_bound` warning and `complete: false`

### Requirement: Byte bounds count the bytes that the walk takes

`maxBytesRead` MUST count the bytes of each file that the walk takes in
canonical order. It MUST also count the bytes that the walk read so far of the
file that it waits on. Bytes of any other file that the walk read ahead MUST NOT count. The
walk MUST stop when the count reaches `maxBytesRead`. `maxFileBytes` MUST skip
a regular file as `oversized` when its size, or the bytes that the walk reads
from it, exceed the bound.

#### Scenario: A configured byte bound stops the walk

- **WHEN** `tools.grep.maxBytesRead` is 10 MiB and a scope holds 50 text files of 1 MiB each with no match
- **THEN** the walk takes 10 files and stops with a `byte_bound` warning and `complete: false`

#### Scenario: A file that grows past the file-size bound is skipped

- **WHEN** `tools.grep.maxFileBytes` is 1 MiB and a file is 900 KiB when the walk opens it and 2 MiB when the walk reads it
- **THEN** the file contributes no hit
- **AND** `warnings` counts one oversized skip

#### Scenario: A byte bound in the first file skips it

- **WHEN** `tools.grep.maxBytesRead` is 10 MiB and the first file of a scope is a 50 MiB text log with no match
- **THEN** the result names that log in `unfinishedFile` and carries a `byte_bound` warning
- **AND** the result holds no passage of that log

### Requirement: Reads run concurrently and keep canonical order

The walk MUST NOT have more than 8 files open for a match at the same time, or
more than a configured file bound leaves. When more candidates wait in
canonical order, the walk MUST have 8 files open, or as many as that bound
leaves. The inline part, the artifact, each bound, each skip count, and each
excluded directory MUST take effect in canonical order. A file opened ahead of a stop
MUST NOT count as reached.

#### Scenario: Eight reads are in flight

- **WHEN** a scope holds 20 candidates and each read waits until the test releases it
- **THEN** 8 reads are in flight at the same time, and no more

#### Scenario: A later file that ends first keeps its place

- **WHEN** `b.ts` ends before `a.ts` and both files match
- **THEN** the passages of `a.ts` come before the passages of `b.ts`

#### Scenario: A stop discards files opened ahead

- **WHEN** the call deadline stops the walk after `c.ts` and the walk has opened `d.ts` to `h.ts` ahead
- **THEN** the result holds no passage of `d.ts` to `h.ts`
- **AND** the result does not count `d.ts` to `h.ts` as examined

#### Scenario: Read-ahead does not exceed the file bound

- **WHEN** `tools.grep.maxFilesExamined` is 3
- **THEN** the walk opens no more than 3 files for a match in the call

#### Scenario: Files before an entry bound are still searched

- **WHEN** the entry bound trips while three earlier candidates with no match are open
- **THEN** the walk takes those three files before it stops
- **AND** the result holds the passages of those three files, if any

#### Scenario: A read refusal counts only for a taken file

- **WHEN** the `read` group refuses a file that the walk admitted ahead, and the call deadline stops the walk before it takes that file
- **THEN** the completion audit does not count that refusal

### Requirement: Excluded directories are reported

The walk MUST record each directory that an ignore rule excludes. It MUST NOT record a directory below an excluded
directory, or an excluded file. When the `read` group admits at least one
recorded locator, the result MUST carry `ignored`. `ignored.count` MUST count
the admitted locators. `ignored.locators` MUST hold the first five of them in
canonical order.

#### Scenario: The model learns which directory to scope

- **WHEN** a search over `/home/u/repo` finds no match and `node_modules/` excluded `/home/u/repo/node_modules`
- **THEN** `ignored.locators` holds `/home/u/repo/node_modules`
- **AND** a later scope of `/home/u/repo/node_modules` searches it

#### Scenario: Nested excluded directories are not repeated

- **WHEN** `node_modules/` excluded `/home/u/repo/node_modules`, and that directory holds another `node_modules`
- **THEN** `ignored.count` counts one directory

#### Scenario: A resumed page does not repeat earlier exclusions

- **WHEN** a Machine scope answers in two `fs.grep` responses, and the first response excluded `/srv/app/node_modules`
- **THEN** the result counts `/srv/app/node_modules` once

### Requirement: Scope backends fail closed per scheme

A host scope on a process without accepted native host authority MUST fail as
`executor_unavailable`. A `kb://` scope on a process without a configured
Knowledge root MUST fail as `knowledge_space_unavailable`. A bare `kb://`
scope for an owner with zero Spaces MUST fail as
`knowledge_space_not_configured`. A bare `kb://` scope MUST check access to
each Space again before the walk enters it.

A bare `skill://` scope on a Chat with no effective skill source names zero
packages. The tool searches it, and it returns no passage and no failure. A
`skill://<name>` scope there MUST fail as `not_found`, as `read` does. A
`skill://` scope with no catalog snapshot MUST fail as
`skill_catalog_unavailable`. A failure of one scope MUST fail the whole call.
A partial result MUST NOT hide a scope that the tool did not search.

A `machine://` scope MUST run on the named Machine through the `fs.grep`
protocol method. The daemon MUST resolve the prefix through its registered
roots. It MUST return `path_not_registered` for a prefix outside them, as
`read` does. The daemon MUST walk, match, and bound the search locally under
the rules of this capability.

The request carries the file, entry, byte, and file-size bounds that are left
for the call. An unset bound MUST travel as `null`, and the daemon then MUST
apply no such bound. The daemon MUST stay inside each bound that the request
sets. The request also carries whether the call progressed. The response
carries whether the daemon walk progressed, as "A stop inside a file before
progress names that file" defines progress.

The request MUST give the daemon nine tenths of the time left to the call
deadline. The daemon answer then arrives before the API stops the request. The
API MUST stop the request at the call deadline.

The daemon MUST return passages, excluded directories, and an unfinished
file as paths relative to its display prefix only. The request carries a page
budget that fits one protocol message. The API MUST ask for the next response
after the last passage it kept, never after a daemon passage it dropped. It
MUST ask again until the scope ends, the call stops, or the artifact bound
cuts a daemon page. The API MUST apply the `read` group to each path that the
daemon returns before the result names it.

An unreachable or unknown Machine MUST fail the call with the Machine failure
results that `read` uses. A daemon without the method MUST fail the call as
Machine unusable. A daemon that refuses the request parameters MUST also fail
the call as Machine unusable.

#### Scenario: Host scope without an executor

- **WHEN** a scope is `/srv/data/**` and the process has no accepted native host authority
- **THEN** the tool returns `executor_unavailable`

#### Scenario: Knowledge scope without a root

- **WHEN** a scope is `kb://<id>/notes/**` and the worker has no configured Knowledge root
- **THEN** the tool returns `knowledge_space_unavailable`

#### Scenario: Skill scope without a source

- **WHEN** a scope is a bare `skill://` and the Chat has no effective skill source
- **THEN** the result holds no passage for that scope and `complete: true`

#### Scenario: Named skill scope without a source

- **WHEN** a scope is `skill://reviewer` and the Chat has no effective skill source
- **THEN** the tool returns `not_found`

#### Scenario: Named skill scope without a catalog snapshot

- **WHEN** a scope is `skill://reviewer` and the catalog snapshot of the Chat is not available
- **THEN** the tool returns `skill_catalog_unavailable`

#### Scenario: Machine search runs on the Machine

- **WHEN** a scope is `machine://build/srv/app/**/*.go`
- **THEN** the daemon on `build` does the walk and the match
- **AND** each hit locator starts with `machine://build/`

#### Scenario: Machine prefix outside the roots

- **WHEN** a scope is `machine://build/**` and `/` is not a registered root
- **THEN** the tool returns `path_not_registered`
- **AND** the daemon opens no file

#### Scenario: Unknown Machine fails the call

- **WHEN** a scope names a Machine that is not configured
- **THEN** the tool returns the Machine not-found result that `read` uses
- **AND** the tool searches no other scope of that call

#### Scenario: A dropped Machine passage never names the cursor

- **WHEN** the last passage of the daemon belongs to a file that the `read` group refuses
- **THEN** the next `fs.grep` request resumes after the last passage that the API kept
- **AND** the refused path is not in the result

#### Scenario: Budgets span Machines

- **WHEN** `tools.grep.maxBytesRead` is 32 MiB, two Machine scopes are submitted, and the first consumed 30 MiB
- **THEN** the second request carries a 2 MiB byte bound

#### Scenario: An unset bound travels as null

- **WHEN** `tools.grep` sets no bound and a scope is `machine://build/srv/**`
- **THEN** the request carries `null` for the file, entry, byte, and file-size bounds
- **AND** the daemon applies no file, entry, byte, or file-size bound

#### Scenario: A daemon that refuses the request is unusable

- **WHEN** a daemon answers an `fs.grep` request with an invalid-parameters error
- **THEN** the tool returns the Machine unusable result, not `invalid_input`

### Requirement: A file is searched as a stream

The walk MUST search a regular file of any size when `maxFileBytes` is not
set. The walk MUST keep the passages of a file until it reaches the end of
that file. The file then gives its passages to the result. A skip that the
walk finds after a match MUST drop each passage of that file.

#### Scenario: A large log is searched

- **WHEN** no bound is configured and the last line of a 200 MiB text log matches
- **THEN** the result holds a passage of that line

#### Scenario: A late skip drops the passages

- **WHEN** line 10 of a file matches and a later line of that file is longer than 4 MiB
- **THEN** the file contributes no passage
- **AND** `warnings` counts one oversized skip

#### Scenario: A cut passage longer than a page loses no line

- **WHEN** a passage of a 200 MiB file spans 2,000 long lines, and the inline part cuts it
- **THEN** the artifact holds every line of that passage once
- **AND** no line of that passage is missed or repeated

### Requirement: The excluded-directory report is filtered and bounded

The `read` group MUST admit a directory locator both as written and with a
final separator before the result counts or names it. The walk MUST record at
most 1,000 excluded directories for one call, across every scope. When it
excludes more, `ignored.atLeast` MUST be `true`. The inline part MUST reserve
room for the `ignored`, `unfinishedFile`, remainder, and artifact notice
lines, so the tool loop never cuts the result.

#### Scenario: A refused directory is not named

- **WHEN** an ignore rule excluded `/home/u/repo/secrets` and the `read` group refuses that locator
- **THEN** `ignored` neither counts nor names `/home/u/repo/secrets`

#### Scenario: A reject with a final separator hides the directory

- **WHEN** an ignore rule excluded `/home/u/.ssh` and the `read` group rejects the literal `/home/u/.ssh/`
- **THEN** `ignored` neither counts nor names `/home/u/.ssh`

#### Scenario: Only refused exclusions leave no report

- **WHEN** the only excluded directory is one that the `read` group refuses
- **THEN** the result carries no `ignored` field

#### Scenario: A large exclusion count is a lower bound

- **WHEN** ignore rules exclude 1,500 directories in one call and the `read` group admits each of them
- **THEN** `ignored.count` is 1,000 and `ignored.atLeast` is `true`

## ADDED Requirements

### Requirement: Unreadable files are skipped and counted

For every scheme, the walk MUST skip a file with a NUL byte in its first 8
KiB. It MUST skip a file that is not valid UTF-8, with an invalid byte at any
offset. It MUST skip a file with a line longer than 4 MiB of UTF-8 bytes as
`oversized`. The result MUST count each skip in a `warnings` entry by kind.

#### Scenario: Binary file is skipped and counted

- **WHEN** a candidate contains a NUL byte in its first 8 KiB
- **THEN** it contributes no hit
- **AND** `warnings` counts one binary skip

#### Scenario: A line longer than 4 MiB skips its file

- **WHEN** no bound is configured and a candidate holds one line of 5 MiB
- **THEN** the file contributes no hit
- **AND** `warnings` counts one oversized skip

#### Scenario: A late invalid byte drops the file

- **WHEN** line 3 of a candidate matches and its byte at offset 900,000 is not valid UTF-8
- **THEN** the file contributes no passage
- **AND** `warnings` counts one `invalid_utf8` skip

### Requirement: A walk ends at its end, a bound, or the deadline

The walk MUST continue until it reaches the end of the last scope, a
configured bound, the artifact bound, or the call deadline. A full inline part
MUST NOT stop the walk. When a bound or the deadline stops the walk, the
result MUST carry `complete: false` and a `warnings` entry that names the stop.

#### Scenario: A full inline part does not stop the walk

- **WHEN** the first 20 files fill the inline part and the scope holds 300 more matching files
- **THEN** the walk examines all 300 files
- **AND** the artifact holds their passages

#### Scenario: The artifact bound stops the walk

- **WHEN** the passages of a walk reach `tools.artifacts.maxBytes`
- **THEN** the walk stops with `complete: false` and an `artifact_bound` warning

#### Scenario: File bound stops the walk

- **WHEN** `tools.grep.maxFilesExamined` is 5,000, a scope holds 6,000 candidate files, and the first 5,000 give no match
- **THEN** the walk stops at 5,000 examined files
- **AND** the result carries `complete: false` and a `warnings` entry that names the file bound

#### Scenario: A bound before the first match leaves an empty result

- **WHEN** the configured entry bound stops the walk before any passage
- **THEN** the result carries `results: []`, `complete: false`, and the entry bound warning

#### Scenario: Deadline returns a partial result

- **WHEN** the walk reaches the call deadline after it found three passages
- **THEN** the result carries those three passages, `complete: false`, and a `deadline` entry

#### Scenario: Oversized file is skipped and counted

- **WHEN** `tools.grep.maxFileBytes` is 1 MiB and a candidate is 2 MiB
- **THEN** it contributes no hit
- **AND** `warnings` counts one oversized skip

#### Scenario: A stopped walk returns no cursor

- **WHEN** the configured file bound stops the walk
- **THEN** the result carries `complete: false` and a `file_bound` warning
- **AND** the result carries no `cursor`

### Requirement: Passages follow scope order and walk order

The tool MUST order passages by resolved scope ordinal, then by canonical
order of the walk, then by passage start line. The inline part and the
artifact MUST use this one order.

#### Scenario: A later file that ends first keeps its place in the artifact

- **WHEN** `b.ts` ends before `a.ts`, both files match, and the result has an artifact
- **THEN** the passages of `a.ts` come before the passages of `b.ts` in the artifact

### Requirement: Each scope and each expansion takes one ordinal

The ordinal of a scope is its position in the resolved scope list. Submitted
scopes MUST keep their submitted order. A bare `kb://` scope MUST expand in
byte order of the Space identifier. A bare `skill://` scope MUST expand in
byte order of the package name. Each expansion and each Machine scope MUST
take its own ordinal from one counter.

#### Scenario: Each expansion of a bare scope takes its own ordinal

- **WHEN** `kb://` resolves to Spaces `a` and `b`, and `/home/u/repo/**` follows
- **THEN** the Spaces take ordinals 0 and 1, and the host scope takes ordinal 2
- **AND** the passage order uses those ordinals

### Requirement: A file gives at most 20 passages

A file with more than 20 passages MUST give its first 20 in canonical order,
in the inline part and in the artifact. Its twentieth passage MUST carry
`truncated: true`. A `read` of the file reaches the passages after the
twentieth.

#### Scenario: Twenty-first passage is marked

- **WHEN** one file holds 25 passages
- **THEN** the result holds its first 20, and the twentieth carries `truncated: true`
- **AND** the artifact holds no twenty-first passage of that file

### Requirement: The inline part is the head of the result

The inline part MUST hold whole passages in result order while the next one
fits. It MUST hold at most `limit` files. Its rendered text MUST stay at or
below 15,000 UTF-16 code units, every line of the result included. When the
first passage does not fit, the tool MUST cut it at a line boundary and mark
it `cut: true`.

#### Scenario: The budget ends the inline part early

- **WHEN** the eleventh passage does not fit in 15,000 code units
- **THEN** the inline part holds ten passages
- **AND** the artifact holds the eleventh passage and every later passage

#### Scenario: A cut first passage continues in the artifact

- **WHEN** the first passage does not fit and the tool cuts it at line 40
- **THEN** the inline part holds that passage up to line 40
- **AND** the artifact holds the whole passage

#### Scenario: No match

- **WHEN** no line in an admitted file matches and no bound or deadline stops the walk
- **THEN** the result is `results: []`, `complete: true`, and no artifact
- **AND** `warnings` still reports skipped files

### Requirement: The remainder line names the next files

When the artifact holds passages after the inline part, the result MUST carry
one remainder line. The line MUST give the count of files and passages after
the inline part. It MUST name at most ten of the next files, each with its
line range in the artifact.

#### Scenario: The next files are named with their ranges

- **WHEN** the inline part holds 20 files and the artifact holds 140 more files with 610 passages
- **THEN** the remainder line counts 140 files and 610 passages
- **AND** it names the next ten files, each with its `artifact://grep-<n>:<a>-<b>` range

### Requirement: A stop inside a file before progress names that file

A call progresses when it emits a passage, or when it finishes an entry. When
the call deadline or a bound stops the walk inside a file before the call
progressed, the result MUST name that file in `unfinishedFile`. After
progress, the result MUST NOT name it. The result MUST NOT name a file that
the `read` group refuses.

#### Scenario: A file larger than the call is named

- **WHEN** a scope starts with a 3 GB log and the call deadline stops the walk in it
- **THEN** the result names that log in `unfinishedFile` with `complete: false`

#### Scenario: A stop after progress names no file

- **WHEN** the call finished 40 files and the call deadline stops the walk in the forty-first
- **THEN** the result carries no `unfinishedFile`

#### Scenario: A refused unfinished file is not named

- **WHEN** the call deadline stops a Machine walk in its first file and the `read` group refuses that file
- **THEN** the result carries no `unfinishedFile`

### Requirement: A Machine response that names an unfinished file is skipped

When a Machine response names an unfinished file, the API MUST ask for the
next response after that file. It MUST NOT open that file again in the call.

#### Scenario: A daemon time budget skips one file

- **WHEN** the daemon time budget stops a Machine walk in its first file, before progress
- **THEN** the next `fs.grep` request of the call starts after that file

## REMOVED Requirements

### Requirement: Results are ordered, bounded, and paged by a keyset cursor

**Reason**: The model no longer pages a `grep` result. The whole result goes to
an artifact, and `read` selectors page it.

**Migration**: Order, per-file passage limits, scope ordinals, and the inline
bound move to the ADDED requirements of this delta. A model that sent `cursor`
reads `artifact://grep-<n>` from the line that the notice names.

### Requirement: Walks are bounded

**Reason**: Its stop rules return a cursor, and the cursor is removed.

**Migration**: "Unreadable files are skipped and counted" keeps the skip
rules. "A walk ends at its end, a bound, or the deadline" keeps the stop rules
without a cursor.

### Requirement: A stop in a file that blocks progress skips that file

**Reason**: Progress across calls has no meaning without a cursor.

**Migration**: "A stop inside a file before progress names that file" keeps
`unfinishedFile` and progress within one call.

### Requirement: A stop after progress opens the file again

**Reason**: No later call resumes a `grep` walk.

**Migration**: Resume of a stopped walk is tracked in #1527.
