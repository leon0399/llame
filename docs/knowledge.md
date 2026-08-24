# Personal Knowledge

Personal Knowledge is an opt-in, owner-scoped read capability. An authenticated
owner can create multiple independently identified Knowledge Spaces, and the
hosted Run loop can search or read the owner's live Markdown files. The files on
disk are authoritative for this slice, including edits made without a Git
commit.

## Configure the root

Set one absolute, operator-owned path in `apps/api/llame.config.json`:

```jsonc
{
  "knowledge": {
    "root": "/srv/llame/knowledge",
  },
  "tools": {
    "allowed": ["search_conversations", "knowledge_search", "knowledge_read"],
  },
}
```

The built-in default is absent. Configuration loading validates the path shape
but does not check that the path exists or is mounted. Provisioning and worker
execution validate their local mount and return a closed unavailable result when
it cannot be used. Leaving either tool out of `tools.allowed` keeps it disabled.

The owner-facing API is an authenticated REST collection:

```text
POST  /api/v1/knowledge-spaces
GET   /api/v1/knowledge-spaces?limit=50&after=<opaque-cursor>
GET   /api/v1/knowledge-spaces/<id>
PATCH /api/v1/knowledge-spaces/<id>
```

Create and rename accept only `{ "name": string }`. Names are non-unique labels;
the opaque ID is the identity and authorization key. List is deterministically
cursor-paginated, defaults to 50 items, and accepts limits from 1 through 100.
There is no delete operation in this iteration.

Trusted code generates each ID and creates its direct child under the configured
root before committing the authority row. Callers cannot provide an owner,
resource ID, path, source, or directory name. A database failure after child
creation may leave an unauthoritative directory; do not delete or repurpose it
as recovery. Until issue #212 ships, place Markdown files in allocated children
through trusted local administration; this slice does not initialize Git or
provide agent writes.

## Deployment boundary

Every API process that accepts Chat Runs must declare the same logical root when
the tools are enabled. Every process serving provisioning needs permission to
create the owner's child; every process consuming the `runs` queue needs read
access to all owner children it may execute. Absolute paths may differ between
processes only when they expose the same stable-ID directories. Subset mounts and
owner-affinity routing are unsupported in this slice.

The expected layout is:

```text
<knowledge.root>/
├── <stable-knowledge-space-id-a>/
│   └── notes.md
└── <stable-knowledge-space-id-b>/
    └── project.md
```

The root and all Knowledge Space directories are trusted-writer-only. Do not use
a tenant-writable, user-supplied, or synchronization-managed mount. The adapter
rejects traversal and symlink components, canonicalizes the root and child, and
opens final files with `O_NOFOLLOW`. This protects the supported operator-managed
deployment. A hostile concurrent parent-directory swap or hardlink race is not
fully prevented by the current path-based checks; descriptor-relative containment
is a future hardening task. Do not treat the current MVP as safe for untrusted
writers or hostile filesystem mutation.

## Results and limits

When both tools are configured and allowlisted they remain callable even for an
owner with zero spaces. Each call resolves the owner's current rows under RLS;
there is no Chat- or Run-pinned inventory. A newly added space is visible to a
later call, and revoked access is rejected on the next check.

`knowledge_search` accepts an optional `knowledgeSpaceId`. With one it searches
only that current owned space; without one it scans all current spaces in
deterministic keyset pages under one shared set of filesystem and output bounds.
If at least one space is searched but another has a space-scoped safe failure,
the result retains usable matches with `complete: false` and bounded warnings.
Total failure, zero inventory, timeout, cancellation, or a global limit remains
a top-level closed error. Search is an in-process literal scan; it uses no grep
subprocess, content index, or embedding store.

`knowledge_read` always requires an explicit `knowledgeSpaceId` and one admitted
relative Markdown path. It never infers the only current space.

Successful results expose the response-time logical Knowledge Space ID and
display name, Knowledge-relative path, and SHA-256 hash of the exact bytes used.
Search adds a matching line and bounded snippet. This attribution is not a
permanent revision: a later call may observe a renamed space or different bytes,
while persisted historical results keep the original attribution. The
configured root, host paths, owner IDs, credentials, and raw filesystem errors
never enter tool results or model context. Notes are owner-maintained, untrusted,
and potentially stale; volatile claims still require appropriate external
verification.

Traversal, symlinks, malformed UTF-8, unsupported paths, oversized work, and
unavailable mounts fail closed. The tools are bounded scans and reads, not a
generic filesystem, shell, index, embedding store, Workspace, Sandbox, or
Personal Realm mount. The stable logical ID is the portable identity boundary;
the hosted owner row and configured path are installation-local bindings.

To disable the capability, remove both Knowledge IDs from `tools.allowed` and
restart the relevant processes. Retain the database linkage and files for a
later retry; disabling the tools does not delete owner content.
