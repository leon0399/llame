---
status: accepted
---

# Worktree creation authorizes environment copying

An agent must run local development commands in a new worktree without
receiving environment secrets through a file-read result. We authorize the copy
of the files that `.worktreeinclude` selects through worktree creation. File-read
permission controls what the `read` tool discloses, not every use of a file on
the Machine. Per-file read admission would block the intended `.env` workflow.

The source checkout's local files take precedence over regular files in the new
worktree, including tracked files. Otherwise creation could report success while
the worktree runs against the base ref's different environment. Git reports any
resulting tracked difference as an ordinary change, so the worktree can be dirty
at once.

## Consequences

Copying does not carry a read rejection to the destination. A copied `.env` can
sit at a path that a read group allows. A later admitted `read` of it returns its
contents to model context, and the read groups at the destination decide that
read. Operators who restrict later reads must cover each destination, such as
`.llame-worktrees` or a `worktree_base`.

The copy still obeys its boundaries. It stays on one Machine, follows no
symlink, and copies no file outside the source checkout. A selected symlink
fails creation, so a pattern that selects a package tree with links, such as
`node_modules/`, fails.

Removal stays unchanged. Plain `git worktree remove` deletes an ignored copy
together with the worktree, and no inventory of copied files exists.

The owner accepted this trade-off in the
[decision record](https://github.com/leon0399/llame/issues/1910#issuecomment-7111200259).
The OpenSpec change
[worktreeinclude](../../openspec/changes/worktreeinclude/proposal.md) specifies
the behavior, and its [design](../../openspec/changes/worktreeinclude/design.md)
records the other decisions. [SPEC.md](../../SPEC.md) describes the shipped
architecture.
