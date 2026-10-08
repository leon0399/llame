# native-file-tools

## Purpose

Provides one bounded native file interface for local coding and file-backed
Knowledge work, with exact edits, create-or-replace writes, selector-based
reads, and future source/type extensions behind one result shape.

Every permission-group evaluation this capability performs before opening a resource — a submitted or canonical local, `skill://`, `kb://`, or web locator, or a resolved web address — governs an attempt whose effective permission mode is `default`; a `bypass` attempt admits it without evaluating a permission group, as `tool-call-permissions` defines.

## Requirements

### Requirement: Native tools operate on absolute local regular files

The native `read`, `edit`, and `write` tools SHALL accept absolute local paths
and equivalent `file://` aliases and execute them with the trusted host
process's OS authority in this alpha capability, and SHALL accept `kb://`
locators under the Knowledge locator requirement. When a Workspace is entered,
`read`, `edit`, and `write` SHALL also accept relative local paths and resolve
them from the Workspace root using lexical path resolution like POSIX
`path.posix.resolve`, preserving a trailing separator; the executor SHALL
receive exactly the projected absolute string, including that trailing
separator. Projection SHALL NOT perform realpath resolution; symlinks inside
the projected path SHALL be followed by the OS as for any absolute path. For
this requirement, "relative" means a path not starting with `/` and without a
`scheme:` prefix recognized by the shared locator parser or the file-alias
classifier (case-insensitive `scheme://` and `file:` forms). An unknown scheme
SHALL remain `invalid_path` rather than being treated as a local path. `..` MAY
resolve outside that root. Without an entered Workspace, a relative local path
SHALL be refused with the existing `invalid_path` error. The file-alias
classifier SHALL run before Workspace-relative projection in native dispatch,
so every valid `file:` alias is absolute and is never resolved from the
Workspace root. Locator-scheme routing SHALL happen before local path
resolution, so `file:`, `kb://`, `skill://`, `http://`, and `https://` locators
remain under their scheme-specific authority and are not projected from the
Workspace root. A selector SHALL remain associated with the path part and
apply to the target resolved from that path. Results for Workspace-projected
local paths SHALL identify the projected absolute path actually used.
`read` SHALL additionally accept read-only skill locators under the Skill
locator requirement and read-only web locators under the Web locator
requirements. A file alias SHALL accept `file://<authority><absolute-path>` and
the RFC 8089 minimal form `file:<absolute-path>`; in these requirements a
`file://` alias means either form. One pure classifier SHALL recognize a
leading `file:` before any other scheme parsing, and both native dispatch and
permission projection SHALL use it. A locator beginning `file://` SHALL always
be the authority form, and the minimal form's path SHALL begin with exactly one
`/`. `file` and `localhost` SHALL be matched ASCII case-insensitively against
the raw, undecoded text. In the `//` form, the authority is the text between
`//` and the next `/`; it SHALL be empty or `localhost`, authority validation
SHALL precede the alias's other locator refusals, and a missing path after the
authority SHALL fail with `invalid_path`. An invalid alias SHALL fail with
`invalid_path` at dispatch, before the native executor check, and SHALL NOT
bind the Run; a valid alias then follows the absolute-path executor rules
below. The alias SHALL decode each percent escape once to bytes and strictly
decode the complete path as UTF-8, without lexical `.` or `..` normalization,
before native operation. A literal query, fragment, backslash, C0 control
character, or DEL, a malformed or non-UTF-8 escape, a percent-encoded `/`, or a
NUL SHALL fail with `invalid_path` before filesystem access. A literal space,
including a trailing space, SHALL remain part of the POSIX path. A trailing
selector after a valid file URL SHALL have the same meaning as it has after
the decoded host path. `%3A` SHALL decode to `:` and then follow host selector
rules after the literal-path probe; there is no escaped literal-colon form.
`file:///C:/x` SHALL denote `/C:/x`, and `file:///C|/x` SHALL denote
`/C|/x`, without drive handling; `file://C:/x` and `file://C|/x` SHALL be
refused as remote authorities. `file:///` SHALL denote the POSIX root. The
scheme of the `path` argument SHALL select the authority; no other argument or
persisted declaration field SHALL. A web locator SHALL be fetched by the API
process's own outbound HTTP and SHALL NOT require or bind a native executor
identity. `edit` and `write` SHALL operate only on regular files, and both
SHALL reject an `http://` or `https://` locator with `invalid_path` before any
request. `read` SHALL operate on regular files and directories, and a web
locator SHALL be governed by the Web locator requirements instead of by entry
kind; every other entry kind SHALL fail. A `read` that misses a regular file
SHALL offer bounded sibling-name suggestions from its existing parent directory
on every scheme that resolves a local directory, names only, with one bounded
directory read and bounded scoring work on the error path and none on success;
an absolute or Workspace-projected local-path miss SHALL follow a symbolic-link
parent exactly as the read itself follows links. A web locator SHALL NOT produce
sibling suggestions, because a failed web read has no directory to list. A
trailing path separator SHALL be accepted on a directory path and SHALL fail as
`not_found` on any other target; in a web locator a trailing separator SHALL
remain part of the URL and SHALL NOT be read as a directory request. A model
argument SHALL NOT select a different executor, owner, tenant, permission mode,
or remote authority. `edit` and `write` SHALL be advertised when the process
has accepted native host authority or has a configured Knowledge root. `read`
SHALL be eligible for advertisement whenever `tools.allowed` names it, because
skill and web locators need no host authority; that eligibility SHALL NOT admit
local host-path access, and an absolute local path or valid `file:` alias on a
process without accepted native authority SHALL fail closed with
`executor_unavailable` rather than resolving through a hosted, Knowledge, or
Sandbox path. A Run SHALL bind to the trusted native executor identity on its
first absolute local-path operation or Workspace-relative local-path operation
after projection, including a valid file alias, and SHALL remain bound to it;
a `kb://` or web operation SHALL NOT bind or require an executor identity; a
later reattachment to another executor SHALL fail closed rather than resolving
the physical path there. A successful `file://` result SHALL report the
decoded host path in `path`, not the submitted URL.

#### Scenario: Coding file is read by absolute path

- **WHEN** the model calls `read` with an existing absolute regular-file path
- **THEN** the native host reads that file using its OS authority
- **AND** the result identifies the absolute path and does not invent a Knowledge Space binding

#### Scenario: Absolute path without accepted native authority fails closed

- **WHEN** the process has a configured Knowledge root and no `tools.nativeExecutorId`, and the model calls `read` with an absolute path
- **THEN** the tool returns `executor_unavailable`
- **AND** it does not resolve the path through the Knowledge root or any other authority

#### Scenario: Missing or non-regular target fails

- **WHEN** `read`, `edit`, or `write` targets a missing entry, or a device, socket, FIFO, or other special entry
- **THEN** the tool returns a bounded structured error
- **AND** it does not follow a different path or invoke another executor

#### Scenario: A missed read suggests sibling names

- **WHEN** `read` targets a missing regular file, named without a trailing separator, whose parent directory exists, on any scheme that resolves a local directory
- **THEN** the `not_found` result also lists at most five entry names from that directory that score as plausible spellings of the requested name, as bare names without any path
- **AND** a miss with no plausible sibling, a trailing separator, or scoring work past its bound returns the bare `not_found`, and the suggestion list is never produced for `edit` or `write`

#### Scenario: A missed read under a missing parent says so

- **WHEN** `read` targets a path whose parent directory does not exist
- **THEN** the `not_found` result states that the parent directory is missing
- **AND** no entry of any other directory is listed

#### Scenario: Mutation on a directory fails

- **WHEN** `edit` or `write` targets an existing directory
- **THEN** the tool returns the `not_regular_file` error
- **AND** it does not create, rename, or modify any entry

#### Scenario: Trailing separator on a file fails

- **WHEN** `read` targets an existing regular file with a trailing path separator
- **THEN** the tool returns `not_found`
- **AND** it does not read the file

#### Scenario: Physical path is bound to one executor

- **WHEN** a later worker or host tries to continue a native Run with a different trusted executor identity
- **THEN** the native tool returns an executor-unavailable error
- **AND** it does not resolve the absolute path on the new host

#### Scenario: A web locator is read without host authority

- **WHEN** a process with neither accepted native host authority nor a configured Knowledge root allowlists `read`, and the model calls `read` with `https://example.test/guide`
- **THEN** `read` is advertised, the API process fetches the URL, and the page content is returned
- **AND** the read does not return `executor_unavailable` and binds no native executor identity, while an absolute path on the same process still returns `executor_unavailable` and `edit` and `write` are not advertised

#### Scenario: Mutation on a web locator fails before any request

- **WHEN** `edit` or `write` targets `https://example.test/guide`
- **THEN** the tool returns `invalid_path`
- **AND** no request is issued and no local entry is created, renamed, or modified

#### Scenario: A failed web read suggests no siblings

- **WHEN** `read` targets `https://example.test/missing` and the server answers 404
- **THEN** the error names the status and lists no sibling names
- **AND** no directory is read to produce suggestions

#### Scenario: A file URL reads the host file

- **WHEN** the model calls `read` with `file:///tmp/guide.md` and the equivalent `/tmp/guide.md` is an existing regular file
- **THEN** both calls use the trusted host executor and return the same file content and native read metadata
- **AND** the file URL result's `path` is `/tmp/guide.md`

#### Scenario: Localhost file authority is accepted

- **WHEN** the model calls `read` with `file://LOCALHOST/tmp/guide.md`
- **THEN** the locator is treated as the local host alias and reads `/tmp/guide.md`
- **AND** no remote authority is contacted

#### Scenario: A file URL selector follows host selector rules

- **WHEN** the model calls `read` with `file:///tmp/guide.md:10-12`
- **THEN** the file URL is decoded to `/tmp/guide.md` before native selector handling
- **AND** the result selects lines 10 through 12 with the same context, bounds, and range metadata as `/tmp/guide.md:10-12`

#### Scenario: A file URL mutation uses the host operation

- **WHEN** `edit` or `write` targets a valid `file:///tmp/guide.md` alias with accepted native host authority
- **THEN** the corresponding host mutation executes with the same fencing, serialization, validation, and result semantics as the absolute path
- **AND** the result identifies `/tmp/guide.md` rather than the submitted URL

#### Scenario: A remote file authority is refused before access

- **WHEN** `read`, `edit`, or `write` targets `file://other.example/tmp/guide.md`, `file://C:/x`, or `file://C|/x`
- **THEN** the tool returns `invalid_path` with `A file:// URL with a host other than localhost names another machine. Only this host's files are readable; write the absolute path instead.`
- **AND** it performs no filesystem probe, mutation, or network request

#### Scenario: Query or fragment on a file URL is refused

- **WHEN** `read`, `edit`, or `write` targets `file:///tmp/guide.md?version=1`, `file:///tmp/guide.md#section`, `file:///tmp/guide.md?`, or `file:///tmp/guide.md#`
- **THEN** the tool returns `invalid_path` before decoding or filesystem access
- **AND** it does not silently discard the query or fragment

#### Scenario: Encoded separator, NUL, or invalid UTF-8 is refused

- **WHEN** `read`, `edit`, or `write` targets a file URL containing a percent-encoded `/`, NUL, or non-UTF-8 escape, such as `file:///tmp/a%2Fb`, `file:///tmp/a%00b`, or `file:///tmp/%FF`
- **THEN** the tool returns `invalid_path` before filesystem access
- **AND** it does not decode the spelling into a different host path

#### Scenario: Unsafe literal file URL characters are refused

- **WHEN** a file URL contains a literal backslash, tab, line feed, carriage return, DEL, or another C0 control character
- **THEN** the tool returns `invalid_path` before decoding or filesystem access
- **AND** a literal trailing space remains accepted as part of the POSIX filename

#### Scenario: A file URL with no authority path is refused

- **WHEN** `read` targets `file://` or `file://localhost`
- **THEN** the tool returns `invalid_path`
- **AND** it does not read the root directory

#### Scenario: The file URL root is a directory

- **WHEN** `read` targets `file:///`
- **THEN** the native host returns the ordinary root directory listing under its existing directory bounds
- **AND** the result identifies `/`

#### Scenario: The minimal file URL form equals its host path

- **WHEN** the model calls `read` with `file:/tmp/guide.md`
- **THEN** it reads the same file and returns the same native metadata as `/tmp/guide.md`

#### Scenario: Workspace-relative local read resolves from the Workspace root

- **WHEN** the model reads `src/app.ts:2-4` with a Workspace entered at `/work/project`
- **THEN** the host reads `/work/project/src/app.ts` and applies selector `:2-4` to that file
- **AND** the result identifies `/work/project/src/app.ts` as the path used

#### Scenario: Workspace-relative path may resolve outside the root

- **WHEN** the model reads `../shared/data.json` with a Workspace entered at `/work/project`
- **THEN** the host reads `/work/shared/data.json`
- **AND** the result identifies `/work/shared/data.json` as the path used without treating the Workspace root as a confinement boundary

#### Scenario: Workspace projection preserves a trailing separator

- **WHEN** the model reads `app.ts/` with a Workspace entered at `/work/project`
- **THEN** lexical projection passes `/work/project/app.ts/` exactly to the host
- **AND** the regular-file target returns `not_found` without being read

#### Scenario: Unknown scheme is invalid

- **WHEN** the model calls `read` with `vault://notes/a.md` while a Workspace is entered
- **THEN** the tool returns `invalid_path`
- **AND** it does not treat the unknown-scheme value as a relative local path or probe a file

#### Scenario: Relative local paths are refused without a Workspace

- **WHEN** no Workspace is entered and `read`, `edit`, or `write` receives a relative local path
- **THEN** the tool returns the existing `invalid_path` error
- **AND** it does not read, create, or modify a local entry

#### Scenario: A file alias ignores the entered Workspace root

- **WHEN** the model calls `read` with `file:///etc/passwd` while a Workspace is entered at `/work/project`
- **THEN** the host resolves `/etc/passwd` as an absolute alias target
- **AND** it does not read `/work/project/etc/passwd`

#### Scenario: An invalid alias fails before executor availability

- **WHEN** a process without `tools.nativeExecutorId` calls `read` with `file://other.example/x` or `file:///a?`
- **THEN** the tool returns `invalid_path`
- **AND** it binds no Run executor and does not return `executor_unavailable`

#### Scenario: A file URL without an absolute path is invalid

- **WHEN** the model calls `read` with `file:x`
- **THEN** the tool returns `invalid_path`
- **AND** it does not treat `x` as a relative or host filename

#### Scenario: POSIX drive syntax is an ordinary path

- **WHEN** the model calls `read` with `file:///C:/x` or `file:///C|/x` on the POSIX host
- **THEN** the native target is `/C:/x` or `/C|/x` respectively
- **AND** no Windows drive-letter interpretation is applied

#### Scenario: A decoded colon follows host selector rules

- **WHEN** the model calls `read` with `file:///tmp/notes%3A10-12`
- **THEN** `%3A` decodes to `:` and the host literal-path probe runs before selector interpretation
- **AND** there is no escaped literal-colon spelling distinct from `/tmp/notes:10-12`

### Requirement: Skill locators provide live read-only package access

`read` SHALL accept `skill://<name>[:selector]` for a package's `SKILL.md`, `skill://<name>/<path>[:selector]` for supporting files, `skill://<name>/` for its directory, and `skill://` for the current bounded catalog. The catalog form SHALL support pagination through native directory range selectors, whose single range accepts the same members as any other read, `N-` and `-K` included, resolved against the catalog's entry count. Skill names SHALL follow the Agent Skills name grammar. Resource segments SHALL follow the Knowledge locator's once-only decoding, selector separation, size/depth, and traversal validation rules. Native directory/read/range/raw/truncation behavior SHALL apply except for the explicit catalog representation. `edit` and `write` SHALL reject skill locators as unsupported operations without effects.

The resolver SHALL re-evaluate the current winning package on each call through the catalog port. It SHALL take the current turn's explicit selection set as a parameter: a manual-only package's body or resource read SHALL return a bounded structured refusal naming explicit selection unless that set contains the package, and the catalog listing SHALL omit manual-only packages not in that set. The Run supplies the set derived from its triggering user message to every skill read it performs, model-initiated reads included; a caller with no turn context supplies an empty set. Symbolic links beneath a source or inside a package follow ordinary operating-system semantics as `agent-skills` specifies; the resolver SHALL NOT resolve, verify, or contain them for access. Missing/invalid packages, unsupported operations, and invalid resource paths SHALL return bounded structured errors. The resolver SHALL NOT read special files.

When a Workspace is entered, the resolver SHALL include live skill sources discovered beneath `<root>/.llame/skills`, `<root>/.agents/skills`, and `<root>/.claude/skills`. A missing, unreadable, non-directory, or over-limit Workspace skill directory SHALL contribute nothing and SHALL NOT make the operator catalog or discovery unavailable; Workspace sources SHALL NOT count toward the operator 32-source bound.

Results SHALL carry the logical locator, selected source, absolute `resolvedPath`, and absolute `skillDirectory`, both as discovered beneath the configured source rather than resolved real paths. A successful skill result SHALL carry an absolute real package directory in the field named `realSkillDirectory` when that directory differs from `skillDirectory`. The field SHALL be reserved before resource content exactly as the other envelope fields are; when the real directory cannot be resolved, the field SHALL be omitted and the read SHALL otherwise be unaffected. These discovered paths and, when present, `realSkillDirectory` SHALL be included in model-facing output and owner metadata. This rule applies to operator and Workspace skill sources. The `realSkillDirectory` field is disclosure-only: reads SHALL continue to open the discovered `resolvedPath`, package-relative references and script paths SHALL continue to resolve from the discovered `skillDirectory`, and the real directory SHALL neither replace those paths nor authorize access. The path instruction SHALL distinguish task-relative inputs and explicit `cwd` from package-relative paths; the tool SHALL NOT rewrite commands. The result bound SHALL reserve space for this envelope before truncating resource content; if the envelope cannot fit, the read SHALL fail with a bounded error. For Workspace sources, publication of `skillDirectory` and `resolvedPath` SHALL use the absolute paths discovered beneath `<root>/.llame/skills`, `<root>/.agents/skills`, or `<root>/.claude/skills`, rather than resolved real paths. Ordinary permission admission SHALL match a pure canonical projection of the submitted skill locator before any resource open: decode resource segments once, validate and re-encode through the shared locator grammar, and omit read selectors. It SHALL never substitute a physical path. Existing configured/default read rules SHALL apply to that projection, including credential-path rejects; no skill-specific permission bypass or duplicate deny list SHALL be introduced.

#### Scenario: Skill resource exposes the execution base

- **WHEN** the model reads `skill://pdf/scripts/extract.py` and the real package directory differs from the discovered `skillDirectory`
- **THEN** the result includes the current script content and model-visible discovered file and package paths, plus `realSkillDirectory` naming the real package directory
- **AND** no script executes during the read

#### Scenario: Skill root and directory differ

- **WHEN** the model reads `skill://pdf` and then `skill://pdf/`
- **THEN** the first reads `SKILL.md` and the second lists the package directory

#### Scenario: Raw root read returns the instructions verbatim

- **WHEN** the model reads `skill://pdf:raw`
- **THEN** the result carries the current `SKILL.md` bytes without line-number prefixes
- **AND** the skill result envelope with `skillDirectory` and `resolvedPath` is still present

#### Scenario: Manual-only package is not selected this turn

