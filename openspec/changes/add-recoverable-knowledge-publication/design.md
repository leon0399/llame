## Context

See [proposal.md](proposal.md) for motivation and scope. Current hosted Runs can
restart their tool loop after infrastructure failure; both catalog admission and
snapshot rebinding reject non-read-only tools. The source is
`apps/api/src/runs/snapshot-tool-execution.ts`, not merely a configurable tool
list. Current Knowledge files are live and may be uncommitted. The personal Node
in #659 has individual file/process approvals but no #212 publication guarantee.

`add-executor-file-views` owns the file tools, private editing directories, and
source/base manifests. This change consumes that contract. The directly linked
research defines [candidate versus acceptance](../../../docs/research/product-vision/2026-08-21-local-nodes-workspaces-and-distributed-execution.md#511-knowledge-spaces-and-absorption)
and [versioned environments](../../../docs/research/product-vision/2026-08-21-local-nodes-workspaces-and-distributed-execution.md#59-native-and-versioned-sandbox-environments);
these are distinct from a local file installation and a disposable view. An editing view is
data that a future configured Sandbox can mount; it is not a KB-owned executor.

## Goals / Non-Goals

The first release publishes one created or replaced Markdown file and leaves
unrelated live files untouched. Preserve a useful operation without shell,
multiple-file atomicity, federation, or a general effect framework. Do not change
ordinary `knowledge_read` or `knowledge_search` into committed-tree readers.

## Decisions

### D1: Explicit managed publication, with no automatic repository adoption

Add an owner-authorized publication setting at
`PUT /api/v1/knowledge-spaces/:id/publication` with `{enabled: boolean}` and a
corresponding personal Node operation. These are trusted owner operations, not
model tools. Enabling declares that canonical writes are coordinated through the
Node; direct concurrent host edits are outside the guarantee. Existing Spaces
start disabled and keep their current live-read behavior. Disabling blocks new
intents and waits for an existing intent to reach a known outcome before it
completes; it never deletes files or history.

Initialize Git only during explicit enablement. This cut supports an absent
repository or an already initialized repository owned by this publisher. A
pre-existing external `.git` directory/file is refused as unsupported, untouched.
Arbitrary repository adoption is a follow-up, because inherited hooks, worktrees,
indexes, and dirty target history would enlarge the first recovery protocol.
Initialization creates no content commit and stages no existing file. A durable
enablement intent and the same per-Space lock make interrupted/concurrent first
use recoverable; ambiguous existing metadata fails closed rather than being
claimed or removed. Ownership is recorded outside the model-writable files.

Use the ordinary `.git` directory in the canonical Space so operators can inspect
Git history conventionally. Never mount it into an editing view. Live files
already present remain visible and untracked until individually published.
For initial replacement of an existing untracked target, retain its preimage in
the publication journal and Git object storage under a trusted preimage ref so
ordinary Git garbage collection cannot discard it. Do not create an extra
baseline commit or sweep unrelated content into the initial commit.

### D2: Candidate submission and acceptance stay separate

Use one local-only publication adapter in this cut. It submits the candidate,
validates current authority, and advances the local accepted ref under the same
controlled operation. The internal boundary separates candidate identity and
base commit, submission outcome, accepted-ref disposition, and live installation.
Future raw-Git/forge adapters may return a submitted candidate without acceptance;
that state must not be presented as retained live Knowledge. No remote adapter or
abstract provider registry is implemented now.

The local result state is `accepted` only after accepted history and live bytes
are reconciled. `candidate_pending` means a preserved candidate without completed
acceptance/installation; `conflicted` and `recovery_pending` are distinct. The tool
name `publish` describes the requested workflow, not a claim that submission alone
is acceptance. The first repository may have an unborn accepted ref; thereafter
all candidates retain the exact accepted parent OID plus the separately observed
live-file base. This staged bootstrap does not turn future dirty working trees
into authoritative accepted revisions.

### D3: One stable publication slot per Run

When a Run has no editing view, its first generic `read` of an advertised
`/knowledge/<space-id>/...` path requests view admission. Trusted code resolves
the current owned, publication-enabled Space and creates C1's bounded snapshot
before returning the read. The result identifies snapshot semantics. Subsequent
file tools stay bound to that view; another Space is refused for editing in
this Run. Existing `knowledge_read` remains a live read and never opens a view.
`write`, `edit`, and `publish` without an admitted view fail closed. This avoids
an extra model-facing open tool without silently selecting a Space by name.

The model calls `publish({message})` on the active view; it cannot select an
owner, root, repository, ref, author, or alternate view. Bound message length is
1 through 200 Unicode code points after trimming; reject control characters.
The publisher computes the admitted target diff. Zero changes returns
`unchanged` without a commit or consuming the slot; two or more paths, deletion,
rename, non-Markdown output, or oversized content fail before preparation.

A trusted durable row keyed uniquely by Run owns one canonical publication.
Record the Space, target, base bytes/digest or absence, desired bytes/digest,
trusted author/provenance, intended parent, and deterministic commit fields.
The one-slot key does not depend on provider tool-call IDs, which may change on
regeneration. Identical retry returns the prior outcome; a distinct request after
slot preparation returns `publication_already_attempted`. This cut does not reset
the slot after conflict: correction can run in a later Run.

Hosted records and enablement state use explicit owner predicates and enabled,
forced RLS. Personal records use the existing private SQLite store. Bound
preimages and outputs to the existing 1 MiB Markdown file cap; do not copy the
entire corpus into journal rows. Publication provenance and recoverable bytes
are retained with the Knowledge change independently of deleting the originating
Chat; retained Run identifiers are provenance, never fresh execution authority.

### D4: Filesystem lock plus durable intent, not lease-only exclusion

Serialize all cooperating canonical writers for one Space with an OS-backed
exclusive lock held across preparation, Git ref update, and file installation.
The first adapter supports POSIX filesystems with tested cross-process lock and
rename/fsync semantics. Different path spellings must still resolve to one lock
for the same stable Space. Do not expire or steal a lock from a paused writer.
Unsupported lock semantics make publication unavailable; ordinary reads remain
available. A database lease alone cannot fence a paused process's filesystem
syscall. No new native Node addon is preselected; the first implementation task
must demonstrate lock release on process death and exclusion across workers.

Under the lock, resolve current owner access and managed enablement, reject a
dirty target relative to its prior published blob, and compare the live target
with the view's base. First publication may adopt that one untracked target's
observed bytes as its preimage. Unrelated dirty/untracked files are not inspected
for staging and are never changed. Keep checking directory containment using
trusted paths; reject symlinks, hardlinks, special files, and parent substitutions.
The security boundary excludes external actors who can mutate managed host paths
concurrently. No application lock or pathname hash is presented as protection
against that host authority.

Persist `prepared` before any canonical Git or file mutation. Construct the tree
from the previous publisher commit and the one target blob using Git plumbing
and a private index if needed. Pin parent, author, timestamp, and message in the
intent so reconstruction produces the same commit. Use compare-and-swap ref
update with the expected parent. Disable inherited Git configuration, hooks,
filters, external helpers, replace refs, and prompts; bounded subprocesses receive
only the publisher's minimal environment. No shell string interpolation.

Durably record the commit outcome, then install the target with a same-directory
temporary file, file fsync, atomic replacement, and directory fsync. Preserve
existing file mode within the allowed regular-file policy. Creation uses a
no-replace operation so unexpected presence conflicts. Revalidate authorization
immediately before installation; if it was revoked, retain a non-published
candidate and refuse further canonical installation.

The ref and filesystem are separate state transitions. Journal states are
`prepared`, `committed`, `accepted`, `conflicted`, and `recovery_pending`; public
results expose only bounded status, logical Space/path, commit OID when known,
and safe reason. A visible Git commit is not proof that live bytes were installed.
Live readers continue to read the actual live files throughout. Only `accepted`
means the new live bytes and corresponding commit are reconciled.

### D5: Recovery never regenerates a new canonical mutation

Recovery acquires the same lock and observes journal, Git ref, and live target.
If the ref is still at the expected parent, reconstruct the recorded commit;
if it already identifies that commit, do not create another. Live target equal
to the recorded base permits installation; equal to the desired bytes permits
settlement after proving the recorded ref outcome; any third value becomes a
conflict and is preserved. Unknown Git history is a conflict, never a reset.
Recovery rechecks current access before any new canonical installation. Once
bytes are installed, later revocation does not erase the historical fact; repair
only its authorized internal receipt without authorizing a new write.

On hosted Run retry, inspect the publication slot before calling the model.
An existing intent is reconciled first. If accepted, restore its bounded
observation to the Run and prevent further canonical effects; if unresolved,
stop with an honest recovery-pending outcome. Never retry shell execution to
reconstruct a publication. Before a slot exists, draft-only work can be discarded
and a fresh attempt opened after fencing the previous view. Narrate that draft
restart; previously persisted observations remain historical, not authority for
the new view. Draft results alone are never reported as retained Knowledge.

Cancellation before preparation leaves live files unchanged. Cancellation after
preparation records the request and resolves the intent; it cannot promise that
an already-installed file was undone. Startup/per-owner access recovery and a
documented operator recovery command cover terminal Runs without a global
cross-tenant reaper. Recoverable Knowledge evidence outlives Chat deletion.

### D6: Narrow first-party admission and deterministic ordering

Allow only the exact code-owned `write`, `edit`, and `publish` implementations
when this recovery path is installed, operator eligibility is bound, and current
owner/view permissions allow the operation. The shared tools use
`write_low_risk`; changing an unrelated tool to that class does not admit it.
`mcp__*` remains read-only. Preserve immutable declarations and update every
catalog, validator, and snapshot-execution gate together. No owner inventory or
filesystem probing moves into hosted HTTP Run admission.

Calls touching one writable view execute in provider-emitted order, including
reads interleaved with edits and publication. Independent read-only calls can
remain concurrent. Every accepted call gets a result even when an earlier
mutation failed; failed preconditions do not silently publish a partial draft.
Personal Node write and publication calls retain individual approval. Hosted
owner enablement plus the exact operator tool gate supplies the initial write
policy; a general approval UI and Run-level grant system are not introduced.

## Risks / Trade-offs

- R1: freely edited live directories cannot satisfy the strong writer contract.
  Explicit enrollment and external-repository refusal make this visible before
  any mutation; existing reads remain supported.
- R2: one Git commit cannot transactionally include a filesystem replacement and
  database receipt. Durable intent, fsync boundaries, and injected crash tests
  establish honest recoverable states.
- R3: the runtime extraction is unmerged. Implement shared publisher logic in its
  own package, then integrate only after the #659 successor packages land; do
  not fork the old API helpers or the #539 harness.
- R4: retained preimages contain owner data. Apply RLS, bounded access, and
  Knowledge-level retention; Chat deletion never reopens a publication slot.

## Migration Plan

Ship journal schema and recovery first, then Git enrollment and the publisher,
then tool gates. Existing Space settings default disabled; no filesystem moves,
history rewrites, or automatic Git initialization occur. Rollback disables new
enrollment/publication while retaining the recovery path and all existing files,
Git history, and intents. Do not remove schema with unresolved intents.

## Revision History

- v1: initial publication design with managed writer ownership, one Run slot,
  deterministic commit reconstruction, and a single-file installation protocol.
