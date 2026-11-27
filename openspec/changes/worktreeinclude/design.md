# Design

## Context

See [proposal.md](proposal.md#why) and the
[confirmed decisions](https://github.com/leon0399/llame/issues/1910#issuecomment-7111200259).
The inspected base is current `master` after the Rust Machine daemon change,
with main-service protocol version 7 in
`packages/machine-protocol/proto/protocol.json`. The Rust workspace already
depends on the `ignore` crate 0.4 for search in `crates/machine-grep`.

`crates/machine-git` implements the gRPC `GitService` of the Rust Machine
daemon. Its `create_worktree` handler runs an argv-only
`git worktree add --no-track` under a 120-second deadline, with a pinned,
environment-cleared git process and process-group kill. Every mutating call
carries a `request_id`; the daemon retains completed results in its
idempotency cache, and the bootstrap handshake requires an exact protocol
version match.

The API reaches that handler through `apps/api/src/machines/wire/git.ts` and
`apps/api/src/machines/executor-git.service.ts`. Both Worktree planners
currently send their inspected main Checkout as `repository`. The tool path
can accept a linked Worktree or a source subdirectory. Chat creation still
refuses a linked Checkout record in
`apps/api/src/chats/chat-creation-workspace-step.ts`. That restriction stays.

The tool path records a native attempt before the daemon call. Chat creation
records the destination in its creation attempt before that call. Both commit
binding and catalog records only after daemon success. The failure mapper must
retain this separation after a copy fails inside the daemon.

## Goals / Non-Goals

Use one daemon-side creation operation for checkout and environment copy. Carry
only source identity and bounded outcome metadata across the Machine protocol.
Keep bytes and pattern evaluation on the Machine.

Do not change branch selection, default base refs, main-Checkout parenting,
placement, Chat source kinds, or removal semantics. Do not add a copy service,
settings precedence, recovery queue, or general-purpose file-transfer protocol.

## Decisions

### D1. Separate git source and copy source

Add a required `copy_source` field to `CreateWorktreeRequest` in
`packages/machine-protocol/proto/stead/machine/v1/git.proto` and to the
internal Worktree-add input. `repository` remains the existing main Checkout
for git creation. The API derives `copy_source` from `inspection.toplevel` of
the selected Checkout, never from an unvalidated model field. Preserve it in
both plans until dispatch.

When inspection discovers a Checkout root different from the admitted submitted
source, admit that root through the existing Workspace-entry admission helper.
Use a named derived decision with the selected root as its locator. Do this
before manifest access or Worktree creation. Main-Checkout admission remains
separate. This prevents an allowed subdirectory from exposing a rejected root.

The daemon resolves `copy_source` through its root guard and confirms that it
belongs to the same git repository as `repository`. It treats the canonical
selected Checkout root as the boundary for the manifest and candidates. It
never silently substitutes main. Source identity is not a new base selector.

Alternative: use only `repository`. This loses linked-Checkout environment
values. Changing `repository` itself also risks changing existing base-ref
semantics.

### D2. Use Git eligibility and the workspace matcher

Reuse the workspace `ignore` crate 0.4, already a dependency of
`crates/machine-grep`, inside `crates/machine-git`. Git determines source
eligibility with ignored/untracked enumeration that honors nested ignore
files, info excludes, and configured global excludes. Use NUL-delimited paths,
no shell, no interpolation, and the daemon's own hardened git invocation.
Enumerate descendants of wholly ignored directories rather than accepting a
collapsed directory as the complete result.

Compile the manifest once and apply the matcher to relative source candidates.
Process directory entries without symlink traversal. Use `lstat` or no-follow
opens to distinguish regular files, links, and special files before contents
are read. Prune Git administration and the new destination if it lies beneath
the source. The latter prevents recursive copies of the output into itself.

Root anchoring uses `/name` as gitignore syntax, not an absolute OS path.
Reject parent-traversal segments, NUL, invalid UTF-8, administrative targets,
and matcher parse failures. Do not invent a stricter glob grammar: many odd
strings are valid literal gitignore patterns. Blank lines, comments, and a
valid pattern with no match are not errors.

Synthetic probes on the previous Node matcher confirmed these cases:

- `**/config.json` selects `vendor/pkg/config.json` directly.
- `secrets/**` followed by `!secrets/private.json` excludes that one file.
- `secrets/` followed by the same negation keeps it selected, because gitignore
  semantics do not re-include a child through a matched parent directory.

These were executable probes, not an upstream compatibility test. The
implementation must repeat them against the Rust `ignore` crate before the
behavior ships.
The source Git ignore rules and manifest selection are two separate filters.
Do not use the manifest to change Git's index or its ignore configuration.

Alternative: ask git to apply the manifest as another ignore file. This risks
mixing the eligibility filter with selection and makes negation harder to
reason about. A new custom matcher is unnecessary.

### D3. Bound filesystem access, not file-tool permissions

Worktree creation authorizes the manifest read and selected local copies.
Do not dispatch `read` or `write`, require their allowlist entries, or call their
permission groups for each file. Keep the existing entry decisions, modes,
Machine roots, and OS permissions. A model read-only attempt still cannot create
a Worktree. An owner read-only Chat creation still can under its existing gates.

The selected source and destination are admitted directory boundaries. The copy
must not follow source links or destination links. Validate each component and
use no-follow file access. Reject a selected special file instead of opening a
FIFO or device. Reject a symlink manifest. Git metadata is never an environment
input, even under a broad manifest pattern.

Replacing a regular destination must not truncate its existing inode through a
hard link. Use a new destination-local file and rename it into place after a
complete copy. Preserve ordinary mode bits without special ownership or set-id
privileges. Keep the target Git index unchanged. Do not remove a directory or
symlink to make a path fit. Recheck the destination before replacement.

This is not a Sandbox against an adversarial process with the same OS user.
Tests must still cover path replacement at the observable copy boundaries.
Where the platform cannot establish safe file identity, fail rather than
follow a changed path. No copied contents belong in diagnostics.

### D4. One fenced mutation, one deadline

Keep checkout and copy inside the daemon's `create_worktree` handler. The API
does not receive a successful add until the copy completes. Do not add a
second RPC that could succeed after an incomplete binding or escape the
existing attempt fence.

Use one deadline for checkout, manifest read, eligibility enumeration, and
copy. The handler's existing 120-second budget remains the limit. Do not
reset it for each file. Stream candidate paths and file bytes rather than
accumulating an unbounded list or file buffer. A fixed stdout bound must fail
explicitly, never silently drop candidates. Prefer incremental enumeration so
large explicit selections are not refused by an accidental inventory-size cap.

Propagate gRPC cancellation to enumeration and copy streams, and kill the git
process group as the handler already does. Drain or stop active writers before
a settled result. A timeout must not return success or leave copy writes
active in the background. Completion does not promise an atomic snapshot
against concurrent source edits. A selected file that disappears or changes
type before its copy causes a known failure, not a silent skip.

For known copy failures return a sanitized typed `GitFailure`. The API maps it
to the existing `worktree_failed` tool result and Chat workspace status, and
adds the known `leftDirectory` from its own plan. The internal result readers
must preserve that locator. Do not expose raw OS errors, manifest lines, or
file bytes. A bounded relative file path and a fixed reason are sufficient. No
public success field is needed.

On any partial failure retain the new directory and branch. Tool entry keeps
its previous binding. Chat creation keeps its filed Chat but stores no initial
message or Run. Both leave new catalog and lease rows uncommitted. A lost link
still yields `outcome_unknown`, not a claim that no effect occurred.

The existing recorded attempt covers both effects, and the daemon's
`request_id` cache returns the first completed result on a retained resend.
Redelivery or a same-id Chat resend never replays an uncertain copy.
Inspection and owner recovery, rather than an automatic retry or cleanup,
resolve leftovers.

### D5. Keep removal unchanged

A synthetic real-git probe confirmed that plain `git worktree remove` deletes an
otherwise clean Worktree containing an ignored `.env`. Git status reported no
change before removal. Document this consequence rather than creating a hidden
copy inventory. A tracked destination overwrite remains an ordinary dirty
change, which the existing removal guard protects.

### D6. Ship the proto change and both callers atomically

The required `copy_source` changes the `stead.machine.v1` git contract. The
canonical machine-daemon rule already requires every `stead.machine.v1`
change to increase the protocol version in
`packages/machine-protocol/proto/protocol.json`, and the bootstrap handshake
refuses any mismatch. Increase the version with the proto change so a daemon
that would silently ignore `copy_source` cannot pass the handshake and create
an unseeded Worktree.

The implementation is one layer with the proto, the regenerated TypeScript
client, the Rust daemon handler, the filesystem copy, both API callers,
regression tests, and shipped documentation. A daemon-only or caller-only
slice has no useful independently shippable contract here. There are no
cutover sub-issues and no parallel implementation branch.

## Architecture decision record

The proposal branch owns planning artifacts only. The following ADR is drafted
here for publication by the implementation layer, not as a claim of shipped
behavior. Planned path:
`docs/adr/2026-11-23-worktree-creation-authorizes-environment-copying.md`.
If acceptance occurs on another day, use that date as the ADR naming rule requires.

### Worktree creation authorizes local environment copying

Proposed status: `proposed` until the proposal revision receives approval.

An agent must run local development commands without receiving environment
secrets through a file-read result. We authorize the selected local copy through
Worktree creation because file-read permission controls disclosure by that tool,
not every executor-side use of the file. Per-file read admission would prevent
the intended `.env` workflow.

The selected source's local configuration takes precedence over regular target
files, including tracked files. Otherwise, creation could report success while
silently running against the target branch's different environment. Git exposes
any resulting tracked differences through its ordinary change state.

Copying does not carry a read rejection to the destination. Operators must cover
each relevant destination when they restrict later reads. The copy still obeys
its source and destination boundaries and cannot follow symlinks outside them.
The implementation ADR links the canonical `worktree-includes` specification
and this change's recorded decisions.

## Risks / Trade-offs

- Broader copy authority can place a source-read-rejected file at a readable
  destination. This is an approved consequence. Explain it in operator and
  permission documentation, with positive and negative destination-read tests.
- Overwrites can make a new Worktree dirty immediately. Preserve the Git index
  and show the real status rather than hiding the differences.
- Broad patterns can copy expensive trees. Honor explicit intent, stream the
  operation, and fail under the shared deadline rather than truncate it.
- A failed copy leaves an unrecorded directory and branch. Return the known
  locator and preserve unknown-outcome recovery without automatic deletion.
- Concurrent source edits do not have snapshot isolation. Prevent path escapes
  and unsafe file types, but do not promise coherent application-level snapshots.
- Existing git-directory and filter-driver gaps are tracked in
  [#1876](https://github.com/leon0399/llame/issues/1876) and
  [#1877](https://github.com/leon0399/llame/issues/1877). Recheck them before
  implementation and coordinate the invocation/admission changes. This change
  must not bypass their fixes or add a weaker git invocation path.

## Migration plan

No database or owner-data migration is required. Release the hub and the Rust
Machine daemon together for the protocol version bump. The existing bootstrap
equality gate refuses mixed versions. No operator enables a separate
file-copy tool or permission group.

Rollback requires matching hub and daemon versions. Existing copied files
remain ordinary Worktree files after rollback. Do not remove them or revert
tracked changes automatically. The manifest becomes inert on a version without
support.

## Review status

The initial draft is published as draft PR #1913 and rebased onto the master
that ships the Rust Machine daemon. Executable probes covered matcher
semantics on the previous Node matcher and ignored-file removal. Independent
proposal reviewers are unavailable in this Chat's tool catalog and shell PATH.
Self-review and validation do not satisfy the two-reviewer gate in
CONTRIBUTING.md. Ready transition, approval, and implementation remain blocked
on the required review and Leo's approval of the published revision.
