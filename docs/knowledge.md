# Personal Knowledge

Personal Knowledge is an opt-in, owner-scoped read capability. An authenticated
owner can create one Knowledge Space, and the hosted Run loop can search or read
that owner's live Markdown files. The files on disk are authoritative for this
slice, including edits made without a Git commit.

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

The owner-facing operation is an authenticated, bodyless:

```text
PUT /api/v1/me/knowledge-space
```

Trusted code generates the opaque Knowledge Space ID and creates its direct child
under the configured root. The response contains only that logical ID. Callers
cannot provide an owner, resource ID, path, source, or directory name. Until
issue #212 ships, place Markdown files in the allocated child through trusted
local administration; this slice does not initialize Git or provide agent
writes.

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
└── <stable-knowledge-space-id>/
    └── notes.md
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

Successful results expose only the logical Knowledge Space ID, a
Knowledge-relative path, and the SHA-256 hash of the exact bytes used. Search
adds a matching line and bounded snippet. This is response-time attribution, not
a permanent revision: a later call may observe different bytes at the same path.
The configured root, host paths, owner IDs, credentials, and raw filesystem
errors never enter tool results or model context. Notes are owner-maintained,
untrusted, and potentially stale; volatile claims still require appropriate
external verification.

Traversal, symlinks, malformed UTF-8, unsupported paths, oversized work, and
unavailable mounts fail closed. The tools are bounded scans and reads, not a
generic filesystem, shell, index, embedding store, Workspace, Sandbox, or
Personal Realm mount. The stable logical ID is the portable identity boundary;
the hosted owner row and configured path are installation-local bindings.

To disable the capability, remove both Knowledge IDs from `tools.allowed` and
restart the relevant processes. Retain the database linkage and files for a
later retry; disabling the tools does not delete owner content.