- **WHEN** a read targets `skill://review` and `review` is manual-only and absent from the turn's selection set
- **THEN** the read returns a bounded refusal naming explicit selection without opening the file
- **AND** `skill://` does not list `review`

#### Scenario: Special-file resource link fails

- **WHEN** a resource symlink resolves to a special file rather than a regular file or directory
- **THEN** the read fails `not_regular_file` without opening the target, because the followed target's kind is checked before any open

#### Scenario: Mutation is unsupported

- **WHEN** an edit or write targets `skill://pdf/SKILL.md`
- **THEN** it returns an unsupported-operation error without a mutation attempt or filesystem effect

#### Scenario: Workspace skill source publishes discovered paths

- **WHEN** the model reads `skill://pdf/scripts/extract.py` from a package discovered under `/work/project/.llame/skills/pdf` with a Workspace entered at `/work/project`, and the real package directory differs from the discovered `skillDirectory`
- **THEN** the result includes the script content, model-visible discovered `resolvedPath` and `skillDirectory`, and `realSkillDirectory` naming the real package directory
- **AND** no script executes during the read

### Requirement: Skill permission matching uses canonical resource identity

The same file permission rules SHALL inspect literal and encoded spellings of one skill resource as the same canonical locator before the resource is opened. Operator replacement policies SHALL retain their existing override semantics.

#### Scenario: Default credential rejects cover skill resources

- **WHEN** the built-in read policy is active and a call targets `skill://pdf/.env`, `skill://pdf/%2eenv:raw`, or `skill://pdf/.ssh/id_ed25519`
- **THEN** permission admission denies the read before any resource open
- **AND** an ordinary `skill://pdf/references/guide.md` is not rejected by those credential-path clauses

### Requirement: Read selectors and context are deterministic

`read` SHALL accept trailing one-based inclusive range members `N`, `N-M`,
`N+K`, `N-`, and `-K`, wherever a member is accepted: a bare single member
such as `:N-M`, a comma-separated list under the multi-range requirement
below, a `raw:` list, and the one optional source range after
`outline` below, together with
`:raw`. The five members are one set: a `raw:` list accepts every member a
bare list accepts, `N+K` included. `N-` is the single line `N` through the
source's last line and `-K` is
its last `K` lines. A `:<list>:raw` selector and the same list after `raw:`
SHALL be one read on every source: the shape gate every source validates
against admits both spellings, the applier reads them as the same `raw:`
list, and the canonical spelling is
the `raw:` one. A host or web split that finds a trailing `:raw` takes the
colon segment before it as the list only when that segment has the member-list
shape; any other segment stays on the path, so `notes:draft:raw` remains the
raw read of `notes:draft`, while `2024:10:raw` becomes line 10 of `2024` raw
and a literal file named `2024:10` is read raw only as `2024:10:raw:1-N`. It SHALL also accept the `outline`
representation member with at most one optional source range, `:outline`,
`:outline:N`, `:outline:N-M`, `:outline:N+K`, `:outline:N-`, or `:outline:-K`,
under the representation requirements below; a comma-separated list after
`outline` is outside the grammar and SHALL fail with `invalid_selector`. A
valid selector SHALL be normalized once to
internal zero-based ranges. A trailing suffix that splits off a locator which
itself parses and lies outside the grammar SHALL fail with `invalid_selector`
on every source, with one message that names the working forms — `:N`,
`:N-M`, `:N+K`, `:N-`, `:-K`, comma lists of them, `:raw`, `:raw:<list>`,
and `:outline` with one member — and, on a source that has an encoded
spelling for a literal colon (a `kb://` or `skill://` resource path, and
web), the `%3A` spelling of the
same locator after the forms; a malformed locator
part remains `invalid_path`. The tool SHALL recognize a `scheme://` prefix before
splitting a trailing selector, so a scheme's own colon is never read as a
selector. For absolute paths, existing literal paths SHALL take precedence over
selector parsing, and after that literal probe an `:outline` form SHALL be
recognized after the `:raw` form and before the last-colon numeric fallback; a
`kb://` path component SHALL NOT contain `:`, so the split is
unambiguous without probing, and its selector SHALL be validated as a numeric
form or as one of the `raw` and `outline` members, as SHALL a `skill://`
selector. A web locator SHALL recognize the `:outline` form before its
last-colon fallback while preserving its path, query, fragment, and port
rules. A `path` that begins with a `scheme://` prefix the
SHALL NOT be treated as a relative or literal filename. For regular-file reads, ordinary single bounded ranges SHALL include
one preceding and one following source line (context lines) when available, and the extended
lines SHALL appear in the same `content` block as the requested lines.

Members are resolved against the source's count before any of the shipped rules
run, and those rules then apply to the resolved absolute ranges: `N-` resolves
to `N..count` and `-K` to `max(1, count-K+1)..count`. That count is the line
count of a regular file on host, `file://`, `kb://`, or `skill://`, obtained
by counting the file's lines before the ordinary read whenever a selector
carries an `N-` or `-K` member, after the source is admitted and found to be a
regular file; the rendered line count of a web document; the
requested-level entry count of a directory listing; or the entry count of the
skill catalog. `requestedRange` and `requestedRanges` SHALL report the resolved
absolute lines, which are the coordinates this read observed rather than a
snapshot of the source. A `-K` with `K` greater than the count SHALL resolve to
`1..count` and `-0` SHALL fail with `invalid_selector`. An `N-` whose `N`
lies past the last line resolves to an empty member. On a nonempty regular file
or web render, that member fails with `invalid_selector` when it is the first
requested start of the sorted members; when it is later, it is dropped before
merging and context expansion, so it emits nothing, adds no context line, and
appears in neither `requestedRanges` nor `shownRanges`. A comma list whose
members all resolve empty fails as a start past the last line on a nonempty
regular file or web render. On an empty regular file or web render, `-K` and
`1-` return the shipped empty result (the start-past-EOF rule does not apply to
a source with no last line at offset 0); any other `N-` fails as a start past
the last line when it is the first requested start of the sorted members, so a
comma list that starts at line 1, such as `:1-,2-`, returns empty plural ranges
as the multi-range rule states. On a listing or the catalog, an `N-` past the end returns the
empty page those sources return today; an empty listing or catalog keeps its
empty page for every member.

For an ordinary ranged read of a `text/markdown` source, `content` SHALL also prepend the direct ancestor heading lines for the passage's first requested line, as specified by the ranged Markdown ancestor requirement.
For single-range reads, result
details SHALL identify requested and shown ranges, representation, path, and
common truncation state. For an `outline` result, `content` SHALL consist of
verbatim source lines carrying the ordinary line-number prefixes, chosen by the
Markdown outline requirements rather than by contiguity, with no context
lines; requested bounds are the outline's source scope and shown bounds are
the first and last emitted source lines. Requested bounds SHALL remain the normalized request
even when the displayed source ends earlier; shown bounds SHALL describe only
emitted source lines. Empty files SHALL return null ranges. `nextOffset` SHALL
identify the next requested source line; for a truncated outline it SHALL
identify the source line of the first omitted entry. Raw reads SHALL return verbatim
selected source content without generated line prefixes, context expansion, or
processors. `:outline:raw` and `:raw:outline` are not representation members:
host and web keep their raw interpretation of `:outline:raw` as a path or URL
ending in `:outline`, because their split recognizes the trailing `:raw` first
and leaves `:outline` on the path, while `kb://` and `skill://`, which split
once at the first colon, return `invalid_selector` for
`:outline:raw`, and any source given `:raw:outline`, whose remainder is outside
the grammar, returns `invalid_selector`. Directory reads SHALL apply single-range selectors to listing entries under the
directory listing requirements and SHALL NOT add context lines; an outline
request on a directory SHALL fail under the representation requirements rather
than reinterpret listing text.

#### Scenario: Bounded read includes live adjacent lines

- **WHEN** the model reads lines 11 through 13 of a file with lines on both sides
- **THEN** content contains lines 10 through 14 in source order
- **AND** details identify requested range 11..13 and shown range 10..14

#### Scenario: Boundary range omits unavailable context

- **WHEN** a read starts at line 1 or ends at the file's last line
- **THEN** it omits the unavailable preceding or following context line
- **AND** it does not synthesize a blank source line

#### Scenario: Raw read is verbatim

- **WHEN** the model calls `read` with the `:raw` selector
- **THEN** the result contains the selected source bytes without line prefixes or generated helpers
- **AND** the result remains subject to the common output bounds, including the shared 2,000-line read ceiling

#### Scenario: Truncated result reports the shown range

- **WHEN** the common result limit prevents the complete requested/context range from fitting
- **THEN** the tool returns the ordinary truncation metadata and the content prefix it can fit
- **AND** it does not claim that omitted lines were observed

#### Scenario: Unknown scheme fails closed

- **WHEN** the model calls `read`, `edit`, or `write` with a path such as `vault://notes/a.md`
- **THEN** the tool returns `invalid_path`
- **AND** no file named `vault:` or `vault://notes/a.md` is read, created, or modified

#### Scenario: Directory range has no context lines

- **WHEN** the model reads a directory path with a range selector
- **THEN** content contains only the header line and the selected listing entries
- **AND** no entry outside the selected range is emitted

#### Scenario: Outline selector is recognized before the numeric fallback

- **WHEN** no file named `/docs/guide.md:outline:10-40` exists and the model reads `/docs/guide.md:outline:10-40`
- **THEN** the read is the outline of `/docs/guide.md` scoped to source lines 10 through 40
- **AND** `/docs/guide.md:outline:raw` remains the shipped raw read of a path ending in `:outline`, while `/docs/guide.md:outline:1,3` fails with `invalid_selector`

#### Scenario: A tail member reads the last lines of a file

- **WHEN** the model reads `:-20` of a 500-line file
- **THEN** the result requests lines 481 through 500 and applies the ordinary context, truncation, and `nextOffset` rules to them
- **AND** the same read spelled `:raw:-20` returns those twenty lines verbatim

#### Scenario: An open-ended member runs to the last line

- **WHEN** the model reads `:50-` of a 3,000-line file of short lines
- **THEN** the requested range is 50 through 3,000 rather than an open-ended window
- **AND** the result is cut at the shared 2,000-line ceiling with the ordinary `nextOffset`

#### Scenario: A tail member larger than the file clips to the first line

- **WHEN** the model reads `:-50` of a 10-line file
- **THEN** the result requests lines 1 through 10, because `-K` resolves to `1..count` instead of failing

#### Scenario: A zero tail is refused

- **WHEN** the model reads `:-0`
- **THEN** the tool returns `invalid_selector` without opening the source

#### Scenario: Both raw orders are the same read

- **WHEN** the model reads `guide.md:raw:60-64` and `guide.md:60-64:raw` of the same file, or `kb://<id>/guide.md:60-64:raw` and `skill://<name>:60-64:raw`
- **THEN** each pair returns lines 60 through 64 verbatim with the same range metadata, because the shape gate every source validates against admits both spellings
- **AND** a file literally named `guide.md:60-64:raw` still wins the host literal-path probe, while `notes:draft:raw` stays the raw read of `notes:draft` because `draft` has no member-list shape

#### Scenario: A malformed suffix names the working forms on every source

- **WHEN** the model reads `kb://<id>/notes/a:b.md`, whose split-off suffix `b.md` lies outside the grammar
- **THEN** the tool returns `invalid_selector` with the one message that names the working forms, followed on a `kb://` or `skill://` resource path by the `%3A` spelling, here `kb://<id>/notes/a%3Ab.md`
- **AND** a malformed locator part, such as an undecodable segment, remains `invalid_path`

#### Scenario: A listing and the catalog read their tails

- **WHEN** the model reads `/var/log/:-20` and `skill://:-10`
- **THEN** the directory read returns the last twenty entries of its requested level and the catalog read the last ten entries of its count, as its single range
- **AND** neither adds context lines

### Requirement: Reads through symbolic links report the real path

When a file `read` on an absolute host path opens a file whose canonical absolute path differs from the normalized path as given, because the path or any component of it is a symbolic link, the result SHALL carry that canonical path as `realPath`. A directory listing SHALL NOT carry `realPath`; its header is the path as given and its link entries carry their own targets. The header and line numbering SHALL remain those of the path as given; `realPath` SHALL count against the result bound like every other result field and SHALL be present before the result is measured, SHALL be absent when the two paths are equal, and SHALL be omitted with the read otherwise unaffected when the canonical path cannot be resolved. `kb://` and `skill://` reads SHALL NOT carry `realPath`. A `skill://` result SHALL instead carry the real package directory as `realSkillDirectory` in its envelope when it differs from `skillDirectory`, reserved before content exactly as the other envelope fields are; when the real directory cannot be resolved the field is omitted and the read is otherwise unaffected.

#### Scenario: File read through a linked directory

- **WHEN** the model reads `/home/u/.agents/skills/octocat/SKILL.md` and `octocat` is a symbolic link to `/home/u/dotfiles/skills/octocat`
- **THEN** content and header are exactly those of the path as given
- **AND** the result carries `realPath: /home/u/dotfiles/skills/octocat/SKILL.md`, counted within the result bound

#### Scenario: Ordinary read carries no real path

- **WHEN** the model reads a file whose normalized path contains no symbolic link, including one written with `..` segments
- **THEN** the result carries no `realPath`

#### Scenario: Skill result names both directories

- **WHEN** the model reads `skill://octocat` and the package is a symbolic link beneath its configured source
- **THEN** `skillDirectory` is the link path beneath the source
- **AND** the envelope also carries `realSkillDirectory` with the real package directory

### Requirement: Multi-range reads return context-bounded intervals

A regular-file `read` SHALL accept two or more comma-separated `N`, `N-M`,
`N+K`, `N-`, or `-K` members, or `raw:` followed by two or more comma-separated
`N`, `N-M`, `N+K`, `N-`, or `-K` members. `N-` and `-K` are resolved against
the file's line count before the sort and merge below, exactly as a bare selector
resolves them. A resolved empty `N-` member is dropped when it is a later
requested start; on a nonempty file, it fails with `invalid_selector` when it is
the first requested start, including when all members of a comma list resolve
empty.
Every bound SHALL satisfy the existing positive safe-integer rules. Invalid
bounds and more than 64 input ranges SHALL fail with `invalid_selector`. Empty
members, whitespace, or malformed members SHALL fail the whole request with
`invalid_selector` on every source.
The tool SHALL sort ranges by start, merge overlapping or adjacent ranges,
expand each merged interval by one preceding and one following source line
when available, clip the expansion to the file bounds, and merge expanded
intervals that overlap or sit adjacent. Raw multi-range requests SHALL NOT
expand context. A comma-separated request SHALL report plural range fields
even if normalization and expansion leave one interval.

For a non-raw, non-outline Markdown source, each merged expanded passage SHALL
also prepend its ancestor headings as specified by the ranged Markdown ancestor
requirement.

Absolute literal-path precedence and scheme-specific authorization SHALL apply
before reading as for existing selectors. Directory comma selectors SHALL fail
with `invalid_selector`; ordinary directory selectors SHALL remain unchanged.

Multi-range results SHALL replace singular `requestedRange` and `shownRange`
with `requestedRanges` and `shownRanges`, arrays of one-based inclusive
`{startLine, endLine}` intervals. `requestedRanges` SHALL retain the merged
pre-expansion request; `shownRanges` SHALL describe only emitted lines,
including expansion. Content SHALL concatenate selected source lines in source
order, using existing numbered rendering or verbatim raw rendering, without gap
markers. `representation`, `path`, and `truncated` SHALL retain their existing
meanings. On reaching EOF, shown ends SHALL clip to available source and later
ranges SHALL emit nothing; EOF alone SHALL NOT indicate truncation. A nonempty
file whose first requested start exceeds EOF SHALL fail with
`invalid_selector`. On a nonempty file, a comma list whose members all resolve
empty SHALL fail as a start past the last line. On an empty file, an all-empty
comma list whose first requested start is line 1 SHALL return empty content and
empty plural range arrays; a later first start SHALL fail. An empty file
starting at line 1 SHALL return empty content and empty arrays; other starts
SHALL fail.

The existing serialized-result cap, including metadata and the authority's
envelope, and shared 2,000-line ceiling SHALL apply once to the entire result.
If the required metadata cannot fit, the call SHALL fail with `invalid_selector`.
The tool SHALL return a prefix of expanded ranges, favoring whole ranges:
after emitting one complete range, a subsequent range that cannot fit SHALL be
omitted in full and end the read. If the first range cannot fit, the tool SHALL
emit the complete source lines from its prefix that fit. An individually
oversized line SHALL be omitted and skipped without ending the read: the tool reports truncation and continues past it.
A truncated result's zero-based `nextOffset`, when present, SHALL identify the
first remaining selected line, skipping gaps and an individually oversized
line that cannot fit on retry. It SHALL be absent when no selected line remains.
A caller SHALL resume by trimming `requestedRanges` at `nextOffset + 1` and
re-running sort, merge, and expansion on the trimmed request, rather than
reading a continuous interval through gaps. Context lines MAY reappear across
retries, as in single-range continuations. Single-range continuation SHALL
remain unchanged, and single-range result fields remain singular unless the
ranged Markdown ancestor rule promotes them.

#### Scenario: Touching expansions merge into one block

- **WHEN** a file read requests `:4-5,7-8`
- **THEN** the expansions 3..6 and 6..9 merge and content contains lines 3 through 9 exactly once
- **AND** requested ranges remain 4..5 and 7..8

#### Scenario: Unsorted overlapping ranges become one context-bounded block

- **WHEN** a file read requests `:20-30,5-10,10+10`
- **THEN** it merges the request to 5..30 and emits lines 4 through 31 exactly once, subject to file bounds
- **AND** requested ranges contain the interval 5..30 and shown ranges contain 4..31 when they fit

#### Scenario: Disjoint windows stay separate and raw reads stay verbatim

- **WHEN** a file read requests `:5-10,20-30` or `:raw:5-10,20-30`
- **THEN** the numbered read emits 4..11 and 19..31 as two shown ranges
- **AND** raw content has only lines 5..10 and 20..30 verbatim with no generated prefixes, context, or gap markers

#### Scenario: Later range waits for continuation

- **WHEN** `:5-10,20-30` fits the first expanded range but not all of the second
- **THEN** it emits only lines 4..11, reports truncation and `nextOffset: 18`
- **AND** a retry that trims `requestedRanges` at 19 reads `:20-30` with fresh expansion

#### Scenario: First range exceeds the line ceiling

- **WHEN** `:1-2500,4000-4010` targets a sufficiently long file with short lines
- **THEN** it emits lines 1..2000, reports truncation and `nextOffset: 2000`
- **AND** the remaining request is `:2001-2500,4000-4010`

#### Scenario: The line ceiling is shared across ranges

- **WHEN** `:1-1499,3000-4500` targets a sufficiently long file with short lines
- **THEN** it emits only lines 1..1500 because the second whole expanded range exceeds the remaining 500-line budget
- **AND** it reports truncation and `nextOffset: 2998`; a retry reads `:3000-4500`

#### Scenario: EOF limits shown ranges only

- **WHEN** a 25-line file is read with `:5-10,20-30,40-50` and output fits
- **THEN** requested ranges remain 5..10, 20..30, 40..50 and shown ranges are 4..11 and 19..25
- **AND** the result is not truncated and has no continuation

#### Scenario: First start past EOF fails despite context

