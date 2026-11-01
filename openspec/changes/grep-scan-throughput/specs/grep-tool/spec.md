## MODIFIED Requirements

### Requirement: Walks are bounded

For every scheme, the walk MUST obey these rules:

- The walk MUST skip a file with a NUL byte in its first 8 KiB.
- The walk MUST skip a file that is not valid UTF-8. An invalid byte at any
  offset skips the file.
- The walk MUST skip a file with a line longer than 64 MiB as `oversized`.
- The result MUST count each skip in a `warnings` entry by kind.

The walk has no file, entry, byte, or file-size bound by default. The
operator-bound requirement defines the bounds that an operator can set. The
call-deadline requirement defines when the walk stops for time.

When a bound or the call deadline stops the walk, the result MUST carry
`complete: false`. It MUST also carry a `warnings` entry that names the stop,
and a `cursor`.

When the page emitted a passage, the cursor MUST be a passage cursor, as the
keyset-cursor requirement defines. Otherwise the cursor MUST be a position
cursor that names the last entry the walk reached in canonical order. A later
call MUST list the entries before that entry and that entry itself, and it
MUST NOT open them. It MUST then continue the walk after that entry.

#### Scenario: Binary file is skipped and counted

- **WHEN** a candidate contains a NUL byte in its first 8 KiB
- **THEN** it contributes no hit
- **AND** `warnings` counts one binary skip

#### Scenario: File bound stops the walk

- **WHEN** `tools.grep.maxFilesExamined` is 5,000, a scope holds 6,000 candidate files, and the first 5,000 give no match
- **THEN** the walk stops at 5,000 examined files
- **AND** the result carries `complete: false`, a `warnings` entry that names the file bound, and a `cursor`
- **AND** a later call with that `cursor` starts after the last file that the first call examined

#### Scenario: A bound before the first match returns a cursor

- **WHEN** the configured entry bound stops the walk before the page emits a passage
- **THEN** the result carries `complete: false`, the entry bound warning, and a `cursor`
- **AND** a later call with that `cursor` opens no entry that the first call listed

#### Scenario: Deadline returns a partial page

- **WHEN** the walk reaches the call deadline after it emitted three passages
- **THEN** the result carries those three passages, `complete: false`, a `deadline` entry, and a `cursor`

#### Scenario: Oversized file is skipped and counted

- **WHEN** `tools.grep.maxFileBytes` is 1 MiB and a candidate is 2 MiB
- **THEN** it contributes no hit
- **AND** `warnings` counts one oversized skip

#### Scenario: A line longer than 64 MiB skips its file

- **WHEN** no bound is configured and a candidate holds one line of 65 MiB
- **THEN** the file contributes no hit
- **AND** `warnings` counts one oversized skip

#### Scenario: A late invalid byte drops the file

- **WHEN** line 3 of a candidate matches and its byte at offset 900,000 is not valid UTF-8
- **THEN** the file contributes no passage
- **AND** `warnings` counts one `invalid_utf8` skip

### Requirement: Walk order and links are defined per scheme

The walk MUST visit each directory depth-first. In one directory, the walk
MUST order entries by name in byte order. The walk MUST visit a file before it
enters a directory of a later name. This traversal order is the canonical
order of the call.

A host, Machine, or Knowledge walk MUST NOT follow a symbolic link. A skill
walk MUST follow the agent-skills link semantics, under the same bounds and
the same call deadline. A skill walk MUST NOT enter a directory whose
canonical identity is already on the current path. It MUST count such a
directory as a `link` skip. It MUST also count a link that the operating
system reports as a loop as a `link` skip.

A host or Machine walk MUST include hidden entries. It MUST NOT enter a
directory named `.git`. It MUST apply ignore files as the ignore-file
requirements define. When a scope names one exact file, the tool MUST search
that file, even when an ignore rule matches it. A Knowledge walk MUST keep the
Knowledge filesystem rules. It refuses a symbolic link at every component, and
the path stays in the resolved Space.

#### Scenario: gitignored directory is not entered

- **WHEN** `/home/u/repo/.gitignore` names `node_modules/` and a scope is `/home/u/repo/**`
- **THEN** the walk examines no file below `node_modules`

#### Scenario: Explicit gitignored file is searched

