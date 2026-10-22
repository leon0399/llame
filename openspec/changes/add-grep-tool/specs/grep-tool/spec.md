## ADDED Requirements

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
  on one page.
- `cursor`: an optional opaque string from an earlier result.

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

#### Scenario: No native attempt is recorded

- **WHEN** a grep call runs over a host scope
- **THEN** no `native.attempt` event is appended

### Requirement: A scope is a walkable locator with an optional glob

A scope MUST be one of these forms:

- an absolute host path,
- a relative host path, which the entered Workspace resolves with the
  Workspace path projection rule,
- `machine://<name><absolute path>`,
- `kb://`, which names every current Knowledge Space of the Run owner,
- `kb://<space-id>/<path>`,
- `skill://`, which names every package in the effective catalog of the
  Chat, without the manual-only entries that the current user turn did not
  select,
- `skill://<name>` or `skill://<name>/<path>`.

When the Workspace of the Chat is on a Machine, a host scope MUST map to
that Machine with the Workspace host mapping of `read`. The tool MUST
normalize a host or Machine scope lexically before any other step. It
resolves `.` and `..` segments and collapses repeated separators like POSIX
`path.posix.resolve`, without a filesystem probe.

The tool MUST recognize a glob operator only as a literal `*` or `?`
character in the submitted text of the path part. `*` and `?` MUST NOT
match a path separator. `**` as a whole segment MUST match zero or more
path segments. A percent-encoded `%2A` or `%3F` is a literal character and
never a glob operator.

A scope with no glob operator MUST name a directory or one regular file. The
tool searches a directory recursively. The scheme, the Machine name, the
Space identifier, and the skill name MUST NOT contain a glob operator.

The tool MUST NOT parse a read selector on a scope. In a host or Machine
scope, a colon is part of the path. In a `kb://` scope, a literal colon is
written `%3A`, as `read` requires. The tool MUST refuse a colon in a
`skill://` scope as `invalid_path`. The tool MUST refuse these scopes as
`invalid_path` before admission:

- a `media://` scope,
- an `http://` or `https://` scope,
- a `file:` alias with a remote host,
- a bare `machine://` or `machine://<name>` with no path,
- a scope with an unknown scheme,
- a scope with a glob operator the tool does not support, such as `{a,b}` or
  `[ab]`. The error MUST name the operator.

When `scopes` is omitted and a Workspace is entered, the tool MUST search the
Workspace root. When `scopes` is omitted and no Workspace is entered, the
tool MUST return `invalid_input`. That error MUST name the scope kinds the
process can serve. The error MUST NOT list Space identifiers, Machine names,
or host paths.

#### Scenario: Glob in the path part

- **WHEN** a scope is `kb://<id>/notes/**/*.md`
- **THEN** every Markdown file beneath `notes` in that Space is a candidate
- **AND** `kb://<id>/notes/other.txt` is not a candidate

#### Scenario: Encoded asterisk is a literal character

- **WHEN** a scope is `kb://<id>/a%2Ab/`
- **THEN** the tool searches the directory named `a*b`
- **AND** no glob is applied

#### Scenario: Glob in the Space identifier is refused

- **WHEN** a scope is `kb://*/notes`
- **THEN** the tool returns `invalid_path`

#### Scenario: Omitted scopes inside a Workspace

- **WHEN** the Chat entered `/home/u/repo` and the model submits only `patterns`
- **THEN** the tool searches `/home/u/repo` recursively

#### Scenario: Omitted scopes without a Workspace

- **WHEN** no Workspace is entered and the model submits only `patterns`
- **THEN** the tool returns `invalid_input`
- **AND** the message names only scope kinds, never a Space identifier, a Machine name, or a host path

#### Scenario: Web scope is refused

- **WHEN** a scope is `https://example.test/docs`
- **THEN** the tool returns `invalid_path` before any permission decision or request

