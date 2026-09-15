---
type: Reference
title: "Kimi Code"
description: "Subagent type allowlist with inherited permission mode; cautionary env inheritance and yolo bypass"
resource: "https://github.com/MoonshotAI/kimi-code"
observed:
  date: "2026-09-15"
  revision: "486dcd26c76f2854fc351515a45d8f0fc2d31ed6"
sources:
  - id: packages-kosong-src-catalog-ts-l438-l497
    resource: "https://github.com/MoonshotAI/kimi-code/blob/486dcd26c76f2854fc351515a45d8f0fc2d31ed6/packages/kosong/src/catalog.ts#L438-L497"
    title: "generic gateway resolution"
  - id: packages-agent-core-v2-src-app-agentidentity-agentidentity-ts-l39-l49
    resource: "https://github.com/MoonshotAI/kimi-code/blob/486dcd26c76f2854fc351515a45d8f0fc2d31ed6/packages/agent-core-v2/src/app/agentIdentity/agentIdentity.ts#L39-L49"
    title: "User-Agent product token rewrite"
  - id: packages-agent-core-v2-src-session-subagent-subagentservice-ts-l80-l165
    resource: "https://github.com/MoonshotAI/kimi-code/blob/486dcd26c76f2854fc351515a45d8f0fc2d31ed6/packages/agent-core-v2/src/session/subagent/subagentService.ts#L80-L165"
    title: "subagent spawn and allowlist"
  - id: packages-agent-core-v2-src-agent-toolapproval-toolapprovalservice-ts-l107-l176
    resource: "https://github.com/MoonshotAI/kimi-code/blob/486dcd26c76f2854fc351515a45d8f0fc2d31ed6/packages/agent-core-v2/src/agent/toolApproval/toolApprovalService.ts#L107-L176"
    title: "requestToolApproval"
  - id: packages-agent-core-v2-src-agent-permissionmode-configsection-ts-l7
    resource: "https://github.com/MoonshotAI/kimi-code/blob/486dcd26c76f2854fc351515a45d8f0fc2d31ed6/packages/agent-core-v2/src/agent/permissionMode/configSection.ts#L7"
    title: "manual, auto, yolo modes"
  - id: packages-agent-core-v2-src-mcpcore-client-stdio-ts-l279-l300
    resource: "https://github.com/MoonshotAI/kimi-code/blob/486dcd26c76f2854fc351515a45d8f0fc2d31ed6/packages/agent-core-v2/src/mcpCore/client-stdio.ts#L279-L300"
    title: "mergeStdioEnv inherits process.env"
  - id: packages-agent-core-v2-src-agent-contextmemory-compactionhandoff-ts-l68-l133
    resource: "https://github.com/MoonshotAI/kimi-code/blob/486dcd26c76f2854fc351515a45d8f0fc2d31ed6/packages/agent-core-v2/src/agent/contextMemory/compactionHandoff.ts#L68-L133"
    title: "compaction summary message"
---

# Kimi Code

- **Stack:** TypeScript pnpm monorepo; local CLI plus a websocket server and ACP server; engine layout mirrors OpenCode; MIT

Listed by OpenCode Go as lacking automatic session-header support. Confirmed:
no `x-opencode-session` occurrence in the tree; `opencode` is a generic
gateway id resolved to a wire protocol and base URL like any
other[^packages-kosong-src-catalog-ts-l438-l497], and the User-Agent is a
uniform product-token rewrite for every
provider[^packages-agent-core-v2-src-app-agentidentity-agentidentity-ts-l39-l49].

**Study**

1. **Subagent type allowlist with inherited permission mode.** Spawning
   enforces a caller-derived allowlist of subagent types, copies the
   caller's permission mode onto the child, and gives forked children a
   context reminder instead of a prompt
   reset[^packages-agent-core-v2-src-session-subagent-subagentservice-ts-l80-l165].
   Moderate confidence as a template for #765; single-process, not queued.
2. **Approval round trip with session-scoped rules.** `requestToolApproval`
   awaits a human response and records approved-for-session
   rules[^packages-agent-core-v2-src-agent-toolapproval-toolapprovalservice-ts-l107-l176].
   Moderate confidence as a shape for #778.
3. **Compaction as an origin-tagged message.** Summarized history becomes one
   `compaction_summary` message plus a retained
   tail[^packages-agent-core-v2-src-agent-contextmemory-compactionhandoff-ts-l68-l133].
   Low applicability; llame keeps an explicit boundary.

**Caution**

- `yolo` permission mode bypasses approval
  entirely[^packages-agent-core-v2-src-agent-permissionmode-configsection-ts-l7];
  a global bypass has no place in a multi-user server.
- MCP stdio servers inherit the full parent `process.env` with config env
  overlaid[^packages-agent-core-v2-src-mcpcore-client-stdio-ts-l279-l300].
  llame's declared-environment rule for stdio MCP is the opposite and must
  stay.
- No provenance or receipt concept; session state lives in local file
  backends with no tenant partitioning.

[^packages-kosong-src-catalog-ts-l438-l497]: [generic gateway resolution](https://github.com/MoonshotAI/kimi-code/blob/486dcd26c76f2854fc351515a45d8f0fc2d31ed6/packages/kosong/src/catalog.ts#L438-L497)

[^packages-agent-core-v2-src-app-agentidentity-agentidentity-ts-l39-l49]: [User-Agent product token rewrite](https://github.com/MoonshotAI/kimi-code/blob/486dcd26c76f2854fc351515a45d8f0fc2d31ed6/packages/agent-core-v2/src/app/agentIdentity/agentIdentity.ts#L39-L49)

[^packages-agent-core-v2-src-session-subagent-subagentservice-ts-l80-l165]: [subagent spawn and allowlist](https://github.com/MoonshotAI/kimi-code/blob/486dcd26c76f2854fc351515a45d8f0fc2d31ed6/packages/agent-core-v2/src/session/subagent/subagentService.ts#L80-L165)

[^packages-agent-core-v2-src-agent-toolapproval-toolapprovalservice-ts-l107-l176]: [`requestToolApproval`](https://github.com/MoonshotAI/kimi-code/blob/486dcd26c76f2854fc351515a45d8f0fc2d31ed6/packages/agent-core-v2/src/agent/toolApproval/toolApprovalService.ts#L107-L176)

[^packages-agent-core-v2-src-agent-permissionmode-configsection-ts-l7]: [manual, auto, yolo modes](https://github.com/MoonshotAI/kimi-code/blob/486dcd26c76f2854fc351515a45d8f0fc2d31ed6/packages/agent-core-v2/src/agent/permissionMode/configSection.ts#L7)

[^packages-agent-core-v2-src-mcpcore-client-stdio-ts-l279-l300]: [`mergeStdioEnv` inherits `process.env`](https://github.com/MoonshotAI/kimi-code/blob/486dcd26c76f2854fc351515a45d8f0fc2d31ed6/packages/agent-core-v2/src/mcpCore/client-stdio.ts#L279-L300)

[^packages-agent-core-v2-src-agent-contextmemory-compactionhandoff-ts-l68-l133]: [compaction summary message](https://github.com/MoonshotAI/kimi-code/blob/486dcd26c76f2854fc351515a45d8f0fc2d31ed6/packages/agent-core-v2/src/agent/contextMemory/compactionHandoff.ts#L68-L133)