- **WHEN** a 5-line file is read with `:6-7,20-25`
- **THEN** the tool returns `invalid_selector`
- **AND** no context line is emitted

#### Scenario: Expansion clips at the first line

- **WHEN** a file read requests `:1-2,5-6`
- **THEN** the expansions 1..3 and 4..7 merge and content contains lines 1 through 7 exactly once
- **AND** no line before line 1 is synthesized

#### Scenario: Invalid member rejects the request

- **WHEN** a nonliteral host read selector is `:5-10,,20-30`, `:5-10,0-2`, or contains 65 ranges
- **THEN** the tool returns `invalid_selector` without returning any selected content
- **AND** a malformed `kb://` suffix such as `:5-10,,20-30` returns `invalid_selector` like a host selector, because the locator before the suffix parses

#### Scenario: Literal filename wins

- **WHEN** `/tmp/report:5-10,20-30` exists as a regular file and is read
- **THEN** it is read as the literal filename without applying ranges

#### Scenario: Resolved tail and open-ended members join one request

- **WHEN** a 40-line file is read with `:1-5,-20` or `:raw:1-5,30-`
- **THEN** the members resolve to 1..5 and 21..40, or to 1..5 and 30..40, and the shipped sort, merge, and context expansion run on the resolved ranges
- **AND** the raw form emits only the resolved lines verbatim, without context, gap markers, or prefixes

#### Scenario: An empty all-empty comma request retains plural fields

- **WHEN** an empty regular file is read with `:1-,2-`
- **THEN** the read succeeds with empty content, `requestedRanges: []`, and `shownRanges: []`
- **AND** `truncated` is false

### Requirement: Directory reads return a deterministic bounded listing

When `read` targets an existing directory without a range selector, it SHALL
return a listing of that directory and its immediate child directories'
entries, two levels deep. The first content line SHALL be the header: the
directory path as given by the caller. The header SHALL NOT count as a listing
entry. Each entry SHALL be rendered on its own line, indented two spaces per
level below the requested directory, as `- name/` for a directory, `- name` for
a regular file, `- name@/ -> <target>` for a symbolic link whose target is a directory,
`- name@ -> <target>` for a symbolic link whose target is a regular file,
`- name@? -> <link text>` for a symbolic link that is dangling or resolves to
a special entry, and `- name?` for any other entry kind such as a FIFO, socket,
or device. `<target>` SHALL be the canonical absolute path the link resolves
to, so that a model without shell access learns where a link leads; a
dangling link SHALL show its raw link text because it cannot resolve, and a
link whose link text cannot be read either SHALL render as the bare
`- name@`. A
`kb://` listing SHALL render every symbolic link as the bare `- name@` with no
target kind and no target, because a Knowledge result exposes no resolved host
path. Rendering a link SHALL read its metadata and target path only, SHALL do
so only for the entries the listing assembles (the requested level or the
requested slice of it, and the capped head of each child directory), and
SHALL NOT open it. Symbolic links
found as entries SHALL NOT be descended whatever their target kind, and
special entries SHALL NOT be opened or followed. A link whose target is a
directory SHALL order among non-directory entries by name, as a link does
today. A symbolic link given as the
target path SHALL resolve to its target directory as file reads resolve today.
Entries below the second level SHALL be counted but never rendered. A directory
with no entries SHALL render `(empty directory)` as its only line after the
header. Within one directory, entries SHALL be ordered with directories first
and then by name under the runtime's default `localeCompare`. Entries SHALL be shown verbatim:
hidden entries, ignore files, and entry metadata other than a link's target
kind and target SHALL NOT alter the listing in this iteration. The listing
SHALL be a pure function of entry names, kinds, counts, link target kinds and
targets, and that comparator, so two reads of a directory whose entries and
link targets are unchanged on one host produce identical content. The comparator resolves against the runtime's
default locale, so ordering is stable per host rather than defined across
hosts. Result details SHALL identify the path and the
directory kind, and listing lines SHALL carry no generated line-number
prefixes.

#### Scenario: Vault structure is listed in one read

- **WHEN** the model reads a directory containing files, subdirectories, and a symbolic link
- **THEN** content starts with the header, lists directories before files at each level, renders each child directory's entries indented beneath it, and marks the symbolic link with `@`, its target kind, and its canonical target without listing anything beneath it

#### Scenario: Special entry is marked and never opened

- **WHEN** the model reads a directory containing a FIFO
- **THEN** the FIFO appears as `- name?` in order among the files
- **AND** the read completes without opening it

#### Scenario: Symbolic link target is listed

- **WHEN** the model reads a path that is a symbolic link to a directory
- **THEN** the result lists the target directory's entries
- **AND** the header is the path as given

#### Scenario: Empty directory

- **WHEN** the model reads a directory with no entries
- **THEN** content is the header followed by `(empty directory)`

#### Scenario: Listing is deterministic

- **WHEN** the model reads the same unchanged directory twice
- **THEN** both results have byte-identical content and details

#### Scenario: Linked package directory shows where it leads

- **WHEN** the model reads a directory containing `octocat`, a symbolic link to a directory elsewhere on the host, and `herdr`, a symbolic link whose target no longer exists
- **THEN** the listing renders `- octocat@/ -> <canonical target directory>` and `- herdr@? -> <raw link text>`
- **AND** neither link is descended or opened

#### Scenario: Knowledge listing shows a link without its target

- **WHEN** the model lists a `kb://` directory containing a symbolic link
- **THEN** the link renders as `- name@` with no target kind and no target
- **AND** the read of that link still fails `not_found`

#### Scenario: Link rendering is deterministic and unaffected by siblings

- **WHEN** an entry is added beside a symbolic link and the directory is read again
- **THEN** the link's line is byte-identical to the previous read
- **AND** the entry order rule is unchanged

### Requirement: Directory listing bounds favor the requested level

Each directory read for a listing, requested or child, SHALL retain at most
10,000 entry names for ordering while continuing to count entries beyond that
budget. A requested directory over the budget SHALL fail closed with a
`directory_too_large` error that states the count and no listing. A child
directory over the budget SHALL render only its `- name/` line followed by an
indented `… N entries` line with the exact count. Within that budget, the
requested directory's own entries SHALL NOT be capped by a per-level limit.
Each child directory SHALL render at most 20 entries in order, followed by one
`… N more` line stating the number of omitted entries when any were omitted.
When the rendered two-level listing exceeds the common native result cap, the
tool SHALL replace whole child blocks, last-first, where a child block is every
line rendered beneath one child directory including its `… N more` line, with
one indented `… N entries` line stating that child's total entry count; the
requested level's own lines SHALL be preserved by that step. An empty child
directory SHALL render as its `- name/` line alone, so a bare child line means
empty and an `… N entries` line means elided. The `… N entries` markers count toward the size of the requested level for
the next step but SHALL NOT occupy entry index positions. Only when the
requested level's entries and their markers still exceed the cap SHALL the tool
apply the ordinary truncation metadata over the requested-level entries in
order, each marker travelling with the entry it hangs from; `nextOffset` SHALL
identify the next requested-level entry index that was not emitted.
A range selector on a directory path SHALL switch the read to a flat listing of
the requested level: the header, then the selected entries by one-based entry
index, with no child entries and no context expansion, regardless of whether
the two-level listing would have fit. `nextOffset` SHALL identify the next
entry index of the requested level. The `:raw` selector on a directory SHALL
fail with a selector error.

#### Scenario: Requested directory over the traversal budget fails closed

- **WHEN** the model reads a directory holding more than 10,000 entries
- **THEN** the tool returns `directory_too_large` with the entry count
- **AND** it emits no listing

#### Scenario: Child directory over the traversal budget is elided

- **WHEN** a child directory holds more than 10,000 entries
- **THEN** the listing shows that child's `- name/` line followed by `… N entries` with the exact count
- **AND** no entry of that child is rendered

#### Scenario: Large child directory is summarized

- **WHEN** a child directory holds more than 20 entries
- **THEN** the listing shows its first 20 entries in order followed by `… N more` with the exact omitted count

#### Scenario: Oversized listing keeps the requested level

- **WHEN** the rendered two-level listing exceeds the common result cap but the requested level fits
- **THEN** whole child blocks are replaced last-first by `… N entries` lines until the listing fits
- **AND** every requested-level entry remains present with no partially rendered child block
- **AND** an empty child directory still renders as a bare `- name/` line

#### Scenario: Oversized requested level pages by selector

- **WHEN** the requested directory's own entries alone exceed the common result cap
- **THEN** the result carries the ordinary truncation details with `nextOffset`
- **AND** a range selector such as `:201-400` on the same directory returns the header and entries 201 through 400 of the requested level only

#### Scenario: Range selector on a small directory is flat

- **WHEN** the model reads a directory whose two-level listing fits the cap, with the selector `:1-5`
- **THEN** content is the header followed by the first five requested-level entries
- **AND** no child directory entries appear

#### Scenario: Raw selector on a directory is rejected

- **WHEN** the model reads a directory path with the `:raw` selector
- **THEN** the tool returns a selector error and no listing

### Requirement: Exact edit replaces one current unique match

`edit` SHALL accept an absolute local path or, while a Workspace is entered, a
relative local path resolved from the Workspace root under the local path rules
above, together with a valid `file://` alias, non-empty `oldText`, and
`newText`. A file alias is always absolute and is decoded before native
operation. It SHALL read the current file at execution time and require exactly
one exact occurrence of `oldText`. A missing or ambiguous occurrence SHALL fail
without mutation. Unrelated changes elsewhere in the file SHALL NOT block a
correct unique replacement. Calls targeting the same path SHALL execute
sequentially in the host runtime. The operation SHALL preserve bytes outside
the replacement and return a bounded diff plus post-edit content with one
adjacent live line on each side when available. No prior read, snapshot tag,
read hash, or permission rule is required in this iteration.

#### Scenario: Unrelated change does not block edit

- **WHEN** another writer changes a different paragraph after the model read, while `oldText` remains one exact match
- **THEN** edit replaces the match and preserves the unrelated change

#### Scenario: Changed target fails without mutation

- **WHEN** another writer changes the exact old text before edit executes
- **THEN** edit returns a stale/missing-target error
- **AND** it does not write the replacement

#### Scenario: Duplicate target fails closed

- **WHEN** `oldText` occurs more than once
- **THEN** edit returns an ambiguity error with no mutation
- **AND** it does not replace every occurrence implicitly

#### Scenario: Sequential same-path calls are first-writer-wins

- **WHEN** two edit calls both request `-Foo +Bar` and `-Foo +Baz` against the same current bytes
- **THEN** the first call applies
- **AND** the second call observes the changed bytes and fails without overwriting the first result

#### Scenario: File URL edit uses the decoded host target

- **WHEN** `edit` targets `file:///tmp/guide.md` with one matching `oldText`
- **THEN** it applies the exact unique replacement to `/tmp/guide.md`
- **AND** it reports the same bounded diff and decoded result identity as an edit naming `/tmp/guide.md`

#### Scenario: Workspace-relative edit uses the resolved local path

- **WHEN** the model edits `src/app.ts` while a Workspace is entered at `/work/project`
- **THEN** the host applies the edit to `/work/project/src/app.ts`
- **AND** the result identifies `/work/project/src/app.ts` as the path used

### Requirement: Write creates or explicitly replaces

`write` SHALL accept `path`, `content`, and a boolean `replace` argument;
absent or `false` SHALL select create-only, `true` SHALL select replace mode,
and every other type SHALL be rejected by the input schema before dispatch and
in production before any mutation. A valid `file://` alias is accepted
wherever an absolute local path is accepted, is always absolute rather than
Workspace-relative, and is decoded under the native file locator requirement.
In create mode it SHALL create a new regular file when the target is absent,
creating missing intermediate directories beneath the resolved authority root
on every scheme. It SHALL fail with `file_exists` when the target already
exists, regardless of the provided content, and with `not_regular_file` when an
intermediate path component exists and is not a directory. Create mode SHALL
otherwise behave exactly as before this change.

In replace mode (`replace: true`) `write` SHALL require the target to exist as
a regular file at validation time and SHALL replace its entire contents
atomically. A target that is absent, or that is deleted by an uncoordinated
external process after validation and before publication, SHALL fail with
`not_found` under the host-ordering guarantee and SHALL create no file under it;
no guarantee beyond that boundary is made, and a widening race is the specified
behavior, identical in kind to `edit` today. A replace target that is a
directory SHALL fail with `not_regular_file` and change nothing. On an absolute
or Workspace-projected local path, or a decoded `file://` alias, a symbolic
link at the target SHALL resolve to and replace its target entry exactly as
`edit` does, and a dangling symbolic link SHALL fail with `not_found`; on a
`kb://` locator, the target SHALL resolve with the leaf required to exist, and
a symbolic-link component SHALL fail as it does today. A successful replace
SHALL preserve the target's existing permission bits and SHALL be marked
`replaced`, distinct from the `created` marker of a create-mode success.

Both modes SHALL validate UTF-8 content and enforce shared output limits before
any byte changes, and SHALL leave the target unchanged on every failure.
Non-boolean `replace` values SHALL fail schema validation before dispatch.
Native file size SHALL NOT be restricted by the legacy Knowledge byte limit.
Every result SHALL identify the target as the caller named it: the submitted
absolute path for an absolute path, the projected absolute path for a
Workspace-relative path, the decoded host path for a `file://` alias, or the
locator for a `kb://` write, never the resolved host path. The create-mode
`file_exists` message SHALL name `replace` as the explicit path for replacing
the file's contents, and the replace-mode `not_found` message SHALL state that
`replace` requires an existing target and that omitting it creates a new file.
Write SHALL NOT produce sibling-name suggestions on either failure.

#### Scenario: Non-boolean replace value is rejected

- **WHEN** write receives `replace` as a non-boolean value such as `"true"` or `1`
- **THEN** the input schema rejects the call before dispatch
- **AND** no file is read, created, or modified

#### Scenario: New file is created

- **WHEN** write targets an absent path with valid bounded content
- **THEN** the file is created atomically
- **AND** the result identifies the created target as the caller named it: the submitted absolute path for an absolute path, the projected absolute path for a Workspace-relative path, or the locator for a `kb://` write, never the resolved host path

#### Scenario: Missing intermediate directories are created

- **WHEN** write in create mode targets `research/2026/note.md` beneath a root where `research/` does not exist
- **THEN** the intermediate directories and the file are created
- **AND** an intermediate component that exists as a regular file fails with `not_regular_file` and creates nothing

#### Scenario: Existing file is protected

- **WHEN** write without `replace`, or with `replace: false`, targets an existing file
- **THEN** the tool returns `file_exists`
- **AND** it does not overwrite or truncate that file

#### Scenario: Existing file is replaced by explicit replace

- **WHEN** write with `replace: true` targets an existing regular file with valid bounded content
- **THEN** the file's entire contents are the new content
- **AND** the result is marked `replaced`, carries no `created` marker, and names the target as the caller named it

#### Scenario: Replace preserves permission bits

- **WHEN** write with `replace: true` targets an existing regular file with a permission mode other than the create default
- **THEN** after the replace the file's permission bits are unchanged from before it

#### Scenario: Replace on a missing target fails and creates nothing

- **WHEN** write with `replace: true` targets an absent path
- **THEN** the tool returns `not_found`
- **AND** it creates no file and no intermediate directory, and the message states that `replace` requires an existing target and that omitting it creates a new file

#### Scenario: Replace on a dangling symbolic link fails

- **WHEN** write with `replace: true` targets a dangling symbolic link on an absolute path
- **THEN** the tool returns `not_found`
- **AND** the link is left unchanged and nothing is created

#### Scenario: Replace resolves a symbolic link like edit

- **WHEN** write with `replace: true` targets an absolute symbolic link to an existing regular file
- **THEN** the link's target file's contents are replaced
- **AND** the link remains a link to that file

#### Scenario: Replace on a directory fails

- **WHEN** write with `replace: true` targets an existing directory
- **THEN** the tool returns `not_regular_file`
- **AND** it does not create, rename, or modify any entry

#### Scenario: Replace validates content before any byte changes

- **WHEN** write with `replace: true` supplies content that is not valid UTF-8 or exceeds the shared output limits
- **THEN** the tool returns the corresponding validation error
- **AND** the existing file's bytes are unchanged

#### Scenario: Replace with empty content truncates

- **WHEN** write with `replace: true` supplies empty content for an existing regular file
- **THEN** the file exists with zero bytes and the result is marked `replaced`

#### Scenario: Knowledge replace follows locator authority

- **WHEN** write with `replace: true` uses a `kb://` locator whose leaf file exists
- **THEN** the file is replaced under the locator-named target with the Knowledge envelope and never the resolved host path
- **AND** a locator whose leaf or any parent directory is missing returns `not_found` and creates nothing

#### Scenario: Workspace-relative write reports the absolute path used

- **WHEN** the model creates `notes/draft.md` with `write` while a Workspace is entered at `/work/project`
- **THEN** the host creates `/work/project/notes/draft.md`
- **AND** the result identifies `/work/project/notes/draft.md` as the path used

#### Scenario: File URL write uses the decoded host target

- **WHEN** write with `replace: true` targets `file:///tmp/guide.md` and the target is an existing regular file
- **THEN** it replaces `/tmp/guide.md` atomically under host mutation ordering
- **AND** the result identifies `/tmp/guide.md` rather than the submitted URL

### Requirement: Native mutations have a durable pre-effect fence

Before an alpha native `edit` or `write` changes bytes on any scheme, the
trusted runtime SHALL durably record a stable mutation attempt identity and
target operation metadata. The recorded target for a `kb://` mutation SHALL be
the locator, never the resolved host path. Executor binding is an absolute-path
concern; a `kb://` attempt SHALL be fenced and replayed without binding the Run
to a worker.
If a retry or recovery observes an unsettled attempt, it SHALL return an unknown
outcome and SHALL NOT invoke the mutation again. A known result SHALL be settled
before the model advances. Client replay SHALL return the stored result without
executing the filesystem operation.

#### Scenario: Retry finds an open native mutation

- **WHEN** a worker dies after recording a native mutation attempt but before settling its result
- **THEN** recovery reports `outcome_unknown`
- **AND** a queue retry does not execute the same edit or write again

#### Scenario: Knowledge mutation is fenced on any worker

- **WHEN** a worker dies after recording a `kb://` edit attempt and a different worker retries the Run
- **THEN** recovery reports `outcome_unknown` on that worker
- **AND** the retry does not execute the edit again and does not fail with `executor_unavailable`

#### Scenario: Settled native mutation replays safely

- **WHEN** a client reconnects after a native mutation result was durably settled
- **THEN** replay returns the stored result
- **AND** the filesystem operation is not repeated

### Requirement: Knowledge locators resolve through trusted owner authority

`read`, `edit`, and `write` SHALL accept `kb://<space-id>/<path>[:selector]`,
where `<space-id>` is the stable Knowledge Space identifier and `<path>` is a
Knowledge-relative path. The tool SHALL resolve the identifier through the
trusted Run owner's current access immediately before opening the child, under
tenant enforcement, on every call. An absent, removed, malformed, or other-owner
identifier SHALL return the same closed `knowledge_space_not_found` result. A
currently owned Space whose root or stable-ID child cannot be resolved safely
SHALL return `knowledge_space_unavailable`. Neither result SHALL reveal whether
another owner, row, or directory exists, and the tool SHALL NOT probe candidate
Space directories. Sibling-name suggestions on a missed `kb://` read SHALL be
drawn only from a parent directory that has already been proven inside the
resolved Space, SHALL never be produced when the Space itself is absent,
removed, or another owner's, and SHALL carry names only; the parent SHALL be
checked without following links immediately before it is opened for names,
and a symbolic-link parent SHALL yield the bare `not_found`.