#### Scenario: Media, remote alias, and unknown scheme are refused

- **WHEN** a scope is `media://<id>`, `file://nas/share`, or `ftp://host/path`
- **THEN** the tool returns `invalid_path` before any permission decision

#### Scenario: A colon in a host scope is part of the path

- **WHEN** a scope is `/home/u/repo/v:1/**`
- **THEN** the tool searches the directory named `v:1`
- **AND** no selector is parsed

#### Scenario: Parent segments are resolved before admission

- **WHEN** a scope is `/home/u/repo/../../../etc/**`
- **THEN** the admitted prefix is `/etc/`
- **AND** an allow on `/home/u/repo/` does not admit the call

#### Scenario: Host scope inside a Machine Workspace

- **WHEN** the Chat's Workspace is `machine://devl/home/me/shop` and a scope is `/home/me/shop/src/**`
- **THEN** the tool searches `machine://devl/home/me/shop/src/**`

### Requirement: Each scope is admitted against the grep group on its literal prefix

The tool MUST evaluate the `tools.permissions.grep` group once per scope,
before it opens any file, under the grep scope projection that the
`tool-call-permissions` capability defines. The literal prefix of a scope is
the scope without every segment from the first segment that contains a glob
operator. The prefix ends with a separator when a segment was removed or
when the submitted text ends with a separator. A bare `kb://` or `skill://`
scope projects to that exact text.

The tool MUST first project a relative host scope through the Workspace path
projection rule. The tool MUST project a `kb://`, `skill://`, or
`machine://` prefix with the same text-only projection that `read` applies
to that scheme. A clause then matches the same identity that a `read` of the
prefix matches.

When `scopes` is omitted and a Workspace is entered, the tool MUST evaluate
the Workspace root as the one scope, as the `tool-call-permissions`
capability defines. An absent `grep` group MUST reject the call. When the
group rejects any scope, the tool MUST reject the whole call as
`permission_denied`. The recorded call decision is the first rejection in
scope order, or the allow of the last scope when every scope is allowed.
The tool MUST NOT search any scope of a rejected call. A bypassed Run MUST
record one bypass decision for the call.

A bare `kb://` scope MUST visit Spaces in byte order of the Space
identifier. A bare `skill://` scope MUST visit packages in byte order of
the package name.

#### Scenario: Prefix of a glob scope is the matched identity

- **WHEN** the `grep` group allows `literal: "/home/u/repo/src/"` on `scopes` and a scope is `/home/u/repo/src/**/*.ts`
- **THEN** the call is admitted for that scope
- **AND** the clause saw `/home/u/repo/src/` and never saw a glob operator

#### Scenario: One refused scope refuses the call

- **WHEN** two scopes are submitted and a reject clause matches the second
- **THEN** the tool returns `permission_denied` with the second scope's decision
- **AND** no file beneath the first scope is opened

#### Scenario: A Knowledge scope matches on its logical identity

- **WHEN** a clause allows `kb://<id>/notes/` and the scope is `kb://<id>/notes/**`
- **THEN** the call is admitted
- **AND** no host path or configured root entered policy matching

#### Scenario: An omitted scope is admitted as the Workspace root

- **WHEN** the Chat entered `/home/u/repo`, the model submits only `patterns`, and the `grep` group rejects `literal: "/home/u/repo/"` on `scopes`
- **THEN** the tool returns `permission_denied`
- **AND** no file is opened

#### Scenario: A bare Knowledge scope matches its own text

- **WHEN** the only `grep` allow is `literal: "kb://"` on `scopes` and the scope is `kb://`
- **THEN** the call is admitted

### Requirement: Every hit is a locator that the read group admits

Before a file contributes a hit, the tool MUST evaluate the `read` group.
The evaluation sets `path` to the canonical locator of that file, under the
projection that `read` applies. When the `read` evaluation is not an allow,
the file contributes nothing. The tool MUST NOT emit, count as examined, or
name that file in the result. A host, Knowledge, or skill walk MUST NOT open
that file.

