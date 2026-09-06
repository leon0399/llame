## Context

The current Knowledge reader already defines bounded logical lines, UTF-8
validation, CRLF handling, line continuation, and a structured output cap. The
current model tool is Knowledge-specific and rejects absolute paths. This change
introduces a separate alpha native-file capability with deliberately broader
host authority; it does not silently widen the current hosted Knowledge tool.

The external reference is OMP's one-path `read`: a selector parser chooses a
range, a source/type handler produces content, and one result envelope carries
content plus details such as truncation and summaries. OMP also reserves raw mode
for verbatim output. Reuse the shape, not its full archive/URL/SQLite/image
surface.

## Goals / Non-Goals

**Goals:**

- One local `read`/`edit`/`write` contract for coding and file-backed Knowledge.
- OMP-style one-based selectors and inline one-line context.
- Exact replacement with no fuzzy matching or hidden full-file read gate.
- Same-path sequential mutation without requiring models to coordinate.
- A shared reader implementation that lets deprecated `knowledge_read` be deleted
  later without maintaining two line/range engines.
- Explicit alpha host-authority disclosure and bounded outputs.

**Non-Goals:**

- Tenant permissions, owner resolution, RLS, or a secure hosted absolute-path API.
- Markdown ToC, frontmatter, OKF metadata, URL loading, archive/SQLite/image
  readers, directories, internal schemes, or remote resource writes.
- Git initialization, commits, review/PR publication, bash, Sandbox lifecycle,
  read-hash enforcement, or snapshot recovery.

## Decisions

### D1: Use one native absolute path and reserve future schemes

The first public path is an absolute local filesystem path. The host resolves it
using normal OS semantics and reports the same path in result details. The model
does not supply an owner, tenant, configured Knowledge root, or alternate
authority. This is an alpha native-authority capability and is unavailable to a
host that cannot intentionally accept that authority. A trusted native executor
identity is bound on the first native operation, including `read`; later worker
or host reattachment with a different executor identity fails closed rather than
resolving the physical path on another machine.

Future resource schemes such as `kb://<space-id>/<path>` and
`chats:://<chat-id>/<message-seq>` are separate resolvers. They must not be
simulated by parsing physical paths or by making a host path portable.

### D2: Parse a small selector grammar at the path boundary

The reader accepts:

```text
/absolute/file.md:10-20
/absolute/file.md:10+11
/absolute/file.md:raw
```

Selectors use one-based inclusive lines. The parser recognizes a selector only
when the suffix is valid; an existing literal filename takes precedence. The
implementation normalizes selectors once to the existing zero-based internal
offset/limit representation. Multiple disjoint ranges, URL selectors, archive
members, SQLite selectors, and scheme-specific grammars are deferred.

The accepted grammar is:

```text
selector := ":" range | ":raw" | ":raw:" range
range    := positiveInteger "-" positiveInteger
          | positiveInteger "+" positiveInteger
```

Integers are safe one-based integers. `end >= start` for a range; the `+` count
is at least one; overflow, zero, negative, reversed, empty, or malformed forms
fail as selector errors. A valid selector may be written as `:10-20`, `:10+11`,
`:raw`, or `:raw:10-20`. An invalid suffix remains part of a literal path when
that literal path exists; otherwise the host returns a path/selector error.

Integers are safe one-based integers. `end >= start` for a range; the `+` count
is at least one; overflow, zero, negative, reversed, empty, or malformed forms
fail as selector errors. A valid selector may be written as `:10-20`, `:10+11`,
or `:raw`. An invalid suffix remains part of a literal path when that literal
path exists; otherwise the host returns a path/selector error. `:raw` may be
combined with a range only in the canonical `:raw:10-20` form in this slice.

### D3: Make ordinary reads context-rich and raw reads verbatim

For one bounded non-raw range, the reader requests one additional source line
before and after the requested window when those lines exist. The extended
content is one block, not separate `beforeContext` or `afterContext` fields.
The result details carry the requested range, shown range, representation,
logical/absolute path, and common truncation state. `nextOffset` identifies the
next requested source line, not the trailing context line. `requestedRange`
retains the normalized requested bounds; `shownRange` identifies only emitted
source lines. Reaching EOF does not rewrite the requested end. Empty files
return null ranges. This keeps streaming and buffered reads consistent without
scanning the whole file to discover EOF.

Normal display may prefix lines with system-authored one-based line numbers; the
system prompt must state that prefixes are navigation metadata and are not file
bytes. `:raw` returns selected source verbatim, suppressing prefixes, context
expansion, and all type processors.

The shared result envelope follows the useful OMP split between one content block
and path-dependent details. It exposes no internal stack trace or unrelated
runtime state. The alpha native capability may expose the requested absolute
path by design; a later resource adapter must replace it with a logical locator.

The tagged result shapes are:

```json
{
  "status": "success",
  "kind": "file",
  "path": "/absolute/notes.md",
  "representation": "text",
  "content": "9: previous\n10: requested\n11: requested\n12: following\n",
  "requestedRange": { "startLine": 10, "endLine": 11 },
  "shownRange": { "startLine": 9, "endLine": 12 },
  "nextOffset": 11,
  "truncated": false
}
```

