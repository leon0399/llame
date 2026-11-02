# grep-tool Specification

## Purpose

Gives a Run bounded regular-expression content search over the locators that
it can walk: host paths, `machine://`, `kb://`, and `skill://`. The tool admits
each scope against the `grep` group and each file against the `read` group. It
returns line-ranged passages whose locators are valid `read` arguments, paged
by a stateless keyset cursor.

## Requirements

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
scope, a colon is part of the path. A grep scope is not a `read` locator. In
its path part a literal `*` or `?` is a glob operator, and `%2A` or `%3F`
names the literal character. In a `kb://` or `skill://` scope the tool MUST
refuse a literal colon as `invalid_path` and name the `%3A` spelling. The tool
MUST refuse these scopes as `invalid_path` before admission:

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
`skill://` locator the tool MUST spell each segment as the canonical
formatter of that scheme does. So a literal `*` stays `*` and a literal `?`
becomes `%3F`. To use such a locator as a later scope, the model writes `%2A`
for a literal `*`.

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
- **THEN** the hit locator is `kb://<id>/notes/a*.md:2-4`
- **AND** `kb://<id>/notes/a%2A.md` as a later scope searches that one file

#### Scenario: Another owner's Space is not found

- **WHEN** a scope names a Space that belongs to another owner
- **THEN** the tool returns `knowledge_space_not_found`
- **AND** no directory of that Space is probed

### Requirement: Walks are bounded

For every scheme, the walk MUST obey these rules:

- The walk MUST skip a file with a NUL byte in its first 8 KiB.
- The walk MUST skip a file that is not valid UTF-8. An invalid byte at any
  offset skips the file.
- The walk MUST skip a file with a line longer than 4 MiB of UTF-8 bytes as
  `oversized`.
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

A position cursor can instead name the start of a scope. It does so when the
walk reached no entry in that scope, or when it skips an unfinished
single-file scope and names the next scope. A later call MUST then start that
scope from its first entry.

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

#### Scenario: A line longer than 4 MiB skips its file

- **WHEN** no bound is configured and a candidate holds one line of 5 MiB
- **THEN** the file contributes no hit
- **AND** `warnings` counts one oversized skip

#### Scenario: A stop before the first entry resumes at the scope start

- **WHEN** the call deadline stops the walk before it reached an entry of the first scope
- **THEN** the result carries `complete: false` and a position cursor on the start of that scope
- **AND** a later call with that `cursor` starts at the first entry of that scope

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
after the cursor count. Each file that the walk takes counts toward a
configured file bound. A file that a `read` reject refuses is listed and not
examined, except on a Machine.

A position cursor names the last entry the walk reached. On resume, the walk
MUST list the entries before that entry and that entry itself, and it MUST NOT
open them. Those entries do not count toward a configured entry bound. The walk MUST
enter a directory that the entry names. It MUST NOT examine again the file
that the entry names. A position cursor on the start of a scope, as "Walks are
bounded" defines it, names no entry. The walk then lists nothing before the
first entry of that scope and examines that first entry.

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
for the call. An unset bound MUST travel as `null`, and the daemon then MUST
apply no such bound. The daemon MUST stay inside each bound that the request
sets. The request also carries whether the call progressed, and the response
carries whether the daemon walk progressed, as the unfinished-file
requirements define progress.

The request MUST give the daemon nine tenths of the time left to the call
deadline. The daemon answer then arrives before the API stops the request. The
API MUST stop the request at the call deadline.

The daemon MUST return passages, excluded directories, and an unfinished
file as paths relative to its display prefix only. The request also carries
the page budget that is left. The API MUST cut a daemon page that is larger
than that budget. The API MUST build the cursor from the last passage it
emitted, never from a daemon passage it dropped. The API MUST apply the `read`
group to each path that the daemon returns before the result names it.

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
- **THEN** the cursor names the last passage that the API emitted
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
- **THEN** the walk takes 3 files and stops with a `file_bound` warning and a `cursor`

### Requirement: Byte bounds count the bytes that the walk takes

`maxBytesRead` MUST count the bytes of each file that the walk takes in
canonical order. It MUST also count the bytes that the walk read so far of the
file that it waits on. Bytes of any other file that the walk read ahead MUST NOT count. The
walk MUST stop when the count reaches `maxBytesRead`. `maxFileBytes` MUST skip
a regular file as `oversized` when its size, or the bytes that the walk reads
from it, exceed the bound.

#### Scenario: A configured byte bound stops the walk

- **WHEN** `tools.grep.maxBytesRead` is 10 MiB and a scope holds 50 text files of 1 MiB each with no match
- **THEN** the walk takes 10 files and stops with a `byte_bound` warning and a `cursor`