A Machine walk opens the file on the Machine, under the Machine's own
authority. The page of the daemon never reaches the model before the check.
The daemon counts those files as examined. An absent `read` group MUST make
every file contribute nothing.

The result MUST NOT tell the model how many files the `read` group refused.
The completion audit, which the owner sees, MUST carry that count. The
`tool-call-permissions` capability defines how the decisions are recorded.

When a scope has no glob operator, the tool MUST probe that path first. The
exact-path `read` check and the `not_found` answer apply only when that path
is one regular file. When the `read` group refuses that file, the tool MUST
return the same `not_found` result as for a missing path. The result then
does not reveal whether the file exists. The tool MUST walk a directory scope
with a `read` check per file, for every scheme. The tool MUST NOT count that
directory as a refused file.

An ignore file that the walker reads as walk policy is not a candidate. The
walker MUST NOT emit its content and needs no `read` decision for it.

Every emitted `locator` MUST have the form
`<canonical file locator>:<start>-<end>` with a one-based inclusive line
range. The value is directly a valid `read` argument. In a `kb://` or
`skill://` locator the tool MUST encode a literal `*` as `%2A` and a literal
`?` as `%3F`. The locator can then return as a scope without a glob.

A `kb://` hit MUST carry the logical Knowledge locator. A `machine://` hit MUST carry
the Machine locator. A hit MUST NOT carry a configured root or a Machine host
path.

A result with at least one `kb://` passage MUST carry `notice`. The value
MUST be the closed Knowledge untrusted-content notice. That notice MUST be
the text that `read` and `knowledge_search` carry. A result with no `kb://`
passage MUST NOT carry `notice`.

#### Scenario: A read reject hides a file beneath an admitted scope

- **WHEN** the `grep` group allows `/home/u/repo/` and the `read` group rejects `regex: "\\.env$"` on `path`
- **THEN** a grep over `/home/u/repo/**` never opens `/home/u/repo/.env`
- **AND** the result does not name `.env` and carries no count of refused files
- **AND** the completion audit records one refused file

#### Scenario: A refused exact path looks missing

- **WHEN** the `read` group rejects `/home/u/.ssh/` and a scope is `/home/u/.ssh/id_ed25519`
- **THEN** the tool returns `not_found`
- **AND** the result is identical for `/home/u/.ssh/absent`

#### Scenario: A refused directory scope is still walked

- **WHEN** the `read` group allows `literal: "/home/u/repo/"` and a scope is `/home/u/repo`
- **THEN** the tool walks that directory
- **AND** a file beneath it contributes a passage
- **AND** the completion audit counts no refused file for the directory

#### Scenario: A Knowledge passage carries the notice

- **WHEN** a result holds one passage of `kb://<id>/notes/a.md`
- **THEN** the result carries `notice` with the closed Knowledge untrusted-content notice
- **AND** a result with no `kb://` passage carries no `notice`

#### Scenario: A hit is a valid read argument

- **WHEN** line 12 of `kb://<id>/notes/a.md` matches
- **THEN** the hit locator is `kb://<id>/notes/a.md:11-13`
- **AND** a `read` of that locator shows lines 11 to 13 in its window

#### Scenario: A Knowledge file named with an asterisk returns as a scope

- **WHEN** line 3 of the Knowledge file `notes/a*.md` matches
- **THEN** the hit locator is `kb://<id>/notes/a%2A.md:2-4`
- **AND** `kb://<id>/notes/a%2A.md` as a later scope searches that one file

#### Scenario: Another owner's Space is not found

- **WHEN** a scope names a Space that belongs to another owner
- **THEN** the tool returns `knowledge_space_not_found`
- **AND** no directory of that Space is probed

### Requirement: Walks are bounded

For every scheme, the walk MUST obey these rules:

