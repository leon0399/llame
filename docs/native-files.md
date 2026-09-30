# Native file tools

Native `read`, `edit`, and `write` select their authority from the scheme of
their `path` argument. An absolute path executes on the worker's filesystem
with its OS user's authority, gated by `tools.nativeExecutorId`. A
`kb://<knowledgeSpaceId>/<path>[:selector]` locator resolves through the
trusted Run owner's current Knowledge Space access instead, gated by
`knowledge.root`, and never binds the Run to an executor. This alpha
capability supplies no per-user or per-path filesystem permissions or sandbox
on either path; `kb://` narrows exposure to one owner-scoped directory tree.

## Enabling

Absolute-path access and `bash` need a trusted host identity in
`llame.config.json`, then a restart of the API and worker:

```json
{
  "tools": {
    "nativeExecutorId": "personal-host-a",
    "allowed": ["read", "edit", "write", "bash"]
  }
}
```

`kb://` locators need only a configured `knowledge.root`; `tools.allowed`
still gates each tool id. A process with `knowledge.root` and no
`nativeExecutorId` advertises `read`, `edit`, and `write`, all usable with a
locator — an absolute path argument on that process fails closed with
`executor_unavailable` instead of resolving through the Knowledge root.

Optional trusted bash cwd (defaults to the API process cwd):

```bash
BASH_WORKING_DIRECTORY=/absolute/project
```

Keep any other desired tool ids in `allowed`. Each distinct host filesystem
needs a distinct, stable `nativeExecutorId`. Co-located API and worker processes
that use the same native filesystem should use the same identity. Without it,
absolute-path native access and `bash` are unavailable even when allowlisted.

## Permission modes

`tools.permissionModes` is an ordered list of per-Run modes. It defaults to
`["default"]` and must always include `default`, so a fresh install does not
offer `bypass`. Add `bypass` to make it selectable:

```json
{
  "tools": {
    "permissionModes": ["default", "bypass"]
  }
}
```

The setting is instance-wide: enabling `bypass` enables it for every
authenticated user, with no per-user gate. Restart the API and every worker
after changing it so the enabled list is consistent. A Run accepted as
`bypass` uses the worker's effective mode; a worker whose own list omits
`bypass` executes that attempt in `default` under its startup policy.

For an attempt whose effective mode is `bypass`, every `tools.permissions`
evaluation is admitted without evaluating the policy: the per-call gate,
web-read derived locators and resolved addresses, both submitted and
canonical `enter_workspace` paths, and the per-attempt Workspace re-check.
This includes paths and addresses that the configured rejects would otherwise
refuse.

`bypass` does not disable `tools.allowed` availability or catalog admission,
owner or tenant authorization (including ownership checks for `kb://`), native
locator validation, Workspace path projection or other Workspace re-check
conditions, the native recovery fence, web-read header, call, body, and
redirect bounds, Run step or call-timeout caps, or MCP environment isolation.
The configured native executor, existing-directory checks, and `realpath`
validation still apply.

Treat `bypass` as a destructive operator choice. A fetched page can steer the
model into any tool call in the admitted catalog, including calls that the
normal `tools.permissions` policy rejects.
Entering a Workspace whose path would normally be rejected also starts its
Workspace MCP servers; they run unsandboxed as the `llame` user. Enabling
`bypass` therefore exposes every authenticated user to prompt-injection and
Workspace MCP risks; keep it off unless that instance-wide trust boundary is
intended.

Each bypass admission still writes an owner-private allow decision with reason
`permission_mode_bypass`, the executing process's policy-instance id, and no
clause reference. This covers the call, web-read derived-locator, and
canonical Workspace records; bypassed address checks do not create address
records because those are recorded only for refused addresses. The decision
metadata is not model-visible.

## Workspace entry

`enter_workspace({ path })` and `exit_workspace({})` are native host
capability tools. Both require `tools.nativeExecutorId`, their own
`tools.allowed` entry, and their own `tools.permissions` group. Entry accepts
only an absolute path. It evaluates the submitted spelling against the
`enter_workspace` group before probing the filesystem, then canonicalizes it
with `realpath` and requires an existing directory. The canonical path is
evaluated independently by the same group; both decisions need an allow and
must avoid every reject. A reject or missing allow on either spelling vetoes
entry, and the stored binding is always the canonical absolute path.

The binding belongs to the owner's Chat and is sticky across Runs on the same
native executor. It remains until `exit_workspace`, a successful switch, or a
failed Run-preparation re-check. Re-entry at the same canonical root is a
no-op. Preparation detaches a binding when the executor is absent or differs,
the root is missing or no longer a directory, its `realpath` moved, the
current entry permission no longer allows it without a reject, or
`enter_workspace` is no longer allowlisted. A detached binding is not restored
automatically; a later successful entry is required.