#### Scenario: A file that grows past the file-size bound is skipped

- **WHEN** `tools.grep.maxFileBytes` is 1 MiB and a file is 900 KiB when the walk opens it and 2 MiB when the walk reads it
- **THEN** the file contributes no hit
- **AND** `warnings` counts one oversized skip

#### Scenario: A byte bound in the first file skips it

- **WHEN** `tools.grep.maxBytesRead` is 10 MiB and the first file of a scope is a 50 MiB text log with no match
- **THEN** the result names that log in `unfinishedFile` and carries a `byte_bound` warning
- **AND** a later call with the `cursor` starts after that log

### Requirement: The grep deadline derives from the tool call timeout

The walk MUST stop at the call deadline. The call deadline is the call start
plus the tool call timeout, minus a margin. The margin is the larger of 5
seconds and one tenth of the timeout, but at most half of it. Without a
timeout in the call context, the timeout is `tools.callTimeoutSeconds`. At the
call deadline, the result MUST carry the passages found so far,
`complete: false`, a `deadline` warning, and a `cursor`.

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

#### Scenario: A call without a timeout in its context uses the configured timeout

- **WHEN** a grep call runs with no timeout in its call context and `tools.callTimeoutSeconds` is 120
- **THEN** the call deadline is 108 seconds after the call starts

#### Scenario: A deadline with no match stays incomplete

- **WHEN** the call deadline stops the walk before any line matched
- **THEN** the result is `results: []` with `complete: false`, a `deadline` warning, and a `cursor`

### Requirement: A file is searched as a stream

The walk MUST search a regular file of any size when `maxFileBytes` is not
set. The walk MUST keep the passages of a file until it reaches the end of
that file. The file then gives its passages to the page. A skip that the walk
finds after a match MUST drop each passage of that file.

#### Scenario: A large log is searched

- **WHEN** no bound is configured and the last line of a 200 MiB text log matches
- **THEN** the result holds a passage of that line

#### Scenario: A late skip drops the passages

- **WHEN** line 10 of a file matches and a later line of that file is longer than 4 MiB
- **THEN** the file contributes no passage
- **AND** `warnings` counts one oversized skip

#### Scenario: A cut passage longer than a page loses no line

- **WHEN** a passage of a 200 MiB file spans 2,000 long lines, and the tool cuts it on two pages in a row
- **THEN** the third call emits the rest of that passage from the line after the second cut
- **AND** no line of that passage is missed or repeated

### Requirement: Reads run concurrently and keep canonical order

The walk MUST NOT have more than 8 files open for a match at the same time, or
more than a configured file bound leaves. When more candidates wait in
canonical order, the walk MUST have 8 files open, or as many as that bound
leaves. The page, the cursor, each bound, each skip count, and each excluded
directory MUST take effect in canonical order. A file opened ahead of a stop
MUST NOT count as reached.

#### Scenario: Eight reads are in flight

- **WHEN** a scope holds 20 candidates and each read waits until the test releases it
- **THEN** 8 reads are in flight at the same time, and no more

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

#### Scenario: Files before an entry bound are still searched

- **WHEN** the entry bound trips while three earlier candidates with no match are open
- **THEN** the walk takes those three files before it stops
- **AND** a later call with the `cursor` opens none of those three files

#### Scenario: A read refusal counts only for a taken file

- **WHEN** the `read` group refuses a file that the walk admitted ahead, and the call deadline stops the walk before it takes that file
- **THEN** the completion audit does not count that refusal

### Requirement: A stop in a file that blocks progress skips that file

The start point of a call is the entry that the cursor of the call names, or
the start of the first scope. A call progresses when it emits a passage, or
when it finishes an entry after its start point. The call deadline or the byte
bound can stop the walk in a file before the call progresses. Then the result
MUST name that file in `unfinishedFile`, and the next call MUST start after
that file.

#### Scenario: A file larger than one call is skipped

- **WHEN** a scope starts with a 3 GB log and the call deadline stops the walk in it
- **THEN** the result names that log in `unfinishedFile`
- **AND** a later call with the `cursor` starts after that log

#### Scenario: An explicit file scope that one call cannot finish is skipped

- **WHEN** the scopes are `/var/log/huge.log` and `/srv/app`, and the call deadline stops the walk in `huge.log`
- **THEN** the result names `/var/log/huge.log` in `unfinishedFile`
- **AND** a later call with the `cursor` starts at `/srv/app`

#### Scenario: An unfinished last file scope ends on the next call

- **WHEN** the only scope is `/var/log/huge.log` and the call deadline stops the walk in it
- **THEN** the result names it in `unfinishedFile` with `complete: false` and a `cursor`
- **AND** a later call with the `cursor` returns `results: []` and `complete: true`