- The walk MUST skip a file with a NUL byte in its first 8 KiB.
- The walk MUST skip a file that is not valid UTF-8.
- The walk MUST skip a regular file larger than 1 MiB.
- The result MUST count each skip in a `warnings` entry by kind.
- The walk MUST stop after it examined 5,000 files. A file is examined when
  the walk opens it for a match.
- The walk MUST stop after it listed 20,000 directory entries.
- The walk MUST stop after it read 32 MiB across the call.

The bounds apply across every scope of one call. The walk MUST search the
file that crosses the byte bound whole. A call then reads at most 1 MiB past
that bound. When a walk stops at a bound, the result MUST carry
`complete: false` and a `warnings` entry that names the bound. The result
MUST also carry a `cursor`.

The cursor MUST name the last entry the walk reached in canonical order. It
names that entry even when the walk emitted no passage. A later call MUST
list the entries up to and including that entry without opening them. It
MUST then continue the walk after that entry.

The call MUST stop after 30 seconds of wall time across every scope. It MUST
then return the passages found so far with `complete: false` and a
`deadline` entry in `warnings`. The result MUST carry a `cursor` under the
same rule.

#### Scenario: Binary file is skipped and counted

- **WHEN** a candidate contains a NUL byte in its first 8 KiB
- **THEN** it contributes no hit
- **AND** `warnings` counts one binary skip

#### Scenario: File bound stops the walk

- **WHEN** a scope holds 6,000 candidate files and the first 5,000 give no match
- **THEN** the walk stops at 5,000 examined files
- **AND** the result carries `complete: false`, a `warnings` entry that names the file bound, and a `cursor`
- **AND** a later call with that `cursor` starts after the last file the first call examined

#### Scenario: A bound before the first match returns a cursor

- **WHEN** the entry bound stops the walk before any passage is emitted
- **THEN** the result carries `complete: false`, the entry bound warning, and a `cursor`
- **AND** a later call with that `cursor` opens no entry the first call listed

#### Scenario: Deadline returns a partial page

- **WHEN** the walk passes 30 seconds after it emitted three passages
- **THEN** the result carries those three passages, `complete: false`, a `deadline` entry, and a `cursor`

#### Scenario: Oversized file is skipped and counted

- **WHEN** a candidate is 2 MiB
- **THEN** it contributes no hit
- **AND** `warnings` counts one oversized skip

### Requirement: Walk order and links are defined per scheme

The walk MUST visit each directory depth-first. Inside one directory, the
walk MUST order entries by name in byte order. The walk MUST visit a file
before it descends into a directory of a later name. This traversal order
is the canonical order of the call.

A host, Machine, or Knowledge walk MUST NOT follow a symbolic link. A skill
walk MUST follow the agent-skills link semantics, under the same file,
entry, byte, and time bounds. A skill walk MUST NOT enter a directory whose
canonical identity is already on the current path. It MUST count such a
directory, and a link the operating system reports as a loop, as a `link`
skip.

A host or Machine walk MUST include hidden entries. It MUST NOT enter a
directory named `.git`. It MUST apply every `.gitignore` file between the
scope prefix and the candidate, with Git precedence. When a scope names one
exact file, the tool MUST search that file even when an ignore rule matches
it. A Knowledge walk MUST keep the Knowledge filesystem rules: the walk
refuses a symbolic link at every component, and the path stays inside the
resolved Space.

#### Scenario: gitignored directory is not entered

- **WHEN** `/home/u/repo/.gitignore` names `node_modules/` and a scope is `/home/u/repo/**`
- **THEN** no file beneath `node_modules` is examined

#### Scenario: Explicit gitignored file is searched

- **WHEN** a scope is `/home/u/repo/dist/app.js` and `dist/` is gitignored
- **THEN** that file is searched

#### Scenario: The Git directory is never entered

