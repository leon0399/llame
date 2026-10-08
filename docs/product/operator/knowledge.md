---
summary: "Knowledge Spaces: the configured root, ownership, mounts, and enabling or disabling"
read_when:
  - you are configuring knowledge.root or the Knowledge tool allowlist
  - you are mounting the Knowledge root across API and worker hosts
behavior:
  - ../reference/tools/knowledge-search.md
  - ../reference/locators/kb.md
  - ../reference/instruction-files.md
---

# Personal Knowledge

Opt-in, owner-scoped read access to live files under multiple Knowledge Spaces.
`knowledge_search` indexes Markdown only; a `kb://` `read` opens any regular
file in the Space. Disk contents are authoritative, including uncommitted
edits.

`knowledge_read` is deleted. Knowledge files are read through the native `read`
tool's `kb://<knowledgeSpaceId>/<path>[:selector]` locator instead. See
[`read`](../reference/tools/read.md) for the read contract and
[kb locators](../reference/locators/kb.md#form) for the full `kb://` grammar.

An allowlisted `knowledge_read` entry now fails boot; remove it from
`tools.allowed` before upgrading. Historical `knowledge_read` observations and
stored results in existing chats keep their original shape and attribution,
and no attempt admits the deleted tool.

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

## Instruction files and host authority

A `read`, `edit`, or `write` of a Space loads that Space's instruction chain.
The chain names, the locators that identify each loaded page, and the
host-path rules that apply unchanged are documented in
[Instruction files](../reference/instruction-files.md).

Instruction imports stay in the importing Space: only relative whole-file targets
resolve, while absolute, escaping, `~/`, and schemed targets remain literal. They
use the `read` group under system origin `instructions`; a denied target is audited
without probing and reported as denied whether or not it exists. The full marker,
ordering, hop, deduplication, and per-file size contract is in
[Instruction files](../reference/instruction-files.md).

A host path under `knowledge.root` is host authority, not Space content: a
`read`, `edit`, or `write` that names one is a plain native file operation,
governed by the host's own permissions, ownership, and executor, and it is
never attributed to a Space or to its owner. Where one host serves several
owners, add a reject rule for the Knowledge root to each of the `read`,
`edit`, and `write` groups (and keep `bash` off such a host), so an absolute
path cannot read or change a Space file the owner's own `kb://` access would
not authorize. Under the `bypass` permission mode no `tools.permissions` rule
is evaluated, so a reject rule closes nothing there: do not expose `bypass` in
`tools.permissionModes` on such a host.

## Deployment and filesystem trust

Every Run-accepting API declares the same logical root. Provisioning processes
need child-create access; `runs` consumers need read access to every child they
may execute. Absolute paths may differ only when they expose the same stable-ID
set. Subset mounts and owner affinity are unsupported.

The root and children are trusted-writer-only. The `kb://` resolver rejects
traversal and symlinks, canonicalizes containment, and opens final files with
`O_NOFOLLOW`. It does not fully prevent hostile concurrent parent swaps or
hardlinks; do not use tenant-writable or synchronization-managed mounts.

## Reading, search, and disabling

Reading a Space file and listing its directory are documented in
[kb locators](../reference/locators/kb.md); the Markdown scanner that finds
candidates is [`knowledge_search`](../reference/tools/knowledge-search.md).

`kb://` reads are not a shell, generic filesystem, Workspace, Sandbox, or
Personal Realm. Disable Knowledge search by removing `knowledge_search` from
`tools.allowed`; disable `kb://` reads by also removing `read` (which also
disables absolute-path native access) or `knowledge.root`. Restart to apply;
existing rows and files persist for later reuse.