#### Scenario: A cursor on the parent directory is no progress

- **WHEN** the cursor of the call names the directory `logs`, `logs/big.log` is the first entry in `logs`, and the call deadline stops the walk in it
- **THEN** the result names `logs/big.log` in `unfinishedFile`

#### Scenario: An unfinished Machine file scope is skipped

- **WHEN** the scope is `machine://build/var/log/huge.log` and the call deadline stops the daemon walk in it
- **THEN** the result names that locator in `unfinishedFile`
- **AND** a later call with the `cursor` does not open that file again

### Requirement: A stop after progress opens the file again

When the call progressed before a stop in a file, the result MUST NOT carry
`unfinishedFile`. A later call with the `cursor` MUST open that file again.
Each Machine request and each later scope MUST use the progress of the whole
call. When the `read` group refuses an unfinished file, the result MUST NOT
name it, and the next call MUST still start after that file.

#### Scenario: A stop after progress resumes at the file

- **WHEN** the call finished 40 files and the call deadline stops the walk in the forty-first
- **THEN** the result carries no `unfinishedFile`
- **AND** a later call with the `cursor` opens the forty-first file again

#### Scenario: Progress in an earlier scope counts

- **WHEN** a host scope finished 10 files and the call deadline then stops a Machine scope in its first file
- **THEN** the result carries no `unfinishedFile`
- **AND** a later call with the `cursor` opens that Machine file again

#### Scenario: An emitted passage is progress

- **WHEN** the call emits the rest of a cut passage of `a.log` and the call deadline then stops the walk in `b.log`
- **THEN** the result carries no `unfinishedFile`
- **AND** a later call with the `cursor` opens `b.log` again

#### Scenario: A refused unfinished file is not named

- **WHEN** the call deadline stops a Machine walk in its first file and the `read` group refuses that file
- **THEN** the result carries no `unfinishedFile`
- **AND** a later call with the `cursor` starts after that file

### Requirement: Ignore files from the scope and above it apply

A host or Machine walk MUST apply `.ignore` files from the filesystem root
down to each candidate. It MUST apply `.gitignore` files in the same way,
under the repository limit of the next requirement. On a Machine, the walk
starts at the registered root that holds the prefix. A deeper ignore file
outranks a shallower one. In one directory, `.ignore` outranks `.gitignore`.
The walk MUST NOT take either file as a candidate of a directory scope.

#### Scenario: A rule at the repository root applies to a narrower scope

- **WHEN** `/home/u/repo/.git` exists, `/home/u/repo/.gitignore` names `dist/`, and a scope is `/home/u/repo/apps`
- **THEN** the walk examines no file below `/home/u/repo/apps/web/dist`

#### Scenario: An ignore file outside a repository applies

- **WHEN** `/mnt/d/Projects/.ignore` names `.build-cache/` and a scope is `/mnt/d/Projects/Arduino`
- **THEN** the walk examines no file below `/mnt/d/Projects/Arduino/libraries/.build-cache`

#### Scenario: An ignore file is not searched

- **WHEN** `/home/u/repo/.ignore` contains a match and a scope is `/home/u/repo`
- **THEN** no passage names `/home/u/repo/.ignore`

### Requirement: A gitignore above the scope applies only in its repository

The repository directory is the nearest directory at or above the prefix that
holds a `.git` entry, a directory or a file. A `.gitignore` above the prefix
MUST apply only in the repository directory or below it. Without a repository
directory, the walk MUST NOT apply a `.gitignore` above the prefix. On a
Machine, the walk looks for it only up to the registered root, and without
one there, the registered root is the repository directory.

#### Scenario: A gitignore above the repository does not apply

- **WHEN** `/home/u/.gitignore` names `*.md`, `/home/u/repo/.git` exists, and a scope is `/home/u/repo`
- **THEN** the walk searches `/home/u/repo/README.md`

#### Scenario: A gitignore outside a repository does not apply above the scope

- **WHEN** `/mnt/d/Projects/.gitignore` names `*.md`, no `.git` exists at or above `/mnt/d/Projects/Arduino`, and that directory is the scope
- **THEN** the walk searches `/mnt/d/Projects/Arduino/README.md`

#### Scenario: A Machine repository above the registered root

- **WHEN** a Machine root is `/srv/app/packages`, `.git` is at `/srv/app`, `/srv/app/packages/.gitignore` names `dist/`, and a scope is `machine://build/srv/app/packages/api`
- **THEN** the daemon examines no file below `/srv/app/packages/api/dist`

### Requirement: An ignore rule decides an entry by its own path