- **WHEN** a scope is `/home/u/repo/**` and `.git/config` contains a match
- **THEN** no passage names `.git/config`

#### Scenario: Hidden file is searched

- **WHEN** a scope is `/home/u/repo/**` and `.editorconfig` contains a match
- **THEN** a passage names `.editorconfig`

#### Scenario: Host link is not followed

- **WHEN** `/home/u/repo/link` is a symbolic link to `/etc` and a scope is `/home/u/repo/**`
- **THEN** no file beneath `/etc` is examined

#### Scenario: Skill link loop is skipped

- **WHEN** a package holds `loop -> .`
- **THEN** the walk does not enter `loop`
- **AND** the entries after `loop` in the package are searched

#### Scenario: Skill package link is followed

- **WHEN** a skill source holds a child link to a package directory
- **THEN** a bare `skill://` scope searches that package

### Requirement: Matching is per logical line with a one-line window

The tool MUST split each file into logical lines with the native `read` line
rules: LF ends a line, CRLF is one delimiter, a lone CR stays text, and a
terminal delimiter makes no phantom line. The tool MUST test each line
unanchored against every compiled pattern. A matched line MUST produce a
window of that line plus at most one line before and one line after. The
tool MUST clip the window at the file ends.

Windows in one file that overlap or touch MUST merge into one passage. A
passage MUST span at most 2,000 lines. The tool MUST partition a longer
merged interval into adjacent passages. Each cut falls after the last
matched line that lies in the first 2,000 lines of the remainder. A
remainder with no matched line is dropped.

Each passage MUST carry `locator`, `content`, and `matches`. `content` MUST
hold the window lines with the ordinary one-based `N:` prefix. The tool MUST
cut a line longer than 512 UTF-16 code units at 512 code units and end it
with `…`. `matches` MUST list the one-based numbers of the matched lines in
the window. The tool MUST NOT report match columns, scores, or counts beyond
`matches`.

#### Scenario: Touching windows merge

- **WHEN** lines 4 and 6 match in one file
- **THEN** one passage `:3-7` is returned with `matches: [4, 6]`

#### Scenario: Window is clipped at the file start

- **WHEN** line 1 matches in a file of 10 lines
- **THEN** the passage is `:1-2` with `matches: [1]`

#### Scenario: Long line is cut

- **WHEN** a matched line is 900 code units long
- **THEN** the emitted line is 512 code units followed by `…`
- **AND** the locator still addresses the full source line

#### Scenario: A long merged interval is partitioned

- **WHEN** every line of a 4,500-line file matches
- **THEN** the file yields passages `:1-2000`, `:2001-4000`, and `:4001-4500`

#### Scenario: A trailing context line is dropped by the cut

- **WHEN** lines 1 to 2,000 of a file match and line 2,001 is only context
- **THEN** the file yields one passage `:1-2000`

#### Scenario: Case is ignored on request

- **WHEN** `ignoreCase` is `true` and a pattern is `todo`
- **THEN** a line that contains `TODO` matches

### Requirement: Results are ordered, bounded, and paged by a keyset cursor

The tool MUST order passages by resolved scope ordinal, then by canonical
order of the walk, then by passage start line. One page MUST hold at most
`limit` files and at most 20 passages per file. A file with more than 20
passages MUST contribute its first 20 in canonical order and
`truncated: true` on its twentieth passage. The passages after the
twentieth are not reachable through a cursor. A later `read` of the file
reaches them. A cursor that names a twentieth passage resumes at the next
file in canonical order.

The ordinal of a scope is its position in the resolved scope list.
Submitted scopes keep their submitted order. A bare `kb://` scope expands
in byte order of the Space identifier. A bare `skill://` scope expands in
byte order of the package name. Each expansion takes its own ordinal. A
Machine scope takes its ordinal from the same counter.