The locator SHALL be split on `/` and on the first `:` after the Space
identifier before any decoding, and each path segment SHALL then be
percent-decoded exactly once; the Space identifier and the selector SHALL NOT
be decoded. A segment that fails to decode, or that decodes to a string
containing `/`, SHALL return `invalid_path`, and that check SHALL run on the
individual segment before segments are rejoined. Where a path has a literal
spelling that is valid under this grammar, that spelling and its encoded
spelling SHALL resolve to the same file; a segment containing `:` or a
literal `%` has no valid literal spelling and SHALL be addressed as `%3A` or
`%25`, and `/` SHALL never be encoded. Path
validation SHALL apply to the decoded segments and SHALL reject absolute
paths, empty components, `.` or `..` components, backslashes, NUL or control
characters, and paths above 1,024 UTF-8 bytes or 32 components, returning
`invalid_path`. A `kb://` locator emitted by the system SHALL encode a segment
only when it contains `:`, `?`, `#`, or `%`, and SHALL leave every other
character, spaces included, literal. It SHALL refuse every
symbolic-link component or entry without following it, returning `not_found`.
`kb://<space-id>` and `kb://<space-id>/` SHALL address the Space's directory and
list it under the directory listing requirements; a bare `kb://` or a locator
with no identifier SHALL fail with `invalid_path`. Beyond those rules, `kb://`
targets SHALL follow the same regular-file, directory, selector, context,
truncation, mutation, and `file_exists` behavior as absolute paths. No
Markdown-only or per-file byte policy SHALL apply to `kb://` operations, except
that the explicit `outline` representation is available only for content the
representation requirements identify as Markdown; text and raw reads, edits,
and writes are unaffected.

Every `kb://` result SHALL identify the target by its locator and SHALL carry
the response-time Knowledge Space identifier and display name. It SHALL expose
no configured root, resolved child path, hosted owner ID, credential, worker
identity, or raw filesystem diagnostic. Every successful `kb://` read or listing
SHALL include the Knowledge untrusted-content `notice`; content SHALL be returned
verbatim so that `edit` `oldText` can be copied from it once the generated
line-number prefixes are removed, or read with `:raw` to omit them. An
`outline` read returns a selection of verbatim source lines under that same
rule while retaining the same locator, Space attribution, and notice.

The `kb://` grammar is the authority-aware locator that later schemes follow; a
scheme SHALL declare which of `read`, `edit`, and `write` it supports, and an
unsupported operation SHALL return a structured error without side effects.

#### Scenario: Search locator opens the passage

- **WHEN** the model calls `read` with a locator returned by `knowledge_search`, such as `kb://<id>/research/note.md:41-53`
- **THEN** the tool returns lines 41 through 53 with one adjacent context line on each side, numbered as native reads number them
- **AND** the result carries the Space identifier, display name, locator, and untrusted-content notice

#### Scenario: Another owner's Space is unresolvable

- **WHEN** the model supplies a locator whose identifier belongs to another owner
- **THEN** the tool returns `knowledge_space_not_found`
- **AND** the result is identical to the result for an absent identifier and no file is opened

#### Scenario: Locator carries no host authority

- **WHEN** a `kb://` read, edit, or write executes on a worker with no `tools.nativeExecutorId`
- **THEN** it resolves through the worker's configured Knowledge root and the Run owner
- **AND** it does not require or record an executor binding

#### Scenario: Space directory is listed

- **WHEN** the model calls `read` with `kb://<id>/`
- **THEN** the result is the deterministic two-level listing of the Space's directory with every entry shown as native listings show it
- **AND** the header is the locator as given

#### Scenario: Non-Markdown file is readable and writable

- **WHEN** the model writes `kb://<id>/data/table.csv` and then reads it back
- **THEN** both operations succeed under ordinary native semantics
- **AND** no Markdown-suffix or 1 MiB rule rejects either call

#### Scenario: Colon inside a Knowledge path is rejected

- **WHEN** the model calls `read` with `kb://<id>/notes/a:b.md`
- **THEN** the tool returns `invalid_selector`, because a literal `:` after the identifier starts the selector and `b.md` lies outside the grammar
- **AND** it does not probe for a literal file; the message names the working forms and the file is addressed as `kb://<id>/notes/a%3Ab.md`

#### Scenario: Encoded and literal spellings resolve alike

- **WHEN** the model calls `read` with `kb://<id>/01_Areas/Pet%20Projects/MOC.md` and then with `kb://<id>/01_Areas/Pet Projects/MOC.md`
- **THEN** both calls open the same file
- **AND** neither result reveals which spelling the filesystem holds

#### Scenario: Encoded separator cannot cross a boundary

- **WHEN** the model calls `read` with `kb://<id>/notes%2Fsecret.md`
- **THEN** the tool returns `invalid_path`
- **AND** `notes/secret.md` is not opened or probed, even though that literal path would be valid

#### Scenario: Malformed encoding fails closed

- **WHEN** the model calls `read` with `kb://<id>/reports/100%.md`
- **THEN** the tool returns `invalid_path`
- **AND** the description tells the model to write `%25` for a literal percent sign

#### Scenario: Edit copies verbatim content

- **WHEN** a note contains `<system>` in its text and the model reads it through `kb://` and then edits it using that text as `oldText`
- **THEN** the read returned the text unchanged
- **AND** the edit finds exactly one match and applies

#### Scenario: Knowledge outline keeps its attribution

- **WHEN** the model calls `read` with `kb://<id>/notes/guide.md:outline`
- **THEN** the result is the note's outline with the Space identifier, display name, locator, and untrusted-content notice
- **AND** `kb://<id>/notes/guide.md:outline:raw` returns `invalid_selector`, because `raw` is not a member `outline` accepts

### Requirement: Web locators are fetched by the native read tool

The native `read` tool SHALL accept an absolute `http://` or `https://`
locator as its `path` and SHALL fetch it with the API process's own outbound
HTTP. No other web scheme SHALL be admitted, and `edit` and `write` SHALL
reject a web locator with `invalid_path` before any request. A submitted web
locator, after any fragment is cut and its selector is split off, SHALL be
normalized to its WHATWG URL serialization and requested as that text: an
uppercase scheme or host, a percent-encoded or Unicode host, an explicit
default port, a host's root dot, an empty path, unencoded path or query
characters, and percent-escapes in the path or query SHALL each be
normalized rather than refused, because none of them
addresses a different resource and refusing them cost a call that taught the
model nothing it could carry to the next locator. Path and query escapes
SHALL be normalized in one pass that yields a fixed point: a `%` that does not
begin a valid escape SHALL be encoded as `%25`, an escape of an unreserved
character (`A-Z`, `a-z`, `0-9`, `-`, `.`, `_`, `~`) SHALL be decoded, and every
other escape, `%2F` included, SHALL stay encoded with uppercase hexadecimal
digits, so normalizing the normalized text changes nothing and llame's
normalization forms no new escape. A fragment SHALL be cut
before anything else reads the locator, because the request drops it anyway.
What no normalization can repair SHALL still fail before any request: a text
that is not a URL, a scheme outside `http` and `https`, and userinfo, which
SHALL fail with `invalid_path` so the tool never sends credentials the model
embedded in a URL, and whose message SHALL NOT echo them. A suffix outside the
selector grammar SHALL fail with `invalid_selector` naming the working forms,
because the locator before that suffix is a URL this tool can request.

After the submitted locator is admitted and canonicalized, the read SHALL
consider the ordered, code-owned web adapters before the generic HTML and text
ladder. A matching adapter SHALL be selected without network I/O. `:raw` SHALL
bypass every adapter and retain the raw-response behavior below; `:outline`
SHALL NOT bypass an adapter, because it describes the document a plain read
of the same locator returns, so a claiming adapter's rendered document is the
outline's input. An adapter SHALL
not add a tool id, a second permission group, or a different source authority.
An adapter target is another derived locator and SHALL be admitted in its own right.

Because the text requested is no longer always the text submitted, the
permission decision SHALL be taken over both: any reject clause matching
either the submitted locator with its read selector removed or its normalized form SHALL refuse the call, so
a spelling cannot be arranged to miss a reject, while the allow SHALL be
decided on the normalized form, because an allow names the resource the call
will reach and the two texts are one resource. A redirect hop is a different
resource and SHALL keep being admitted in its own right, and every address a
request would connect to SHALL additionally be judged under the
address-admission requirement below. Availability and
restriction for fetching web locators through `read` SHALL come only from the `read` permission group's
`path` clauses: a prefix allow admits the web, and a prefix or domain reject
removes a host. This web-availability rule governs a `default`-mode attempt; under `bypass` the web is reachable without a `path` allow, as this capability's Purpose states. No web tool id, `tools.allowed` entry, configuration block, or
advertisement condition SHALL be added for fetching a web locator; `web_search`, specified by `web-search`, is a separate tool with its own allowlist entry, configuration, and permission group, and the `read` group's `path` clauses do not restrict it; a process that does not advertise
`read` SHALL NOT reach a URL through it. Each call SHALL fetch afresh: no
response or render SHALL be cached, and a later selector read of the same
locator SHALL issue a new request. The tool SHALL NOT consult `robots.txt` or
any publisher signal such as `content-signal`, and a fetch SHALL NOT be
represented as permission from the publisher. The scheme split and trailing
selector rules that protect a `scheme://` prefix SHALL apply unchanged: the
scheme's own colon is never read as a selector, and the shipped
trailing-selector split (the last colon after the last slash) governs the
rest, except that the `:raw` and `:outline` representation forms are
recognized before that last-colon fallback. A selector SHALL be split only from a locator that has a path and
carries no `?` and no `#`, so a colon inside a query is part of the URL
(`https://example.test/search?at=2026:10` is fetched as written) and the only
colon of a pathless locator opens its port: `https://example.test:88` is port
88, `https://example.test/:88` is line 88 of the site root, and
`https://example.test:88/:88` is line 88 served from port 88.
A literal colon in the last path segment of a query-free locator SHALL be
written as `%3A` (`https://w.example/wiki/Special%3ASearch`), because a
trailing colon is always read as a selector split and the shipped grammar
admits `raw`, `raw:<list>`, `N`, `N-M`, `N+K`, `N-`, `-K`, comma lists of
those, `outline`, `outline:N`, `outline:N-M`, `outline:N+K`, `outline:N-`, and
`outline:-K`, with `:<list>:raw` the same read as `:raw:<list>`: `Search`
is outside it, so `https://w.example/wiki/Special:Search`
fails as `invalid_selector`, while `https://w.example/docs/2024:10` selects
line 10 and `https://w.example/docs/2024:10-20` lines 10 through 20 of
`https://w.example/docs/2024`. A suffix `:outline` or `:outline:<range>` is
split as the outline representation before the last-colon fallback, so
`https://h.example/p:outline:5-40` requests `https://h.example/p` and scopes
the outline to rendered lines 5 through 40; a literal last-segment colon in a
path intended to end in `outline` SHALL be percent-encoded.
Each refusal that remains SHALL name the spelling that would work rather than
the rule that was broken: a selector written straight after the authority
(`https://example.test:1-5`, which is not a URL at all because `1-5` is not a
port) SHALL be answered with the authority's own serialization carrying that
selector (`https://example.test/:1-5`); a port that is not a number
(`https://example.test:abc/`) SHALL be answered by naming that rule and the
same locator without a port, rather than by the generic message, since the
locator is absolute and only its port is broken; a suffix that meant a line the
grammar cannot serve (`:12+`), or any other suffix outside it (`Search`), SHALL be answered with the forms, `N-` and
`-K` included, first and the literal colon's encoding second; and a selector
the render could not
serve — past its end, or with no line in it — SHALL be answered with the
number of lines the page rendered, which the model cannot know before reading
it.

#### Scenario: A web locator is fetched by the API process

- **WHEN** the model calls `read` with `https://example.test/guide`
- **THEN** the API process issues the request and returns the page content
- **AND** no native executor identity is required, bound, or reported

#### Scenario: A rejected cleartext scheme never reaches the network

- **WHEN** the `read` group rejects `path` matching `^http://` and the model reads `http://example.test/guide`
- **THEN** the call is rejected before any request is issued
- **AND** an admitted `https://` locator is unaffected by that reject

#### Scenario: A web locator is never mutated

- **WHEN** `edit` or `write` targets `https://example.test/guide`
- **THEN** it returns `invalid_path`
- **AND** no request is issued

#### Scenario: A noncanonical spelling is normalized, not refused

- **WHEN** the model reads `https://g%72okipedia.com/page`, `HTTPS://Example.test/guide`, `https://example.test:443/guide`, or `https://example.test./guide`
- **THEN** the read requests the normalized locator (`https://grokipedia.com/page`, `https://example.test/guide`) without a refusal first
- **AND** a reject clause written against the canonical spelling still refuses every one of those variants, because the decision is taken over the submitted text and the normalized text alike
- **AND** a reject clause written against the submitted spelling, such as one naming `%72`, also refuses

#### Scenario: An encoded unreserved character cannot slip past a path reject

- **WHEN** the `read` group rejects `path` matching `^https://example\.test/private` and the model reads `https://example.test/%70rivate`
- **THEN** the call is rejected before any request, because the normalized text is `https://example.test/private`
- **AND** `https://example.test/%%370rivate` is requested as `https://example.test/%2570rivate`, whose once-decoded path is the literal `/%70rivate` it named, so llame's normalization forms no new escape; a server that decodes a path twice can still read it as `/private`, which a path-scoped rule cannot bound
- **AND** `https://example.test/a%2fb` is requested as `https://example.test/a%2Fb`, still encoded

#### Scenario: A pathless host reads its port, a path reads its line

- **WHEN** the model reads `https://example.test:88`, which has no path for a selector to trail
- **THEN** the read requests `https://example.test:88/` on port 88, and the permission decision matched that same text
- **AND** `https://example.test/:88` requests the site root and returns line 88 of its render
- **AND** `https://example.test:88/:88` requests the root on port 88 and returns line 88 of it

#### Scenario: Userinfo in a locator fails closed

- **WHEN** the model reads `https://user:secret@example.test/guide`
- **THEN** the read returns `invalid_path` before any request
- **AND** no credential from the locator is sent to the host

#### Scenario: A colon in the last path segment is a selector unless encoded

- **WHEN** the model reads `https://w.example/wiki/Special:Search`
- **THEN** the read fails with `invalid_selector` and issues no request, because the split-off suffix is present but outside the grammar
- **AND** `https://w.example/wiki/Special%3ASearch` is fetched as written, while `https://w.example/docs/2024:10` selects line 10 and `https://w.example/docs/2024:10-20` lines 10 through 20 of `https://w.example/docs/2024`
- **AND** `https://w.example/wiki/Special:-5` is the last five rendered lines of `https://w.example/wiki/Special`, and the literal spelling of that same resource is `https://w.example/wiki/Special%3A-5`

#### Scenario: Outline representation splits before the last-colon fallback

- **WHEN** the model reads `https://h.example/p:outline:5-40`
- **THEN** the request targets `https://h.example/p` and the outline is scoped to rendered lines 5 through 40
- **AND** the `:outline` text is not sent as part of the URL path

#### Scenario: A refused locator names the spelling that works

- **WHEN** the model reads `https://example.test:1-5`, which no URL parser accepts because `1-5` is not a port
- **THEN** the read returns `invalid_path` naming `https://example.test/:1-5`, and resubmitting that reads lines 1 through 5 of the page
- **AND** reading `https://example.test/guide:12+` returns `invalid_selector` naming the `:N`, `:N-M`, `:N+K`, `:N-`, and `:-K` forms before the `%3A` spelling, while `https://example.test/guide:12-` reads line 12 through the render's last line
- **AND** a suffix outside the grammar with no line number in it, such as `https://w.example/wiki/Special:Search`, names the same forms and then the encoded spelling

#### Scenario: A selector the page cannot serve reports the page's length

- **WHEN** the model reads `https://example.test/guide:100-200` and the render is 3 lines long
- **THEN** the read returns `invalid_selector` reporting that the page rendered 3 lines
- **AND** the message does not repeat the error type as its text

#### Scenario: A local-only allow does not admit the web

- **WHEN** the `read` group's only allow clause is a `path` regex for `^/`
- **THEN** an `https://` locator matches no allow and is rejected as `no_allow` before any request

#### Scenario: Publisher signals are not permission

- **WHEN** a page's `robots.txt` disallows the path or its response carries `content-signal: ai-train=no`
- **THEN** an admitted read still fetches the locator and returns its content
- **AND** the read does not report or enforce the signal

#### Scenario: Read path clauses do not govern web search

- **WHEN** the `read` group has no allow for `^https://` and `tools.allowed`, `webSearch`, and `tools.permissions.web_search` admit `web_search`
- **THEN** a `web_search` call runs its engines and returns results
- **AND** a `read` of any returned `https://` URL is still rejected as `no_allow` before any request

### Requirement: Web fetch bounds fail fast and are never retried

Every web request SHALL carry `User-Agent: llame/<version>`, where the version
is the boot-time value instance configuration resolves for the running
process. The tool SHALL NOT rotate, randomize, or omit that value and SHALL
NOT claim another product's client identity. A request whose response
headers do not arrive within 10 seconds SHALL fail the call with
`headers_timeout`. A call that has not completed within 30 seconds, counted
across every request it issues, SHALL fail with `call_timeout`. The response
body SHALL be streamed against a 5 MiB cap and aborted past it with
`body_too_large`, and a declared length above the cap SHALL fail before the
body is read. `Accept-Encoding` SHALL be left to the runtime. A web call
SHALL NOT retry: a transport failure, a timeout, and an error status SHALL
each be reported to the model as an error observation with no second
attempt. A non-2xx status other than a redirect status (301, 302, 303, 307,
308, which the redirect requirement governs whether or not a `Location` is
present) on the first request, or on a
redirect hop, SHALL fail the call with `http_status` naming the status; a 429
SHALL additionally carry the `Retry-After` value when the response supplies
one. A status error SHALL NOT return the response body and SHALL NOT report
response headers other than that `Retry-After` delay. A redirect answer to a
probe request SHALL be followed under the shared redirect rules before any
terminal status is judged. An adapter request or its redirect chain whose
status, content type, or transport fails SHALL disqualify that adapter without
failing the call. Adapter requests share the 30-second call deadline, 5 MiB
per-response bound, and 20-hop redirect bound; the rendered adapter document
SHALL also be capped at 5 MiB, with no separate adapter request-count cap. A
probe request (an
alternate, a suffix candidate, or an `llms.txt` candidate) whose terminal
response answers a non-2xx status, or a refused content type, or which fails
on a bound of its own (a headers timeout, an oversized body, a transport
failure, or a redirect it cannot follow), SHALL disqualify only that
candidate, and the pipeline SHALL continue; a probe that exhausts the call's
deadline or its redirect budget SHALL fail the call, while a refusal inside
a probe's own redirect chain disqualifies only that candidate, as a refused
probe locator does. A
call SHALL issue at most one alternate request, one suffix-probe request,
and four `llms.txt` requests, and SHALL follow at most 20 redirects in total
across all of its requests.