While entered, a relative local `read`, `edit`, or `write` path, and a
relative Bash `cwd`, is resolved lexically from the canonical root like
POSIX `path.resolve`. `..` may leave the root: Workspace entry selects a
working root but is not filesystem confinement. A submitted trailing
separator is preserved in the projected absolute string, and projection
does not call `realpath`; symlinks are followed by the host OS as for any
absolute path. Absolute paths and recognized `kb://`, `skill://`, `http://`,
and `https://` locators keep their existing authority. Without a binding,
relative native-file paths remain invalid.

An omitted Bash `cwd` uses the canonical Workspace root while entered and the
host/API default otherwise. Each Bash call remains a fresh process. The
native executor runs under its host OS user, so an entered root does not
confine Bash, file tools, symlink traversal, or other host operations.

The recommended policy in `llame.config.json.example` uses an
operator-edited `enter_workspace.path` field allow such as
`^/home/operator/projects/[^/]+/?$`, plus F1-F3 credential rejects and E1-E3
rejects for `node_modules`, temporary roots, and `Downloads`. Every directory
that this group admits is trusted to run code and read host secrets through
its Workspace MCP configuration. W1 and W2 reject case-insensitive text paths to
`.mcp.json` and `.llame`, `.agents`, or `.claude` trees for both `edit` and
`write`. These are text-only policy rejects: an in-repository alias such as a
symlink can bypass them, and there is no executor-level guard.

