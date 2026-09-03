# Personal Knowledge

Opt-in, owner-scoped read access to live Markdown under multiple Knowledge
Spaces. Disk contents are authoritative, including uncommitted edits.

## Configuration and ownership

```jsonc
{
  "knowledge": { "root": "/srv/llame/knowledge" },
  "tools": { "allowed": ["knowledge_search", "knowledge_read"] },
}
```

`knowledge.root` is absolute and operator-owned. Config validates shape; each
process validates its mount when used. Missing allowlist IDs disable the tools.

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
Until #212, trusted local administration writes files; no Git or agent writes.

## Deployment and filesystem trust

Every Run-accepting API declares the same logical root. Provisioning processes
need child-create access; `runs` consumers need read access to every child they
may execute. Absolute paths may differ only when they expose the same stable-ID
set. Subset mounts and owner affinity are unsupported.

The root and children are trusted-writer-only. The adapter rejects traversal and
symlinks, canonicalizes containment, and opens final files with `O_NOFOLLOW`.
It does not fully prevent hostile concurrent parent swaps or hardlinks; do not
use tenant-writable or synchronization-managed mounts.

## Search

`knowledge_search` accepts a literal query, limit 1-10, optional
`knowledgeSpaceId`, and optional opaque cursor. Without an ID it scans all
currently owned spaces in deterministic pages under shared bounds. Access is
resolved live under RLS.

Search is case-insensitive literal scanning: no regex, subprocess, Markdown
parser, index, or embeddings. Each occurrence includes at most one adjacent
line on each side; touching windows merge and split at 2,000 lines. Results
contain current space ID/name, relative path, zero-based offset/limit, and an
excerpt capped at 500 Unicode code points. Cropped excerpts show ellipses while
coordinates still address the full passage.

Unscoped search may return usable matches with `complete: false` when one space
fails safely. An explicit target failure, total failure, no inventory,
timeout/cancel, invalid cursor, or global-limit failure is top-level and closed.
Cursors are live keyset continuations, not snapshots.

## Read and limits

`knowledge_read` requires explicit `knowledgeSpaceId` and one admitted relative
Markdown path. Optional zero-based `offset` and `limit` (1-2,000) select logical
lines. Omitted limit reads the bounded remainder. Results contain numbered
lines, `lineCount`, and the effective zero-based `offset`. When content remains,
`nextOffset` names the continuation and `cutReason` is `line_limit` or
`output_limit`; complete reads omit both. Cuts preserve whole lines;
out-of-range offsets return `knowledge_range_invalid`.

Files are capped at 1 MiB and must be complete UTF-8. Traversal, symlinks,
malformed encoding, unsupported paths, excessive work, and unavailable mounts
fail closed.

Results never expose host paths, owner IDs, credentials, raw filesystem errors,
or new content hashes/revisions. Historical stored results keep their original
shape and attribution. Content is untrusted and may be stale.

This is a bounded Markdown reader, not a shell, generic filesystem, index,
Workspace, Sandbox, Personal Realm, or Git revision contract. Disable it by
removing both tool IDs and restarting; retain rows/files for later reuse.