The scope directory is the directory that the literal prefix of the scope
names. An ignore rule MUST NOT exclude the scope directory or a directory above
it. A rule MUST decide an entry only when its pattern matches the path of that
entry. A match on a directory above the entry MUST NOT decide it. In one ignore
file, the last rule that decides an entry wins.

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

#### Scenario: A nested ignored directory below an explicit scope is excluded

- **WHEN** `/home/u/repo/.gitignore` names `node_modules/` and a scope is `/home/u/repo/node_modules/react`
- **THEN** the walk examines no file below `/home/u/repo/node_modules/react/x/node_modules`

#### Scenario: An allow list keeps its files

- **WHEN** `/home/u/repo/.gitignore` names `*`, then `!*/`, then `!src/**`
- **THEN** the walk searches `/home/u/repo/src/a/b.js`
- **AND** it examines no `/home/u/repo/lib/c.js`

#### Scenario: A negated directory keeps the rule for its files

- **WHEN** `/home/u/repo/.gitignore` names `build*` and `!build-tools/`
- **THEN** the walk enters `/home/u/repo/build-tools`
- **AND** it examines no `/home/u/repo/build-tools/build.sh`

#### Scenario: A rule that matches a file directly still excludes it

- **WHEN** `/home/u/repo/.gitignore` names `docs/**` and then `!docs/keep/`
- **THEN** the walk enters `/home/u/repo/docs/keep`
- **AND** it examines no `/home/u/repo/docs/keep/a.md`

### Requirement: Excluded directories are reported

The walk MUST record each directory that an ignore rule excludes at or after
the start point of the call. It MUST NOT record a directory below an excluded
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

- **WHEN** a first page excluded `/home/u/repo/a/node_modules`, and a second call resumes from a position cursor on `/home/u/repo/b`
- **THEN** the second result does not count `/home/u/repo/a/node_modules`

### Requirement: The excluded-directory report is filtered and bounded

The `read` group MUST admit a directory locator both as written and with a
final separator before the result counts or names it. The walk MUST record at
most 1,000 excluded directories for one call, across every scope. When it
excludes more, `ignored.atLeast` MUST be `true`. The page MUST reserve room for
the `ignored` line and for the `unfinishedFile` line, so the tool loop never
cuts the result.

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

### Requirement: A reported directory locator is a valid scope

Each locator in `ignored.locators` MUST be a grep scope that names that one
directory. The tool MUST spell a literal `%`, `*`, `?`, `[`, `]`, `{`, or `}`
in it as `%25`, `%2A`, `%3F`, `%5B`, `%5D`, `%7B`, or `%7D`. These seven
spellings MUST name the literal character in the path part of every scope. The
tool MUST NOT refuse `%5B`, `%5D`, `%7B`, or `%7D` as glob operators.

#### Scenario: A reported directory with brackets can be scoped

- **WHEN** `node_modules/` excluded `/home/u/repo/app/[id]/node_modules`
- **THEN** `ignored.locators` holds `/home/u/repo/app/%5Bid%5D/node_modules`
- **AND** a later scope of that locator searches that directory

#### Scenario: A reported directory with a percent sign can be scoped

- **WHEN** `node_modules/` excluded `/home/u/repo/100%41/node_modules`
- **THEN** `ignored.locators` holds `/home/u/repo/100%2541/node_modules`
- **AND** a later scope of that locator searches `/home/u/repo/100%41/node_modules`

### Requirement: Host scopes decode the literal spellings

In a host scope, the tool MUST decode the seven literal spellings in the
literal prefix in one pass before the probe. It MUST NOT decode another percent
sequence. A Machine scope keeps the full decode of a `machine://` locator.
In both, the `grep` group and every all-fields rejection MUST see the prefix
that the walk probes. So an encoded path cannot hide from a reject.

#### Scenario: A host scope with an encoded asterisk names one directory

- **WHEN** a scope is `/home/u/repo/a%2Ab` and `/home/u/repo/a*b` is a directory
- **THEN** the walk searches `/home/u/repo/a*b`

#### Scenario: An encoded bracket does not pass a reject

- **WHEN** the `grep` group rejects the literal `/home/u/repo/app/[id]` and a scope is `/home/u/repo/app/%5Bid%5D`
- **THEN** the call is refused

#### Scenario: Another percent sequence stays text

- **WHEN** a scope is `/home/u/repo/100%41`
- **THEN** the tool probes the directory `/home/u/repo/100%41`

#### Scenario: A spelled percent decodes once

- **WHEN** a scope is `/home/u/repo/a%252A`
- **THEN** the tool probes the directory `/home/u/repo/a%2A`

#### Scenario: A Machine scope decodes on both sides

- **WHEN** the `grep` group rejects the literal `machine://build/srv/100A` and a scope is `machine://build/srv/100%41`
- **THEN** the call is refused
