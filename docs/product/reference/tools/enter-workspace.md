---
summary: "The enter_workspace tool: binds the owner's Chat to a canonical host or Machine directory and projects relative paths from it"
read_when:
  - you need to know what entering a Workspace changes for later paths
  - you need to know when a binding is refused or detached
  - you need to know what a Workspace on a Machine binds and discloses
spec: workspace-entry
configured_by:
  - ../../operator/native-files.md
---

# enter_workspace

## Purpose

`enter_workspace({ path, worktree? })` binds the owner's Chat to one canonical
directory: a host directory, or a directory on a configured
[Machine](../locators/machine.md). While entered, a relative native-file or Bash
path resolves from that root instead of failing. With `worktree`, the call
creates a new git worktree of the clone `path` names and binds that directory
instead.

## Arguments

| Argument           | Meaning                                                                                                    |
| ------------------ | ---------------------------------------------------------------------------------------------------------- |
| `path`             | an absolute host path, or a `machine://` locator naming a directory on a Machine; nothing else is accepted |
| `worktree`         | optional: create a worktree of the source clone `path` names and bind it                                   |
| `worktree.name`    | optional: the worktree name; an omitted name is generated                                                  |
| `worktree.baseRef` | optional: the commit-ish the new branch starts at; an omitted value uses the source HEAD                   |

A `worktree` object with any other member, and `exit_workspace` with any
argument, is invalid input.

## Worktree entries

With `worktree`, `path` is a source clone: a subdirectory of one, a linked
worktree of one, or the clone itself. The source is the main tree git reports,
and the call runs one read-only inspection of it.

- The directory is `<parent>/.llame-worktrees/<display name>/<slug>`, beside the
  clone, unless the clone's main checkout carries a `worktree_base`, which
  replaces `<parent>/.llame-worktrees`. `<slug>` is the name with each `/`
  replaced by `-`.
- The branch is `llame/<name>`, or the name itself when it holds a `/`. A
  supplied name is used as written; an omitted one becomes
  `<adjective>-<noun>-<4 hex>` and is retried while its directory exists.
- The policy decides the submitted path, then the canonical source clone, then
  the main clone git reports, then the canonical worktree directory — resolved
  through its deepest existing ancestor, so a symlinked parent decides where it
  lands. A refusal on any of the four creates nothing.
- The Worktree checkout, its lease, any adopted repository and main checkout, and
  the binding commit together. The result names the root, the branch, and the
  base commit.
