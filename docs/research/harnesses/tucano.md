---
type: Reference
title: "Tucano"
description: "Apache-2.0 Electron workspace whose peer CLIs take tools from a per-turn MCP gateway and whose approval rechecks the grant before the stored call runs."
resource: "https://github.com/eduwxyz/tucano/tree/cdc70feb56f4ac29c74a9de46dff2d6b514ff61d"
tags: [harness, peer-executor, mcp, approvals, desktop, routines]
status: stable
generated:
  by: "grok/grok-4.7"
  at: "2026-11-03"
observed:
  date: "2026-11-03"
  revision: "cdc70feb56f4ac29c74a9de46dff2d6b514ff61d"
sources:
  - id: tucano-license
    resource: "https://github.com/eduwxyz/tucano/blob/cdc70feb56f4ac29c74a9de46dff2d6b514ff61d/LICENSE#L1-L4"
    title: "Apache License 2.0 heading"
  - id: tucano-security
    resource: "https://github.com/eduwxyz/tucano/blob/cdc70feb56f4ac29c74a9de46dff2d6b514ff61d/SECURITY.md#L19-L20"
    title: "Per-turn MCP gateway and approvals tied to the call"
  - id: tucano-claude-web
    resource: "https://github.com/eduwxyz/tucano/blob/cdc70feb56f4ac29c74a9de46dff2d6b514ff61d/src/core/engines/claude.ts#L31-L49"
    title: "With web on, Claude still receives WebSearch and WebFetch"
  - id: tucano-hash
    resource: "https://github.com/eduwxyz/tucano/blob/cdc70feb56f4ac29c74a9de46dff2d6b514ff61d/src/core/policy.ts#L28-L49"
    title: "Grant filter and approval hash of connector, tool, and canonical args"
  - id: tucano-recheck
    resource: "https://github.com/eduwxyz/tucano/blob/cdc70feb56f4ac29c74a9de46dff2d6b514ff61d/src/core/runs.ts#L979-L981"
    title: "A tool call re-reads the grant before it runs"
  - id: tucano-decide
    resource: "https://github.com/eduwxyz/tucano/blob/cdc70feb56f4ac29c74a9de46dff2d6b514ff61d/src/core/runs.ts#L1250-L1252"
    title: "Approving runs the stored call after another grant check"
  - id: tucano-always
    resource: "https://github.com/eduwxyz/tucano/blob/cdc70feb56f4ac29c74a9de46dff2d6b514ff61d/src/core/runs.ts#L1258"
    title: "always skips high-risk tools and GitHub, browser, and apps connectors"
  - id: tucano-decide-check
    resource: "https://github.com/eduwxyz/tucano/blob/cdc70feb56f4ac29c74a9de46dff2d6b514ff61d/src/core/runs.ts#L1370"
    title: "decide refuses when the tool is no longer allowed"
---

# Tucano

