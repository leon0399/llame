# Proposal

## Why

A new Worktree lacks ignored local inputs such as `.env`, so it cannot run the
same development commands as its source Checkout without manual copying.
[Issue #1910](https://github.com/leon0399/llame/issues/1910) requests the shared
`.worktreeinclude` convention, with the
[confirmed contract](https://github.com/leon0399/llame/issues/1910#issuecomment-7111200259)
that copying is part of Worktree creation rather than a file-read operation.

## What Changes

- Automatically copy selected ignored, untracked regular files from the selected
  source Checkout before either Worktree creation path binds the Chat.
- Read the source's live `.worktreeinclude`, whether committed or not. An absent
  or empty file copies nothing. Use gitignore-style patterns without Claude
  Code's special ignored-directory traversal restriction.
- Authorize the copy through Worktree creation, not separate `read` or `write`
  permission groups. A read-rejected `.env` still copies. Later reads have their
  own permission decisions at their destination paths.
- Overwrite regular destination files, including tracked files. Refuse selected
  symlinks (including a link inside a selected directory), destination symlinks, file/directory conflicts, and path escapes.
- Run the copy on the same Machine as the Checkouts. Return no copied contents.
  Keep the existing operation deadline without new byte or file-count caps.
  Enumerate Git's ignored paths as a stream with no volume cap.
- Retain a partial Worktree on failure, report its location, and preserve the
  previous binding. Never replay a recorded uncertain creation. Report a copy
  failure as the new typed reason `copy_failed`, with a fixed phrase and at
  most one bounded relative path. A `worktreeAdd` timeout cannot be told from a
  copy timeout, so it also names the plan directory as a possible leftover, and
  the durable tool result keeps that locator.
- Validate input first: an empty, option-like, or foreign-repository
  `copy_source` fails as typed `INVALID_INPUT` before any mutation.
- Keep one-time copy semantics and ordinary owner-initiated removal. Ignored
  copies have no inventory or change protection.

## Capabilities

### New Capabilities

- `worktree-includes`: Manifest selection, source eligibility, safe local copy,
  overwrite, failure, lifetime, and output rules.

### Modified Capabilities

- `tool-call-permissions`: Add the aggregate authorization contract and the
  derived `copy_source` decision for a selected source Checkout root derived
  from a submitted subdirectory, including its bypass record.
- `workspace-entry`: Require the copy before a Worktree entry commits, with
  selected-source identity distinct from the main Checkout used by git, and
  define the message of a copy failure and the possible leftover of a timeout.
- `chat-creation`: Require complete copying before the first binding and message,
  with the existing recorded-directory recovery behavior on a partial copy, and
  define the message of a copy failure and the possible leftover of a timeout.
- `remote-machines`: Replace the git-failure rule so a `COPY_FAILED` failure
  carries a fixed reason phrase and at most one bounded relative path instead
  of standard error.

## Impact

The gRPC `CreateWorktree` operation changes in its proto contract under
`packages/machine-protocol` (a required `copy_source` field and the
`GIT_FAILURE_REASON_COPY_FAILED` reason) and in the Rust daemon's
`crates/machine-git`.
The API must carry the selected source separately through both Worktree
planners and preserve typed failures. Both host and remote creation use the
Rust Machine daemon. The proto change must increase the machine protocol
version so an old daemon cannot silently create an unseeded Worktree.

Reuse the workspace Rust `ignore` crate for manifest matching. Git remains the
source of truth for ignored and untracked eligibility. No database migration,
public configuration key, new tool, or UI control is planned.

The implementation updates the entry tool reference, repository operator guide,
permission documentation, and `SPEC.md` with the behavior it ships, and adds
`.changeset/worktreeinclude.md`.
The proposed ADR text is in [design.md](design.md#architecture-decision-record).
The implementation publishes it under `docs/adr/` with the required links.

## Acceptance and non-goals

Acceptance includes real-git fixtures for linked sources, wholly ignored trees,
sources with more than 1 MiB of ignored paths, nested repositories,
tracked destination overwrites, symlink refusal, partial failures, owner
isolation, permission modes, and absence of file contents from observations.
[Tasks](tasks.md) assign the checks to one atomic implementation layer.

No automatic defaults, personal patterns, setup commands, dependency installation,
file synchronization, symlink support, copy inventory, automatic cleanup of a
failed copy, or new Chat-creation source kinds are included. The shipped
removal of a Worktree whose real path differs from the decided one is
unchanged. Manual `git worktree add` is unchanged.
Base-ref resolution, parenting, naming, placement, and removal guards remain as
shipped. Copy-source identity does not change the git source or its base commit.

There are no unresolved product decisions. Proposed engineering details remain
subject to independent review and approval of the published proposal revision.
Approval of the grilling summary does not authorize implementation or publication.