#### Scenario: Every request identifies llame

- **WHEN** any web request of an admitted read is inspected
- **THEN** its `User-Agent` is `llame/<version>` with the boot-time version
- **AND** the value does not vary between the call's requests

#### Scenario: A redirect is followed, not failed, and a bare redirect fails closed

- **WHEN** the first response is 302 with a `Location` header and policy admits the target
- **THEN** the hop is followed and the call does not fail with `http_status`
- **AND** a 302 without a parsable `Location` fails the call with `invalid_redirect`

#### Scenario: Slow headers fail at the header bound

- **WHEN** a server accepts the connection and sends no response headers within 10 seconds
- **THEN** the call fails with `headers_timeout`
- **AND** the body is not read

#### Scenario: A call over the total bound fails

- **WHEN** each response arrives inside the header bound but the call passes 30 seconds while following hops or probing alternates
- **THEN** the call fails with `call_timeout`
- **AND** no further request is issued for that call

#### Scenario: An oversized body is aborted

- **WHEN** a response declares or streams more than 5 MiB
- **THEN** the call fails with `body_too_large`
- **AND** the read stops streaming instead of buffering the remainder

#### Scenario: Rate limiting is reported, not retried

- **WHEN** a server answers 429 with `Retry-After: 120`
- **THEN** the call fails with `http_status` naming 429 and the retry delay
- **AND** no retry is attempted

#### Scenario: An error status is not content

- **WHEN** a server answers 404 or 500
- **THEN** the call fails with `http_status` naming the status
- **AND** the response body is not returned as content

### Requirement: Web reads accept text bodies only

A web read SHALL accept only text bodies: `text/*` media types,
`application/json`, `application/xml`, and any type whose subtype carries a
`+json` or `+xml` suffix. `text/markdown` SHALL be handled as Markdown. Every
other content type SHALL fail with `unsupported_content_type` naming the
received type, and its body SHALL NOT be returned as content. An adapter
response with a refused content type SHALL disqualify that adapter with a
bounded `content_type` note and SHALL not fail the source call. Only a
declared HTML type — `text/html` or `application/xhtml+xml` — SHALL be
rendered. A `text/plain` body SHALL be returned as served whatever it
contains, because a conversion guesses at structure and guessing on a body
the publisher declared as plain text costs more than it returns: a Markdown
file that opens with a block of inline HTML was extracted as an article and
lost every line after it. Any other accepted text body SHALL be returned as
the content unchanged. Text SHALL be decoded with the
charset from the `Content-Type`
parameter when present, else with a `<meta charset>` declaration found in the
first 2 KiB of the body, else as UTF-8.

#### Scenario: A JSON body is returned as text

- **WHEN** a locator serves `application/json`
- **THEN** the read returns the body text unchanged with `method` `text`
- **AND** a first response that is `text/plain` is returned unchanged with `method` `negotiated`

#### Scenario: A binary body is refused with its type named

- **WHEN** a locator serves `application/pdf` or `image/png`
- **THEN** the read fails with `unsupported_content_type` naming that type
- **AND** no conversion or extraction is attempted

#### Scenario: Only a declared HTML type is rendered

- **WHEN** a response declares `text/plain` and its body is an HTML document
- **THEN** the body is returned as served with `method` `negotiated`, not extracted
- **AND** a `text/plain` README that opens with a block of inline HTML, such as `<div align="center">`, keeps every line

#### Scenario: A declared charset is honored

- **WHEN** a response declares `charset=iso-8859-1` and its body contains bytes outside ASCII
- **THEN** the returned text is decoded with that charset
- **AND** a response that declares no charset and carries no `<meta charset>` in its first 2 KiB is decoded as UTF-8

### Requirement: Web HTML reads prefer publisher Markdown

The generic ladder begins only after matching adapters produce no result.

The first request for a page SHALL send `Accept: text/markdown,
text/plain;q=0.9, text/html;q=0.8, */*;q=0.5`, so a publisher that serves
Markdown or plain text for agents is used without a second request or a
local conversion. A first response that is `text/markdown` or
`text/plain` SHALL be returned as the content with `method`
`negotiated`, ungated and unconverted: the publisher's agent-facing body is
taken as it is. Otherwise, for an HTML body, the tool SHALL try, in order,
a Markdown alternate announced by the response's `Link` header or by a `<link
rel="alternate" type="text/markdown">` element in the page head, resolved to
an absolute URL, fetched, and reported as `method` `alternate`; then the
publisher's Markdown suffix probe, mapping `/a/b.html` to `/a/b.html.md`,
`/a/b` to `/a/b.md`, and `/a/b/` to `/a/b/index.md`, reported as `method`
`md-suffix`. The first candidate that passes the quality gate SHALL win and
end the search. The quality gate SHALL judge an alternate, a suffix candidate,
and the local render alike: more than 100 non-whitespace characters, not
HTML-shaped for a Markdown candidate, and not low quality, where a candidate
is low quality when it is under 1,024 characters and contains a JavaScript
or captcha gate phrase, or when more than 70 percent of its non-blank lines
are shorter than 40 characters and fewer than 40 of them reach that length,
since a render that carries 40 substantial lines is a document whatever its
shape and the fallback it would be sent to is the same page's raw HTML.
Every derived locator, meaning an alternate,
a suffix candidate, an `llms.txt` candidate, or a redirect hop, SHALL be
evaluated against the `read` permission group before its request through
the same evaluator and the same projection the call used, as if the model
had submitted it; a rejected probe locator, or a rejected hop inside a
probe's own redirect chain, SHALL disqualify that candidate without failing
the call and its decision SHALL be recorded like a hop decision, so a hostile
page cannot make a read of itself fail by announcing a refused alternate. A probe request SHALL send the same `Accept` header and
SHALL count against the call's total time, body, request, and redirect
bounds; a failure of its own disqualifies the
candidate without failing the call, while a spent call bound fails it. A candidate that fails the gate SHALL
NOT become the content, and a fetched candidate SHALL NOT be searched for
further alternates
or suffixes.
An adapter request is also a derived locator and SHALL use the same admission,
address, and shared-bound checks before it is issued.

#### Scenario: Negotiated Markdown wins without a second request

- **WHEN** the first request's response is `text/markdown`
- **THEN** the content is that body and `method` is `negotiated`
- **AND** the call issues no further request for that page

#### Scenario: A Link header alternate is fetched

- **WHEN** an HTML response carries `Link: <https://example.test/guide.md>; rel="alternate"; type="text/markdown"`
- **THEN** that URL is requested and its body is returned with `method` `alternate`

#### Scenario: A head alternate link resolves against the page

- **WHEN** a page's head declares `<link rel="alternate" type="text/markdown" href="/guide.md">`
- **THEN** `/guide.md` is resolved against the page's URL, fetched, and reported as `method` `alternate`

#### Scenario: The suffix probe finds a publisher file

- **WHEN** an HTML page at `https://example.test/a/b` announces no alternate and `https://example.test/a/b.md` returns Markdown that passes the gate
- **THEN** the content is that file and `method` is `md-suffix`

#### Scenario: A candidate that fails the gate does not win

- **WHEN** an alternate or suffix URL answers 404, serves `application/pdf`, returns an HTML error page, or returns a body of 40 characters
- **THEN** that candidate is not returned as the content and the call does not fail
- **AND** the next ladder stage in order decides the content

#### Scenario: A low-quality candidate is rejected

- **WHEN** a page's only Markdown candidate is 900 characters dominated by short navigation lines, or a short page whose text is a JavaScript gate notice
- **THEN** the candidate fails the gate
- **AND** the pipeline continues past it

#### Scenario: A refused alternate is skipped, not fetched

- **WHEN** the `read` group's only allow is `^https://docs\.example\.com/` and a page on that host announces `Link: <https://evil.example/x.md>; rel="alternate"; type="text/markdown"`
- **THEN** the alternate locator is rejected before any request, no request reaches `evil.example`, and the decision is recorded like a hop decision
- **AND** the pipeline continues with the suffix probe and the local render, and the call does not fail

#### Scenario: Probes carry the negotiated accept header

- **WHEN** any alternate or suffix probe request is inspected
- **THEN** it sends the same `Accept` value as the first request
- **AND** it counts against the call's total time and body bound

### Requirement: Web HTML reads fall back to a local render, llms.txt, and the raw body

Only when no publisher Markdown candidate wins SHALL the tool render locally:
Readability main-content extraction over the response body, converted to
Markdown with GFM tables and reported as `method` `readability`. When
Readability finds no article, the whole body SHALL be converted instead and
reported with the same method. The render SHALL open with the page's title as
a heading unless its own first line already is that title, because Readability
treats the title as the article's heading and strips it, leaving a page that
never names itself. Only when that render fails the quality gate
SHALL the tool probe `llms.txt`, requesting at most four candidates from the
deepest path segment up to the site root (the three deepest scopes and the
root) until one is accepted, reported as `method` `llms-txt`. An `llms.txt`
candidate SHALL be accepted on the length and not-HTML-shaped conditions
only, because an index file is short link lines by construction. When no
attempt is accepted, the tool SHALL return the response body with `method`
`raw` and a note explaining that the page could not be converted. A
JavaScript or captcha challenge SHALL fail the gate, be returned with
`method` `raw`, and carry a note naming the detected challenge. A text body
outside the negotiation set (JSON, XML, and other `text/*` types) SHALL be
returned unchanged with `method` `text`. `:raw` SHALL skip every probe and
conversion and return, untouched and with `method` `raw`, the body of the
final response after any followed redirects, with `finalUrl` naming that
response; a `:raw` read of a refused content type SHALL still fail under the
content-type rule.

#### Scenario: A page without publisher Markdown is rendered

- **WHEN** an HTML page offers no negotiated body, no alternate, and no passing suffix candidate
- **THEN** Readability's main content is returned as Markdown with GFM tables and `method` `readability`

#### Scenario: A render names the page it came from

- **WHEN** Readability strips the page title as the article's own heading, as it does for `https://example.com/`
- **THEN** the render opens with that title as a heading
- **AND** a render whose first line already is the title is not given a second one

#### Scenario: A Readability miss converts the whole body

- **WHEN** Readability finds no article on a page that still has content
- **THEN** the whole body is converted to Markdown and reported with `method` `readability`

#### Scenario: A passing render stops the search before llms.txt

- **WHEN** the local render passes the quality gate
- **THEN** no `llms.txt` candidate is requested

#### Scenario: llms.txt is probed from the deepest segment upward

- **WHEN** the local render fails the gate and `https://example.test/a/b/llms.txt` does not exist while `https://example.test/llms.txt` does
- **THEN** the walk requests the deeper candidate first and returns the root one with `method` `llms-txt`

#### Scenario: The raw body is the last resort, with a note

- **WHEN** every Markdown and render attempt fails the gate
- **THEN** the response body is returned with `method` `raw`
- **AND** `notes` explains that the page could not be converted and the content is not presented as converted text

#### Scenario: A challenge page is reported, not converted

- **WHEN** a response body is a JavaScript or captcha gate under 1,024 characters
- **THEN** it is returned with `method` `raw` and `notes` naming the detected challenge

#### Scenario: Raw mode fetches once

- **WHEN** the model reads `https://example.test/guide:raw`
- **THEN** the body of the final response is returned untouched with `method` `raw`, `finalUrl` names that response, and no Readability or Turndown step runs
- **AND** no alternate, suffix, or `llms.txt` request is issued

### Requirement: Web reads follow redirects under per-hop permission admission

A web read SHALL follow 301, 302, 303, 307, and 308 responses on any host,
up to 20 in total per call, and SHALL request each hop with the same bounds
and non-credential headers as the first. The submitted source request and
generic probes SHALL send no cookie, `Authorization`, or other credential. The
GitHub adapter MAY send its token only to `https://api.github.com` and a
same-origin API hop; it SHALL be removed before any cross-origin hop. The hop
locator SHALL be the `Location` value
resolved against the redirecting request's URL by the WHATWG URL parser and
serialized as its `href`, so a relative `Location` becomes absolute and the
serialization is what policy sees: lowercase host, an internationalized host
as punycode, default port dropped, empty path as `/`, path and query
percent-encoded and normalized as for a submitted locator. A fragment SHALL be dropped from the resolved locator
before admission and before the request, so the text policy matches is
exactly the URL the next request uses. A redirect status without a parsable
`Location`, or a resolved locator that carries userinfo or a scheme other
than `http` or `https`, SHALL fail the source request chain with
`invalid_redirect` before any request and SHALL NOT name the target. The same
condition on an adapter chain SHALL disqualify that adapter before its target
request. Before a hop's request is sent, the `read`
permission group SHALL be evaluated against that locator as if the model had
submitted it, through the same evaluator and the same projection the call
used. A rejected hop on the call's own request chain SHALL end the call with
a `permission_denied` error
whose result carries the rejected locator as `rejectedUrl` with its query
and fragment removed (origin and path only, so a signed query string in a
`Location` never reaches the model), bounded to 2,048 characters with
control characters removed, and whose message is the fixed hop template;
the rejected target's body SHALL NEVER be read. A rejected hop inside a
probe's own redirect chain SHALL disqualify that candidate instead, under the
adapter rule, so a page cannot end a read of itself through a redirect it
announced. A rejected hop inside an adapter chain SHALL disqualify that adapter.
When the
redirect budget is exhausted the call SHALL fail with `too_many_redirects`
and SHALL issue no further request. The result SHALL name the URL of the
response that produced the content as `finalUrl` and SHALL NOT enumerate the
hop chain: when a publisher-Markdown probe won, that is the probe's own
final URL, including any redirect it followed, rather than the page's. An
adapter result instead reports its source URL as `finalUrl`.
The `read` tool description SHALL state that redirects are
followed and that `finalUrl` reports where the content came from, so the
model does not re-fetch a page to learn its location. A hop admitted on its text
SHALL then connect only to the addresses the address-admission requirement
admits; a hop whose every address is refused SHALL end the call on the call's
own request chain and disqualify only the candidate on a probe's chain or the
adapter on an adapter chain, as that requirement states.

#### Scenario: A cross-host hop is followed when policy admits it

- **WHEN** `https://a.example/start` answers 302 to `https://b.example/guide` and the `read` group admits both URLs
- **THEN** the second request is issued and `finalUrl` is the b.example URL
- **AND** the result reports no hop chain

#### Scenario: A hop naming a rejected host ends the call without reading its body

- **WHEN** a redirect target is refused by a `read` reject
- **THEN** the call returns `permission_denied` with the fixed hop message and `rejectedUrl` carrying the resolved target's origin and path without query or fragment, bounded to 2,048 characters with control characters removed
- **AND** no request is sent to the refused target, so its body is never read, converted, or returned

#### Scenario: The hop limit bounds a redirect loop

- **WHEN** a server redirects more than 20 times within one call
- **THEN** the call fails with `too_many_redirects`
- **AND** no further request is issued

#### Scenario: A redirect to a credentialed or non-web target fails closed

- **WHEN** a hop's `Location` resolves to `https://user:secret@b.example/x` or to `file:///etc/passwd`
- **THEN** the call fails with `invalid_redirect` before any request to that target
- **AND** the error does not repeat the target

#### Scenario: A relative Location is resolved and normalized before policy

- **WHEN** `https://a.example/docs/start` answers 302 with `Location: ../Guide` and the `read` group allows `^https://a\.example/`
- **THEN** policy evaluates `https://a.example/Guide` and the request targets that URL
- **AND** `finalUrl` reports `https://a.example/Guide`

#### Scenario: A hop is judged by the address it resolves to

- **WHEN** a public page redirects to `https://files.example/private` and `files.example` resolves to `10.67.88.60`
- **AND** the `read` group allows everything and rejects `^https?://10\.67\.88\.60/private`
- **THEN** no connection is opened to `10.67.88.60` and the call ends with `permission_denied`, the refused-address message, and `rejectedUrl` `https://files.example/private`

#### Scenario: A hop to a private address is admitted by its text

- **WHEN** a redirect targets `http://127.0.0.1:8080/admin` and the `read` group admits that URL's text
- **AND** no reject matches its address locator `http://127.0.0.1:8080/admin`
- **THEN** the request is issued, because operator policy decides and no built-in address range refuses it
- **AND** the outcome is the same for a hostname whose address resolves into a private range

#### Scenario: The description explains where the content came from

- **WHEN** the packaged `read` description is rendered for a catalog that includes `read`
- **THEN** it states that redirects are followed and that the result reports the final URL

### Requirement: Web reads connect only to addresses the read group admits

Before each request a web read issues (the submitted locator, a redirect hop,
an announced alternate, a suffix candidate, or an `llms.txt` candidate) and
after that locator's own text is admitted, the tool SHALL determine the
addresses the request may connect to. An adapter request SHALL use this same
address resolution and pinning before it is issued. A host that is an IP literal SHALL be its
own single address. Any other host SHALL be resolved through the system
resolver, so hosts files and the platform's name service apply as they do for
every other process of the host, at most once per call: a later request of
the same call to the same host SHALL reuse that answer. Resolution SHALL count
against the request's header bound and the call bound, and a resolution
failure SHALL fail the request as a transport failure does. No CNAME or other
intermediate name SHALL be evaluated.

For every address, the `read` group SHALL be evaluated against an address
locator: exactly the URL the request uses with only its host replaced by
that address, keeping the scheme, port, path, and query; a read selector is
never requested and SHALL NOT be part of it. An IPv4 address SHALL be written
in dotted decimal, an IPv6 address in brackets in its WHATWG serialization,
and an IPv4-mapped IPv6 address, in whichever textual form the resolver or the
locator gave it, as the dotted IPv4 address it maps; an IPv6 zone identifier
SHALL be dropped. An address SHALL be judged in its own form: `0.0.0.0` and
`::` are not rewritten to the loopback addresses the platform may connect
them to. An address locator SHALL be judged by reject clauses only: an address
SHALL be refused when a reject clause matches its address locator or when the
evaluation exceeds the inspection limit, and SHALL otherwise be admitted
whether or not any allow clause matches it, because allow is decided on the
locator text the request was admitted by. A call evaluated without a compiled
permission policy SHALL admit no address.

The request SHALL connect only to admitted addresses, racing them under the
runtime's ordinary address selection. A refused address SHALL never be
dialed, and trying the next admitted address while the connection is being
established is part of one request, not a retry. The host SHALL NOT be
resolved again between the decision and the connection. A connection SHALL
serve only the request whose address locators admitted it and SHALL NOT be
reused by another request, even one to the same host.

When every address of a request is refused, that request SHALL NOT be issued.
On the call's own request chain (the submitted locator or one of its redirect
hops) the call SHALL end with `status: "error"`, `type: "permission_denied"`,
and the fixed refused-address message, and a refused hop SHALL also carry its
hostname locator as `rejectedUrl` under the hop rules; on a probe's chain only
that candidate SHALL be disqualified. An adapter chain whose addresses are
all refused SHALL disqualify only that adapter. No result, message, or note SHALL carry
a resolved address. Each distinct refused address SHALL be recorded as a
derived-locator decision of kind `address` under the provenance requirement of
`tool-call-permissions`.

#### Scenario: An address reject holds for every name