- Removing a worktree is an owner action, not a tool: see
  [repositories](../../operator/repositories.md#worktrees-a-chat-creates).

## Locators

An absolute host path, or a [`machine://`](../locators/machine.md) locator that
names one Machine and an absolute directory path on it. Entry accepts no
`file://`, `kb://`, `skill://`, or web locator, and the two Machine listing forms
(`machine://`, `machine://<name>`) name no directory and are refused.

## Result

A successful entry returns the canonical address that is now the binding: the
canonical absolute host path, or the canonical `machine://<name>/<path>` locator
for a Machine target. A worktree entry adds `worktree` with its `path`, `branch`,
and `baseCommit`. The result carries the authority the bound root discloses,
which for a Machine names the Machine and states that its operations run as that
Machine's own OS user; see [machine authority](../locators/machine.md#authority).

## Behavior

Entry evaluates the submitted spelling against the `enter_workspace` group
before probing the filesystem, then canonicalizes it with `realpath` and requires
an existing directory. The canonical path is evaluated independently by the same
group; both decisions need an allow and must avoid every reject. A reject or
missing allow on either spelling vetoes entry, and the stored binding is always
the canonical absolute path.

A Machine locator is evaluated the same way inside that Machine's address space.
The submitted spelling is evaluated against the `enter_workspace` group first, a
name the operator did not configure is refused without opening a connection, and
an unreachable Machine fails before the directory is probed. The Machine then
answers with the canonical locator of the named directory — its own `realpath`,
inside its registered roots — and an existing directory is required. That
canonical locator is evaluated independently by the same group, so both
decisions need an allow and must avoid every reject, and the binding stores the
canonical locator.

The binding belongs to the owner's Chat and is sticky across Runs on the same
native executor. A Machine entry records executor `machine:<name>` instead of
the local executor id, and it does not pin the Run to a local executor, so a
worker without a configured local executor can hold a Machine Workspace. The
binding remains until `exit_workspace`, a successful switch, or a failed
Run-preparation re-check. Re-entry at the same canonical root is a no-op.
Preparation detaches a binding when the executor is absent or differs, the root
is missing or no longer a directory, its `realpath` moved, the current entry
permission no longer allows it without a reject, or `enter_workspace` is no
longer allowlisted; a Machine binding detaches only when the Machine is no longer
configured, because [an unreachable Machine does not detach
it](../locators/machine.md#behavior). A detached binding is not restored
automatically; a later successful entry is required.

Entry loads the bound root's instruction chain when it establishes or switches
the binding, never on a same-root re-entry; a Machine entry discovers that chain
on the Machine, as described in [instruction files](../instruction-files.md).

## Bounds

While entered, a relative local `read`, `edit`, or `write` path, and a relative
Bash `cwd`, is resolved lexically from the canonical root like POSIX
`path.resolve`. `..` may leave the root: Workspace entry selects a working root
but is not filesystem confinement. A submitted trailing separator is preserved
in the projected absolute string, and projection does not call `realpath`;
symlinks are followed by the host OS as for any absolute path. Absolute paths
and recognized `kb://`, `skill://`, `http://`, and `https://` locators keep their
existing authority. Without a binding, relative native-file paths remain invalid.

A Machine Workspace resolves the same way in the Machine's own address space: a
relative native-file path or relative Bash `cwd` becomes the Machine locator of
the path resolved lexically from the canonical locator, and a bare absolute
native-file path is that Machine's own path, so it is projected into the bound
Machine's locator too. A `file://` alias always addresses the local host, and
another scheme or another Machine's locator keeps its own authority. Everything
runs as the Machine's OS user with no sandbox and no isolation between hub users
sharing that Machine, and the Machine's registered roots bound addressing only;
see [machine authority](../locators/machine.md#authority).

An omitted Bash `cwd` uses the canonical Workspace root while entered and the
host/API default otherwise; on a Machine Workspace it is the canonical root on
the Machine, and the command runs there. Each Bash call remains a fresh process.
The native executor runs under its host OS user, so an entered root does not
confine Bash, file tools, symlink traversal, or other host operations.

## Errors

An existing-directory and permission refusal vetoes entry before any binding is
stored; the refusals are the `enter_workspace` group's rejects, described in
[tool-call permissions](../../operator/tool-call-permissions.md). A Machine
target adds that surface's failures: `machine_not_found` for a name the operator
did not configure, `machine_unavailable` for a Machine that could not be reached,
and the Machine's own refusal for a path no registered root contains; see
[machine errors](../locators/machine.md#errors).

A worktree call adds `invalid_input` for a name or base ref git would refuse,
`permission_denied` for a refused decision, and `worktree_failed` for a failed
creation — including a name whose directory or branch exists, a source that is
not a repository, a timeout, and the redacted git standard error. A failure
records no row and leaves the previous binding and its generation unchanged. A
fence lost after the directory was created answers `executor_unavailable` with
`leftDirectory`, and a Machine link that dropped after the request was sent
answers `outcome_unknown`; the directory can remain on disk in both cases.

## Configured by

[native files](../../operator/native-files.md) enables the host executor, the
`enter_workspace` entry, and its permission group. Workspace MCP servers,
started on entry, are configured as described in
[MCP tools](../../operator/mcp-tools.md#workspace-mcp).

A Machine target is the operator's Machine configuration rather than a local
executor: the entry and its permission group are all it needs, and without that
configuration a Machine locator is refused as an unknown scheme; see
[machine locators](../locators/machine.md#configured-by). A Machine Workspace's
MCP servers run on that Machine.
