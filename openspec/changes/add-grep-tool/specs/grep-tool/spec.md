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
pattern.

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

### Requirement: A scope is a walkable locator with an optional glob

A scope MUST be one of these forms:

- an absolute host path,
- a relative host path, which the entered Workspace resolves with the
  Workspace path projection rule,
- `machine://<name><absolute path>`,
- `kb://`, which names every current Knowledge Space of the Run owner,
- `kb://<space-id>/<path>`,
- `skill://`, which names every package in the catalog,
- `skill://<name>` or `skill://<name>/<path>`.

The path part of a scope can contain the glob operators `*`, `**`, and `?`.
`*` and `?` MUST NOT match a path separator. `**` MUST match zero or more
path segments. A scope with no glob operator MUST name a directory or one
regular file. The tool searches a directory recursively. The scheme, the
Machine name, the Space identifier, and the skill name MUST NOT contain a
glob operator.

A scope MUST NOT carry a read selector. The tool MUST refuse these scopes as
`invalid_path` before admission:

- a `media://` scope,
- an `http://` or `https://` scope,
- a `file:` alias with a remote host,
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

### Requirement: Each scope is admitted against the grep group on its literal prefix

The tool MUST evaluate the `tools.permissions.grep` group once per scope,
before it opens any file. For that evaluation, the `scopes` field MUST hold
one string: the literal prefix of the scope. The literal prefix is the scope
without every segment from the first segment that contains a glob operator.
The prefix keeps its end separator when it names a directory.

The tool MUST first project a relative host scope through the Workspace path
projection rule. The tool MUST project a `kb://`, `skill://`, or
`machine://` scope with the same text-only projection that `read` applies to
that scheme. A clause then matches the same identity that a `read` of the
prefix matches.

An absent `grep` group MUST reject the call. When the group rejects any
scope, the tool MUST reject the whole call as `permission_denied` with the
decision provenance of the permission capability. The tool MUST NOT search
any scope of a rejected call. A bypassed Run MUST record bypass decisions as
the permission capability defines.

#### Scenario: Prefix of a glob scope is the matched identity

- **WHEN** the `grep` group allows `literal: "/home/u/repo/src/"` on `scopes` and a scope is `/home/u/repo/src/**/*.ts`
- **THEN** the call is admitted for that scope
- **AND** the clause saw `/home/u/repo/src/` and never saw a glob operator

#### Scenario: One refused scope refuses the call

- **WHEN** two scopes are submitted and a reject clause matches the second
- **THEN** the tool returns `permission_denied`
- **AND** no file beneath the first scope is opened

#### Scenario: A Knowledge scope matches on its logical identity

- **WHEN** a clause allows `kb://<id>/notes/` and the scope is `kb://<id>/notes/**`
- **THEN** the call is admitted
- **AND** no host path or configured root entered policy matching

### Requirement: Every hit is a locator that the read group admits

Before a file contributes a hit, the tool MUST evaluate the `read` group with
`path` set to the canonical locator of that file. The evaluation MUST use the
same projection that `read` applies. When the `read` evaluation is not an
allow, the file contributes nothing. The tool MUST NOT open, count, or name
that file in the result. An absent `read` group MUST make every file
contribute nothing. The tool MUST record each decision as a derived decision
of the `grep` call, with the decision provenance of the permission capability.

Every emitted `locator` MUST have the form
`<canonical file locator>:<start>-<end>` with a one-based inclusive line
range. The value is directly a valid `read` argument. A `kb://` hit MUST
carry the logical Knowledge locator. A `machine://` hit MUST carry the
Machine locator. No hit MUST carry a configured root or a Machine host path.

#### Scenario: A read reject hides a file beneath an admitted scope

- **WHEN** the `grep` group allows `/home/u/repo/` and the `read` group rejects `regex: "\\.env$"` on `path`
- **THEN** a grep over `/home/u/repo/**` never opens `/home/u/repo/.env`
- **AND** the result does not name `.env` and does not count it

#### Scenario: A hit is a valid read argument

- **WHEN** line 12 of `kb://<id>/notes/a.md` matches
- **THEN** the hit locator is `kb://<id>/notes/a.md:11-13`
- **AND** `read` of that locator returns those lines

#### Scenario: Another owner's Space contributes nothing

- **WHEN** a scope names a Space that belongs to another owner
- **THEN** the tool returns `knowledge_space_unavailable`
- **AND** no directory of that Space is probed

### Requirement: Walks are bounded and never follow links

For every scheme, the walk MUST obey these rules:

- The walk MUST NOT follow a symbolic link.
- The walk MUST skip a file with a NUL byte in its first 8 KiB.
- The walk MUST skip a file that is not valid UTF-8.
- The walk MUST skip a regular file larger than 1 MiB.
- The result MUST count each skip in a `warnings` entry by kind.
- The walk MUST stop after it examined 5,000 files.
- The walk MUST stop after it read 32 MiB across the call.

When a walk stops at a bound, the result MUST carry `complete: false` and a
`warnings` entry that names the bound.

A host or Machine walk MUST include hidden entries. It MUST NOT enter a
directory named `.git`. It MUST apply every `.gitignore` file between the
scope prefix and the candidate, with Git precedence. When a scope names one
exact file, the tool MUST search that file even when an ignore rule matches
it.

A Knowledge walk MUST keep the Knowledge filesystem rules: the walk refuses a
symbolic link at every component, and the path stays inside the resolved
Space. A skill walk MUST keep the agent-skills link semantics.