- **WHEN** the `read` group is `{ "allow": true, "reject": [{ "field": "path", "regex": "^https?://10\\.67\\.88\\.60/private" }] }`
- **AND** `export.corp`, `x.attacker.example`, and a redirect target each resolve to `10.67.88.60`
- **THEN** reading `/private` through any of them opens no connection and ends with `permission_denied` and the refused-address message
- **AND** reading `https://export.corp/data` connects to `10.67.88.60` and returns the page

#### Scenario: A refused address is skipped

- **WHEN** a host resolves to `10.0.0.5` and `93.184.216.34` and a reject matches only the `10.0.0.5` address locator
- **THEN** the request connects to `93.184.216.34` and never to `10.0.0.5`
- **AND** the call succeeds and records one `address` rejection

#### Scenario: An address needs no allow of its own

- **WHEN** the `read` group's only allow is `^https://docs\.example\.com/` and `docs.example.com` resolves to an address no clause names
- **THEN** the read is admitted and fetched

#### Scenario: The checked answer is the one dialed

- **WHEN** the resolver answers `93.184.216.34` for a host when the request is decided and would answer `127.0.0.1` to any later query
- **THEN** the request connects to `93.184.216.34` and never to `127.0.0.1`
- **AND** a later probe of the same call to that host connects to `93.184.216.34` without a second resolution

#### Scenario: An IP literal is judged in its address form

- **WHEN** the model reads `https://[::ffff:169.254.169.254]/latest` and a reject matches `^https?://169\.254\.169\.254[:/]`
- **THEN** the read is refused with no connection, because its address locator is `https://169.254.169.254/latest`

#### Scenario: A connection is not reused across paths

- **WHEN** `a.example` resolves to `10.0.0.5` and `10.0.0.6`, the page `https://a.example/page` connects over `10.0.0.5`, and a path-scoped reject refuses `10.0.0.5` for its suffix probe `https://a.example/page.md`
- **THEN** the probe opens a new connection to `10.0.0.6` and never sends its request over the page's connection or to `10.0.0.5`
- **AND** the page's content is returned

#### Scenario: A resolved IPv4-mapped answer is judged as IPv4

- **WHEN** a host resolves only to the AAAA answer `::ffff:10.67.88.60` and a reject matches `^https?://10\.67\.88\.60/private`
- **THEN** reading `/private` on that host opens no connection, because its address locator is `https://10.67.88.60/private`

#### Scenario: A selector is not part of the address locator

- **WHEN** a reject matches `^https?://10\.67\.88\.60/private$` and the model reads `https://export.corp/private:raw` with `export.corp` resolving to `10.67.88.60`
- **THEN** the read is refused with no connection, because the address locator is the requested URL `https://10.67.88.60/private`

#### Scenario: No resolved address reaches the model

- **WHEN** every address of the call's own locator is refused
- **THEN** the result carries the fixed refused-address message and no address text
- **AND** a probe candidate whose every address is refused is disqualified without an error

### Requirement: Web read results carry the final URL and retrieval method

A successful web read SHALL return the native read success object — `content`,
the requested and shown range or ranges, `nextOffset`, `truncated`, and `path`
as the locator with its selector stripped, as a local read reports it —
extended with `finalUrl` and `method`, plus `notes` only when
the tool has something to report. `method` SHALL be one of `negotiated`,
`alternate`, `md-suffix`, `readability`, `llms-txt`, `text`, `raw`, or
`adapter`, and SHALL name the ladder stage or adapter that produced the returned content.
For `method: "adapter"`, the result SHALL carry an `adapter` object with its
stable `id` and `route` (`native` or `rewrite`); `origin` SHALL be present only
for `rewrite`. The adapter result SHALL keep `finalUrl` equal to the source URL,
not its derived request target, and notes SHALL identify delegated content and
its origin when applicable. The result SHALL
NOT carry a `url` field, a `contentType` field, a `markdownTokens` field, a
text header before the content, or a metadata frontmatter block. Line
selectors SHALL apply to the rendered text exactly as to a local file, with
the existing context, range, `nextOffset`, and truncation rules, and the
rendered text SHALL be measured against the existing native read result bound,
which SHALL reserve space for `path`, `finalUrl`, `method`, `adapter`, and
`notes` before
truncating content. A `-K` member requested on an adapter document the web
plane cut at its 5 MiB document bound SHALL fail with `representation_too_large`
naming the cut and SHALL return no partial content, because the end of a cut
document is not the end the source holds; an `N-` member and an ordinary read of
the same document are unaffected and keep the ordinary truncation note. A web read SHALL NOT carry `realPath`. A selector read of
a locator read earlier SHALL refetch and rerender, and the tool SHALL NOT
promise that two reads of the same URL return the same text.

#### Scenario: The result is the native object plus the web fields

- **WHEN** a web read succeeds
- **THEN** the result carries `content`, the range metadata, `path` as the locator with its selector stripped (as a local read reports it), `finalUrl`, and `method`, with `notes` only when non-empty
- **AND** it carries no `url`, `contentType`, `markdownTokens`, leading text header, or frontmatter block

#### Scenario: Selectors address the rendered text

- **WHEN** the model reads `https://example.test/guide:10-20`
- **THEN** lines 10 through 20 of the rendered text are returned with the ordinary context lines and range metadata
- **AND** the request targets `https://example.test/guide` rather than a URL ending in the selector

#### Scenario: A long render truncates under the native bound

- **WHEN** the rendered text exceeds the native read result bound
- **THEN** the result reports `truncated` and `nextOffset` for the rendered text
- **AND** `path`, `finalUrl`, `method`, and any `notes` remain present

#### Scenario: A repeated read refetches

- **WHEN** the model reads the same locator twice, the second time with a different selector
- **THEN** two requests are issued and the second result reports the content the server returned then
- **AND** no cached render or stored snapshot is reused

#### Scenario: A tail member on a cut adapter document is refused

- **WHEN** the model requests a `-K` member of an adapter document the web plane cut at its 5 MiB document bound
- **THEN** the tool returns `representation_too_large` naming the cut and no content
- **AND** an `N-` member and the ordinary read of that document still return it with the ordinary truncation note

#### Scenario: Adapter provenance preserves the source identity

- **WHEN** a declared rewrite entry renders `https://x.com/jack/status/20` through `https://x.pcstyle.dev`
- **THEN** the result has `method: "adapter"`, `finalUrl: "https://x.com/jack/status/20"`, and an adapter object with route `rewrite` and origin `https://x.pcstyle.dev`
- **AND** its notes state that the content came through the configured origin

### Requirement: Web adapter contract is ordered, admitted, and fallible

The web adapter plane SHALL be a static, code-owned ordered list selected by
`tools.webAdapters`; an absent setting SHALL enable no adapter. Every entry
SHALL provide a pure synchronous `match` over the canonical source URL, a
stable `id`, and one route kind, `native` or `rewrite`. A native route SHALL
contact only fixed first-party origins; a rewrite route SHALL contact only its
operator-declared target origin. Matching SHALL occur only after the source
locator passes the submitted and normalized `read` permission checks and
SHALL precede the generic ladder. A URL an adapter's `match` accepts is
claimed by that adapter; a URL every `match` rejects is unclaimed and SHALL
reach the generic ladder with no adapter request and no note. `:raw` SHALL
bypass every adapter; `:outline` SHALL NOT, and is applied to the claiming
adapter's rendered document.

Every request an adapter derives SHALL pass the same `read`-group admission,
address resolution and pinning, 10-second header bound, 30-second call bound,
5 MiB per-response body bound, and redirect rules as the generic web path.
There SHALL be no adapter request-count cap; the rendered adapter document
SHALL be bounded at 5 MiB. The GitHub `token` SHALL be the only adapter
credential; it SHALL be sent only to `https://api.github.com` and SHALL be
removed before any cross-origin hop. An adapter SHALL never widen the source
permission or bypass address admission.

A claimed URL whose primary request is refused before I/O, answers a non-2xx
status, is rate-limited, cannot be parsed, or renders empty SHALL yield a
bounded note naming the adapter and one failure category — `permission`,
`address`, `status`, `rate_limit`, `transport`, `parse`, `empty`, `binary`,
`too_large`, or `content_type` — and SHALL fall through to the next claiming
adapter, then the generic ladder. A claimed URL whose primary request
succeeded and whose later request for the same document fails, or whose call
deadline or document bound is reached, SHALL render the content that arrived
and attach one note per missing section naming its category. A spent shared
call bound or caller abort before the primary request SHALL end the call
under the existing web contract. A native permission error on the submitted
source request chain SHALL end the call; a permission error on an adapter
chain SHALL disqualify only that adapter. Adapter failures SHALL NOT return a
response body to the model. A successful adapter SHALL use the result
provenance requirement, including the source URL as `finalUrl`. A rendered
adapter outcome SHALL declare the media type of its document so the
representation requirements can decide whether a member applies: the GitHub
adapter labels its issue, pull request, repository, and commit renders
`text/markdown` and a decoded blob by the same extension table the file
sources use; a rewrite adapter forwards the media type its inner render
reports. The label is internal and SHALL NOT be returned as a result field. A successful
adapter MAY return a directory read instead of text; it SHALL be rendered
through the host directory-read path with the call's selector and result
budget, and whatever that path returns, including the host's
`directory_too_large` refusal, SHALL be the call's result with no adapter
note and no fall-through.

#### Scenario: Matching does no network work

- **WHEN** a canonical `github.com` issue URL is passed to the adapter list
- **THEN** the GitHub adapter claims it from URL shape alone
- **AND** no request occurs before the derived API locator is admitted

#### Scenario: An unclaimed URL is untouched

- **WHEN** no configured adapter's `match` accepts the admitted source URL
- **THEN** the generic ladder runs exactly as it does without adapters
- **AND** the result carries no adapter note and no `adapter` object

#### Scenario: A rejected adapter request falls through

- **WHEN** a claimed adapter derives `https://api.github.com/repos/o/r/issues/1`
- **AND** the `read` group rejects that API origin
- **THEN** no request is issued to `api.github.com`
- **AND** a note names the adapter and `permission`, after which the generic ladder may run

#### Scenario: A status or parse failure falls through without its body

- **WHEN** a claimed adapter's primary request answers a non-2xx status, a recognized rate limit, malformed data, or an empty render
- **THEN** the response body is not returned to the model
- **AND** the adapter records a bounded failure note and the next candidate may render the source

#### Scenario: A secondary request failure renders partial content with a note

- **WHEN** an adapter's primary request succeeded and a later request for the same document fails or the call deadline is reached
- **THEN** the content that arrived is rendered
- **AND** each missing section carries one omission note naming its category

#### Scenario: Raw mode skips all adapters

- **WHEN** a source URL is claimed by a configured adapter and the selector is `:raw`
- **THEN** no adapter request is issued
- **AND** the final response body follows the generic raw contract

#### Scenario: A directory result follows the host directory path

- **WHEN** an adapter succeeds with a directory read whose requested level
  exceeds the host per-directory entry budget
- **THEN** the call returns the host's `directory_too_large` refusal
- **AND** no adapter note is added and the generic ladder does not run

#### Scenario: A rewrite result identifies its origin

- **WHEN** a rewrite adapter succeeds through its declared origin
- **THEN** the result preserves the source URL as `finalUrl`
- **AND** `method: "adapter"`, an adapter object with route `rewrite` and that origin, and a provenance note identify it

#### Scenario: An adapter document carries its media type

- **WHEN** the GitHub adapter renders `https://github.com/o/r/issues/1`
- **THEN** its document is labeled `text/markdown` and `:outline` applies to that rendered document with `method: "adapter"` and the `adapter` object retained
- **AND** a decoded `data.json` blob is labeled by its extension, so `:outline` on it fails with `invalid_selector` naming the member's accepted media types

### Requirement: GitHub native adapter reads issues and pull requests

A configured `github` adapter SHALL claim canonical `github.com/{owner}/{repo}/issues/{number}`
and `github.com/{owner}/{repo}/pull/{number}` locators. Owner segments SHALL
match `^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$`; repo segments SHALL match
`^[A-Za-z0-9._-]{1,100}$` and SHALL not be `.` or `..`; numbers SHALL match
`^[1-9][0-9]{0,9}$`. `/pull/{number}.diff`, `/pull/{number}.patch`,
`/pull/{number}/files`, `/pull/{number}/commits`, `/pull/{number}/checks`,
the `/issues` and `/pulls` lists, Actions, Projects, Discussions, search,
gists, `raw.githubusercontent.com`, Enterprise hosts, and every write URL
SHALL be unclaimed. The adapter SHALL use only `GET` requests to
`https://api.github.com` with `Accept: application/vnd.github+json`.

An issue SHALL request `/repos/{owner}/{repo}/issues/{number}` and every
page of `/repos/{owner}/{repo}/issues/{number}/comments`. A pull request
SHALL request `/repos/{owner}/{repo}/pulls/{number}` and every page of
`/repos/{owner}/{repo}/issues/{number}/comments`,
`/repos/{owner}/{repo}/pulls/{number}/reviews`,
`/repos/{owner}/{repo}/pulls/{number}/comments`, and
`/repos/{owner}/{repo}/pulls/{number}/files`, and every page of
`/repos/{owner}/{repo}/commits/{head_sha}/check-runs` requested with
`filter=latest&per_page=100`. The whole document
SHALL be loaded before rendering, subject to the shared call deadline and the
5 MiB document bound; the model SHALL page the rendered text with the ordinary
`:N-M` selector, and each read SHALL refetch.

The issue view SHALL render `# Issue #{number}: {title}`, then the lines
`State`, `State reason` (when present), `Author`, `Created`, `Updated`,
`Labels`, and `URL`, then `## Body` with the body or `No description
provided.`, then `## Comments ({n})`. The pull request view SHALL render
`# Pull Request #{number}: {title}`, then `State`, `Draft`, `Author`, `Base`,
`Head`, `Reviews` as latest-per-reviewer counts (for example
`Reviews: 2 approved, 1 changes requested (latest per reviewer)`),
`Merge state` as the `mergeable_state` value returned, including `unknown`,
`Checks:` as counts from all check-runs pages requested with
`filter=latest&per_page=100` (for example
`Checks: 14 passed, 1 failed (lint), 2 pending`); the counts cover what the
endpoint returns, which GitHub limits to the 1000 most recent check suites.
If a check-runs page after the first does not arrive, the `Checks:` line
SHALL state the loaded counts plus `total_count` minus the loaded runs as
`{n} not loaded` (for example
`Checks: 97 passed, 1 failed (lint), 2 pending, 40 not loaded`); if the first
check-runs page does not arrive, the line SHALL render as
`Checks: unavailable`. A page that answers but cannot be parsed, or a first
page without a numeric `total_count`, SHALL count as not arriving. Either case
SHALL add an omission note naming check runs and its failure category. Then `Created`,
`Updated`, `Labels`, `URL`, and `Diff: https://github.com/{owner}/{repo}/pull/{number}.diff`,
then `## Body`, `## Files ({n})` listing every changed file with its status
and added/deleted counts, `## Reviews ({n})`, `## Review Comments ({n})`, and
`## Comments ({n})`. Every comment, review, and review comment SHALL be one
`### {author} · {timestamp}` heading at the same depth in source order,
followed by `ID`, `Reply to` (when the item answers another), `Location
{path}:{line}` and `Side` (review comments), `State` (reviews, the review's
own state such as `APPROVED`), and `URL` lines, then the body.
No `Review decision` line, patch text, or event timeline SHALL be rendered;
minimized comments SHALL render like any other comment.

Without a configured token, requests SHALL carry no credential and private
repositories SHALL not be claimed as readable. An optional operator token
SHALL be interpolated as a secret and sent only to `api.github.com`; it SHALL
never be sent to a rewrite target, a source host, or a redirected origin. The
token is instance-wide authority: every owner on the instance can address any
repository visible to that token. `429`, or `403` with
`x-ratelimit-remaining: 0` or with `retry-after`, SHALL be classified as
`rate_limit` with reset information when `x-ratelimit-reset` is also
available; `x-ratelimit-reset` alone SHALL not classify a response. Rate
limits are not permission errors and SHALL not be retried.

#### Scenario: An issue renders in the fixed layout with every comment

- **WHEN** the model reads `https://github.com/o/r/issues/12` and the issue has 230 comments
- **THEN** the adapter requests the issue and all three comment pages
- **AND** the rendered text has the title line, the metadata lines, `## Body`, and `## Comments (230)` with one `###` item per comment carrying `ID` and `URL`

#### Scenario: A pull request view carries Reviews, Checks, and Diff lines

- **WHEN** the model reads `https://github.com/o/r/pull/12`
- **THEN** the metadata block has `Reviews:` counts per latest review,
  `Merge state` as returned, `Checks:` counts from all check-runs pages
  requested with `filter=latest&per_page=100`, and `Diff: https://github.com/o/r/pull/12.diff`
- **AND** the `## Review Comments` items carry `Reply to` and `Location` lines
  instead of nested headings

#### Scenario: An unauthenticated GitHub read sends no token

- **WHEN** no GitHub token is configured and the model reads a public issue
- **THEN** the API request has no `Authorization` header
- **AND** the result is still eligible for the native adapter

#### Scenario: A token is never sent to another origin

- **WHEN** a token-backed GitHub API response redirects to another origin or a rewrite entry is next considered
- **THEN** no request to that other origin carries the GitHub token
- **AND** the redirected or rewrite request is either unauthenticated or disqualified

#### Scenario: An instance token has accepted cross-owner authority

- **WHEN** an operator configures a token that can read private repositories and two different llame owners address repositories
- **THEN** both URLs are evaluated under the token's instance-wide authority
- **AND** the runbook identifies this as operator attestation, not tenant isolation

#### Scenario: Rate limit falls through with a note

- **WHEN** GitHub answers a claimed primary request with `403` and `x-ratelimit-remaining: 0`, or with `429` and `x-ratelimit-reset: 123`
- **THEN** the adapter records a `rate_limit` note with the reset information when available
- **AND** it returns no response body and does not retry, allowing the generic ladder to run

#### Scenario: A secondary page failure renders a partial pull request

- **WHEN** the pull request request succeeded and the third review-comment page answers `403` with `x-ratelimit-remaining: 0`
- **THEN** the metadata, body, files, reviews, loaded review comments, and comments are rendered
- **AND** a note states that review comments were omitted with `rate_limit` and the reset time

#### Scenario: Check runs load every page and report an unloaded remainder

- **WHEN** a pull request's check-runs `total_count` is 140 at
  `filter=latest&per_page=100` and the second check-runs page fails after the
  first arrives
- **THEN** both check-runs pages are requested and the 100 loaded runs are
  counted
- **AND** the `Checks:` line ends with `40 not loaded` and an omission note
  names check runs

#### Scenario: A failed first check-runs page renders the line as unavailable

- **WHEN** the pull request request succeeds and the first check-runs page
  fails
- **THEN** the pull request renders with `Checks: unavailable`, never with
  invented zero counts
- **AND** an omission note names check runs and the failure category

#### Scenario: An unparsable check-runs page counts as not arriving

- **WHEN** the first check-runs page answers `200` without a numeric
  `total_count`, or a later check-runs page answers `200` with a body that
  cannot be parsed
- **THEN** the first case renders `Checks: unavailable` and the second renders
  the loaded counts plus the `total_count` remainder from the first page
- **AND** the omission note names check runs with the `parse` category

#### Scenario: Private content without a token is not claimed

- **WHEN** an unauthenticated GitHub API response does not expose a private repository resource
- **THEN** the adapter falls through without claiming private content
- **AND** no API error body is returned to the model

