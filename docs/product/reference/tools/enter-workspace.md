---
summary: "The enter_workspace tool: binds the owner's Chat to a canonical Machine directory and projects relative paths from it"
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
directory on a Machine: the current Machine, or one named by a
[`machine://`](../locators/machine.md) locator. While entered, a relative
native-file or Bash
path resolves from that root instead of failing. With `worktree`, the call
creates a new git worktree of the clone `path` names and binds that directory
instead.

## Arguments

| Argument           | Meaning                                                                                                                      |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `path`             | an absolute path on the current Machine, or a `machine://` locator naming a directory on a Machine; nothing else is accepted |
| `worktree`         | optional: create a worktree of the source clone `path` names and bind it                                                     |
| `worktree.name`    | optional: the worktree name; an omitted name is generated                                                                    |
| `worktree.baseRef` | optional: the commit-ish the new branch starts at; an omitted value uses the source HEAD                                     |

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
- Every Machine, the host Machine included, runs the inspection and
  `git worktree add` on its daemon, so that daemon's registered roots bound the
  source and the directory; a path outside them fails as `path_not_registered`.
  An unavailable host daemon fails the call as `machine_unavailable` and starts
  no git process in the API or the worker.
- The Worktree checkout, its lease, any adopted repository and main checkout, and
  the binding commit together. The result names the root, the branch, and the
  base commit.