The call MUST stop after 30 seconds of wall time. It MUST then return the
passages found so far with `complete: false` and a `deadline` entry in
`warnings`.

#### Scenario: gitignored directory is not entered

- **WHEN** `/home/u/repo/.gitignore` names `node_modules/` and a scope is `/home/u/repo/**`
- **THEN** no file beneath `node_modules` is examined

#### Scenario: Explicit gitignored file is searched

- **WHEN** a scope is `/home/u/repo/dist/app.js` and `dist/` is gitignored
- **THEN** that file is searched

#### Scenario: Binary file is skipped and counted

- **WHEN** a candidate contains a NUL byte in its first 8 KiB
- **THEN** it contributes no hit
- **AND** `warnings` counts one binary skip

#### Scenario: File bound stops the walk

- **WHEN** a scope holds 6,000 candidate files
- **THEN** the walk stops at 5,000 examined files
- **AND** the result carries `complete: false` and a `warnings` entry that names the file bound

### Requirement: Matching is per logical line with a one-line window

The tool MUST split each file into logical lines with the native `read` line
rules: LF ends a line, CRLF is one delimiter, a lone CR stays text, and a
terminal delimiter makes no phantom line. The tool MUST test each line
unanchored against every compiled pattern. A matched line MUST produce a
window of that line plus at most one line before and one line after. The
tool MUST clip the window at the file ends.

Windows in one file that overlap or touch MUST merge into one passage. A
passage MUST span at most 2,000 lines. The tool MUST partition a longer
merged interval into adjacent passages of at most 2,000 lines. Each partition
MUST contain at least one matched line.

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

### Requirement: Results are ordered, bounded, and paged by a keyset cursor

The tool MUST order passages by submitted scope index, then by canonical file
locator in byte order, then by passage start line. One page MUST hold at most
`limit` files and at most 20 passages per file. A file with more than 20
passages MUST contribute its first 20 in order and a per-file
`truncated: true`. The whole result MUST stay under the 16,000 character
result cap of the tool loop.

When passages remain after a page, the result MUST carry `complete: false`
and an opaque keyset `cursor`. The cursor names the next passage by scope
index, file locator, and start line. A later call with that `cursor` and the
same `patterns`, `scopes`, `literal`, and `ignoreCase` MUST resume after that
passage. The tool MUST refuse a `cursor` submitted with different search
inputs as `invalid_input`. The tool MUST NOT store state between calls.

A result with no passage MUST return `results: []` and `complete: true`.

#### Scenario: Second page resumes after the cursor

- **WHEN** a first call returns 20 files and a `cursor`
- **THEN** a second call with that `cursor` returns the next files in the same order
- **AND** no file of the first page is repeated

#### Scenario: Cursor with changed patterns is refused

- **WHEN** a `cursor` from a call with `patterns: ["a"]` is submitted with `patterns: ["b"]`
- **THEN** the tool returns `invalid_input`

#### Scenario: No match

- **WHEN** no line in any admitted file matches
- **THEN** the result is `results: []`, `complete: true`
- **AND** `warnings` still reports skipped files

### Requirement: Scope backends fail closed per scheme

A host scope on a process without accepted native host authority MUST fail as
`executor_unavailable`. A `machine://` scope MUST run on the named Machine
through the `fs.grep` protocol method. The daemon MUST walk, match, and bound
the search locally under the rules of this capability. The daemon MUST return
passages that name Machine locators only. An unreachable or unknown Machine
MUST fail the call with the Machine failure results that `read` uses.

A `kb://` scope on a process without a configured Knowledge root MUST fail as
`knowledge_space_not_configured`. A `skill://` scope on a process with no
configured skill source MUST return no passage for that scope. A failure of
one scope MUST fail the whole call. A partial result MUST NOT hide a scope
that the tool did not search.

#### Scenario: Host scope without an executor

- **WHEN** a scope is `/srv/data/**` and the process has no accepted native host authority
- **THEN** the tool returns `executor_unavailable`

#### Scenario: Machine search runs on the Machine

- **WHEN** a scope is `machine://build/srv/app/**/*.go`
- **THEN** the daemon on `build` performs the walk and the match
- **AND** every hit locator starts with `machine://build/`

#### Scenario: Unknown Machine fails the call

- **WHEN** a scope names a Machine that is not configured
- **THEN** the tool returns the Machine not-found result that `read` uses
- **AND** no other scope of that call is searched

### Requirement: The tool is advertised when a backend can serve

The candidate resolver MUST admit `grep` when `tools.allowed` names it and
at least one backend can serve. A backend can serve when the process holds
accepted native host authority, a configured Knowledge root, a configured
skill source, or a configured Machine. With no backend, the tool MUST stay
unavailable. The tool MUST NOT record a `native.attempt` effect, because it
mutates nothing. The packaged description MUST be a complete template under
the tool-prompt-templates rules. `tools.grep` MUST be a true predicate when
the tool is admitted.

#### Scenario: Knowledge root alone admits grep

- **WHEN** `tools.allowed` names `grep`, no native executor is accepted, and a Knowledge root is configured
- **THEN** `grep` is advertised
- **AND** a host scope still fails as `executor_unavailable`

#### Scenario: No backend leaves grep unavailable

- **WHEN** `tools.allowed` names `grep` and the process has no executor, no Knowledge root, no skill source, and no Machine
- **THEN** `grep` is not advertised
