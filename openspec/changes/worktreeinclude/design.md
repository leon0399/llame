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
`git worktree add --no-track` under a 120-second deadline. The repository
check before the add runs pinned; the add itself runs through the crate's
shared invocation with a cleared environment and process-group kill, without
pinning. Every mutating call carries a `request_id`; the daemon retains
completed results in its idempotency cache, and the bootstrap handshake
requires an exact protocol version match.

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

Proto3 has no required fields. An empty `copy_source` is `INVALID_INPUT`, never
a default to `repository`. It joins the leading-`-` check in `option_like`.

Admit the selected Checkout root before manifest access or Worktree creation.
When inspection reports a root whose locator differs from both the canonical
decision and the `main_clone` decision already recorded, record a derived
decision of kind `copy_source` with that locator, through the same
Worktree-entry admission helper that records `main_clone`
(`requireDerivedPermission`). When the root equals either locator, the existing
decision covers it and no `copy_source` decision exists. In practice the new
decision appears for a subdirectory of a linked Worktree. Under `bypass` it is
a bypass decision like the others. This prevents an allowed subdirectory from
exposing a rejected root.

Before any subprocess for the copy, the daemon resolves `copy_source` with the
existing `nearest_git` and `checked_git_data` path, which requires the gitfile
and the git directory to lie inside the registered roots. It then requires the
canonical common directory of `copy_source` to equal that of `repository`.
Enumeration runs with pinned discovery. The daemon treats the canonical
selected Checkout root as the boundary for the manifest and candidates and
never silently substitutes main. Source identity is not a new base selector.

