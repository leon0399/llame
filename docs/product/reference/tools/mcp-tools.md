---
summary: "MCP tools appear as mcp__<server>__<tool> and every call needs its own permission group"
read_when:
  - you are about to call a tool that came from an MCP server
  - you need to know what allowlisting an MCP tool does and does not mean
spec: mcp-tools
configured_by:
  - ../../operator/mcp-tools.md
  - ../../operator/tool-call-permissions.md
---

# MCP tools

## Purpose

MCP tools are the tools published by the operator's configured MCP servers.
They appear in the catalog under their own ids, with the schema and
descriptions the server declares.

## Arguments

Tool-defined: each MCP tool takes the arguments its own server's schema
declares. Rules that inspect individual arguments are operator policy; see
[Tool call permissions](../../operator/tool-call-permissions.md).

## Locators

None. An MCP tool takes no llame locator; any path, query, or target it needs is
an ordinary argument.

## Result

Tool-defined: the result is whatever the server returns.

An MCP tool declares no spill shape, so a result above the 16,000-character
model-facing cap spills by head: the system stores the whole rendering as an
artifact, keeps the head inline, and the cap notice names the artifact, its
line count, and the line to continue from. The model reads the rest with
`read("artifact://mcp__<server>__<tool>-<n>:<line>-")`. A rendering above
`tools.artifacts.maxBytes`, a failed write, or a Run that cannot read artifacts
returns the cut inline JSON, with `[full result not stored]` when a write was
attempted. See [artifacts](artifacts.md) and
[model output](model-output.md).

## Behavior

Tools are named `mcp__<server>__<tool>`.

An exact allowlist entry or a namespace wildcard selects safely admitted MCP
identities for a Run; it does not attest to an operation's effects. Remote
annotations grant no authority, and every MCP call also requires an applicable
permission group, which is named for the exact tool id: a missing or rejecting
group refuses the call. Write, send, delete, execute, financial, and
administrative operations are allowed only when the source is allowlisted and
the call passes its permission group.

The worker records each MCP dispatch before invoking it. On queue redelivery a
Run with a recorded attempt fails as `outcome_unknown` without re-running its
model loop: open calls settle from durable results where present, and no
recorded operation is invoked again. MCP calls have no automatic retry. See
[Unknown outcome](../mutation-recovery.md#unknown-outcome).

## Configured by

[MCP tools](../../operator/mcp-tools.md) — the servers, the allowlist, and the
permission group for every allowlisted tool.
[Tool call permissions](../../operator/tool-call-permissions.md) — the rules
each call is evaluated against.
