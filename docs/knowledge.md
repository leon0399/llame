# Personal Knowledge

Opt-in, owner-scoped read access to live files under multiple Knowledge Spaces.
`knowledge_search` indexes Markdown only; a `kb://` `read` opens any regular
file in the Space. Disk contents are authoritative, including uncommitted
edits.

`knowledge_read` is deleted. Knowledge files are read through the native `read`
tool's `kb://<knowledgeSpaceId>/<path>[:selector]` locator instead. See
[native files](native-files.md) for the `read` contract and the full `kb://`
grammar.

An allowlisted `knowledge_read` entry now fails boot; remove it from
`tools.allowed` before upgrading. Historical `knowledge_read` observations in
existing chats still render as recorded, and a Run accepted before the removal
whose bound tool snapshot names it fails closed before the provider request
rather than executing a substitute.

## Configuration and ownership

```jsonc
{
  "knowledge": { "root": "/srv/llame/knowledge" },
  "tools": { "allowed": ["knowledge_search", "read"] },
}
```

`knowledge.root` is absolute and operator-owned. Config validates shape; each
process validates its mount when used. Missing allowlist IDs disable the tools.

`kb://` locators also serve `edit` and `write`: an exact-match edit and a
create-or-replace write, each fenced by the durable pre-effect attempt log and
neither binding the Run to a worker. A create may name directories that do not
exist yet.

Two Knowledge tool ids exist: `knowledge_search` scans Markdown across a Space,
and native `read`, `edit`, and `write` open, change, or create a Space's files
by locator. `read` still needs its own
`tools.allowed` entry; what a configured `knowledge.root` removes is the
`tools.nativeExecutorId` requirement, so an allowlisted `read` is advertised
without one. On such a process an absolute path argument to `read` fails closed
with `executor_unavailable` instead of resolving through the Knowledge root.

The authenticated collection is:

```text
POST  /api/v1/knowledge-spaces
GET   /api/v1/knowledge-spaces?limit=50&after=<cursor>
GET   /api/v1/knowledge-spaces/<id>
PATCH /api/v1/knowledge-spaces/<id>
```

Create/rename accepts only `{ "name": string }`. Names are non-unique labels;
opaque server-generated IDs are identity and authorization. List limits are
1-100, default 50. This release has no delete.

Trusted code creates `<root>/<stable-id>/` before committing its authority row.
Callers cannot choose owner, ID, path, source, or directory. A DB failure may
leave an unauthoritative directory; never reuse or delete it automatically.
Trusted native hosts may edit these files through the generic file tools.
Git submission remains separate work under #212.

## Deployment and filesystem trust

Every Run-accepting API declares the same logical root. Provisioning processes
need child-create access; `runs` consumers need read access to every child they
may execute. Absolute paths may differ only when they expose the same stable-ID
set. Subset mounts and owner affinity are unsupported.

The root and children are trusted-writer-only. The `kb://` resolver rejects
traversal and symlinks, canonicalizes containment, and opens final files with
`O_NOFOLLOW`. It does not fully prevent hostile concurrent parent swaps or
hardlinks; do not use tenant-writable or synchronization-managed mounts.

## Search

`knowledge_search` accepts a literal query, limit 1-10, optional
`knowledgeSpaceId`, and optional opaque cursor. Without an ID it scans all
currently owned spaces in deterministic pages under shared bounds. Access is
resolved live under RLS.

Search is case-insensitive literal scanning: no regex, subprocess, Markdown
parser, index, or embeddings. Each occurrence includes at most one adjacent
line on each side; touching windows merge and split at 2,000 lines. Each
result carries current space ID/name, relative path, a one-based inclusive
`locator` (`kb://<knowledgeSpaceId>/<path>:N-M`), and an excerpt capped at 500
Unicode code points. The locator is a ready `read` argument; drop the `:N-M`
suffix to read the whole note. Reserved characters in the filename are encoded
in the locator; colon-named Markdown files are searched normally. Cropped excerpts show ellipses while the
locator still addresses the full passage.

Unscoped search may return usable matches with `complete: false` when one space
fails safely. An explicit target failure, total failure, no inventory,
timeout/cancel, invalid cursor, or global-limit failure is top-level and closed.
Cursors are live keyset continuations, not snapshots.

## Reading and listing

`read` opens `kb://<knowledgeSpaceId>/<path>[:selector]`, or lists a Space's
directory at `kb://<knowledgeSpaceId>` or `kb://<knowledgeSpaceId>/`. The
identifier is resolved through the owner's current Knowledge access on every
call, under RLS, with no filesystem probe. An absent, removed, malformed, or
other-owner identifier returns `knowledge_space_not_found`; an unresolvable
root or stable-ID child returns `knowledge_space_unavailable`. Path and file
failures use the native vocabulary (`invalid_path`, `not_found`,
`not_regular_file`, ...). See [native files](native-files.md) for the full
selector grammar, symlink handling, and error set.

Locator paths are percent-decoded once per segment after splitting. A literal
`:`, `?`, `#`, or `%` is written as `%3A`, `%3F`, `%23`, or `%25`; spaces and
other characters may be literal or encoded, and `/` is never encoded. Search
emits those four escapes only and includes colon-named notes. Malformed encoding
and encoded separators fail with `invalid_path`. Previously saved locators with
a literal `%` must now use `%25`.

`kb://` reads carry no Markdown-only suffix rule and no 1 MiB per-file limit —
a Space is a directory of arbitrary files. `knowledge_search` itself is
unchanged: it still indexes only Markdown and still warns per Space on an
oversized or invalid-UTF-8 `.md` file.

Every successful `kb://` read or listing carries the Knowledge
untrusted-content notice, the Space identifier, and the Space display name.
Content is returned verbatim, not neutralized, unlike the deleted
`knowledge_read`; recall-time framing carries the untrusted-content warning
instead.

Results never expose host paths, owner IDs, credentials, or raw filesystem
errors. Historical stored `knowledge_read` results keep their original shape
and attribution. Content is untrusted and may be stale.

`knowledge_search` is a bounded Markdown scanner, not an index, embeddings
store, or Git revision contract. `kb://` reads are not a shell, generic
filesystem, Workspace, Sandbox, or Personal Realm. Disable Knowledge search by
removing `knowledge_search` from `tools.allowed`; disable `kb://` reads by also
removing `read` (which also disables absolute-path native access) or
`knowledge.root`. Restart to apply; existing rows and files persist for later
reuse.