Every failure uses the bounded shape
`{ "status": "error", "type": <closed-code>, "message": <safe-text> }`.
The initial closed codes are `invalid_path`, `invalid_selector`, `not_found`,
`not_regular_file`, `invalid_utf8`, `file_exists`,
`old_text_not_found`, `old_text_ambiguous`, `executor_unavailable`, and
`outcome_unknown`.

### D4: Keep the first loader type-neutral

The first loader reads regular UTF-8 text files and returns bounded source text.
It preserves source line delimiters according to the existing Knowledge line
rules. It does not parse Markdown, frontmatter, JSON, YAML, HTML, archives, or
SQLite. A future representation processor receives the normalized source plus
source metadata and adds sibling result details such as `toc`; it never inserts
generated material into source `content` or changes source line coordinates.

Native files have no blanket 1 MiB size ceiling. Local reads stream the selected
window with bounded memory and output, following OMP/OpenCode. The initial exact
editor may buffer a whole file, as Pi does; it remains subject to host resource
limits rather than a Knowledge-specific file-size policy. The deprecated
Knowledge adapter retains its existing byte limits.

### D5: Make `edit` exact, unique, and sequential

The model calls:

```json
{
  "path": "/absolute/notes.md",
  "oldText": "Status: draft",
  "newText": "Status: accepted"
}
```

`oldText` must be non-empty. The host reads the current file while holding the
per-path mutation gate, counts exact occurrences, and requires exactly one.
Missing or ambiguous text returns a structured failure without mutation.
`newText` may be empty for deletion. Unrelated changes elsewhere in the file do
not block a correct exact replacement. Two same-path calls execute sequentially;
the second observes the first call's bytes and normally fails if its old text no
longer exists. This is runtime serialization, not model-visible coordination.

The host writes through a temporary file and atomic replacement where the local
filesystem supports it, preserving bytes outside the replaced range and
preserving line-ending style. It returns a bounded diff and post-edit content
with one live line above and below the changed region when available. It does
not require a previous read, snapshot tag, or content hash in this slice.

The success shape is tagged and bounded:

```json
{
  "status": "success",
  "operation": "edit",
  "path": "/absolute/notes.md",
  "replacements": 1,
  "diff": "@@ ...",
  "content": "11: Review state\n12: Status: accepted\n13: Owner: Leo\n",
  "shownRange": { "startLine": 11, "endLine": 13 }
}
```

The create success shape uses `operation: "write"`, `created: true`, and the
same path/content bounds. Failure uses the common tagged error shape from D3.

An interrupted mutating call must not be silently retried by a durable host that
can re-execute it. Before changing bytes, the runtime must durably record a
native mutation attempt with a stable effect identity and target metadata. A
retry that finds an open attempt marks it unknown and does not call the editor
again. A known result is settled before the model can advance; durable effect
dedupe beyond this fence belongs to a later proposal.

### D6: Make `write` creation-only

`write({ path, content })` succeeds only when the target does not exist. Existing
targets return a closed `file_exists` result and remain unchanged. This keeps
whole-file replacement out of the first API and forces targeted edits through
the exact replacement contract.

### D7: Share the reader with deprecated Knowledge reads

`knowledge_read` delegates line splitting, range selection, whole-line
truncation, and result shaping to the shared reader. Its existing owner/Space
authorization and Knowledge-relative result contract remain in its adapter. The
legacy adapter disables native context expansion and keeps its current exact
requested-range payload shape. The tool description marks it deprecated, and
tasks record deletion only after generic read parity and the current Knowledge
acceptance suite pass.

### D8: Keep mutation authority explicit but defer permissions

This proposal intentionally does not implement per-user or per-path permission
policy. The alpha host must advertise the native capability only where the
operator accepts full OS-user authority. Later permission work can wrap the same
operations without changing exact replacement semantics.

## Risks / Trade-offs

- [Physical paths leak host layout and carry OS authority] -> limit the first
  capability to trusted alpha hosts and add `kb://`/`chats:://` authority-aware
  resolvers before hosted multi-user exposure.
- [Two independent processes can race despite in-process sequencing] -> use the
  strongest local per-path serialization available; document that external
  editors and uncoordinated processes are outside this iteration's guarantee.
- [A generic reader can grow into OMP's entire platform] -> land only raw local
  loading and the small selector subset; each new processor/source gets a later
  proposal.
- [Queue retry can replay a mutation] -> do not automatically retry a native
  mutation without a durable effect identity; add that in the submit/runtime
  proposal.
- [Deprecated `knowledge_read` survives indefinitely] -> add a deletion task,
  parity tests, and an explicit removal issue in the final acceptance layer.

## Migration Plan

1. Land the package and local host adapter behind an alpha native capability.
2. Rewire `knowledge_read` internals to the shared reader without changing its
   current authorization adapter.
3. Mark `knowledge_read` deprecated in its declaration and documentation.
4. Keep the existing tool until generic read parity and Knowledge E2E evidence
   pass; then open/land a separate deletion change.

No existing Knowledge directory is migrated by this proposal. No Git repository
is initialized here.

## Open Questions

- Whether a future host can offer the same operations through an OS-level file
  lock or only an in-process mutation gate is executor-specific.
- Whether line prefixes should be rendered in normal mode for every file type or
  only when a future edit mode requests them is a prompt/output decision.

## Revision history

- **v2 (2026-09-06):** Added durable pre-effect mutation fencing, native executor
  affinity, explicit result/error shapes, formal selector edge cases, and kept
  legacy `knowledge_read` exact-range output during deprecation.