- Removing a worktree is an owner action, not a tool: see
  [repositories](../../operator/repositories.md#worktrees-a-chat-creates).

### Environment files

A new worktree starts from the source checkout's `.worktreeinclude` file, when
that file exists at the checkout root. The source is the checkout that the call
selected, not always the main clone. A subdirectory of a checkout uses that
checkout's root. The file need not be committed. Without it, the call creates a
plain checkout and copies nothing.

The file uses gitignore syntax and selects files that git ignores and does not
track. A file that is tracked, or untracked and not ignored, never qualifies.
The Machine copies each selected file once, at creation. A later edit of the
source file does not reach the worktree, and a later edit of the copy does not
reach the source.

- **Matching.** Patterns apply to the ignored files that git lists for the
  source, including files inside an ignored directory. Git's own ignore rules
  decide eligibility: nested ignore files, `.git/info/exclude`, and the
  global excludes that the daemon can see. The daemon passes git only `PATH`,
  `HOME`, and `TMPDIR`, so global excludes come from HOME-based config alone:
  `core.excludesFile` and `$HOME/.config/git/ignore`. It does not read
  `XDG_CONFIG_HOME` or `GIT_CONFIG_GLOBAL`.
- **Ancestor rule.** Evaluation runs from the root down. The first ignored
  ancestor directory selects its descendants, and a later `!` pattern cannot
  re-include a child. With `secrets/` followed by `!secrets/private.json`, the
  file is copied. With `secrets/**` in place of `secrets/`, it is not.
- **Refused patterns.** A pattern with a `..` or `.git` path segment fails
  creation, as does a manifest that is a symlink, larger than 1 MiB, not valid
  UTF-8, or unreadable. An unreadable file never counts as an empty one. A
  pattern that matches no file is not an error.
- **Skipped.** A nested repository or linked worktree is skipped, even when a
  pattern matches it.
- **Symlinks.** A selected symlink or special file fails creation. This includes
  one inside a selected directory. A pattern that selects a package tree with
  links, such as `node_modules/` with its `.bin` entries, therefore fails.
  Select the files that the worktree needs, such as `.env*`, instead.
- **Overwrite.** A copy replaces a regular file at the destination, including a
  file that the base ref tracks. The copy does not stage it, so git reports the
  difference as a change and the new worktree can be dirty from the start.
  Identical bytes leave no change.

The copy is not a read. It runs on the Machine as the Machine's OS user, and
copied bytes never cross the Machine protocol or enter a tool result. A file
that a `read` reject refuses at the source can still be copied. A later `read`
of the copy is decided by the permission groups for its destination path, so an
operator who restricts reads must cover the worktree directories. See
[Worktree creation authorizes environment
copying](../../../adr/2026-11-28-worktree-creation-authorizes-environment-copying.md).

A failed copy fails the call as `worktree_failed`. The worktree directory, its
branch, and the files copied before the failure remain, and the call binds
nothing. The failure records the directory as `leftDirectory` for recovery, and
the model-facing text omits it. A timeout records that directory as well,
because the call cannot tell whether the checkout or the copy timed out. A new
worktree root whose real path differs from the requested path also fails the
call, with the message "worktree root moved", and the directory stays. A
message holds a fixed phrase and at most one relative path,
never file bytes or an OS error. One deadline covers the checkout, the
enumeration, and the copy.

Plain `git worktree remove` deletes ignored copies with the worktree, and
nothing records which files came from the source. The owner removal route in
[repositories](../../operator/repositories.md#worktrees-a-chat-creates) refuses
only a dirty or unpublished tree, so an edited ignored copy does not stop it.

## Locators

An absolute path on the current Machine, or a
[`machine://`](../locators/machine.md) locator that
names one Machine and an absolute directory path on it. Entry accepts no
`file://`, `kb://`, `skill://`, or web locator, and the two Machine listing forms
(`machine://`, `machine://<name>`) name no directory and are refused.

## Result

A successful entry returns the canonical address that is now the binding: the
canonical `machine://<name>/<path>` locator, also when the target is on the
current Machine. A worktree entry adds `worktree` with its `path`, `branch`,
and `baseCommit`. The result carries the authority the bound root discloses,
which for a Machine names the Machine and states that its operations run as that
Machine's own OS user; see [machine authority](../locators/machine.md#authority).
The result holds no git state: when the entry binds or switches the root, the
next model step carries a `git` item after the result, as described in
[git state](../git-state.md).

## Behavior

Entry evaluates the submitted spelling against the `enter_workspace` group
before probing the filesystem, then requires an existing directory whose
canonical form is answered by the target Machine's daemon. The canonical path
is evaluated independently by the same group; both decisions need an allow and
must avoid every reject. A reject or missing allow on either spelling vetoes
entry, and the stored binding is always the canonical locator. No directory is
resolved in the worker.

An absolute path is placed on the current Machine, so that Machine's daemon
answers exactly as it does for a `machine://` locator. A `machine://` locator
is evaluated inside that Machine's address space. The submitted spelling is
evaluated against the `enter_workspace` group first, a name the operator did not
configure is refused without opening a connection, and an unreachable Machine
fails before the directory is probed. The Machine then answers with the
canonical locator of the named directory, its own `realpath` inside its
registered roots, and an existing directory is required. That canonical locator
is evaluated independently by the same group, so both decisions need an allow
and must avoid every reject, and the binding stores the canonical locator. A
host daemon that cannot start or answer fails the call as `machine_unavailable`,
a wrong identity as `machine_identity_mismatch`, and a host path outside every
registered root as `path_not_registered`.

The binding belongs to the owner's Chat and is sticky across Runs. It records
the Machine name as its executor id, so a worker that reaches the Machine can
serve a later attempt. The
binding remains until `exit_workspace`, a successful switch, or a failed
Run-preparation re-check. Re-entry at the same canonical root is a no-op.
Preparation detaches a binding when its Machine is absent or differs, the root
is missing or no longer a directory, its `realpath` moved, the current entry
permission no longer allows it without a reject, or `enter_workspace` is no
longer allowlisted; a Machine binding detaches only when the Machine is no longer
configured, because [an unreachable Machine does not detach
it](../locators/machine.md#behavior). A detached binding is not restored
automatically; a later successful entry is required.

Entry tells the repository's [git state](../git-state.md) the same way: always
when it binds or switches the root, and on a same-root re-entry only when the
state changed. A failed git read never fails the entry.

Entry loads the bound root's instruction chain when it establishes or switches
the binding, never on a same-root re-entry. The bound Machine's daemon discovers
that chain inside its registered roots, as described in
[instruction files](../instruction-files.md#machine-triggers).

## Bounds

While entered, a relative `read`, `edit`, or `write` path, and a relative
Bash `cwd`, is resolved lexically from the canonical root like POSIX
`path.resolve`. `..` may leave the root: Workspace entry selects a working root
but is not filesystem confinement. A submitted trailing separator is preserved
in the projected absolute string, and projection does not call `realpath`;
symlinks are followed by the Machine's OS as for any absolute path. Absolute paths
and recognized `kb://`, `skill://`, `http://`, and `https://` locators keep their
existing authority. Without a binding, relative native-file paths remain invalid.

A Workspace on any Machine resolves the same way in its Machine's own address
space: a
relative native-file path or relative Bash `cwd` becomes the Machine locator of
the path resolved lexically from the canonical locator, and a bare absolute
native-file path is that Machine's own path, so it is projected into the bound
Machine's locator too. A `file://` alias addresses the current Machine, which is
the bound Machine here, and another Machine's locator keeps its own authority.
Everything
runs as the Machine's OS user with no sandbox and no isolation between hub users
sharing that Machine, and the Machine's registered roots bound addressing only;
see [machine authority](../locators/machine.md#authority).

An omitted Bash `cwd` uses the canonical Workspace root while entered and the
current Machine's default directory otherwise; on a Machine Workspace it is the
canonical root on
the Machine, and the command runs there. Each Bash call remains a fresh process.
The Machine user runs every operation, so an entered root does not
confine Bash, file tools, symlink traversal, or other operations.

## Errors

An existing-directory and permission refusal vetoes entry before any binding is
stored; the refusals are the `enter_workspace` group's rejects, described in
[tool-call permissions](../../operator/tool-call-permissions.md). A Machine
target adds that surface's failures: `machine_not_found` for a name the operator
did not configure, `machine_unavailable` for a Machine that could not be reached,
and the Machine's own refusal for a path no registered root contains; see
[machine errors](../locators/machine.md#errors). An absolute path on the current
Machine takes the same failures, because its own daemon answers the
canonicalization.

A worktree call adds `invalid_input` for a name or base ref git would refuse,
`permission_denied` for a refused decision, and `worktree_failed` for a failed
creation — including a name whose directory or branch exists, a source that is
not a repository, a timeout, a failed [environment copy](#environment-files),
and the redacted git standard error. A failure records no row and leaves the
previous binding and its generation unchanged.

A fence lost after the directory was created answers `executor_unavailable`
with `leftDirectory`. A failed copy or a timeout answers `worktree_failed`, and
it also carries `leftDirectory`. A Machine link that dropped after the request
was sent answers `outcome_unknown`. In each case the directory can remain on
disk.

## Configured by

[native files](../../operator/native-files.md) enables the
`enter_workspace` entry and its permission group, and
[Machines](../../operator/machines.md) declares the Machines it can bind. The
target directory must lie inside its Machine's registered roots. Workspace MCP
servers, started on entry, are configured as described in
[MCP tools](../../operator/mcp-tools.md#workspace-mcp).

Entry and its permission group are all a Machine target needs, and without the
Machine configuration a Machine locator is refused as an unknown scheme; see
[machine locators](../locators/machine.md#configured-by). A Machine Workspace's
MCP servers run on that Machine.