See [Workspace MCP](mcp-tools.md#workspace-mcp) for configuration
precedence, interpolation, client lifetime, and redaction limits.

## Instruction files

llame loads per-directory project instruction files into the model's context
through the `instructions` context item. Each directory has two independent
chains: the base chain `LLAME.override.md`, `LLAME.md`, `AGENTS.override.md`,
`AGENTS.md`, `CLAUDE.override.md`, `CLAUDE.md`, and the local chain
`LLAME.local.md`, `AGENTS.local.md`, `CLAUDE.local.md`. The first existing
regular file in each chain wins and replaces every later name in the same
chain rather than merging with it, so a directory contributes a base file, a
local file, both, or neither. An empty regular file is selected and
contributes nothing, which suppresses later names in its chain. A name that
resolves to a non-regular entry (a directory, socket, or FIFO) is skipped and
the chain continues. A symbolic link is followed and its target's content is
loaded. Filename comparison is exact and case-sensitive: candidates are
matched against the directory's own listing, so a case-insensitive host cannot
select a differently cased name. When two selected candidates in one walk
resolve to the same file, the first in walk order is loaded under its own
selected path and the later one contributes nothing.

A trigger names one directory and the load walks every directory from the
filesystem root down to it inclusive, in that order, without visiting
siblings or children. An entry trigger names the canonical Workspace root; a
file-tool trigger names the projected absolute path itself when it is an
existing directory, and otherwise that path's parent, whether or not the
parent exists. Ancestors above the Workspace root and above any Git root are
included, so `/home/operator/AGENTS.md` enters every Chat that touches a path
beneath it on that executor. A reject rule on the `read` group excludes such a
path from every load; add the rule to the existing `tools.permissions` map
rather than replacing what is already configured there:

```json
{
  "tools": {
    "permissions": {
      "read": {
        "allow": true,
        "reject": [
          {
            "field": "path",
            "regex": "^/home/operator/(LLAME|AGENTS|CLAUDE)(\\.override|\\.local)?\\.md($|:)"
          }
        ]
      }
    }
  }
}
```

Entry loads the root chain when it establishes or switches the binding, never
on a same-root re-entry, and exit and detach load nothing; every load is
effective from the next model step. Each native `read`, `edit`, or `write`
whose `path` resolves to a local host path loads its directory's chain from
the next model step, whatever the call's own outcome — a denied call loads
nothing — and a read selector or representation suffix (`:40-80`, `:outline`)
does not change the trigger directory, while a `file://` alias triggers as the
path it decodes to. Each accepted turn on a Chat with a live binding re-stages
the bound root's chain before the first model request when any file of it is
not already in effective context; a Chat without a binding stages nothing.
`bash`, `skill://`, `http://`, and `https://` never trigger a load, and a model
read of a candidate file itself neither loads nor marks that file.

A `kb://` `read`, `edit`, or `write` triggers the same way, inside its Space:
the walk starts at the Space's own directory and goes down to the touched
directory, never above it, so a file in the `knowledge.root` itself is never a
candidate. Each loaded file is named by its `kb://<knowledgeSpaceId>/<path>`
locator, its canonical key is that locator, and its pages are read through the
native `read` tool under the same `instructions` origin and `read` permission
group. `knowledge_search` hits never trigger. When host and Space files are
pending at the same step, they resolve into one item with the host files first,
each group broadest directory first. A Space that is missing, belongs to
another owner, or is unavailable loads nothing and reveals nothing. There is no
accepted-turn load for Spaces: a Chat has no Space binding, and a Space chain
returns on the next `kb://` touch after a compaction.

Loading requires `read` in `tools.allowed` plus a configured native executor
for host triggers or a configured `knowledge.root` for `kb://` triggers, and
does not require `enter_workspace`.

A file is loaded at most once per compaction epoch. The seen set is the set of
canonical (`realpath`) paths recorded in the payload of `instructions` items
in the Chat's effective history, and is never stored in a Chat column; a
forked Chat inherits it through its copied history. A candidate whose
canonical path is already seen is omitted, so a symlink and its target are one
file and an edit to a loaded file is not re-announced; denied, failed, and
empty candidates are not seen. All triggers pending at one model step, or one
accepted turn, resolve together into at most one item.
After a compaction absorbs loaded items, only the bound root's chain is
restaged on the next accepted turn; a nested chain returns on the next `read`,
`edit`, or `write` in its directory.

Each existing candidate is read as a native `read` call with system origin
`instructions`, under the `read` permission group and the Run's effective
permission mode, with an attempt-scoped call id of
`instructions-<runId>-<attemptId>-<n>` — one audited call per page. A denied
or otherwise failed page drops the whole file: it is absent from the
model-visible text, never named there, and disclosed to the owner alone
through the read's audit event and, when the same step loads another file, the
chip.

A file larger than 32 KiB is cut at 32 KiB on a UTF-8 character boundary and
followed by one line naming the path and the byte count omitted; there is no
aggregate cap across files.

The owner transcript shows a chip on the message that carries the item, at the
position the item was stored: on the assistant message it follows the step that
loaded the files, and on the triggering user message of an accepted-turn load
it leads the turn. The chip lists the loaded paths and marks truncated and
denied ones from the item's private metadata. Non-owners, public shares,
transcript exports, and search projections expose neither the item's text nor
its metadata.

Imports are not supported; instruction files are loaded only from the
directory chains above ([#1029](https://github.com/leon0399/llame/issues/1029)).

## `file://` aliases

`read`, `edit`, and `write` accept `file://` and RFC 8089 minimal `file:`
URLs as local-path aliases. Accepted forms are
`file:///absolute/path`, `file://localhost/absolute/path` (localhost is
case-insensitive), and `file:/absolute/path`. The scheme is ASCII
case-insensitive, so `FILE:///x` works.

Percent escapes decode once to bytes and then strict UTF-8; `.` and `..` retain
host-path semantics. `%3A` decodes to `:` and follows host selector rules after
a literal-path probe first; there is no escaped literal-colon form. Selectors
work the same way, so `file:///path:10-12` is equivalent to `/path:10-12`.

This is POSIX-only: `file:///C:/x` means `/C:/x`; drive handling is not
supported, and `file://C:/x` is refused as remote. A literal space, including
a trailing space, is a legal POSIX filename and is retained.

Aliases are refused before filesystem access for a non-local authority, missing
path, a literal query (`?`), fragment (`#`), backslash, C0 control or DEL,
malformed or non-UTF-8 escape, `%2F`, or `%00`. Results report the decoded host path, never
the submitted URL. A valid alias binds the Run exactly as an absolute path
does; Workspace root does not affect them. Permission allows match the decoded
host path, not the URL form, so prefer `^/path/` over `^file:///path/`.

## `kb://` locators

`read`, `edit`, and `write` accept `kb://<knowledgeSpaceId>/<path>[:selector]`;
a selector selects lines to read and is rejected on `edit` and `write`.
`<knowledgeSpaceId>` is resolved through the trusted Run owner's current
Knowledge Space access on every call, under RLS, with no filesystem probe. An
absent, removed, malformed, or other-owner identifier returns
`knowledge_space_not_found`; a currently owned Space whose root or stable-ID
child cannot be resolved safely returns `knowledge_space_unavailable`. Neither
result reveals whether another owner, row, or directory exists.

`<path>` follows the same component rules as an absolute path — no empty
components, `.`/`..`, backslashes, or NUL/control characters, and no more than
1,024 UTF-8 bytes or 32 components. Split the locator before decoding each
path segment exactly once. Encode a literal `:`, `?`, `#`, or `%` as `%3A`,
`%3F`, `%23`, or `%25`; other characters, including spaces, may be literal or
encoded. Never encode `/`: an encoded separator and malformed encoding return
`invalid_path`. Validation applies after decoding, so encoded `..` is refused.
A raw colon starts the selector; use `%3A` inside a filename. Existing literal
percent names now require `%25`, including locators saved before this change.
The Space identifier and selector are never decoded. Every
path component is `lstat`ed and a symbolic link is refused without being
followed, returning `not_found`; the reader itself opens with `O_NOFOLLOW`, so
a link swapped in after validation also reads back as `not_found`.
`kb://<id>` and `kb://<id>/` list the Space's directory through the same
depth-2 listing as an absolute directory path, except that every symbolic link
renders as the bare `- name@` with no target, because a `kb://` result exposes
no resolved host path; a bare `kb://` or a locator with no identifier is
`invalid_path`.

In create mode a `write` may name directories that do not exist yet. They are
created one component at a time, each checked after creation, because a
recursive create adopts an existing symbolic link without complaint and would
build the rest of the chain through it — placing the file outside the Space
while the result still named a locator inside it. A component that exists and
is not a directory fails `not_regular_file`. This matters most on a host that
allowlists `bash` alongside `write`: the shell can plant such a link itself, so
the boundary cannot rest on the model being unable to create one.

`kb://` carries no Markdown-only suffix rule and no 1 MiB size cap — a Space
is a directory of arbitrary files. Beyond the rules above, `kb://` targets
follow the same regular-file, directory, selector, context, truncation, and
mutation behavior as absolute paths, and never bind or require the Run's
`tools.nativeExecutorId`. A create-mode `write` may name directories that do
not exist yet; a component that exists and is not a directory fails
`not_regular_file` and creates nothing. A replace creates no directory: its
target must already resolve.

Every successful `kb://` read, listing, or mutation carries the closed
untrusted-content `notice`, the Space identifier, and the Space display name.
Content is not neutralized, so an `edit` `oldText` can be copied from a prior
read — after removing the generated line-number prefixes, or by reading
with `:raw`, which omits them. Only a raw read is byte-for-byte source.

An unimplemented `scheme://` prefix — for example `vault://x` — fails closed
with `invalid_path` on `read`, `edit`, and `write` alike. It is never treated
as a literal relative or absolute filename, and no file named after the scheme
is read, created, or modified.

## `skill://` locators

`read` also accepts read-only `skill://` locators for packages the operator
installed under `skills.directories` (see [skills.md](skills.md)); `edit` and
`write` reject the scheme with `unsupported_operation` and no filesystem
effect.

- `skill://<name>` reads the package's `SKILL.md`; `skill://<name>:raw` returns
  it verbatim, still with the result envelope.
- `skill://<name>/<path>[:selector]` reads a supporting file, with the same
  selector, truncation, and context behavior as any other read.
- `skill://<name>/` lists the package directory, and `skill://` with an
  optional `:N-M` or `:N+K` lists the catalog, which pages through
  `nextOffset` like a directory listing.

`<name>` follows the Agent Skills name grammar (1-64 lowercase letters, digits,
and hyphens, with no leading, trailing, or consecutive hyphen). `<path>`
follows the same component and bounds rules as a `kb://` path. Every call
re-reads the catalog, so a removed or newly invalid package fails immediately
rather than serving stale bytes.

Every successful result carries `locator`, `sourceDirectory`, absolute
`resolvedPath`, absolute `skillDirectory`, and `skillPathInstruction`; the
envelope also carries `realSkillDirectory` when the real package directory
differs from `skillDirectory`. Package-relative paths still resolve against
`skillDirectory`, not `realSkillDirectory`.
Unlike `kb://`, these paths are published deliberately: a skill's script and
reference instructions are usable only once the agent can turn them into
absolute paths. Resolve package-relative references against `skillDirectory`,
keep task-relative input arguments as given, and pass an explicit `cwd` when a
script needs its own directory. The tool never rewrites a Bash command and
never executes a skill's scripts during a read.

A manual-only package (one whose invocation control disables proactive use)
loads only when the user names it explicitly in the current turn, for example
by writing `$review`. Without that selection its body and resource reads return
`skill_requires_explicit_selection` and the catalog listing omits it.

## Calls

- `read({ path: "/absolute/file.md:10-20" })` returns lines 10 through 20, plus one live line of context on either side when available. `:10+11` selects the same requested range. `:raw` and `:raw:10-20` return verbatim source, without line numbers or added context. Existing literal filenames take precedence over selector syntax. Comma-separated ranges such as `:4-5,7-8` read several passages in one bounded call: ranges sort, merge, grow one context line per side, and merge again when the grown windows touch, so `:4-5,7-8` renders lines 3 through 9. `:raw:4-5,7-8` stays verbatim without context. Up to 64 ranges per read. Multi-range results report `requestedRanges` (the merged request) and `shownRanges` (emitted lines); a truncated read reports a zero-based `nextOffset` — trim `requestedRanges` at `nextOffset + 1` and re-read. A file read on an absolute path reports `realPath`, the canonical absolute path, when a symbolic link in the path or in one of its components makes it differ from the normalized path as given; `realPath` counts within the result bound, and the header and line numbering stay those of the path as given. A directory listing never carries it, and neither does a `kb://` or `skill://` read.

### Ranged Markdown ancestors

An ordinary ranged read of a `text/markdown` source prepends the direct
root-heading chain that contains each passage's first requested source line,
shallowest first. This applies to host paths, `file://`, `kb://`, `skill://`,
and web renders labeled `text/markdown`; the preceding context line does not
choose the chain. Each heading contributes only its own source lines, in source
order, with an ordinary `N:` prefix followed by a space: an ATX heading
contributes one line, and a setext heading contributes all of its text lines
and its underline verbatim. No excerpt line or outline 120-code-unit cut is
added, and lines already emitted by the passage window or an earlier chain
are not repeated.

For a single range, emitting at least one ancestor promotes the result to the
existing plural `requestedRanges` and `shownRanges` shape. `requestedRanges`
contains only the requested interval; `shownRanges` includes the ancestor and
context intervals, merging adjacent intervals. If no ancestor line is
emitted, singular `requestedRange` and `shownRange` remain unchanged. A
comma-separated request is plural as usual; each merged passage gets the
chain for its first requested line. A chain emits only heading lines before
its passage's first shown line, and a chain line that would precede content
already emitted is skipped, so output stays in source order. Lines are
deduplicated by source line against every earlier emitted passage or chain.
Ancestors never enter `requestedRanges`.

For example, if `VISION.md` has `# Level one` at line 13, `## Level two` at
line 32, and `### Level three` at line 54, a read of `VISION.md:60-72`
includes the ordinary context lines at 59 and 73:

```text
13: # Level one
32: ## Level two
54: ### Level three
59: <context line>
60: ... through 72: <requested lines>
73: <context line>
```

The result reports `requestedRanges: [{startLine: 60, endLine: 72}]` and
`shownRanges` covering `{13,13}`, `{32,32}`, `{54,54}`, and `{59,73}`.

The scanner sees only the lines through the selected window's end and is
ended there; it never reads past that window. A role still undecided at the
boundary counts as a non-heading, including an open paragraph that might
become a setext heading and an unclosed line-one `---` block, which is
replayed as Markdown. CPU for a large-offset Markdown read scales with the
offset because every skipped line is parsed.

Ancestor lines count against the shared 2,000-line ceiling and serialized
result bound. If the chain plus the N-1 context line (when shown) and line N
do not fit, whole heading units are dropped from the outermost end first until
the deepest remaining heading fits. An oversized outer heading is an
unrenderable unit and is skipped during trimming. A setext heading's text
lines and underline are one unit. If even the deepest heading is
unrenderable or does not fit, the chain is silently absent and the passage
window is still returned when it can fit. `nextOffset` continues to identify
the next requested source line, never an ancestor line; a continuation at
`nextOffset + 1` computes a fresh chain, so a heading may reappear.

`:raw`, `:outline`, directory reads, unselected reads, empty files, and
non-Markdown sources remain unchanged. Ancestors are chosen only after the
existing source resolution and permission admission, so permissions, source
identity, Knowledge attribution and untrusted-content notice, web provenance,
and result envelopes are unchanged. Heading lines and their coordinates are
untrusted, execution-time navigation metadata rather than a snapshot, hash,
lock, or authority token; a later read reauthorizes and rereads the current
source.

- `read({ path: "/absolute/directory" })` returns a depth-2 listing:
  directories first, then files, sorted by name under the host collation. A
  symbolic link sorts among the files by name whatever its target kind.
  Each entry renders as `- name/` (directory), `- name` (file),
  `- name@/ -> <target>` (symbolic link to a directory), `- name@ -> <target>`
  (symbolic link to a regular file), `- name@? -> <link text>` (a dangling
  link, or one resolving to a special entry), or `- name?` (special entry).
  `<target>` is the canonical absolute path the link resolves to, while a link
  that is dangling or resolves to a special entry shows its raw link text
  instead. Symbolic links are never descended, even when the target is a
  directory, and links and special entries are never opened. Child directories
  show up to 20 entries followed by `… N more`.
  Empty directories render `(empty directory)`.
  A trailing separator is optional: `/dir/` and `/dir` both work.
  Range selectors such as `:1-5` return a flat listing of root-level entries
  only, with no child content. `:raw` is not supported for directories.
  Directories over 10,000 entries fail with `directory_too_large`.
- `edit({ path, oldText, newText })` replaces exactly one current match.
  Empty `newText` deletes the match. Missing or ambiguous matches fail without
  changing the file. No previous-read requirement is enforced yet.
- `write({ path, content, replace? })` creates a new file, creating missing
  intermediate directories beneath the resolved authority root on every
  scheme, or — with `replace: true` — swaps an existing file's entire contents
  atomically. Create mode refuses every existing target with `file_exists` and
  an intermediate component that exists as a regular file with
  `not_regular_file`; on an absolute path "existing" includes a dangling
  symbolic link, while a `kb://` locator refuses a symbolic-link component as
  `not_found` before the target is reached. Replace mode asserts an existing
  regular file and fails an absent or dangling target with `not_found`,
  creating nothing. The flag's outcome by target existence:

  | Target | `replace`    | Result                                      |
  | ------ | ------------ | ------------------------------------------- |
  | absent | absent/false | file created, result marked `created`       |
  | exists | absent/false | `file_exists`, bytes untouched              |
  | exists | `true`       | contents replaced, result marked `replaced` |
  | absent | `true`       | `not_found`, nothing created                |

  Replacing an absolute path resolves a symbolic link to its target entry
  exactly as `edit` does, preserving that file's permission bits; a `kb://`
  target must have an existing regular-file leaf and creates no directory.
  Empty content truncates the file to zero bytes. Each mode's refusal message
  names the other: `file_exists` points at `replace: true`, and the replace
  `not_found` states that omitting the flag creates a new file. Use `edit` for
  a partial change.

Knowledge identifier failures — `knowledge_space_not_found` and
`knowledge_space_unavailable` — are specific to `kb://`. Every other path and
file failure — `invalid_path`, `not_found`, `not_regular_file`, `file_exists`,
`executor_unavailable`, `directory_too_large`, ... — is the same native
vocabulary regardless of scheme.

## Representations

Representation selectors are chosen after source admission and content
acquisition. The grammar accepts `:raw`, `:raw:<ranges>`, `:outline`,
`:outline:<N>`, `:outline:<N-M>`, and `:outline:<N+K>`. `<ranges>` uses the
existing raw-range grammar, including comma-separated ranges; an outline
scope accepts exactly one range and never a comma list. `:outline:N` means
source line N only, and `:outline:N+K` means K source lines from N (N through N+K-1).
Ordinary bounded reads add one preceding and one following live line when
available; these are called **context lines**. Outline reads do not add
context lines.

Host literal-path probing still happens first, and host and web split the
outline form after the raw form and before the last-colon numeric fallback.
Thus `:outline:raw` is the shipped raw read of a path or URL ending in
`:outline`, not an outline request. On host and web, `:raw:outline` is not a
representation member and fails with `invalid_selector`; `kb://` and
`skill://` return `invalid_path` for either form. The host permission check
sees the submitted suffix-bearing path, including `:outline`, before selector
parsing.

### Markdown outline output

For Markdown, `:outline` returns source lines in source order with the
ordinary `N:` prefix and space: the selected frontmatter lines, the first
non-blank root excerpt before the first root heading, and each root heading's
heading lines followed by the first non-blank non-heading line in its section.
ATX headings contribute one line; setext headings contribute their text lines
and underline. A heading followed immediately by another heading or by the
end of the document has no excerpt. Fenced or indented code, HTML blocks,
list items, blockquotes, and frontmatter do not create root headings. No
heading text, section coordinates, summaries, or heading-name selectors are
generated.

The result uses `representation: "outline"`. Apart from the ordinary prefix
and the documented long-line cut, each emitted line retains its authored text
and native terminator. Root sections end immediately before the next root
heading at the same or a shallower depth; deeper headings remain inside the
preceding shallower section.

The exact structural example from the specification is:

````text
1: # Guide
3: Intro sentence.
5: ## Install
7: ```bash
12: ## Use
14: ### Flags
16: Flag text.
````

A setext heading remains verbatim, including its underline:

```text
8: Two
9: ===
```

Every emitted source line is cut after 120 UTF-16 code units and gets a
trailing `…` when it is longer. A line of exactly 120 code units is unchanged.
The only generated text is that marker and the frontmatter elision marker
below. A document without root headings returns its frontmatter and root
excerpt, while an empty document returns empty content with null ranges.

### Frontmatter

Only a block that starts on line 1 with `---` and closes with the first later
`---` or `...` delimiter is frontmatter. Both delimiter lines are emitted.
Between them, the outline emits up to 32 top-level key lines: lines beginning
in column zero with a character other than whitespace, `#`, or `-`. Indented
lines, comments, and sequence items are omitted. After 32 key lines, the
remaining keys are replaced by one unprefixed generated line, with no source
coordinate:

```text
[… 28 more frontmatter lines]
```

For example, the specification's frontmatter case produces:

```text
1: ---
2: name: octocat
3: description: Use for GitHub.
4: ---
5: # Octocat
```

That elision line does not extend `shownRange`. No YAML, TOML, or JSON parse
is performed; malformed or scalar frontmatter is shown by the same rule, with
no note. An unclosed line-one opener is ordinary Markdown, not frontmatter.

The native line model counts LF delimiters, keeps a lone CR inside its source
line, and does not add a line for a trailing LF. Frontmatter delimiter
matching removes one trailing CR and trailing spaces or tabs, so CRLF
frontmatter is recognized. A leading U+FEFF on line 1 is ignored for heading
and frontmatter recognition but remains in the emitted source line.

### Scope, bounds, and continuation

The outline prepends the direct ancestor chain of source line N: root headings
whose sections contain N, shallowest first. Each ancestor is rendered with
its heading lines and excerpt, restricted to lines before N, and is omitted
when its own lines are already in scope. Frontmatter and the root excerpt
appear only when their source lines are in scope. If the ancestor chain of N
does not fit the result budget or 2,000-line cap on its own, omit the whole
chain and continue with in-scope lines, so every continuation read makes
progress. A scope beginning past the last source line fails with
`invalid_selector`, as an ordinary out-of-range read does.
Scope is by source coordinates, not by the number of outline
lines, and outline output has no context lines. `requestedRange` remains the
normalized source scope (or line 1 through the scanned source end when
unscoped), while `shownRange` is the first and last emitted source line, or
null when no source line is emitted; an empty source has null ranges.

For a file with `# Title` at line 1, `## Setup` at line 30, `### Linux` at
line 44, `### macOS` at line 70, and `## Use` at line 100, `:outline:60-90`
returns the ancestor chain of line 60 (`1: # Title`, `30: ## Setup`, and
`44: ### Linux`, with their excerpt lines before line 60), then
`70: ### macOS` with its excerpt line; `100: ## Use` lies outside the scope.
`:outline:65` returns `1: # Title`, `30: ## Setup`, and `44: ### Linux`, with
their excerpt lines, and nothing after line 65.

File outlines stream the source and have no whole-file input ceiling, but
the shared 2,000-emitted-line and 16,000-UTF-16-code-unit result bounds still
apply. When those bounds cut an outline, `truncated` is true and
`nextOffset` is the zero-based index of the first omitted entry's source line.
Resume with `:outline:<nextOffset + 1>-M`; a cut at the frontmatter elision
line reports the closer's source line.

### Media types and errors

The outline reader is selected by source media type, never by heading-looking
text. Host, `file://`, `kb://`, and `skill://` regular files map
case-insensitively by extension: `.md`, `.markdown`, `.mdown`, and `.mkd`
map to `text/markdown`; `.mdx` is excluded; every other extension has no
outline reader. An unsupported member returns `invalid_selector` with:

> The :outline member reads text/markdown content only; read this source without it.

The web ladder labels `negotiated` with its served type (`text/markdown`
supports outline; `text/plain` does not), `alternate`, `md-suffix`,
`readability`, and `llms-txt` as `text/markdown`, `text` with its served
type, and `raw` with no media type. A rendered adapter outcome carries an
internal media-type label: GitHub issue, pull request, repository, and commit
renders are `text/markdown`; GitHub blobs use the file extension table;
directory outcomes have no outline type; and a rewrite adapter forwards the
inner render's label. Unsupported web and adapter results use the same
`invalid_selector` error, while ordinary reads remain available.

An outline request on a host, `file://`, `kb://`, or `skill://` directory, or
on a web adapter directory, returns `invalid_selector` with:

> The :outline member is not supported for directory reads.

The skill catalog (`skill://:outline`) returns `invalid_selector` with:

> The :outline member is not supported for the skill catalog.

If the web plane cut an adapter document at its 5 MiB document bound,
`:outline` returns `representation_too_large` and no partial outline, with:

> The adapter document was cut at the web read's document bound, so an outline would omit structure; read it without :outline.

The ordinary adapter read still returns its cut document and note.

### Authority, envelopes, and changing sources

Admission, permission checks, owner resolution, and content acquisition
finish before media-type derivation or Markdown scanning. A denied submitted
locator therefore fails like an ordinary read and is never parsed. See the
per-source sections above for the envelope fields retained by each scheme.
`:outline` runs over the rendered adapter document; `:raw` is the only member
that bypasses adapters.

Headings, excerpts, frontmatter keys, and every other emitted line remain
untrusted content. They cannot change tool availability, owner identity,
permissions, or source authority, and a line number grants no access beyond
the original locator. Outline line numbers are execution-time navigation
coordinates, not a snapshot, hash, lock, or authority token: a later read
reauthorizes and rereads the current source, so an old range may return
different text.

Line numbers are display metadata, not source. Continuation uses zero-based
`nextOffset`; add one when composing the next one-based read selector. For
multi-range reads, trim `requestedRanges` at `nextOffset + 1` (dropping fully
shown ranges) and re-run the same selector pipeline; context lines may
reappear, as in single-range continuations.

Native files have no blanket size cap. Reads stream a bounded window; exact
editing currently buffers the file in memory. Normal reads default to 2,000
requested lines, plus available adjacent context. Multi-range reads share the
same 2,000-line ceiling across all passages. Serialized native results
are bounded to the shared 16,000 UTF-16 code-unit cap and retain whole source lines.
Markdown processing, URLs, and logical resource schemes other than `kb://` are
separate capabilities. Allowlisted `bash` shares the absolute-path native host
gate: the model supplies shell text and the host runs `bash -c` in
`BASH_WORKING_DIRECTORY` (or the API cwd). It is not tenant isolation.
`bash` accepts an optional literal `cwd` and string-record `env`. An absolute
`cwd` is used as given; a relative `cwd` resolves from `BASH_WORKING_DIRECTORY`
or the API cwd. When omitted, the default directory is used. The directory
must be enterable before the attempt is recorded, and no shell expansion is
applied to the argument. Each call starts a fresh process, so its working
directory, environment, and shell state do not persist. The child receives the
fixed managed base (`PATH`, `LANG=C.UTF-8`, `HOME`, `TMPDIR`, `USER`, `LOGNAME`
when set, and `TERM=dumb`) plus the call's additions as its initial
environment; base variables cannot be replaced. Bash, its launcher, or the
runtime may add variables such as `PWD`, `SHLVL`, and `_` before a command prints
its environment.
Command stdout and stderr are returned as produced up to the configured bound,
with truncation reported. Host-known protected values are redacted before the
result leaves the executor, and the shared model-facing neutralizer escapes
reserved tool delimiters in the copy sent to the model. Host `bash` can also
discover a mounted `knowledge.root` through ordinary filesystem commands; that
is separate from the owner-scoped `knowledge_search` and `kb://` capabilities.
After an unproven stop, the process-group quarantine is local to the worker and
is lost if that worker crashes. An in-flight shell process group can survive
that crash, so a replacement worker can admit a new bash command while the old
group remains alive because the replacement has no quarantine for the lost
worker. The durable `native.attempt` still prevents Run recovery from replaying
the command, and the Run becomes `outcome_unknown`.
Directory reads are bounded by a 10,000-entry traversal budget per directory.
When the rendered two-level listing exceeds the result cap, child blocks are
elided last-first into `… N entries` markers before root-level entries are
truncated with `nextOffset`.

## Mutation recovery

The first absolute-path native operation binds its Run to the configured
executor identity. A different executor cannot resolve those physical paths
on reattachment. Mutations are ordered in the host process, including
symlink aliases; external editors and other uncoordinated processes are
outside that guarantee.

Before an edit or write changes bytes, on either scheme, its attempt is
committed to the existing owner-scoped Run event log — for `kb://`, recorded
against the locator, never the resolved host path. The result is committed
before the model continues. A recovered open attempt returns
`outcome_unknown`; a queue retry of a Run that started a mutation terminates
instead of replaying its model loop. Reconnecting clients replay recorded
activity without running tools again. A `kb://` mutation uses this same fence
without binding or requiring an executor identity, so a retry on a different
worker still reports `outcome_unknown` rather than `executor_unavailable`.

After an unknown outcome, read the file's current state before authoring a new
attempt. Do not assume a timeout means the file was unchanged.
