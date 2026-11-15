---
summary: "What an effective default, read-only, or bypass permission mode admits, refuses, and records for one Run"
read_when:
  - you need to know whether a permission group still applies to this Run
  - you need to know what a bypass admission authorizes and what it does not
spec: permission-modes
configured_by: ../operator/native-files.md
---

# Permission modes

A Run has one effective permission mode. `default` evaluates every configured
permission clause. `read-only` adds a ceiling over what a call may be, then
evaluates the policy exactly as `default`. `bypass` changes what an evaluation
admits, and nothing else.

## Admitted by read-only

A `read-only` attempt may call a tool only when the tool is classified
`read_only`, when it is `exit_workspace`, or when it is `enter_workspace`
without a `worktree` argument. Every other schema-valid call — `bash`, `stop`,
`edit`, `write`, `enter_workspace` with `worktree`, and every MCP tool — is refused
before any SSH host resolution, grep scope check, or permission group, with
reason `permission_mode_read_only` and the fixed message the spec names. The
message names neither the mode nor a setting. The decision carries the process's
policy-instance id, no clause reference, and is stored on the tool part like any
other decision; it is not model-visible beyond the `permission_denied` result.

An admitted call then needs the operator policy exactly as in `default`: a
`read` call without an allow is still refused with `no_allow`, and a reject still
applies. Expression of a `permission_mode_read_only` rejection also wins over a
policy reject for the same call.

A `read-only` attempt starts no Workspace MCP server and uses no Workspace MCP
client that another attempt started. A Workspace entry reports each configured
server as `unavailable` with reason `not started in a read-only Run`; a file or
server the configuration already reports as unavailable keeps its own reason.
The tool availability reminder reports the removed declarations as
`Removed tools:`.

Egress is not contained: `read` of an `http(s)` locator, `web_search`, and
`search_conversations` still reach the network under the operator policy, and a
remote `ssh://` read still runs llame's bounded read script. `read-only` prevents
mutation, not data leaving the process.

Chat creation with a `worktree` under `read-only` still creates it: the owner,
not the model, starts that Workspace step, and its path decisions evaluate as in
`default`.

## Effective mode

A Run accepted as `bypass` uses the worker's effective mode; a worker whose own
list omits `bypass` executes that attempt in `default` under its startup policy.
A Run accepted as `read-only` executes as `read-only` on every process: the
enabled list gates acceptance at the API, so withdrawing the mode never widens a
queued Run.

## Admitted by bypass

For an attempt whose effective mode is `bypass`, every permission evaluation is
admitted without evaluating the policy: the per-call gate, web-read derived
locators and resolved addresses, both submitted and canonical `enter_workspace`
paths, the per-attempt Workspace re-check, and an instruction import's canonical
path evaluation when it differs from its resolved path. This includes paths and
addresses that the configured rejects would otherwise refuse.

## Unchanged by bypass

`bypass` does not disable tool availability or catalog admission, owner or tenant
authorization (including ownership checks for `kb://`), native
locator validation, Workspace path projection or other Workspace re-check
conditions, the native recovery fence, web-read header, call, body, and redirect
bounds, Run step or call-timeout caps, or MCP environment isolation. The
configured native executor, existing-directory checks, and `realpath` validation
still apply.

## Recorded decisions

Each bypass admission still writes an owner-private allow decision with reason
`permission_mode_bypass`, the executing process's policy-instance id, and no
clause reference. This covers the call, web-read derived-locator, canonical
Workspace, and instruction-import canonical-path records; bypassed address checks
do not create address records because those are recorded only for refused
addresses. The decision metadata is not model-visible.

## Git state

The [git state](git-state.md) item is read for the model under the `read` group,
evaluated in the Run's effective mode. Its `git state unavailable: not
permitted` line is the one place where the mode changes what the model sees: a
`bypass` turn admits a git entry that the group rejects, so it tells the
repository state after a `default` turn told that line. No item names the mode,
and `read-only` tells the state exactly as `default` does.

## Configured by

[native files](../operator/native-files.md) enables the modes and owns the
instance-wide trust decision `bypass` represents;
[tool-call permissions](../operator/tool-call-permissions.md) defines the policy
each group evaluates.
