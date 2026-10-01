---
summary: "What an effective default or bypass permission mode admits, refuses, and records for one Run"
read_when:
  - you need to know whether a permission group still applies to this Run
  - you need to know what a bypass admission authorizes and what it does not
spec: permission-modes
configured_by: ../operator/native-files.md
---

# Permission modes

A Run has one effective permission mode. `default` evaluates every configured
permission clause. `bypass` changes what an evaluation admits, and nothing else.

## Effective mode

A Run accepted as `bypass` uses the worker's effective mode; a worker whose own
list omits `bypass` executes that attempt in `default` under its startup policy.

## Admitted by bypass

For an attempt whose effective mode is `bypass`, every permission evaluation is
admitted without evaluating the policy: the per-call gate, web-read derived
locators and resolved addresses, both submitted and canonical `enter_workspace`
paths, and the per-attempt Workspace re-check. This includes paths and addresses
that the configured rejects would otherwise refuse.

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
clause reference. This covers the call, web-read derived-locator, and canonical
Workspace records; bypassed address checks do not create address records because
those are recorded only for refused addresses. The decision metadata is not
model-visible.

## Configured by

[native files](../operator/native-files.md) enables the modes and owns the
instance-wide trust decision `bypass` represents;
[tool-call permissions](../operator/tool-call-permissions.md) defines the policy
each group evaluates.
