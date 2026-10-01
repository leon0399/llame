---
summary: "The enter_workspace tool: binds the owner's Chat to a canonical host directory and projects relative paths from it"
read_when:
  - you need to know what entering a Workspace changes for later paths
  - you need to know when a binding is refused or detached
spec: workspace-entry
configured_by:
  - ../../operator/native-files.md
---

# enter_workspace

## Purpose

`enter_workspace({ path })` binds the owner's Chat to one canonical host
directory. While entered, a relative native-file or Bash path resolves from that
root instead of failing.

## Arguments

| Argument | Meaning                                         |
| -------- | ----------------------------------------------- |
| `path`   | an absolute host path; nothing else is accepted |

## Locators

An absolute host path only. Entry accepts no `file://`, `kb://`, `skill://`, or
web locator.

## Result

A successful entry returns the canonical absolute path that is now the binding.

## Behavior

Entry evaluates the submitted spelling against the `enter_workspace` group
before probing the filesystem, then canonicalizes it with `realpath` and requires
an existing directory. The canonical path is evaluated independently by the same
group; both decisions need an allow and must avoid every reject. A reject or
missing allow on either spelling vetoes entry, and the stored binding is always
the canonical absolute path.

The binding belongs to the owner's Chat and is sticky across Runs on the same
native executor. It remains until `exit_workspace`, a successful switch, or a
failed Run-preparation re-check. Re-entry at the same canonical root is a no-op.
Preparation detaches a binding when the executor is absent or differs, the root
is missing or no longer a directory, its `realpath` moved, the current entry
permission no longer allows it without a reject, or `enter_workspace` is no
longer allowlisted. A detached binding is not restored automatically; a later
successful entry is required.

Entry loads the bound root's instruction chain when it establishes or switches
the binding, never on a same-root re-entry; see
[instruction files](../instruction-files.md).

## Bounds

While entered, a relative local `read`, `edit`, or `write` path, and a relative
Bash `cwd`, is resolved lexically from the canonical root like POSIX
`path.resolve`. `..` may leave the root: Workspace entry selects a working root
but is not filesystem confinement. A submitted trailing separator is preserved
in the projected absolute string, and projection does not call `realpath`;
symlinks are followed by the host OS as for any absolute path. Absolute paths
and recognized `kb://`, `skill://`, `http://`, and `https://` locators keep their
existing authority. Without a binding, relative native-file paths remain invalid.

An omitted Bash `cwd` uses the canonical Workspace root while entered and the
host/API default otherwise. Each Bash call remains a fresh process. The native
executor runs under its host OS user, so an entered root does not confine Bash,
file tools, symlink traversal, or other host operations.

## Errors

An existing-directory and permission refusal vetoes entry before any binding is
stored; the refusals are the `enter_workspace` group's rejects, described in
[tool-call permissions](../../operator/tool-call-permissions.md).

## Configured by

[native files](../../operator/native-files.md) enables the host executor, the
`enter_workspace` entry, and its permission group. Workspace MCP servers,
started on entry, are configured as described in
[MCP tools](../../operator/mcp-tools.md#workspace-mcp).