The tool MUST keep the result under a budget of 15,000 UTF-16 code units.
It MUST emit whole passages in order while the next passage fits. When the
first passage of a page does not fit, the tool MUST cut that passage at a
line boundary and mark it `truncated: true`. That passage ends the page. The
page MUST end before the budget, so the tool loop never cuts the result.

When the tool cuts a passage, the cursor MUST name that passage and its last
emitted line. A later call with that cursor MUST emit the rest of that
passage first. It MUST start at the line after the last emitted line. It
MUST repeat no line. It MUST then continue in canonical order. A cut
passage that is also the twentieth passage of its file keeps the twentieth
rule after that call emits its rest.

When passages remain after a page, the result MUST carry `complete: false`
and an opaque keyset `cursor`. The cursor names the last emitted passage by
resolved scope ordinal, canonical file locator, and start line. It also
carries a hash of the resolved search inputs: the patterns, the projected
scopes, the Space identifiers and package names a bare scope resolved to,
`literal`, and `ignoreCase`. A later call with that `cursor` MUST resume
after the named passage.

The tool MUST refuse a `cursor` whose hash differs from the current resolved
inputs as `invalid_input`. A Workspace change then invalidates an old
cursor. The tool MUST NOT store state between calls.

On resume, the walk MUST list entries before the cursor without opening
them. Those entries do not count toward the 20,000-entry bound. Entries at
or after the cursor count. Opened files count toward the 5,000-file bound.
A file that a `read` reject refuses is listed, not examined, except on a
Machine.

A position cursor names the last entry the walk reached. On resume, the
walk MUST list the entries up to and including that entry without an open.
It MUST descend a directory named by that entry. It MUST NOT examine the
file named by that entry again.

A result with no passage MUST return `results: []` and `complete: true`
when no bound stopped the walk.

#### Scenario: Second page resumes after the cursor

- **WHEN** a first call returns 20 files and a `cursor`
- **THEN** a second call with that `cursor` returns the next files in the same order
- **AND** no file of the first page is repeated

#### Scenario: Cursor with changed patterns is refused

- **WHEN** a `cursor` from a call with `patterns: ["a"]` is submitted with `patterns: ["b"]`
- **THEN** the tool returns `invalid_input`

#### Scenario: Cursor from another Workspace is refused

- **WHEN** a `cursor` was issued while `/home/u/a` was the Workspace and the Chat then entered `/home/u/b`
- **THEN** a call with that `cursor` and the same submitted inputs returns `invalid_input`

#### Scenario: Twenty-first passage is marked, not paged

- **WHEN** one file holds 25 passages
- **THEN** the page holds its first 20, the twentieth carries `truncated: true`
- **AND** the cursor names the twentieth passage, so the next page starts at the next file

#### Scenario: A new Space invalidates a bare cursor

- **WHEN** a `cursor` was issued for scope `kb://` and the owner then created a Space
- **THEN** a call with that `cursor` returns `invalid_input`

#### Scenario: The budget ends a page early

- **WHEN** the eleventh passage of a page does not fit under 15,000 code units
- **THEN** the page holds ten passages and a `cursor` that names the tenth

#### Scenario: A cut passage continues on the next call

- **WHEN** the first passage of a page does not fit and the tool cuts it at line 40
- **THEN** the cursor names that passage and line 40
- **AND** the next call emits the rest of that passage from line 41
- **AND** no line of that passage is repeated

#### Scenario: Each expansion of a bare scope takes its own ordinal

- **WHEN** `kb://` resolves to Spaces `a` and `b`, and `/home/u/repo/**` follows
- **THEN** the Spaces take ordinals 0 and 1, and the host scope takes ordinal 2
- **AND** the passage order and the cursor use those ordinals

#### Scenario: No match

- **WHEN** no line in any admitted file matches
- **THEN** the result is `results: []`, `complete: true`
- **AND** `warnings` still reports skipped files

### Requirement: Scope backends fail closed per scheme

