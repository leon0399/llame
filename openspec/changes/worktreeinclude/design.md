# Design

## Context

See [proposal.md](proposal.md#why) and the
[confirmed decisions](https://github.com/leon0399/llame/issues/1910#issuecomment-7111200259).
The inspected base is `a39a42ff`, with Machine protocol version 3 and
`ignore` 7.0.12 already used by `packages/native-file-tools`.

`packages/git-executor/src/worktrees.ts` implements an argv-only
`git worktree add`, with a 120-second budget. The Machine daemon calls it from
`apps/machine/src/git.ts`. All Checkouts, including host Checkouts, now use the
Machine protocol. There is no API-process git fallback.

Both API planners currently send their inspected main Checkout as `source`.
The tool path can accept a linked Worktree or a source subdirectory. Chat
creation currently rejects linked Checkout records in
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

Add a required `copySource` to the internal Worktree-add input and Machine RPC.
`source` remains the existing main Checkout for git creation. The API derives
`copySource` from `inspection.toplevel` of the selected Checkout, never from an
unvalidated model field. Preserve it in both plans until dispatch.

When inspection discovers a Checkout root different from the admitted submitted
source, admit that root through the existing Workspace-entry admission helper.
Use a named derived decision with the selected root as its locator. Do this
before manifest access or Worktree creation. Main-Checkout admission remains
separate. This prevents an allowed subdirectory from exposing a rejected root.

The daemon validates `copySource` through its root guard and confirms that it
belongs to the same git repository as `source`. It treats the canonical selected
Checkout root as the boundary for the manifest and candidates. It never silently
substitutes main. Source identity is not a new base-ref selector.

Alternative: use only `source`. This loses linked-Checkout environment values.
Changing `source` itself also risks changing existing base-ref semantics.

### D2. Use Git eligibility and the existing matcher

Reuse `ignore` 7.0.12 through a direct dependency on the same version in
`packages/git-executor`. Do not import the entire native-file-tools package.
Git determines source eligibility with ignored/untracked enumeration that
honors nested ignore files, info excludes, and configured global excludes.
Use NUL-delimited paths, no shell, no interpolation, and the shared hardened git
invocation policy. Enumerate descendants of wholly ignored directories rather
than accepting a collapsed directory as the complete result.

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

The inspected matcher confirms these cases:

- `**/config.json` selects `vendor/pkg/config.json` directly.
- `secrets/**` followed by `!secrets/private.json` excludes that one file.
- `secrets/` followed by the same negation keeps it selected, because gitignore
  semantics do not re-include a child through a matched parent directory.

These were executable synthetic probes, not an upstream compatibility test.
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

Keep checkout and copy inside `git.worktreeAdd`. The API does not receive a
successful add until the copy completes. Do not add a second RPC that could
succeed after an incomplete binding or escape the existing attempt fence.

Use one deadline for checkout, manifest read, eligibility enumeration, and copy.
The existing 120-second daemon operation budget remains the limit. Do not reset
it for each file. Stream candidate paths and file bytes rather than accumulating
an unbounded list or file buffer. A fixed stdout bound must fail explicitly,
never silently drop candidates. Prefer incremental enumeration so large explicit
selections are not refused by an accidental inventory-size cap.

Propagate cancellation to enumeration and copy streams. Drain or stop active
writers before a settled result. A timeout must not return success or leave
copy writes active in the background. Completion does not promise an atomic
snapshot against concurrent source edits. A selected file that disappears or
changes type before its copy causes a known failure, not a silent skip.

For known copy failures return a sanitized typed git failure with the optional
known `leftDirectory`. Map it to the existing `worktree_failed` tool result and
Chat workspace status. The internal result readers must preserve that locator.
Do not expose raw OS errors, manifest lines, or file bytes. A bounded relative
file path and a fixed reason are sufficient. No public success field is needed.

On any partial failure retain the new directory and branch. Tool entry keeps
its previous binding. Chat creation keeps its filed Chat but stores no initial
message or Run. Both leave new catalog and lease rows uncommitted. A lost link
still yields `outcome_unknown`, not a claim that no effect occurred.

The existing recorded attempt covers both effects. Redelivery or a same-id Chat
resend never replays an uncertain copy. Inspection and owner recovery, rather
than an automatic retry or cleanup, resolve leftovers.

### D5. Keep removal unchanged

A synthetic real-git probe confirmed that plain `git worktree remove` deletes an
otherwise clean Worktree containing an ignored `.env`. Git status reported no
change before removal. Document this consequence rather than creating a hidden
copy inventory. A tracked destination overwrite remains an ordinary dirty
change, which the existing removal guard protects.

### D6. Ship the protocol and both callers atomically

The required `copySource` changes the internal RPC contract. Advance the current
protocol revision in the implementation. Both hub and daemon must agree before
any Worktree mutation. Do not allow a daemon that only understands the old add
shape to silently omit environment files. Old/new mixed sessions fail through
the existing incompatible-version behavior, not a new fallback.

The implementation is one layer with protocol types, daemon handler, filesystem
copy, both API callers, regression tests, and shipped documentation. A daemon-
only or caller-only slice has no useful independently shippable contract here.
There are no cutover sub-issues and no parallel implementation branch.

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

No database or owner-data migration is required. Upgrade hub and Machine daemon
bundles together for the protocol revision. Mixed versions refuse handshake.
No operator enables a separate file-copy tool or permission group.

Rollback requires matching hub and daemon versions. Existing copied files remain
ordinary Worktree files after rollback. Do not remove them or revert tracked
changes automatically. The manifest becomes inert on a version without support.

## Review status

This is the initial draft. Executable probes covered matcher semantics and
ignored-file removal. Independent proposal reviewers are unavailable in this
Chat's tool catalog and shell PATH. Self-review and validation do not satisfy
the two-reviewer gate in CONTRIBUTING.md. Publication and implementation remain
blocked on the required review, revision approval, and publication permission.
