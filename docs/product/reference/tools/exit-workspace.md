---
summary: "The exit_workspace tool: releases the owner's Chat binding so relative paths stop resolving"
read_when:
  - you need to leave a Workspace and know what releasing it changes
  - you need to know when a binding ends without this call
spec: workspace-entry
configured_by: ../../operator/native-files.md
---

# exit_workspace

## Purpose

`exit_workspace({})` releases the owner's Chat binding to a canonical host
directory.

## Arguments

None. The call takes no argument.

## Result

A successful exit reports the released binding; no file changes.

## Behavior

Exit releases the binding; a binding's lifetime and the other two ways it ends
are described in
[enter_workspace](enter-workspace.md#behavior).

Exit and detach load nothing; a released binding stages no instruction chain on
the next accepted turn. See [instruction files](../instruction-files.md).

## Errors

Exit takes no path, so it has no path failure of its own; it fails only when the
host executor is unavailable or the `exit_workspace` group refuses the call.

## Configured by

[native files](../../operator/native-files.md) enables the host executor, the
`exit_workspace` entry, and its permission group.