#### Scenario: Unsupported GitHub shapes are unclaimed

- **WHEN** the source is `/pull/12.diff`, `/pull/12/files`, an `/issues` or `/pulls` list, an Actions log, a Project, a Discussion, a search result, a gist, an Enterprise host, or a write URL
- **THEN** the adapter does not claim it and issues no request and no note
- **AND** the generic ladder handles the source exactly as before

### Requirement: GitHub native adapter reads repository code

A configured `github` adapter SHALL claim canonical
`github.com/{owner}/{repo}` repository roots, `/tree/{ref}[/{path}]`,
`/blob/{ref}/{path}`, and `/commit/{sha}` locators, with the owner and repo
grammars above and commit SHAs matching `^[0-9a-fA-F]{7,40}$`. Ref and path
segments SHALL be decoded once, SHALL be non-empty, not `.` or `..`, and free
of `\`, NUL, and control characters, and SHALL be re-encoded with
`encodeURIComponent` when building an API URL. Every request SHALL be a `GET`
to `https://api.github.com`; `raw.githubusercontent.com` SHALL never be
requested.

A blob SHALL request `/repos/{owner}/{repo}/contents/{path}?ref={ref}` with
the ref passed through `URLSearchParams`, base64-decode `content`, and render
valid UTF-8 text line-for-line without a heading, so `:N-M` addresses source
lines. NUL bytes, invalid UTF-8, an `encoding` of `none`, empty content for a
large file, or a declared size over the body bound SHALL be a `binary` or
`too_large` failure that falls through; binary bytes SHALL never be presented
as text. A commit SHALL request `/repos/{owner}/{repo}/commits/{sha}` and
render message, author, timestamp, the changed files with their status and
counts, loaded in pages of 100 until a short page; GitHub lists at most 3,000
files for a commit, so a list that reaches 3,000 files SHALL carry the note
`files omitted: too_large` marking it as possibly incomplete. The rendered
commit is paged with `:N-M` like any adapter document. The view SHALL also render `Diff: https://github.com/{owner}/{repo}/commit/{sha}.diff`; it
SHALL NOT render patches.

A directory SHALL request one
`/repos/{owner}/{repo}/git/trees/{ref}:{path}?recursive=1` (the root:
`/repos/{owner}/{repo}/git/trees/{ref}?recursive=1`), filter the result to
the requested level and one child level, and render the host directory
listing shape: the requested level, then each child directory's first 20
entries in order followed by `… N more`, with the same `… N entries`,
truncation, and range-selector rules as a host directory read. A response
over 5 MiB SHALL be `too_large` and fall through. A non-root directory whose
requested level exceeds the host per-directory entry budget SHALL end the
call with the host's `directory_too_large` error, exactly as a host directory
read does; that is a directory-read outcome, not an adapter failure, and it
does not fall through. A symlink entry (mode
`120000`) SHALL render with the host symlink marker as `- name@`, and a
submodule entry (mode `160000`) with the host special marker as `- name?`.
The repository root SHALL
additionally request `/repos/{owner}/{repo}` and render `Description`,
`Default branch`, `Visibility`, and `Language` lines before the listing, then
`## README` with the decoded `/repos/{owner}/{repo}/readme` content. When the
root's top-level entries exceed the host listing's per-directory entry budget
(the same count a host directory read bounds; child-level samples do not
count), the root SHALL render its metadata and README without the listing and
carry the section omission note `tree omitted: too_large`; this is a
render-time omission note, not an adapter failure, and nothing falls through.

Because a locator does not mark where a ref ends, the adapter SHALL try the
first segment after `tree/` or `blob/` as the ref. On a `404` with segments
remaining, it SHALL request `/repos/{owner}/{repo}/git/matching-refs/heads/{segment}`
and, when that yields no acceptable candidate, `/git/matching-refs/tags/{segment}`;
a candidate is acceptable only when it equals the remaining locator text or
is followed by `/` in it; the longest acceptable candidate SHALL be used and
the contents or tree request retried. A 40-character hexadecimal first
segment SHALL be treated as a SHA without a lookup. A `404` with nothing left
to split SHALL be a `status` failure.

#### Scenario: A public blob preserves source lines

- **WHEN** the model reads `https://github.com/o/r/blob/main/src/a.ts`
- **THEN** the adapter contacts only the admitted `api.github.com` contents endpoint, once
- **AND** the rendered file text is line-for-line so a trailing `:10-20` selector addresses source lines

#### Scenario: A binary or too-large blob falls through

- **WHEN** the GitHub contents object reports binary bytes, invalid UTF-8, `encoding: "none"`, empty large-file content, or a size above the body bound
- **THEN** the adapter records `binary` or `too_large` and returns no file text
- **AND** the source may continue through the generic ladder

#### Scenario: A branch containing a slash resolves through matching refs

- **WHEN** the model reads `https://github.com/o/r/blob/feature/foo/src/a.ts` and `feature/foo` is a branch
- **THEN** the contents request for ref `feature` answers `404`, `matching-refs/heads/feature` returns `refs/heads/feature/foo`, and the contents request is retried with `ref=feature/foo` and path `src/a.ts`
- **AND** a candidate such as `feature-old` is not accepted because it is not followed by `/` in the locator

#### Scenario: A tag shadowing a branch returns the tag's file

- **WHEN** tag `v1` and branch `v1/x` both contain `x/README.md` and the model reads `/blob/v1/x/README.md`
- **THEN** the first contents request at ref `v1` succeeds and the tag's file is returned
- **AND** this documented limit is not treated as an error

#### Scenario: A directory renders as a two-level listing

- **WHEN** the model reads `https://github.com/o/r/tree/main/apps`
- **THEN** one recursive tree request is issued and the listing shows the `apps` entries and each child directory's first 20 entries followed by `… N more`
- **AND** a `:1-10` selector and the result truncation behave as on a host directory

#### Scenario: Symlinks and submodules keep host markers

- **WHEN** a recursive tree response has entries of mode `120000` and `160000`
- **THEN** the symlink renders as `- name@` and the submodule as `- name?`
- **AND** neither renders as a plain file line

#### Scenario: An over-budget directory ends like a host directory

- **WHEN** `https://github.com/o/r/tree/main/big` has more top-level entries
  than the host per-directory entry budget and its tree response is under 5 MiB
- **THEN** the call ends with `directory_too_large`, as a host directory read
  over the budget does
- **AND** no fall-through to the generic ladder occurs

#### Scenario: An over-budget root omits only its listing

- **WHEN** a repository root has more top-level entries than the host
  per-directory entry budget
- **THEN** the metadata lines and `## README` render
- **AND** the listing is replaced by the omission note `tree omitted: too_large`
  and no fall-through occurs

#### Scenario: A repository root renders metadata, listing, and README

- **WHEN** the model reads `https://github.com/o/r`
- **THEN** the repository, tree, and readme endpoints are each requested once
- **AND** the text has `Description`, `Default branch`, `Visibility`, and `Language` lines, the two-level root listing, and `## README`

#### Scenario: A commit renders a summary with a Diff line

- **WHEN** the model reads `https://github.com/o/r/commit/c91b31c0`
- **THEN** the text has the message, author, timestamp, and each changed file with counts, up to 3,000 files
- **AND** `Diff: https://github.com/o/r/commit/c91b31c0.diff` is present and no patch text is rendered

#### Scenario: A commit at GitHub's file limit is marked

- **WHEN** a commit's file pages reach 3,000 files
- **THEN** all loaded files are rendered with counts and the view is paged with `:N-M`
- **AND** the note `files omitted: too_large` marks the list as possibly incomplete

### Requirement: Operator rewrite adapters are validated and opt-in

A `rewrite` adapter entry SHALL be enabled only when an operator declares it.
Its `hosts` SHALL be exact canonical host matches. Its optional
`pathPattern` SHALL be an RE2-compatible regular expression compiled by the
same bounded matcher `tools.permissions` uses, searched unanchored against
the canonical path. Its `target` SHALL be a literal `http` or `https` origin
containing no placeholder, userinfo, or fragment, followed by a path/query
template in which only `{path}` and `{query}` occur: `{path}` is allowed only
in the path and inserts the canonical source path as-is; `{query}` inserts
`encodeURIComponent` of the canonical query without its `?`. Boot SHALL
reject any other placeholder, a placeholder in the scheme, host, or port,
`{path}` in the query, a
non-http(s) target, userinfo, a fragment, a malformed template, or an invalid,
oversized, or unsupported `pathPattern`. Per call the target SHALL be rebuilt
from the template, revalidated against the declared origin and literal path
prefix, admitted, and address-pinned, then fetched once through the
negotiated/text or Readability stages only; no alternate, suffix, or
`llms.txt` probe SHALL run,
and a raw, challenge, or failed render SHALL fall through. The result SHALL
keep the source URL as `finalUrl`, report `method: "adapter"` with route
`rewrite` and the declared origin, and note that content came through the
configured origin. The runbook example SHALL be
`https://x.pcstyle.dev{path}` for `x.com` and `twitter.com` status paths,
and SHALL state that the source path reaches that origin.

#### Scenario: A declared rewrite renders an x.com source

- **WHEN** a rewrite with hosts `x.com` and `twitter.com` and target `https://x.pcstyle.dev{path}` is declared and the model reads `https://x.com/jack/status/20`
- **THEN** `https://x.pcstyle.dev/jack/status/20` is admitted and address-pinned before one fetch through the local stages
- **AND** the result keeps `https://x.com/jack/status/20` as `finalUrl` and names `https://x.pcstyle.dev`

#### Scenario: A rewrite is off unless declared

- **WHEN** no rewrite entry matches a source host
- **THEN** no rewrite target is contacted
- **AND** other configured adapters or the generic ladder may run

#### Scenario: Placeholder data cannot alter the target shape

- **WHEN** the source is `https://x.com/a&admin=1` or its query contains `/`, `?`, `#`, or `@`
- **THEN** the rebuilt target keeps the declared origin and literal path prefix and the inserted text remains data
- **AND** a rebuilt target that leaves the declared origin is refused before any request

### Requirement: Read representations are selected by media type and member

A representation SHALL be selected from a closed, compile-time table keyed by
the admitted content's media type and the requested member. The table SHALL
hold the `raw` and `outline` members; it
SHALL NOT be runtime-configurable, operator-loadable, or dynamically imported.
A member SHALL belong to one of two output classes: a `:` member returns
verbatim source lines with a shown range (`raw` without generated line
prefixes, as raw reads always have, and `outline` with the ordinary
line-number prefixes), and a future `?` member would return transformed
content with no prefixes and no shown range; no `?` member and no `?` grammar
exists yet. With no member named, reading SHALL remain unchanged except that an ordinary ranged Markdown read SHALL prepend the direct ancestor headings under the ranged Markdown ancestor requirement. A member
requested for a media type the table does not map SHALL fail with
`invalid_selector` naming the member's accepted media types, and the ordinary
read of that source SHALL remain available.

The media type SHALL be derived from the source, never from the body's
appearance: a host, `file://`, `kb://`, or `skill://` regular file by the
extension table `.md`, `.markdown`, `.mdown`, and `.mkd` to `text/markdown`,
with `.mdx` excluded and every other extension mapping to no
representation-eligible type; a web ladder result by its stage —
`text/markdown` for a `negotiated` response whose `Content-Type` is
`text/markdown` and for `alternate`, `md-suffix`, `readability`, and
`llms-txt`, the served type for `text` and for a `negotiated` `text/plain`
body, and none for `raw`; a web adapter result by the label the adapter
contract requires. A reader SHALL receive only the admitted decoded content as
a sequence of native lines, the source display identity, and the selector's
source scope; a file source SHALL feed those lines as it reads them rather
than decoding the whole file first. A reader SHALL NOT change source
admission, permission projection, owner resolution, executor binding, request
policy, or the source-specific result envelope. Readers over
bytes rather than decoded text SHALL define their own input contract rather
than widening this one.

#### Scenario: A Markdown file selects the outline reader

- **WHEN** the model calls `read` with an authorized Markdown file and the `:outline` member
- **THEN** the result has `representation: "outline"` and contains the deterministic outline
- **AND** the source is admitted exactly as it is for an ordinary read

#### Scenario: An omitted member keeps the existing read

- **WHEN** the model reads an authorized Markdown file without a member
- **THEN** the result uses the existing text representation and line-numbered source content
- **AND** no outline is appended or inferred; a ranged Markdown read prepends its ancestor headings under the ranged Markdown ancestor requirement.

#### Scenario: An unsupported media type names the accepted types

- **WHEN** the model requests `:outline` for an otherwise readable `.json`, `.mdx`, `.pdf`, `.txt`, or binary file, or for a web read whose result is `text`, `raw`, or a `negotiated` `text/plain` body
- **THEN** the tool returns `invalid_selector` naming `text/markdown` as the member's accepted media type
- **AND** an ordinary read of that source is unchanged

#### Scenario: Admission denies the submitted locator before any parse

- **WHEN** permission admission denies the submitted `:outline` locator, including a host rule that matches the selector-free submitted text
- **THEN** the tool returns the same `permission_denied` result as the ordinary read
- **AND** no media-type derivation or Markdown scan is attempted

#### Scenario: Web ladder Markdown supports outline

- **WHEN** a web read's result method is `alternate`, `md-suffix`, `readability`, or `llms-txt`, or is `negotiated` with a `text/markdown` response
- **THEN** `:outline` scans that rendered body and its line numbers refer to the rendered text
- **AND** the web envelope and provenance remain present

#### Scenario: A directory or catalog is not an outline document

- **WHEN** the model requests `:outline` on a host, `file://`, `kb://`, or `skill://` directory, on `skill://`, or on a web read whose adapter returned a directory result
- **THEN** the tool returns `invalid_selector`
- **AND** it does not reinterpret the listing as headings or return a listing page as outline content

### Requirement: Markdown outlines are verbatim structural lines

For Markdown content, `:outline` SHALL return, in source order and each with
its ordinary line-number prefix, exactly these source lines: the frontmatter
lines the frontmatter requirement selects; the first non-blank line of the
document that precedes the first root heading and is not itself a heading line
(the root excerpt); and, for every root heading, its heading lines (one line
for an ATX heading; every text line plus the underline for a setext heading)
followed by the first non-blank line of its section that is not a heading
line, whatever that line is. A heading immediately followed by another heading
or by the end of the document has no excerpt line. Each native line SHALL be
emitted at most once, even when a lone CR lets it hold more than one root
heading. Every emitted line SHALL be
the source line verbatim, cut at 120 UTF-16 code units with a trailing `…` when
longer, backing up one unit rather than splitting a surrogate pair; the only text the outline generates is that marker and the
frontmatter elision line. The output SHALL contain no synthesized heading
text, no section end coordinates, no summary, no body excerpt beyond the one
line, and no heading-name selector. A Markdown document with no root headings
SHALL return its frontmatter lines, if any, and its root excerpt, if any; an
empty document SHALL return the ordinary empty-file result with null ranges.

#### Scenario: An outline is the document's structural lines

- **WHEN** an authorized file holds `# Guide` on line 1, `Intro sentence.` on line 3, `## Install` on line 5, ` ```bash ` on line 7, `## Use` on line 12, and `### Flags` on line 14 with `Flag text.` on line 16
- **THEN** the outline content is `1: # Guide`, `3: Intro sentence.`, `5: ## Install`, `7: ```bash`, `12: ## Use`, `14: ### Flags`, `16: Flag text.` and nothing else
- **AND** `12: ## Use` has no excerpt line because its next line is a heading, and reading `:14-16` addresses the `Flags` section

#### Scenario: A setext heading shows its underline

- **WHEN** a file holds `Two` on line 8 and `===` on line 9
- **THEN** the outline contains `8: Two` followed by `9: ===`
- **AND** neither line is rewritten as `# Two`

#### Scenario: A long line is cut, not rewritten

- **WHEN** a heading or excerpt line is longer than 120 code units
- **THEN** the outline emits its first 120 code units followed by `…`, or its first 119 when the 120th would split a surrogate pair
- **AND** a line of exactly 120 code units is emitted whole

#### Scenario: A document without headings shows its opening line

- **WHEN** an authorized Markdown file has no root heading and its first non-blank line is line 3
- **THEN** the outline content is `3: <that line>` after any frontmatter lines
- **AND** the result is a successful read with `representation: "outline"`

#### Scenario: Duplicate headings are told apart by line

- **WHEN** a file contains `## Notes` at lines 10 and 40
- **THEN** the outline contains `10: ## Notes` and `40: ## Notes`, each with its own excerpt line
- **AND** no selector addresses either occurrence by name

### Requirement: Markdown heading sections use deterministic CommonMark boundaries

The outline SHALL recognize CommonMark ATX headings and setext headings only
at the root document level, outside fenced code blocks, indented code blocks,
frontmatter, and HTML blocks. Headings nested in list items or blockquotes
SHALL NOT produce entries. An ATX heading starts at its ATX line. A setext
heading starts at its first text line and includes its underline line. One
leading U+FEFF on line 1 SHALL be ignored for recognition, as CommonMark
ignores it, and SHALL stay in the emitted line, which remains verbatim. A
heading's section SHALL begin at its first heading line and end at the line
immediately before the next root heading whose depth is less than or equal to
its own, or at the source's last line; a deeper heading remains inside the
nearest preceding shallower section. Section boundaries are used by the scope
and ancestor requirement and by the shared structure primitive; they are not
printed. Heading text SHALL be source-derived and untrusted.

#### Scenario: Nested sections end at the same or a shallower level

- **WHEN** a level-two heading at line 5 is followed by a level-three heading at line 9 and another level-two heading at line 20
- **THEN** the level-three section is lines 9 through 19
- **AND** the first level-two section is lines 5 through 19, containing it

#### Scenario: Fenced and indented code are not headings

- **WHEN** fenced or indented code contains lines such as `# not a heading`
- **THEN** those lines produce no outline entry
- **AND** surrounding real headings keep their line numbers

#### Scenario: HTML blocks are not headings

- **WHEN** an HTML block contains a line beginning with `# not a heading`
- **THEN** that line produces no outline entry
- **AND** a Markdown heading after the closed HTML block is recognized normally

#### Scenario: Container headings are excluded

- **WHEN** `- # in list` and `> ## in quote` precede `# Real` at line 3 of a three-line Markdown file
- **THEN** the outline contains `1: - # in list` as the root excerpt, because a list item is a content line, and `3: # Real` as the only heading entry
- **AND** no heading entry is produced for the list-item or blockquote heading

#### Scenario: A thematic break is not a setext underline

- **WHEN** a blank line precedes `---`
- **THEN** no heading is produced
- **AND** `Two` immediately followed by `---` is a depth-two setext heading

#### Scenario: A leading byte order mark is ignored for recognition

- **WHEN** a Markdown file begins with U+FEFF followed by `# Title` on line 1
- **THEN** line 1 is a root heading and the outline emits it verbatim, byte order mark included
- **AND** a line-one `---` preceded by U+FEFF still opens frontmatter

### Requirement: Frontmatter is shown as authored key lines

