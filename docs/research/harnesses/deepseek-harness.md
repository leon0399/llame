---
type: Reference
title: "DeepSeek Harness"
description: "Session projections and explicit approval outcomes"
resource: "https://github.com/deepseek-ai/deepseek-harness"
sources:
  - id: docs-subsystems-session-md-l1-l25
    resource: "https://github.com/deepseek-ai/deepseek-harness/blob/aa8262ec091698bae9a6b04773a6b5b06ad4aef2/docs/subsystems/session.md#L1-L25"
    title: "session contract"
  - id: docs-subsystems-compaction-md-l9-l21
    resource: "https://github.com/deepseek-ai/deepseek-harness/blob/aa8262ec091698bae9a6b04773a6b5b06ad4aef2/docs/subsystems/compaction.md#L9-L21"
    title: "Compaction"
  - id: docs-subsystems-approval-md-l1-l58
    resource: "https://github.com/deepseek-ai/deepseek-harness/blob/aa8262ec091698bae9a6b04773a6b5b06ad4aef2/docs/subsystems/approval.md#L1-L58"
    title: "approval contract"
  - id: readme-md-l11-l13
    resource: "https://github.com/deepseek-ai/deepseek-harness/blob/aa8262ec091698bae9a6b04773a6b5b06ad4aef2/README.md#L11-L13"
    title: "developer-preview notice"
---

# DeepSeek Harness

- **Stack:** TypeScript monorepo on the Cordis plugin kernel; MIT; developer preview
- **Observed:** 2026-09-10 @ `aa8262ec091698bae9a6b04773a6b5b06ad4aef2`

`dsh` is a localhost harness built on Cordis plugins. Moderate-confidence
reference for documented session projections and explicit approval outcomes;
its developer-preview contracts require implementation validation before reuse.

**Study**

1. **Append-only context projection.** The append-only typed Session log is the single source of model context:
   `deriveMessages()` projects model history and replay reconstructs it without
   re-running tools (session contract[^docs-subsystems-session-md-l1-l25]).
   Compaction[^docs-subsystems-compaction-md-l9-l21]
   logs markers and a replacement message, retaining the original event history.
2. **Explicit approval outcomes.** Approval is a closed, fail-closed outcome set: `allowed-once`, `rejected`,
   `cancelled`, and `unavailable`; a missing or throwing answerer becomes
   `unavailable`. Per-session `ask`/`never` policy is itself reconstructed by
   replay (approval contract[^docs-subsystems-approval-md-l1-l58]). This is a useful authorization
   result contract for llame's future policy engine.

**Caution**

The developer-preview notice[^readme-md-l11-l13] explicitly anticipates compatibility breaks. These documented contracts do not establish llame's owner isolation or durable recovery; validate those at the adapter boundary.

[^docs-subsystems-session-md-l1-l25]: [session contract](https://github.com/deepseek-ai/deepseek-harness/blob/aa8262ec091698bae9a6b04773a6b5b06ad4aef2/docs/subsystems/session.md#L1-L25)

[^docs-subsystems-compaction-md-l9-l21]: [Compaction](https://github.com/deepseek-ai/deepseek-harness/blob/aa8262ec091698bae9a6b04773a6b5b06ad4aef2/docs/subsystems/compaction.md#L9-L21)

[^docs-subsystems-approval-md-l1-l58]: [approval contract](https://github.com/deepseek-ai/deepseek-harness/blob/aa8262ec091698bae9a6b04773a6b5b06ad4aef2/docs/subsystems/approval.md#L1-L58)

[^readme-md-l11-l13]: [developer-preview notice](https://github.com/deepseek-ai/deepseek-harness/blob/aa8262ec091698bae9a6b04773a6b5b06ad4aef2/README.md#L11-L13)
