# Spec Delta

## MODIFIED Requirements

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

The tool MUST keep the rendered model text of the whole result at or under
15,000 UTF-16 code units, as `tool-result-rendering` defines that text. The
continuation line, the `[warnings: …]` line, and the notice count. It MUST
emit whole passages in order while the next passage fits. When the
first passage of a page does not fit, the tool MUST cut that passage at a
line boundary and mark it `cut: true`. That passage ends the page. The
page MUST end before the budget, so the tool loop never cuts the result.

When the tool cuts a passage, the cursor MUST name that passage and its last
emitted line. A later call with that cursor MUST emit the rest of that
passage first. It MUST start at the line after the last emitted line. It
MUST repeat no line. It MUST then continue in canonical order.

A rest with no matched line is dropped, as the partition rule drops one. A
cut passage that is also the twentieth passage of its file carries
`truncated: true` beside its cut, and the twentieth rule holds after that
call emits its rest.

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
Those entries do not count toward the 20,000-entry bound. The walk MUST
descend a directory named by that entry. It MUST NOT examine the file named
by that entry again.

The entry that a position cursor names can be one that the `read` group
refused. The cursor names it only as the point to resume after. It never
names a passage of that entry.

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
- **AND** the 15,000 code units were measured on the rendered text, continuation line included

#### Scenario: A cut passage continues on the next call

- **WHEN** the first passage of a page does not fit and the tool cuts it at line 40
- **THEN** the cursor names that passage and line 40
- **AND** the next call emits the rest of that passage from line 41
- **AND** no line of that passage is repeated

#### Scenario: A position cursor names a refused entry

- **WHEN** a bound stops the walk on an entry that the `read` group refused and the page emitted no passage after it
- **THEN** the position cursor names that entry as the point to resume after
- **AND** the result holds no passage of that entry
- **AND** the next call does not count that entry toward the 20,000-entry bound

#### Scenario: A rest of context only is dropped

- **WHEN** the tool cuts a passage at line 40 and every line after line 40 is context
- **THEN** the next call emits no rest of that passage
- **AND** it starts at the next file in canonical order

#### Scenario: Each expansion of a bare scope takes its own ordinal

- **WHEN** `kb://` resolves to Spaces `a` and `b`, and `/home/u/repo/**` follows
- **THEN** the Spaces take ordinals 0 and 1, and the host scope takes ordinal 2
- **AND** the passage order and the cursor use those ordinals

#### Scenario: No match

- **WHEN** no line in any admitted file matches
- **THEN** the result is `results: []`, `complete: true`
- **AND** `warnings` still reports skipped files