Only a block that starts at line 1 with `---` and closes with a later `---`
or `...` line SHALL be frontmatter; a delimiter line matches when its content,
after removing one trailing CR and any trailing spaces or tabs, is exactly
`---` or `...`, so CRLF files are recognized. A closed block SHALL be excluded
from heading recognition regardless of its contents. The outline SHALL emit
both delimiter lines and, between them, every top-level key line: a block line
that begins at column zero with a character other than whitespace, `#`, or
`-`. Indented lines, comments, and sequence items SHALL NOT be emitted. After
32 key lines the outline SHALL emit one generated line
`[… N more frontmatter lines]` in place of the rest, where N counts the omitted
key lines; that line carries no line-number prefix and no source coordinate
and does not extend the shown range. No YAML, TOML, or JSON parsing SHALL be performed and no note SHALL
be emitted for a block that would not parse. An unclosed line-one opener SHALL
NOT be frontmatter and SHALL be parsed as ordinary Markdown; a later `---` with
no closed line-one block is ordinary Markdown.

#### Scenario: Frontmatter keys precede the headings

- **WHEN** a skill file begins `---`, `name: octocat`, `description: Use for GitHub.`, `---`, then `# Octocat` on line 5
- **THEN** the outline begins `1: ---`, `2: name: octocat`, `3: description: Use for GitHub.`, `4: ---`, `5: # Octocat`
- **AND** no YAML line becomes a heading

#### Scenario: Nested values show their key only

- **WHEN** the block holds `tags:` on line 3 followed by an indented `- notes` sequence item on line 4 and `title: >` on line 5 followed by an indented folded scalar
- **THEN** the outline emits `3: tags:` and `5: title: >` and neither indented line
- **AND** a `# comment` line inside the block is not emitted

#### Scenario: A long frontmatter block is elided

- **WHEN** a note's closed block holds 60 top-level keys
- **THEN** the outline emits the first 32 key lines followed by `[… 28 more frontmatter lines]` and then the closing delimiter
- **AND** the headings that follow are unaffected

#### Scenario: A malformed block still shows its lines

- **WHEN** a closed line-one block is not valid YAML, or is a scalar rather than a mapping, and the body contains a valid heading
- **THEN** the outline emits the block's delimiter and key lines as they are and the body heading, with no note
- **AND** no line of the block becomes a heading

#### Scenario: An unclosed opener is ordinary Markdown

- **WHEN** a line-one `---` opener has no closing `---` or `...` and the body contains a valid heading
- **THEN** the outline parses the document as ordinary Markdown and emits no frontmatter lines
- **AND** the body heading keeps its line number

#### Scenario: CRLF frontmatter is recognized

- **WHEN** a CRLF Markdown file begins `---`, `title: X`, `---`, `# Body`, each line ending in CRLF
- **THEN** the closed block is excluded from heading recognition and the outline emits `1: ---`, `2: title: X`, `3: ---`, `4: # Body`
- **AND** the CR is not part of the delimiter match

### Requirement: Outline scope prepends the direct ancestors

`:outline:N-M` (and `:outline:N` for `N-N`, `:outline:N+K` for the `K` lines
from `N`, as ordinary `:N+K` selects, `:outline:N-` for the lines from `N`
through the source's last line, and `:outline:-K` for its last `K` lines, each
resolved against the source's count as an ordinary range member is) SHALL
restrict the emitted lines to those whose source line lies in the
scope, and SHALL prepend the direct ancestor chain of source line `N`: the
root headings whose sections contain `N`, from the shallowest to the deepest,
each rendered as an in-scope heading is (its heading lines and its excerpt
line) restricted to lines before `N`, because lines from `N` on follow the
in-scope rule, and each omitted when its own lines already lie in scope.
The ancestor chain is context: when the chain together with the first
in-scope entry does not fit the shared serialized result cap or the
2,000-line ceiling, the chain SHALL be omitted whole, so a continuation read
always advances. The omission is silent: `truncated` and `nextOffset` report
only in-scope output that was cut. A scope that holds no entry after its
chain is omitted SHALL return a successful outline with empty content and a
null shown range.
Frontmatter lines and the
root excerpt appear only when their source lines lie in scope. A scope that
begins past the source's last line SHALL fail as an ordinary range past the
end does. No comma-separated scope SHALL be accepted.

#### Scenario: A scope shows the headings it contains and what encloses them

- **WHEN** a file holds `# Title` at line 1, `## Setup` at line 30, `### Linux` at line 44, `### macOS` at line 70, and `## Use` at line 100, and the model reads `:outline:60-90`
- **THEN** the outline is the ancestor chain of line 60, `1: # Title`, `30: ## Setup`, and `44: ### Linux` with their excerpt lines before line 60, then `70: ### macOS` with its excerpt line
- **AND** `100: ## Use` is absent because line 100 lies outside the scope

#### Scenario: A single line answers with its ancestors

- **WHEN** the model reads `:outline:65` of that file
- **THEN** the outline is `1: # Title`, `30: ## Setup`, `44: ### Linux` with their excerpt lines
- **AND** nothing after line 65 is emitted

#### Scenario: An ancestor chain larger than the result is omitted

- **WHEN** a root setext heading has text on lines 1 through 3,000 and its `===` underline on line 3,001, its section holds `first body` on line 3,003, `## In scope` on line 3,550, and `scope body` on line 3,552, and the model reads `:outline:3500-3600`
- **THEN** the outline is `3550: ## In scope` and `3552: scope body`, without the omitted chain
- **AND** `truncated` is false, and an unscoped outline of the same file that is cut at the 2,000-line ceiling continues through `:outline:<nextOffset + 1>-M` without repeating a result

#### Scenario: A scope with no entry returns an empty outline

- **WHEN** the model reads `:outline:3500` of that file, whose line 3,500 lies in the heading's section body
- **THEN** the result is a successful outline with empty content, a null shown range, and `truncated: false`
- **AND** it carries no `nextOffset`

#### Scenario: A scope past the end is refused

- **WHEN** the model reads `:outline:500-600` of a 120-line file
- **THEN** the tool returns `invalid_selector` under the ordinary out-of-range rule
- **AND** no outline content is returned

#### Scenario: A scope reaches the last line or the tail of a source

- **WHEN** the model reads `:outline:60-` of the file whose `## Use` sits at line 100 and whose last line is 120
- **THEN** the outline carries the ancestor chain of line 60 and every entry whose source line lies in 60 through 120
- **AND** `:outline:-20` of that file is the same scope as `:outline:101-120`, with the chain of its first line prepended

### Requirement: Outline output obeys explicit bounds

The Markdown reader SHALL scan the source in one forward pass, holding only
the open container and heading stacks, the lines it will emit, and the lines
whose meaning a later line decides (an open root paragraph that a setext
underline may turn into a heading, a paragraph whose first line may open a
link reference definition, and the lines after a line-one `---` until its
closer), so a file source SHALL have no input size ceiling beyond the
abort signal; a web body and an adapter document keep the web plane's 5 MiB
bounds. A source that is one undecided run, such as a single paragraph with
no blank line or a line-one `---` that never closes, is held until that run
is decided. The scan SHALL stop once the lines through the scope end are decided
or the result budget is spent. Outline output
SHALL obey the shared serialized result cap and 2,000-line ceiling; when it is
cut, `truncated` SHALL be true and `nextOffset` SHALL be the zero-based index
of the first omitted entry's source line, where an entry is one emitted line,
so an outline is cut between lines and never inside one, as every read result's
`nextOffset` is, so `:outline:<nextOffset + 1>-M` continues it against
the source observed by that later call. An adapter document the web plane
truncated at its document bound SHALL fail with `representation_too_large`
and SHALL return no partial outline, because an outline of a cut document
would omit structure without saying so. Line numbers SHALL use the native LF
line model that ordinary reads use. A successful outline SHALL not imply a
source snapshot: a later range read reauthorizes and rereads the current
source.

#### Scenario: A large file is outlined in one pass

- **WHEN** the model requests `:outline:40000-41000` of a 200 MiB Markdown file of ordinary blank-line-separated sections
- **THEN** the outline is returned without the file being loaded whole
- **AND** an ordinary range read of that file follows the ranged Markdown ancestor rule

#### Scenario: A long outline reports continuation

- **WHEN** the outline exceeds the shared line or serialized result bound
- **THEN** the result reports `truncated: true` and `nextOffset` as the zero-based index of the first omitted entry's source line
- **AND** a read of `:outline:<nextOffset + 1>-M` continues from that entry

#### Scenario: A truncated adapter document has no outline

- **WHEN** an adapter document was cut at the web plane's 5 MiB document bound and the model requests `:outline`
- **THEN** the tool returns `representation_too_large`
- **AND** no partial outline is returned, while the ordinary adapter read still returns its truncated document and note

#### Scenario: Line numbers use the native LF line model

- **WHEN** a Markdown source contains CRLF, a lone CR, and a trailing LF
- **THEN** outline line numbers count LF delimiters exactly as ordinary native reads count them, keep lone CR inside a line, and add no line for the trailing LF
- **AND** every emitted prefix is a valid ordinary selector line

#### Scenario: Outline coordinates are execution-time coordinates

- **WHEN** the source changes between an outline call and a later ordinary range read
- **THEN** the later read uses the current source and may return different text for the old range
- **AND** neither call claims a snapshot or stale-selection authority

### Requirement: Representation output preserves source attribution and authority

An outline SHALL run only after the same source admission, permission
decision, owner resolution, and content acquisition that an ordinary `read`
would use. It SHALL preserve the ordinary source identity and result envelope:
host results retain host path behavior, `file://` results retain the decoded
host identity, `kb://` results retain their locator, Space identity, and
closed untrusted-content notice, `skill://` results retain their published
skill paths, and web results retain `path`, `finalUrl`, `method`, the
`adapter` object when present, and `notes`. Emitted lines SHALL remain
untrusted content and SHALL NOT become instructions or authority. An outline
line number SHALL grant no access not already granted to the original locator.

#### Scenario: Host and Knowledge outlines are structurally equivalent

- **WHEN** equivalent Markdown is read through an authorized absolute host path and an authorized `kb://` locator
- **THEN** both outlines contain the same lines with the same prefixes
- **AND** the host result has host identity while the Knowledge result has its Space attribution and untrusted-content notice

#### Scenario: Knowledge outline remains untrusted

- **WHEN** a Knowledge Markdown heading contains an instruction-like string
- **THEN** the outline returns that heading line as untrusted content with the Knowledge notice
- **AND** the heading cannot change tool availability, owner identity, or read authority

#### Scenario: Skill outline retains path disclosure rules

- **WHEN** the model requests `:outline` for an eligible `skill://` Markdown resource
- **THEN** the outline result retains the skill locator, resolved path, skill directory, and existing skill instruction envelope
- **AND** the outline does not grant mutation or script execution

#### Scenario: Web outline retains provenance

- **WHEN** an admitted web adapter produces a Markdown document and the model requests `:outline`
- **THEN** the result retains the source `path`, `finalUrl`, `method: "adapter"`, the `adapter` object, and any notes
- **AND** the outline does not expose an adapter credential or turn the rendered content into authority

### Requirement: Ranged Markdown reads prepend their ancestor headings

An ordinary, non-`:raw`, non-`:outline` ranged `read` of a `text/markdown`
source SHALL prepend the direct root-heading ancestor chain of each passage's
first requested source line N, shallowest first. The preceding context line at
N-1 remains shown but does not select headings. Each ancestor SHALL be rendered
from its own source lines with the ordinary one-based `N:` prefix followed by a
space. An ATX heading contributes its heading line; a setext heading
contributes all of its text lines plus its underline, verbatim. The chain SHALL
NOT include an excerpt line and SHALL NOT apply the outline reader's 120-code-
unit cut. A heading line already shown by the context-expanded window or an
earlier chain SHALL NOT be repeated. A heading whose own lines include line N,
such as a setext heading whose text line or underline is requested, is N's own
heading and SHALL NOT be emitted as N's ancestor.

A single-range result that emits at least one ancestor line SHALL use the plural
`requestedRanges` and `shownRanges` fields. Its `requestedRanges` SHALL contain
only the requested source interval, while its `shownRanges` SHALL contain the
ancestor lines and the ordinary context-expanded window, merging adjacent
intervals. A range with no emitted ancestor SHALL retain the singular result
shape. Comma-separated reads SHALL apply this rule independently to every
merged passage using that passage's first requested line, deduplicate by source
line, and keep the content in source order: a chain emits only heading lines
before its passage's first shown line, and a chain line that would precede
content already emitted SHALL be skipped. A chain heading whose earlier lines
an earlier passage already emitted therefore contributes only its remaining
lines, which directly follow those emitted lines, so a setext heading's text
lines and underline are never separated by other output.

Ancestor lines SHALL count against the shared 2,000-line ceiling and serialized
result bound. If a passage's complete chain plus all mandatory output through
the first requested line N does not fit, including the N-1 context line when it
is shown and not already emitted and line N, whole headings SHALL be dropped
from the outermost end until the deepest remaining heading plus that mandatory
output fits. A setext heading's text lines and underline SHALL be dropped as
one unit. If even the deepest heading does not fit, no chain SHALL be emitted
and the passage window SHALL still be returned when it can fit. `nextOffset`
keeps its existing meaning for single- and multi-range reads and never
identifies a line emitted only as an ancestor. A continuation at
`nextOffset + 1` SHALL calculate a fresh chain, so an ancestor MAY reappear
across continuations. A trimmed or absent chain SHALL be silent and SHALL NOT
add a flag field.

A ranged read SHALL never read past its requested window. The Markdown scanner
SHALL end at the window end; a line whose role is undecided at that boundary
SHALL count as not a heading for this read. An open paragraph that might become
a setext heading and an unclosed line-one `---` block SHALL be replayed as
Markdown rather than resolved with later input.

The rule SHALL apply uniformly to host paths, `file://`, `kb://`, `skill://`,
and web renders labeled `text/markdown`, after existing permission admission
and source resolution. It SHALL preserve each source's existing identity,
Knowledge attribution and untrusted-content notice, web provenance, and
execution-time coordinates. `:raw`, `:outline`, directory reads, unselected
reads, empty files, non-Markdown reads, and `edit`/`write` post-edit previews
SHALL remain unchanged.

#### Scenario: A ranged read prepends its enclosing headings

- **WHEN** a Markdown file has `# Level one` at line 13, `## Level two` at line 32, `### Level three` at line 54, and a read requests `VISION.md:60-72`
- **THEN** the result emits the following source lines in order, including the ordinary context lines at 59 and 73:

  ```text
  13: # Level one
  32: ## Level two
  54: ### Level three
  59: <context line>
  60: ... through 72: <requested lines>
  73: <context line>
  ```

- **AND** the result reports `requestedRanges: [{startLine: 60, endLine: 72}]` and `shownRanges` covering `{13,13}`, `{32,32}`, `{54,54}`, and `{59,73}`

#### Scenario: Setext ancestors retain all text lines and the underline

- **WHEN** the first requested line of a Markdown passage is enclosed by a setext heading whose text occupies lines 9 and 10 and whose underline occupies line 11
- **THEN** all three source lines are emitted verbatim before the passage
- **AND** the three adjacent ancestor lines appear as one `{startLine: 9, endLine: 11}` interval in `shownRanges`

#### Scenario: A requested line inside a setext heading is not its own ancestor

- **WHEN** the first requested line of a Markdown range is a text line of a setext heading that begins before the preceding context line
- **THEN** that heading's earlier text lines are not emitted as ancestors
- **AND** only the headings enclosing that setext heading are prepended

#### Scenario: An ancestor adjacent to the context line merges

- **WHEN** an ancestor heading is immediately before the preceding context line for a requested Markdown range
- **THEN** the heading, context line, requested lines, and following context line are emitted once in source order
- **AND** the adjacent heading and context line are represented in one merged `shownRanges` interval

#### Scenario: A window starting on a heading does not repeat it

- **WHEN** the requested line of a Markdown range is itself a heading already present in the selected window
- **THEN** the direct ancestor chain selected by that requested line is emitted before the window
- **AND** that heading source line appears only once

#### Scenario: No enclosing heading keeps the singular shape

- **WHEN** an ordinary Markdown range starts in content before any root heading, or starts at line 1
- **THEN** the read returns its existing context-expanded content
- **AND** it retains singular `requestedRange` and `shownRange` fields and emits no ancestor line

#### Scenario: An edit preview of a Markdown file has no ancestors

- **WHEN** `edit` or `write` produces a post-edit preview for a Markdown file whose changed region has an enclosing heading
- **THEN** the preview retains its existing context and line-range behavior without ancestor headings
- **AND** the mutation result does not promote its singular `shownRange`

#### Scenario: Non-Markdown `.txt` remains unchanged

- **WHEN** an ordinary range selects content from a `.txt` file with heading-looking lines
- **THEN** the result has the existing text-read content and context behavior
- **AND** it emits no ancestor headings and does not promote its range fields

#### Scenario: `:raw` remains unchanged

- **WHEN** the model reads a Markdown range with `:raw`
- **THEN** the selected source bytes remain verbatim without context or generated prefixes
- **AND** no ancestor line is emitted

#### Scenario: `:outline` remains unchanged

- **WHEN** the model reads a scoped Markdown range with `:outline`
- **THEN** the result follows the outline representation's existing scope, ancestor, excerpt, and output rules
- **AND** ordinary ranged-read ancestors are not added a second time

#### Scenario: A comma read with two passages emits a shared ancestor once

- **WHEN** a Markdown file has one root heading enclosing two disjoint requested passages in different child sections and the model requests both in one comma selector
- **THEN** each passage is preceded by its direct ancestor chain, in source order
- **AND** the shared root heading is emitted once, while each distinct child heading is emitted once before its own passage
- **AND** `requestedRanges` excludes all ancestor lines and `shownRanges` includes them

#### Scenario: A setext ancestor straddling an earlier passage continues it

- **WHEN** an earlier passage of a comma-separated Markdown read shows a setext heading's leading text lines but not its underline, and that heading encloses a later passage's first requested line
- **THEN** the later passage's chain emits only the heading's unshown remaining lines, directly after the earlier passage's last line
- **AND** no heading line is repeated or emitted out of source order

#### Scenario: A continuation at `nextOffset + 1` gets its own chain

- **WHEN** a truncated Markdown range returns a `nextOffset` inside a section and the caller retries from `nextOffset + 1`
- **THEN** the retry emits the direct ancestor chain for the retry's first requested line when it fits
- **AND** the retry does not treat the earlier result's chain as carried state

#### Scenario: Outermost headings are dropped first when a chain does not fit

- **WHEN** the chain is `# Title`, `## Setup`, and `### Linux`, and the shared budget fits only one heading line plus all mandatory output through the first requested line, including a shown and not already emitted N-1 context line and line N
- **THEN** the result emits `### Linux` and the requested passage, without `# Title` or `## Setup`
- **AND** whole setext headings are dropped as units, and if even the deepest heading cannot fit the passage window still returns when it can without emitting a chain

#### Scenario: Web Markdown renders get ancestors and web `text/plain` does not

- **WHEN** the web read renders one locator as `text/markdown` and another as `text/plain`, both with the same ordinary range selector
- **THEN** the Markdown result includes its ancestor headings and the plain-text result does not
- **AND** both results retain their existing web `path`, `finalUrl`, `method`, adapter, notes, and truncation behavior

#### Scenario: A `kb://` ranged read gets ancestors and keeps Space attribution and notice

- **WHEN** the model reads a Markdown note through `kb://<space-id>/notes/guide.md:60-72`
- **THEN** the result includes the direct ancestor chain and ordinary context lines for that note
- **AND** it retains the Space identifier, display name, locator, and untrusted-content notice
