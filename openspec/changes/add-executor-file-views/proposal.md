## Why

Issue [#212](https://github.com/leon0399/llame/issues/212) needs ordinary file
operations before Knowledge changes can become recoverable publications. The
current Knowledge tools read live Markdown, while future native and managed
Sandbox executors need one explicitly authorized disposable view that exposes
the same bytes and writes drafts without making a host path canonical.

## What Changes

- Add a shared executor FileView contract in `packages/file-views` with an
  opaque view binding, trusted source identity, disposable view roots, and
  snapshot/live semantics.
- Define bounded `read({path, offset?, limit?})`, `write({path, content})`, and
  `edit({path, oldText, newText})` operations over an admitted view. Reads are
  line-bounded; writes and edits are draft changes, with hashes and base bytes
  retained by the harness rather than supplied by the model.
- Require full-file read coverage before replacing a file with `write`; require
  the uniquely matched target range at the retained base before `edit`. Reject
  stale bases, ambiguous or missing matches, unsafe paths, symlinks, malformed
  content, and every result that exceeds the bounded contract.
- Reauthorize every new view or tool admission against the trusted Run owner,
  Space binding, and executor policy. A caller-selected owner, root, host path,
  or source locator never widens access.
- Map the portable Knowledge Space ID and Knowledge-relative path to a local
  execution-view path such as `/knowledge/<space-id>/notes.md`; the local path
  is never a portable or canonical source identity.
- Preserve the existing personal per-file approval policy. Do not advertise
  hosted persistent draft-write tools until the C2 recovery gate; C1 may ship
  the library and adapter contract without changing the public tool inventory.
- Keep `knowledge_search` and `knowledge_read` live tools with their current
  contracts. Do not add Git publication, shell execution, managed Sandbox
  implementation, origin-namespace persistence, federation, profile
  activation, or episodic migration here.

## Capabilities

### New Capabilities

- `executor-file-views`: shared FileView binding, local source mapping,
  disposable snapshot reads, draft writes/edits, coverage tracking, bounded
  outcomes, and executor adapter obligations.

### Modified Capabilities

None. C1 does not change the existing Knowledge read/search requirements or the
read-only model tool loop; public write admission and recoverable publication
belong to `add-recoverable-knowledge-publication` (C2).

## Impact

The primary new module is `packages/file-views`. It is consumed by later native
and managed-Sandbox adapters and by C2's Knowledge publication layer, which owns
recovery, canonical writes, and API integration. The contract carries Run
identity, stable Knowledge Space ID, trusted source root, private view root,
base manifest hashes/bytes, and observed read ranges; private fields are never
model input/output. C1 permits one active writable Space/view per Run, with
private scratch only when an executor requires it.

The implementation must preserve tenant isolation and fail closed when identity,
binding, authorization, view state, or coverage is missing. No origin namespace
is persisted in this change; #547 remains a qualification seam for a later
portable identity capability. The connected delivery stack is `master <-
knowledge-files/proposal <- knowledge-files/views-core <-
knowledge-files/views-adapters <- knowledge-files/publication-storage <-
knowledge-files/publication-git <- knowledge-files/publication-integration <-
knowledge-files/publication-acceptance <- knowledge-files/sandbox-runtime <-
knowledge-files/sandbox-node-tools <- knowledge-files/sandbox-acceptance <-
knowledge-files/finalize`. Every layer owns focused tests; one finalizer syncs,
strict-validates, and archives all connected changes only after every task is
complete. This proposal does not close #212.