- **WHEN** a scope is `/home/u/repo/dist/app.js` and `dist/` is gitignored
- **THEN** the tool searches that file

#### Scenario: The Git directory is never entered

- **WHEN** a scope is `/home/u/repo/**` and `.git/config` contains a match
- **THEN** no passage names `.git/config`

#### Scenario: Hidden file is searched

- **WHEN** a scope is `/home/u/repo/**` and `.editorconfig` contains a match
- **THEN** a passage names `.editorconfig`

#### Scenario: Host link is not followed

- **WHEN** `/home/u/repo/link` is a symbolic link to `/etc` and a scope is `/home/u/repo/**`
- **THEN** the walk examines no file below `/etc`

#### Scenario: Skill link loop is skipped

- **WHEN** a package holds `loop -> .`
- **THEN** the walk does not enter `loop`
- **AND** the tool searches the entries after `loop` in the package

#### Scenario: Skill package link is followed

- **WHEN** a skill source holds a child link to a package directory
- **THEN** a bare `skill://` scope searches that package

### Requirement: Results are ordered, bounded, and paged by a keyset cursor

The tool MUST order passages by resolved scope ordinal, then by canonical
order of the walk, then by passage start line. One page MUST hold at most
`limit` files and at most 20 passages for each file. A file with more than 20
passages MUST give its first 20 in canonical order. Its twentieth passage
MUST carry `truncated: true`. A cursor does not reach the passages after the
twentieth. A later `read` of the file reaches them. A cursor that names a
twentieth passage resumes at the next file in canonical order.

The ordinal of a scope is its position in the resolved scope list. Submitted
scopes keep their submitted order. A bare `kb://` scope expands in byte order
of the Space identifier. A bare `skill://` scope expands in byte order of the
package name. Each expansion takes its own ordinal. A Machine scope takes its
ordinal from the same counter.

The tool MUST keep the rendered model text of the whole result at or below
15,000 UTF-16 code units, as `tool-result-rendering` defines that text. The
continuation line, the `[warnings: …]` line, the notice, and every other line
of the result count. The tool MUST emit whole passages in order while the next
passage fits. When the first passage of a page does not fit, the tool MUST cut
that passage at a line boundary and mark it `cut: true`. That passage ends the
page. The page MUST end before the budget, so the tool loop never cuts the
result.

When the tool cuts a passage, the cursor MUST name that passage and its last
emitted line. A later call with that cursor MUST emit the rest of that passage
first. It MUST start at the line after the last emitted line. It MUST repeat
no line. It MUST then continue in canonical order.

The tool drops a rest with no matched line, as the partition rule drops one. A
cut passage that is also the twentieth passage of its file carries
`truncated: true` beside its cut. The twentieth rule holds after the call that
emits its rest.

When passages are left after a page, the result MUST carry `complete: false`
and an opaque keyset `cursor`. The cursor names the last emitted passage by
resolved scope ordinal, canonical file locator, and start line. It also
carries a hash of the resolved search inputs. These inputs are the patterns,
the projected scopes, `literal`, and `ignoreCase`. They also include the Space
identifiers and package names that a bare scope resolved to. A later call with
that `cursor` MUST resume after the named passage.

The tool MUST refuse a `cursor` whose hash differs from the current resolved
inputs as `invalid_input`. A Workspace change thus makes an old cursor
invalid. The tool MUST NOT store state between calls.

On resume, the walk MUST list the entries before the cursor and MUST NOT open
them. Those entries do not count toward a configured entry bound. Entries at or
after the cursor count. Each file that the walk opens counts toward a
configured file bound. A file that a `read` reject refuses is listed and not
examined, except on a Machine.

A position cursor names the last entry the walk reached. On resume, the walk
MUST list the entries before that entry and that entry itself, and it MUST NOT
open them. Those entries do not count toward a configured entry bound. The walk MUST
enter a directory that the entry names. It MUST NOT examine again the file
that the entry names.

The entry that a position cursor names can be an entry that the `read` group
refused. The cursor names it only as the point to resume after. It never names
a passage of that entry.

A result with no passage MUST return `results: []` and `complete: true` when
no bound and no call deadline stopped the walk.

#### Scenario: Second page resumes after the cursor