[#1876](https://github.com/leon0399/llame/issues/1876) and
[#1877](https://github.com/leon0399/llame/issues/1877) are open. This change
uses the existing guards for `copy_source` and adds no new admission path.

Alternative: use only `repository`. This loses linked-Checkout environment
values. Changing `repository` itself also risks changing existing base-ref
semantics.

### D2. Use Git eligibility and the workspace matcher

Reuse the workspace `ignore` crate 0.4, already a dependency of
`crates/machine-grep`, inside `crates/machine-git`, for manifest parsing only.
Git decides eligibility and the matcher evaluation below decides selection.

**Candidate source.** The only source of candidates is
`git ls-files -z --others --ignored --exclude-standard`, without `--directory`,
run in the copy source. Git then lists the descendants of an ignored directory
individually and honors nested ignore files, info excludes, and configured
global excludes. An entry that ends in `/` is a nested repository or Worktree,
including a destination that lies under the source. Never walk or copy it, and
skip it silently even when a pattern matches it. A probe confirmed that a nested
repository and a linked Worktree appear as `nested/` and `wt/x/`, while
`vendor/pkg/config.json` under an ignored `vendor/` appears as a file. Paths
under `.git` never appear in Git output.

**Streaming enumeration.** Ignored-path output is unbounded in practice: this
repository produced 14.7 MB and 122,000 entries, while `OUTPUT_MAX` in
`crates/machine-git/src/lib.rs` is 1 MiB. `read_capped` would reject it.
Enumeration therefore uses a streaming reader of NUL-terminated records that
matches each record as it arrives and holds only the selected paths. It has no
stdout volume cap. The shared deadline is its bound. It must have the hardening
of the pinned invocation in `run_mode`: cleared environment, the existing
config overrides, a process group killed at the deadline, and pinned discovery.
Share the command construction with `run_pinned` and differ only in how stdout
is consumed. Add no weaker invocation path.

**Manifest pattern screen.** Before parsing, refuse a manifest line whose
pattern, after stripping a leading `!` and a leading `/`, contains a path
segment equal to `..` or `.git`, or contains NUL or invalid UTF-8. Do not
refuse a wildcard that could match under `.git`: Git output never contains
those paths. Do not invent a stricter glob grammar, because many odd strings
are valid literal gitignore patterns. Blank lines, comments, and a valid
pattern with no match are not errors. Matcher parse failures are refused.
Root anchoring uses `/name` as gitignore syntax, not an absolute OS path.

**Matcher evaluation.** Compile the manifest once as a `Gitignore` rooted at
the copy source. For each relative candidate, evaluate top-down. For each
ancestor directory of the candidate, from the root down, call
`matched(ancestor, true)`. The first ancestor that returns Ignore selects the
candidate, and a later negation cannot re-include it, as in Git. Otherwise
`matched(candidate, false)` decides: Ignore selects, and Whitelist or None does
not. Do not use `matched_path_or_any_parents`: it returns a leaf negation even
under an ignored ancestor.

Synthetic probes on the previous Node matcher confirmed these cases:

- `**/config.json` selects `vendor/pkg/config.json` directly.
- `secrets/**` followed by `!secrets/private.json` excludes that one file.
- `secrets/` followed by the same negation keeps it selected, because gitignore
  semantics do not re-include a child through a matched parent directory.

These were executable probes, not an upstream compatibility test. The
implementation must repeat all three as Rust tests against the evaluation
above before the behavior ships.

**Global excludes.** The daemon's cleared environment keeps `HOME`, so
`core.excludesFile` and `$HOME/.config/git/ignore` apply. `XDG_CONFIG_HOME` and
`GIT_CONFIG_GLOBAL` do not. This limitation is documented, and no new variable
is forwarded.

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

The selected source and destination are admitted directory boundaries. Every
source and destination operation is relative to a directory handle opened
component by component without following links: `openat` and `renameat` with
`O_NOFOLLOW` semantics, or `openat2` with `RESOLVE_BENEATH|RESOLVE_NO_SYMLINKS`
on Linux. Where the platform cannot provide this, fail with `copy_failed`
rather than fall back to path-based access. Reject a selected special file
instead of opening a FIFO or device. Reject a symlink manifest. Git metadata is
never an environment input.

After `git worktree add` and before any copy, the daemon opens the new Worktree
root without following links and confirms that its real path equals the
requested canonical path. On a mismatch the daemon copies nothing and returns
the Worktree as created. The hub's existing real-path check in the tool entry
path (`refuseElsewhere` in `apps/api/src/tools/workspace-worktree-entry.ts`)
then removes it, on an unseeded and clean tree, so the canonical removal rule
stays unchanged. The daemon's existing `verify_unchanged` stays the final check
after the operation.

Replacing a regular destination must not truncate its existing inode through a
hard link. Write a destination-local temporary file and rename it into place
after a complete copy. Preserve ordinary mode bits without special ownership or
set-id privileges. Keep the target Git index unchanged. Do not remove a
directory or symlink to make a path fit. Recheck the destination before
replacement.

This is not a Sandbox against an adversarial process with the same OS user.
File reads already exceed `read` permission by design, so a hard link in the
source that points elsewhere is out of scope. Destination hard-link protection
stays. Tests must still cover path replacement at the observable copy
boundaries. No copied contents belong in diagnostics.

### D4. One fenced mutation, one deadline

Keep checkout and copy inside the daemon's `create_worktree` handler. The API
does not receive a successful add until the copy completes. Do not add a
second RPC that could succeed after an incomplete binding or escape the
existing attempt fence.

Use one deadline for checkout, manifest read, eligibility enumeration, and
copy. The handler's existing 120-second budget remains the limit. Do not
reset it for each file. Stream file bytes rather than accumulating a file
buffer, and check the deadline between chunks. Enumeration has no volume cap
(see D2). Do not fail on a large explicit selection.

`IdempotencyCache::run` in `crates/machine-core/src/idempotency.rs` spawns the
work detached, so a dropped RPC does not stop it. Do not claim cancellation
propagation. The shared deadline bounds checkout, enumeration, and copy, and
the existing process-group kill applies at that deadline. A copy that reaches
the deadline stops writing, removes its temporary file, and returns `TIMED_OUT`.
No copy write continues after that result.

The hub waits `WORKTREE_ADD_TIMEOUT_MS` (120 s, equal to the daemon budget) plus
`MACHINE_MARGIN_MS` (15 s) in `executor-git-machine.ts`. The daemon deadline
therefore expires before the hub stops waiting, and a typed `TIMED_OUT`
normally arrives. A lost link is `outcome_unknown`. Completion does not promise
an atomic snapshot against concurrent source edits. A selected file that
disappears or changes type before its copy causes a known failure, not a silent
skip.

Remove the temporary file on every failure, including the deadline. A leftover
temporary file would otherwise make a later non-force removal refuse the
Worktree as dirty.

For known copy failures return a sanitized typed `GitFailure` with the new
reason `GIT_FAILURE_REASON_COPY_FAILED = 9`, kept before the `GIT_FAILED = 255`
slot and its comment. Add the API wire type `copy_failed` to the closed
`FAILURE_TYPES` map in `apps/api/src/machines/wire/git.ts`. Unlike the other
stderr-carrying types, it carries `message`: a fixed reason phrase plus at most
one bounded relative path, never stderr, OS error text, manifest lines, or
bytes. Manifest refusals (invalid pattern, symlink manifest) use the same
reason. The API reads and maps it to the existing `worktree_failed` tool result
and Chat workspace status, and adds the known `leftDirectory` from its own
plan, in the plan's existing locator form. The model-facing renderer keeps
stripping that field. The internal result readers must preserve that locator
and the `message`. No public success field is needed.

On any partial failure retain the new directory and branch. The one exception
is the existing real-path-mismatch removal of D3, which acts on a Worktree that
received no copy. Tool entry keeps its previous binding. Chat creation keeps
its filed Chat but stores no initial message or Run. Both leave new catalog and
lease rows uncommitted. A lost link still yields `outcome_unknown`, not a claim
that no effect occurred.

The hub mints a fresh `request_id` for every call, so the daemon's cache does
not protect a recorded attempt from a second dispatch. Replay protection on this
path is the recorded attempt: the tool path records a native attempt before
the call, and Chat creation records the destination in its creation attempt.
Redelivery or a same-id Chat resend never replays an uncertain copy. Inspection
and owner recovery, rather than an automatic retry or cleanup, resolve
leftovers.

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

Copying does not carry a read rejection to the destination. A later admitted
read of a copied file can return its contents to model context; the read
groups at the destination govern that, and the copy's own no-disclosure rule
does not. Operators must cover each relevant destination when they restrict
later reads. The copy still obeys its source and destination boundaries and
cannot follow symlinks outside them.
The implementation ADR links the canonical `worktree-includes` specification
and this change's recorded decisions.

## Risks / Trade-offs

- Broader copy authority can place a source-read-rejected file at a readable
  destination, and a later admitted read there can return its contents to
  model context. The owner confirmed this trade-off in the
  [decision record](https://github.com/leon0399/llame/issues/1910#issuecomment-7111200259);
  approval of the published revision must accept it with the ADR in view.
  Explain it in operator and permission documentation, with positive and
  negative destination-read tests.
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

Round 1 ran two independent reviewers, one of them adversarial. Their findings
were verified against code and probes, and the revision that adds this section
encodes them. Leo directed implementation of the proposal in the implementation
session. A further review round follows.