A host scope on a process without accepted native host authority MUST fail as
`executor_unavailable`. A `kb://` scope on a process without a configured
Knowledge root MUST fail as `knowledge_space_unavailable`. A bare `kb://`
scope for an owner with zero Spaces MUST fail as
`knowledge_space_not_configured`. A bare `kb://` scope MUST re-check access
to each Space before the walk enters it.

A `skill://` scope on a Chat with no effective skill source MUST return no
passage for that scope. A failure of one scope MUST fail the whole call. A
partial result MUST NOT hide a scope that the tool did not search.

A `machine://` scope MUST run on the named Machine through the `fs.grep`
protocol method. The daemon MUST resolve the prefix through its registered
roots. It MUST return `path_not_registered` for a prefix outside them, as
`read` does. The daemon MUST walk, match, and bound the search locally under
the rules of this capability. The request carries the remaining file, entry,
byte, and time budget, and the daemon MUST stay inside it.

The daemon MUST return passages that name paths relative to its display
prefix only. The request also carries the remaining page budget. The API
MUST cut a daemon page that exceeds the remaining budget. The API MUST
abandon the request at the remaining deadline. The API MUST build the
cursor from the last passage it emitted, never from a daemon passage it
dropped.

An unreachable or unknown Machine MUST fail the call with the Machine
failure results that `read` uses. A daemon without the method MUST fail the
call as Machine unusable.

#### Scenario: Host scope without an executor

- **WHEN** a scope is `/srv/data/**` and the process has no accepted native host authority
- **THEN** the tool returns `executor_unavailable`

#### Scenario: Knowledge scope without a root

- **WHEN** a scope is `kb://<id>/notes/**` and the worker has no configured Knowledge root
- **THEN** the tool returns `knowledge_space_unavailable`

#### Scenario: Skill scope without a source

- **WHEN** a scope is `skill://` and the Chat has no effective skill source
- **THEN** the result holds no passage for that scope and `complete: true`

#### Scenario: Machine search runs on the Machine

- **WHEN** a scope is `machine://build/srv/app/**/*.go`
- **THEN** the daemon on `build` performs the walk and the match
- **AND** every hit locator starts with `machine://build/`

#### Scenario: Machine prefix outside the roots

- **WHEN** a scope is `machine://build/**` and `/` is not a registered root
- **THEN** the tool returns `path_not_registered`
- **AND** the daemon opens no file

#### Scenario: Unknown Machine fails the call

- **WHEN** a scope names a Machine that is not configured
- **THEN** the tool returns the Machine not-found result that `read` uses
- **AND** no other scope of that call is searched

#### Scenario: A dropped Machine passage never names the cursor

- **WHEN** the daemon's last passage belongs to a file the `read` group refuses
- **THEN** the cursor names the last passage the API emitted
- **AND** the refused path appears nowhere in the result

#### Scenario: Budgets span Machines

- **WHEN** two Machine scopes are submitted and the first consumed 30 MiB
- **THEN** the second request carries a 2 MiB byte budget

### Requirement: The tool is advertised when a backend can serve

The candidate resolver MUST admit `grep` when `tools.allowed` names it and
at least one backend can serve. A backend can serve when the process holds
accepted native host authority, a configured Knowledge root, a configured
operator skill source, or a configured Machine. With no backend, the tool
MUST stay unavailable. The packaged description MUST be a complete template
under the tool-prompt-templates rules. `tools.grep` MUST be a true predicate
when the tool is admitted.

#### Scenario: Knowledge root alone admits grep

- **WHEN** `tools.allowed` names `grep`, no native executor is accepted, and a Knowledge root is configured
- **THEN** `grep` is advertised
- **AND** a host scope still fails as `executor_unavailable`

#### Scenario: No backend leaves grep unavailable

- **WHEN** `tools.allowed` names `grep` and the process has no executor, no Knowledge root, no skill source, and no Machine
- **THEN** `grep` is not advertised
