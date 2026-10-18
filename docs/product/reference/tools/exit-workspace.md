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

`exit_workspace({})` releases the owner's Chat binding to a canonical host or
[Machine](../locators/machine.md) directory.

## Arguments

None. The call takes no argument.

## Result

A successful exit reports the released binding; no file changes.

## Behavior

Exit releases the binding; a binding's lifetime and the other two ways it ends
are described in
[enter_workspace](enter-workspace.md#behavior).

Exit never contacts the bound Machine. A Machine binding is cleared while that
Machine is unreachable, and it needs neither a configured local executor nor a
reachable one, so a Machine Workspace is always released by this call.

Exit and detach load nothing; a released binding stages no instruction chain on
the next accepted turn. See [instruction files](../instruction-files.md).

## Errors

Exit takes no path, so it has no path failure of its own. It returns
`executor_unavailable` when the Run identity or the current-delivery fence the
call needs is missing or no longer holds, `permission_denied` when the
`exit_workspace` group refuses the call, `workspace_transition_conflict` when an
`enter_workspace` or `exit_workspace` call already took this model step's single
transition slot, and `cancelled` when the Run is aborted. A Machine binding
passes no executor identity, so its exit succeeds on a worker that has no local
executor configured.

## Configured by

[native files](../../operator/native-files.md) enables the host executor, the
`exit_workspace` entry, and its permission group. A Machine binding needs that
entry and group but no local executor; see
[machine locators](../locators/machine.md#configured-by).