- **WHEN** a first call returns 20 files and a `cursor`
- **THEN** a second call with that `cursor` returns the next files in the same order
- **AND** the second page repeats no file of the first page

#### Scenario: Cursor with changed patterns is refused

- **WHEN** a call with `patterns: ["b"]` submits a `cursor` from a call with `patterns: ["a"]`
- **THEN** the tool returns `invalid_input`

#### Scenario: Cursor from another Workspace is refused

- **WHEN** the tool issued a `cursor` while `/home/u/a` was the Workspace, and the Chat then entered `/home/u/b`
- **THEN** a call with that `cursor` and the same submitted inputs returns `invalid_input`

#### Scenario: Twenty-first passage is marked, not paged

- **WHEN** one file holds 25 passages
- **THEN** the page holds its first 20, and the twentieth carries `truncated: true`
- **AND** the cursor names the twentieth passage, so the next page starts at the next file

#### Scenario: A new Space invalidates a bare cursor

- **WHEN** the tool issued a `cursor` for scope `kb://`, and the owner then created a Space
- **THEN** a call with that `cursor` returns `invalid_input`

#### Scenario: The budget ends a page early

- **WHEN** the eleventh passage of a page does not fit in 15,000 code units
- **THEN** the page holds ten passages and a `cursor` that names the tenth
- **AND** the tool measured the 15,000 code units on the rendered text, with the continuation line

#### Scenario: A cut passage continues on the next call

- **WHEN** the first passage of a page does not fit and the tool cuts it at line 40
- **THEN** the cursor names that passage and line 40
- **AND** the next call emits the rest of that passage from line 41
- **AND** the next call repeats no line of that passage

#### Scenario: A position cursor names a refused entry

- **WHEN** a bound stops the walk on an entry that the `read` group refused, and the page emitted no passage after it
- **THEN** the position cursor names that entry as the point to resume after
- **AND** the result holds no passage of that entry
- **AND** the next call does not count that entry toward the configured entry bound

#### Scenario: A rest of context only is dropped

- **WHEN** the tool cuts a passage at line 40 and each line after line 40 is context
- **THEN** the next call emits no rest of that passage
- **AND** it starts at the next file in canonical order

#### Scenario: Each expansion of a bare scope takes its own ordinal

- **WHEN** `kb://` resolves to Spaces `a` and `b`, and `/home/u/repo/**` follows
- **THEN** the Spaces take ordinals 0 and 1, and the host scope takes ordinal 2
- **AND** the passage order and the cursor use those ordinals

#### Scenario: No match

- **WHEN** no line in an admitted file matches
- **THEN** the result is `results: []`, `complete: true`
- **AND** `warnings` still reports skipped files

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
for the call, and the time left to the call deadline. An unset bound MUST
travel as `null`, and the daemon then MUST apply no such bound. The daemon
MUST stay inside each bound that the request sets.

The daemon MUST return passages, excluded directories, and an unfinished
file as paths relative to its display prefix only. The request also carries
the page budget that is left. The API MUST cut a daemon page that is larger
than that budget. The API MUST stop the request at the call deadline. The API
MUST build the cursor from the last passage it emitted, never from a daemon
passage it dropped. The API MUST apply the `read` group to each path that the
daemon returns before the result names it.

An unreachable or unknown Machine MUST fail the call with the Machine failure
results that `read` uses. A daemon without the method MUST fail the call as
Machine unusable.

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
- **THEN** the cursor names the last passage that the API emitted
- **AND** the refused path is not in the result

#### Scenario: Budgets span Machines

- **WHEN** `tools.grep.maxBytesRead` is 32 MiB, two Machine scopes are submitted, and the first consumed 30 MiB
- **THEN** the second request carries a 2 MiB byte bound

#### Scenario: An unset bound travels as null

- **WHEN** `tools.grep` sets no bound and a scope is `machine://build/srv/**`
- **THEN** the request carries `null` for the file, entry, byte, and file-size bounds
- **AND** the daemon stops only at the call deadline or at the end of the walk

## ADDED Requirements

### Requirement: Operator bounds limit a grep walk only when configured

