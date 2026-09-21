---
type: Reference
title: "Kimi Code"
description: "Subagent type allowlist with inherited permission mode; cautionary env inheritance and yolo bypass"
resource: "https://github.com/MoonshotAI/kimi-code"
observed:
  date: "2026-09-21"
  revision: "6a52dd781b959328190b0cd66082154b96ef6a47"
sources:
  - id: packages-kosong-src-catalog-ts-l438-l497
    resource: "https://github.com/MoonshotAI/kimi-code/blob/6a52dd781b959328190b0cd66082154b96ef6a47/packages/kosong/src/catalog.ts#L438-L497"
    title: "generic gateway resolution"
  - id: packages-kosong-src-catalog-ts-l26-l29
    resource: "https://github.com/MoonshotAI/kimi-code/blob/6a52dd781b959328190b0cd66082154b96ef6a47/packages/kosong/src/catalog.ts#L26-L29"
    title: "opencode named as an example gateway provider"
  - id: packages-node-sdk-src-config-schema-ts-l47-l58
    resource: "https://github.com/MoonshotAI/kimi-code/blob/6a52dd781b959328190b0cd66082154b96ef6a47/packages/node-sdk/src/config/schema.ts#L47-L58"
    title: "static per-provider customHeaders map"
  - id: packages-kosong-src-providers-request-auth-ts-l18-l30
    resource: "https://github.com/MoonshotAI/kimi-code/blob/6a52dd781b959328190b0cd66082154b96ef6a47/packages/kosong/src/providers/request-auth.ts#L18-L30"
    title: "default and per-request header merge at the client factory"
  - id: packages-agent-core-v2-src-app-agentidentity-agentidentity-ts-l42-l60
    resource: "https://github.com/MoonshotAI/kimi-code/blob/6a52dd781b959328190b0cd66082154b96ef6a47/packages/agent-core-v2/src/app/agentIdentity/agentIdentity.ts#L42-L60"
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

Listed by OpenCode Go as lacking automatic session-header support. Confirmed at
this revision: no `x-opencode-session` occurrence in the tree, `opencode` is a
generic gateway id resolved to a wire protocol and base URL like any
other[^packages-kosong-src-catalog-ts-l438-l497] (the resolver names it only as an
example of a gateway with per-model
overrides[^packages-kosong-src-catalog-ts-l26-l29]), and the User-Agent is a
product-token rewrite of whatever host headers the embedding application supplied
rather than a provider-specific
string[^packages-agent-core-v2-src-app-agentidentity-agentidentity-ts-l42-l60]. The only
header channel is a static per-provider `customHeaders` map from configuration,
merged with any per-request headers when the wire client is
built[^packages-node-sdk-src-config-schema-ts-l47-l58][^packages-kosong-src-providers-request-auth-ts-l18-l30];
nothing derives a session value, so a Go adapter here is configuration, not code.

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
4. **A construction-time header channel with no session derivation.** Provider
   configuration accepts an arbitrary `customHeaders` record, and the request
   builder merges it under any per-request header map before constructing the wire
   client[^packages-node-sdk-src-config-schema-ts-l47-l58][^packages-kosong-src-providers-request-auth-ts-l18-l30].
   Every value is static, so the map can carry a fixed header but never a
   conversation identifier, and the resolver below it remains catalog-driven. High
   confidence for #881's boundary: an operator-facing header map is useful, but a
   session channel needs the call site that knows the Chat id.

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

[^packages-kosong-src-catalog-ts-l438-l497]: [generic gateway resolution](https://github.com/MoonshotAI/kimi-code/blob/6a52dd781b959328190b0cd66082154b96ef6a47/packages/kosong/src/catalog.ts#L438-L497)

[^packages-kosong-src-catalog-ts-l26-l29]: [opencode named as an example gateway provider](https://github.com/MoonshotAI/kimi-code/blob/6a52dd781b959328190b0cd66082154b96ef6a47/packages/kosong/src/catalog.ts#L26-L29)

[^packages-node-sdk-src-config-schema-ts-l47-l58]: [static per-provider `customHeaders` map](https://github.com/MoonshotAI/kimi-code/blob/6a52dd781b959328190b0cd66082154b96ef6a47/packages/node-sdk/src/config/schema.ts#L47-L58)

[^packages-kosong-src-providers-request-auth-ts-l18-l30]: [default and per-request header merge at the client factory](https://github.com/MoonshotAI/kimi-code/blob/6a52dd781b959328190b0cd66082154b96ef6a47/packages/kosong/src/providers/request-auth.ts#L18-L30)

[^packages-agent-core-v2-src-app-agentidentity-agentidentity-ts-l42-l60]: [User-Agent product token rewrite](https://github.com/MoonshotAI/kimi-code/blob/6a52dd781b959328190b0cd66082154b96ef6a47/packages/agent-core-v2/src/app/agentIdentity/agentIdentity.ts#L42-L60)

[^packages-agent-core-v2-src-session-subagent-subagentservice-ts-l80-l165]: [subagent spawn and allowlist](https://github.com/MoonshotAI/kimi-code/blob/486dcd26c76f2854fc351515a45d8f0fc2d31ed6/packages/agent-core-v2/src/session/subagent/subagentService.ts#L80-L165)

[^packages-agent-core-v2-src-agent-toolapproval-toolapprovalservice-ts-l107-l176]: [`requestToolApproval`](https://github.com/MoonshotAI/kimi-code/blob/486dcd26c76f2854fc351515a45d8f0fc2d31ed6/packages/agent-core-v2/src/agent/toolApproval/toolApprovalService.ts#L107-L176)

[^packages-agent-core-v2-src-agent-permissionmode-configsection-ts-l7]: [manual, auto, yolo modes](https://github.com/MoonshotAI/kimi-code/blob/486dcd26c76f2854fc351515a45d8f0fc2d31ed6/packages/agent-core-v2/src/agent/permissionMode/configSection.ts#L7)

[^packages-agent-core-v2-src-mcpcore-client-stdio-ts-l279-l300]: [`mergeStdioEnv` inherits `process.env`](https://github.com/MoonshotAI/kimi-code/blob/486dcd26c76f2854fc351515a45d8f0fc2d31ed6/packages/agent-core-v2/src/mcpCore/client-stdio.ts#L279-L300)

[^packages-agent-core-v2-src-agent-contextmemory-compactionhandoff-ts-l68-l133]: [compaction summary message](https://github.com/MoonshotAI/kimi-code/blob/486dcd26c76f2854fc351515a45d8f0fc2d31ed6/packages/agent-core-v2/src/agent/contextMemory/compactionHandoff.ts#L68-L133)
