---
type: Reference
title: "qwen-audio-agent"
description: "Host-owned sessions with ACP/A2A peer execution"
resource: "https://github.com/QwenAudio/qwen-audio-agent/tree/94d6cd372379f9c889ea8d6f6190e4cd45122adb"
sources:
  - id: docs-architecture-deep-dive-md-l191-l214
    resource: "https://github.com/QwenAudio/qwen-audio-agent/blob/94d6cd372379f9c889ea8d6f6190e4cd45122adb/docs/architecture/deep-dive.md#L191-L214"
    title: "Stable backend session semantics"
  - id: server-src-agent-acp-backend-session-utils-mjs-l10-l15
    resource: "https://github.com/QwenAudio/qwen-audio-agent/blob/94d6cd372379f9c889ea8d6f6190e4cd45122adb/server/src/agent/acp/backend-session-utils.mjs#L10-L15"
    title: "encoded session keys"
  - id: server-src-agent-acp-session-registry-mjs-l64-l75
    resource: "https://github.com/QwenAudio/qwen-audio-agent/blob/94d6cd372379f9c889ea8d6f6190e4cd45122adb/server/src/agent/acp/session-registry.mjs#L64-L75"
    title: "registry state"
  - id: shared-backend-environment-mjs-l3-l6
    resource: "https://github.com/QwenAudio/qwen-audio-agent/blob/94d6cd372379f9c889ea8d6f6190e4cd45122adb/shared/backend/environment.mjs#L3-L6"
    title: "Catalog-driven environment allowlisting"
  - id: server-src-agent-acp-permission-broker-mjs-l112-l214
    resource: "https://github.com/QwenAudio/qwen-audio-agent/blob/94d6cd372379f9c889ea8d6f6190e4cd45122adb/server/src/agent/acp/permission-broker.mjs#L112-L214"
    title: "owner-bound permission brokering"
---

# qwen-audio-agent

- **Stack:** Plain ESM `.mjs`, Zod, Node 22+, ACP, A2A, and custom backends; Apache-2.0.
- **Observed:** 2026-09-10 @ `94d6cd372379f9c889ea8d6f6190e4cd45122adb`

A meta-harness whose gateway owns task/session routing while backends retain
execution state. High confidence for executor boundaries and declared environment
flow; moderate for persistence because it remains a single-user application.

**Study**

1. **Session ownership seam.** Stable backend session semantics[^docs-architecture-deep-dive-md-l191-l214], encoded session keys[^server-src-agent-acp-backend-session-utils-mjs-l10-l15], and registry state[^server-src-agent-acp-session-registry-mjs-l64-l75] provide a comparison to llame owning Chat/Run identity around executor adapters.
2. **Secret and approval boundary.** Catalog-driven environment allowlisting[^shared-backend-environment-mjs-l3-l6] and owner-bound permission brokering[^server-src-agent-acp-permission-broker-mjs-l112-l214] inform llame's declared MCP environment and approval contracts.

**Caution:** The architecture document labels behavior roadmap-provisional. Verify
the cited implementation when defining an adapter contract, and retain llame's
tenant isolation independently of the host's owner/session routing keys.

[^docs-architecture-deep-dive-md-l191-l214]: [Stable backend session semantics](https://github.com/QwenAudio/qwen-audio-agent/blob/94d6cd372379f9c889ea8d6f6190e4cd45122adb/docs/architecture/deep-dive.md#L191-L214)

[^server-src-agent-acp-backend-session-utils-mjs-l10-l15]: [encoded session keys](https://github.com/QwenAudio/qwen-audio-agent/blob/94d6cd372379f9c889ea8d6f6190e4cd45122adb/server/src/agent/acp/backend-session-utils.mjs#L10-L15)

[^server-src-agent-acp-session-registry-mjs-l64-l75]: [registry state](https://github.com/QwenAudio/qwen-audio-agent/blob/94d6cd372379f9c889ea8d6f6190e4cd45122adb/server/src/agent/acp/session-registry.mjs#L64-L75)

[^shared-backend-environment-mjs-l3-l6]: [Catalog-driven environment allowlisting](https://github.com/QwenAudio/qwen-audio-agent/blob/94d6cd372379f9c889ea8d6f6190e4cd45122adb/shared/backend/environment.mjs#L3-L6)

[^server-src-agent-acp-permission-broker-mjs-l112-l214]: [owner-bound permission brokering](https://github.com/QwenAudio/qwen-audio-agent/blob/94d6cd372379f9c889ea8d6f6190e4cd45122adb/server/src/agent/acp/permission-broker.mjs#L112-L214)