The walk MUST apply a file, entry, byte, or file-size bound only when
`tools.grep` sets it. An unset bound MUST NOT stop the walk.
`maxFilesExamined` bounds the files that the walk opens for a match.
`maxEntriesListed` bounds the directory entries that the walk lists.
`maxBytesRead` bounds the bytes that the walk reads across the call.
`maxFileBytes` skips a larger regular file as `oversized`. Each bound applies
across every scope of one call.

#### Scenario: A default walk has no count bound

- **WHEN** `tools.grep` is absent and a scope holds 30,000 text files of 300 MiB in total
- **THEN** the walk examines every file if the call deadline allows it
- **AND** the result carries no `file_bound`, `entry_bound`, or `byte_bound` warning

#### Scenario: A configured byte bound stops the walk

- **WHEN** `tools.grep.maxBytesRead` is 10 MiB and the scope holds 50 MiB of text
- **THEN** the walk stops after it read 10 MiB
- **AND** the result carries a `byte_bound` warning and a `cursor`

### Requirement: The grep deadline derives from the tool call timeout

The walk MUST stop at the call deadline. The call deadline is the tool call
timeout minus a margin. The margin is the larger of 5 seconds and one tenth of
the timeout. The margin MUST NOT be more than half of the timeout. At the call
deadline, the result MUST carry the passages found so far, `complete: false`,
a `deadline` warning, and a `cursor`.

#### Scenario: The default timeout leaves a margin

- **WHEN** `tools.callTimeoutSeconds` is 120 and the walk does not end
- **THEN** the walk stops 108 seconds after the call starts
- **AND** the tool returns its passages and a `cursor`, not a `timeout` error

#### Scenario: A longer timeout gives a longer walk

- **WHEN** `tools.callTimeoutSeconds` is 300
- **THEN** the call deadline is 270 seconds after the call starts

#### Scenario: A short timeout keeps half of it for the walk

- **WHEN** `tools.callTimeoutSeconds` is 6
- **THEN** the call deadline is 3 seconds after the call starts

### Requirement: A file is searched as a stream

The walk MUST search a regular file of any size when `maxFileBytes` is not
set. The walk MUST keep the passages of a file until it reaches the end of
that file. The file then gives its passages to the page. A skip that the walk
finds after a match MUST drop each passage of that file.

#### Scenario: A large log is searched

- **WHEN** no bound is configured and the last line of a 200 MiB text log matches
- **THEN** the result holds a passage of that line

#### Scenario: A late skip drops the passages

- **WHEN** line 10 of a file matches and a later line of that file is longer than 64 MiB
- **THEN** the file contributes no passage
- **AND** `warnings` counts one oversized skip

### Requirement: Reads run concurrently and keep canonical order

The walk MUST NOT have more than 8 files open for a match at the same time. It
can open later files in canonical order before an earlier file ends. The page,
the cursor, and each bound MUST count a file only when the walk takes its
result in canonical order. A file that the walk opened ahead of a stop MUST
NOT count as reached.

#### Scenario: A later file that ends first keeps its place

- **WHEN** `b.ts` ends before `a.ts` and both files match
- **THEN** the passages of `a.ts` come before the passages of `b.ts`

#### Scenario: A stop discards files opened ahead

- **WHEN** the call deadline stops the walk after `c.ts` and the walk has opened `d.ts` to `h.ts` ahead
- **THEN** the cursor names an entry no later than `c.ts`
- **AND** the next call opens `d.ts` to `h.ts` again

#### Scenario: Read-ahead does not exceed the file bound

- **WHEN** `tools.grep.maxFilesExamined` is 3
- **THEN** the walk opens no more than 3 files for a match in the call

### Requirement: A file that one call cannot finish is skipped and named

When the call deadline or the byte bound stops the walk in a file, the walk
MUST check its progress. If the call reached no entry after its start point,
the result MUST name that file in `unfinishedFile`. The cursor MUST then move
past that file. Otherwise the next call MUST open that file again. The
`unfinishedFile` field MUST name only a locator that the `read` group admits.

#### Scenario: A file larger than one call is skipped

- **WHEN** a scope starts with a 3 GB log and the call deadline stops the walk in it
- **THEN** the result names that log in `unfinishedFile`
- **AND** a later call with the `cursor` starts after that log

#### Scenario: A stop after progress resumes at the file

- **WHEN** the call reached 40 files and the call deadline stops the walk in the forty-first
- **THEN** the result carries no `unfinishedFile`
- **AND** a later call with the `cursor` opens the forty-first file again