- **Stack:** Electron and TypeScript. Apache-2.0.[^tucano-license] The [tierroom board](https://my-tierroom.party/agents/tucano) and [tucano.sh](https://tucano.sh/) are live pages and are not pinned.

Tucano is a desktop workspace of named agents on Claude Code, Codex, OpenCode, or Pi. The security note says each reply runs the harness CLI with no built-in tools, and the only tools come from a local MCP gateway on a secret per-turn URL that lists that agent's tools.[^tucano-security] `claudeArgs` says that with web enabled the only built-in tools are web search and page reading, and `--tools` is that web list.[^tucano-claude-web] Source inspection of the policy and run files; nothing was run.

**Study**

1. **The gateway is the tool catalog.** `allowed` exposes a tool when it is enabled and the grant is `read_write`, or when the grant is `read` and the class is `read`.[^tucano-hash] A peer CLI that can also call its own shell would bypass this. The security note says the CLI is started without built-in tools.[^tucano-security] `claudeArgs` passes `--tools` as the web-tool list, empty unless web is on. The comment names those tools as web search and page reading.[^tucano-claude-web]
2. **Sensitive calls are hashed, then checked again.** `approvalHash` is SHA-256 of `connectorId`, tool name, and canonical JSON of the arguments.[^tucano-hash] During a turn, a call returns "tool not allowed right now" when the live grant no longer allows it. The comment calls that a defense against grants changing since the turn started.[^tucano-recheck] `decide` says approving runs the stored call after checking the grant again.[^tucano-decide] The branch this pass read refuses the stored tool when `allowed` is false for the current grant.[^tucano-decide-check] `always` can add a tool to `autoApprove` except for a high-risk tool and the GitHub, browser, and apps connectors.[^tucano-always]
3. **Channels and routines are product surface around that gateway.** The board says @mentions and a router choose who speaks, and that schedules need the app running. Those behaviors were not traced in this pass. Telegram is described on the board as the approvals path, not a full phone client.

**llame fit**

- High: item 1, for any future peer-CLI adapter. llame's adapters are [north-star work](../../../VISION.md#runs-are-the-unit-of-execution). A per-turn allowlist the peer cannot widen is the boundary that keeps the harness as the executor.
- High: item 2's recheck of the grant at execution time, on top of a hash of the arguments. llame's [tools.allowed gate](../../../VISION.md#the-harness-owns-execution) is static today; fine-grained approvals are later work.
- Low: the desktop team UI, until the router and routine scheduler are read.

**Caution:** Name-based tool classification (`delete`, `send`, and a read-verb list) can mis-label a tool before the grant filter runs.[^tucano-hash] `decide` rechecks `allowed` and runs the stored arguments. This pass did not find a comparison of `approvalHash` at decision time. The security note's "runs exactly that call" matches the connector path that uses `ap.args`.[^tucano-decide-check] Docker as an optional Linux computer is a README and board claim; the container code was not opened. Prompts still go to the selected CLI's provider.

[^tucano-license]: [Apache License 2.0 heading](https://github.com/eduwxyz/tucano/blob/cdc70feb56f4ac29c74a9de46dff2d6b514ff61d/LICENSE#L1-L4)

[^tucano-security]: [Per-turn MCP gateway and approvals tied to the call](https://github.com/eduwxyz/tucano/blob/cdc70feb56f4ac29c74a9de46dff2d6b514ff61d/SECURITY.md#L19-L20)

[^tucano-claude-web]: [With web on, Claude still receives WebSearch and WebFetch](https://github.com/eduwxyz/tucano/blob/cdc70feb56f4ac29c74a9de46dff2d6b514ff61d/src/core/engines/claude.ts#L31-L49)

[^tucano-hash]: [Grant filter and approval hash of connector, tool, and canonical args](https://github.com/eduwxyz/tucano/blob/cdc70feb56f4ac29c74a9de46dff2d6b514ff61d/src/core/policy.ts#L28-L49)

[^tucano-recheck]: [A tool call re-reads the grant before it runs](https://github.com/eduwxyz/tucano/blob/cdc70feb56f4ac29c74a9de46dff2d6b514ff61d/src/core/runs.ts#L979-L981)

[^tucano-decide]: [Approving runs the stored call after another grant check](https://github.com/eduwxyz/tucano/blob/cdc70feb56f4ac29c74a9de46dff2d6b514ff61d/src/core/runs.ts#L1250-L1252)

[^tucano-always]: [always skips high-risk tools and GitHub, browser, and apps connectors](https://github.com/eduwxyz/tucano/blob/cdc70feb56f4ac29c74a9de46dff2d6b514ff61d/src/core/runs.ts#L1258)

[^tucano-decide-check]: [decide refuses when the tool is no longer allowed](https://github.com/eduwxyz/tucano/blob/cdc70feb56f4ac29c74a9de46dff2d6b514ff61d/src/core/runs.ts#L1370)