### Requirement: Ignore files from the scope and above it apply

A host or Machine walk MUST read `.gitignore` and `.ignore` in each directory
from the filesystem root down to each candidate. On a Machine, the walk starts
at the registered root that holds the prefix. A deeper ignore file outranks a
shallower one. In one directory, `.ignore` outranks `.gitignore`.

#### Scenario: A rule at the repository root applies to a narrower scope

- **WHEN** `/home/u/repo/.git` exists, `/home/u/repo/.gitignore` names `dist/`, and a scope is `/home/u/repo/apps`
- **THEN** the walk examines no file below `/home/u/repo/apps/web/dist`

#### Scenario: An ignore file outside a repository applies

- **WHEN** `/mnt/d/Projects/.ignore` names `.build-cache/` and a scope is `/mnt/d/Projects/Arduino`
- **THEN** the walk examines no file below `/mnt/d/Projects/Arduino/libraries/.build-cache`

### Requirement: A gitignore above the scope applies only in its repository

The repository directory is the nearest directory at or above the prefix that
holds a `.git` entry. That entry can be a directory or a file. A `.gitignore`
above the prefix MUST apply only when it is in the repository directory or
below it. Without a repository directory, the walk MUST NOT apply a
`.gitignore` above the prefix.

#### Scenario: A gitignore above the repository does not apply

- **WHEN** `/home/u/.gitignore` names `*.md`, `/home/u/repo/.git` exists, and a scope is `/home/u/repo`
- **THEN** the walk searches `/home/u/repo/README.md`

#### Scenario: A gitignore outside a repository does not apply above the scope

- **WHEN** `/mnt/d/Projects/.gitignore` names `*.md`, no `.git` exists at or above `/mnt/d/Projects/Arduino`, and that directory is the scope
- **THEN** the walk searches `/mnt/d/Projects/Arduino/README.md`

### Requirement: An ignore rule never excludes the scope directory

An ignore rule MUST NOT exclude the scope directory or a directory above it.
A rule above the scope excludes an entry only when the rule matches that entry
or a directory between the scope and that entry. The walk MUST evaluate each
rule on its own. A deeper `!` rule MUST include again only the paths that it
matches.

#### Scenario: An explicit scope searches an ignored directory

- **WHEN** `/home/u/repo/.gitignore` names `node_modules/` and a scope is `/home/u/repo/node_modules/react`
- **THEN** the walk searches the files below that scope

#### Scenario: A glob does not override an ignore rule

- **WHEN** `/home/u/repo/.gitignore` names `node_modules/` and a scope is `/home/u/repo/**/node_modules/react/*.js`
- **THEN** the walk examines no file below `/home/u/repo/node_modules`

#### Scenario: A re-included directory keeps the other rules

- **WHEN** `/home/u/repo/.gitignore` names `build/` and `*.log`, and `/home/u/repo/src/.gitignore` names `!build/`
- **THEN** the walk enters `/home/u/repo/src/build`
- **AND** it examines no `.log` file below it

### Requirement: Excluded directories are reported

When an ignore rule excluded a directory, the result MUST carry `ignored`.
`ignored.count` MUST count the excluded directories whose locator the `read`
group admits. `ignored.locators` MUST hold the first five of them in canonical
order. The walk MUST NOT report a directory below an excluded directory, or
an excluded file. When the walk kept 1,000 excluded paths in one call,
`ignored.atLeast` MUST be `true`.

#### Scenario: The model learns which directory to scope

- **WHEN** a search over `/home/u/repo` finds no match and `node_modules/` excluded `/home/u/repo/node_modules`
- **THEN** `ignored.locators` holds `/home/u/repo/node_modules`
- **AND** a later scope of `/home/u/repo/node_modules` searches it

#### Scenario: A refused directory is not named

- **WHEN** an ignore rule excluded `/home/u/repo/secrets` and the `read` group refuses that locator
- **THEN** `ignored` neither counts nor names `/home/u/repo/secrets`

#### Scenario: Nested excluded directories are not repeated

- **WHEN** `node_modules/` excluded `/home/u/repo/node_modules`, and that directory holds another `node_modules`
- **THEN** `ignored.count` counts one directory
