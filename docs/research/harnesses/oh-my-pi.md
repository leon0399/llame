---
type: Reference
title: "oh-my-pi"
description: "Primary coding implementation reference for capabilities and tool behavior"
resource: "https://github.com/can1357/oh-my-pi/tree/4267074ac91456866e95ed8de0b6353388f08502"
observed:
  date: "2026-09-14"
  revision: "4267074ac91456866e95ed8de0b6353388f08502"
sources:
  - id: docs-compaction-md-l27-l55
    resource: "https://github.com/can1357/oh-my-pi/blob/7728213eef8be770a67b2b20710d705ee63fefe7/docs/compaction.md#L27-L55"
    title: "Session compaction entries"
  - id: packages-coding-agent-src-session-session-context-ts-l261-l341
    resource: "https://github.com/can1357/oh-my-pi/blob/7728213eef8be770a67b2b20710d705ee63fefe7/packages/coding-agent/src/session/session-context.ts#L261-L341"
    title: "context replay"
  - id: docs-secrets-md-l1-l32
    resource: "https://github.com/can1357/oh-my-pi/blob/7728213eef8be770a67b2b20710d705ee63fefe7/docs/secrets.md#L1-L32"
    title: "Reversible secret obfuscation"
  - id: packages-coding-agent-src-export-ttsr-ts-l303-l365
    resource: "https://github.com/can1357/oh-my-pi/blob/7728213eef8be770a67b2b20710d705ee63fefe7/packages/coding-agent/src/export/ttsr.ts#L303-L365"
    title: "TTSR stream rules"
  - id: packages-coding-agent-src-session-ttsr-coordinator-ts-l410-l455
    resource: "https://github.com/can1357/oh-my-pi/blob/7728213eef8be770a67b2b20710d705ee63fefe7/packages/coding-agent/src/session/ttsr-coordinator.ts#L410-L455"
    title: "their coordinator"
  - id: packages-coding-agent-src-mcp-transports-stdio-ts-l574-l584
    resource: "https://github.com/can1357/oh-my-pi/blob/7728213eef8be770a67b2b20710d705ee63fefe7/packages/coding-agent/src/mcp/transports/stdio.ts#L574-L584"
    title: "code"
  - id: packages-coding-agent-src-eval-js-tool-bridge-ts-l232-l260
    resource: "https://github.com/can1357/oh-my-pi/blob/4267074ac91456866e95ed8de0b6353388f08502/packages/coding-agent/src/eval/js/tool-bridge.ts#L232-L260"
    title: "callSessionTool"
  - id: packages-coding-agent-src-session-session-tools-ts-l437-l455
    resource: "https://github.com/can1357/oh-my-pi/blob/4267074ac91456866e95ed8de0b6353388f08502/packages/coding-agent/src/session/session-tools.ts#L437-L455"
    title: "shared registry and eval bridge names"
  - id: packages-coding-agent-src-eval-py-tool-bridge-ts-l90-l130
    resource: "https://github.com/can1357/oh-my-pi/blob/4267074ac91456866e95ed8de0b6353388f08502/packages/coding-agent/src/eval/py/tool-bridge.ts#L90-L130"
    title: "loopback HTTP bridge"
  - id: packages-coding-agent-src-tools-eval-format-code-mode-declarations-ts-l50-l60
    resource: "https://github.com/can1357/oh-my-pi/blob/4267074ac91456866e95ed8de0b6353388f08502/packages/coding-agent/src/tools/eval-format/code-mode-declarations.ts#L50-L60"
    title: "TypeScript declaration generation"
---

# oh-my-pi

- **Stack:** Bun/TypeScript coding agent with Rust support crates; MIT

OMP is llame's primary implementation reference for coding capabilities and tool
behavior. Consult it first for coding-specific decisions; [OpenClaw](./openclaw.md)
remains the broad alpha capability reference. llame's specs remain authoritative.
OMP forks [pi-mono](./pi-mono.md), which covers the inherited session tree,
provider wrappers, and hook registry.

`oh-my-pi` is useful implementation prior art for a durable agent session, provider-boundary transformations, and stream-time policy. Its session tree keeps append-only entries behind a mutable leaf pointer. Compaction records an explicit `firstKeptEntryId`; rebuilding context replays entries from that boundary, so the source transcript and model view remain distinct. That is directly comparable to llame's stored `messages.parts` and explicit compaction boundary.

**Study**

1. **F19: Anchored compaction.** Session compaction entries[^docs-compaction-md-l27-l55] and context replay[^packages-coding-agent-src-session-session-context-ts-l261-l341] provide a concrete anchored-prefix model.
2. **F20: Provider-boundary secret handling.** Reversible secret obfuscation[^docs-secrets-md-l1-l32] replaces provider-visible values, deep-restores model-authored tool arguments before execution, and re-obfuscates replayed context.
3. **F21: Stream-time rules.** TTSR stream rules[^packages-coding-agent-src-export-ttsr-ts-l303-l365] and their coordinator[^packages-coding-agent-src-session-ttsr-coordinator-ts-l410-l455] can abort a streamed response, inject a rule message, and retry.
4. **F22: Eval bridge with MCP parity.** Script code calls `tool.<name>(args)`; `callSessionTool`[^packages-coding-agent-src-eval-js-tool-bridge-ts-l232-l260] resolves the name through the same registry and permission gate as direct calls, so MCP tools registered as `mcp__<server>__<tool>` are callable with no special path (shared registry[^packages-coding-agent-src-session-session-tools-ts-l437-l455]). Python reaches the same handler through a loopback HTTP server with a per-run bearer token[^packages-coding-agent-src-eval-py-tool-bridge-ts-l90-l130]. Under Codex Code Mode the harness renders TypeScript signatures for bridged tools from JSON Schema[^packages-coding-agent-src-tools-eval-format-code-mode-declarations-ts-l50-l60]. High confidence as the bridge shape for llame's planned eval tool; see the [code-mode deep dive](../tool-harness/2026-09-14-code-mode-eval-tool.md).

**Applicability:** High for compaction and the eval bridge; moderate for MCP argument redaction; exploratory for stream enforcement. **Confidence:** High for the cited current source paths; moderate for behavior outside those paths. **Caution:** secrets are disabled by default, the stdio transport still passes the whole `Bun.env` into child processes (code[^packages-coding-agent-src-mcp-transports-stdio-ts-l574-l584]), and eval kernels run as a Bun worker thread and a host Python subprocess with full filesystem, network, and environment access and no idle reaper. Keep llame's declared environment and trusted runtime boundaries.

[^docs-compaction-md-l27-l55]: [Session compaction entries](https://github.com/can1357/oh-my-pi/blob/7728213eef8be770a67b2b20710d705ee63fefe7/docs/compaction.md#L27-L55)

[^packages-coding-agent-src-session-session-context-ts-l261-l341]: [context replay](https://github.com/can1357/oh-my-pi/blob/7728213eef8be770a67b2b20710d705ee63fefe7/packages/coding-agent/src/session/session-context.ts#L261-L341)

[^docs-secrets-md-l1-l32]: [Reversible secret obfuscation](https://github.com/can1357/oh-my-pi/blob/7728213eef8be770a67b2b20710d705ee63fefe7/docs/secrets.md#L1-L32)

[^packages-coding-agent-src-export-ttsr-ts-l303-l365]: [TTSR stream rules](https://github.com/can1357/oh-my-pi/blob/7728213eef8be770a67b2b20710d705ee63fefe7/packages/coding-agent/src/export/ttsr.ts#L303-L365)

[^packages-coding-agent-src-session-ttsr-coordinator-ts-l410-l455]: [their coordinator](https://github.com/can1357/oh-my-pi/blob/7728213eef8be770a67b2b20710d705ee63fefe7/packages/coding-agent/src/session/ttsr-coordinator.ts#L410-L455)

[^packages-coding-agent-src-mcp-transports-stdio-ts-l574-l584]: [code](https://github.com/can1357/oh-my-pi/blob/7728213eef8be770a67b2b20710d705ee63fefe7/packages/coding-agent/src/mcp/transports/stdio.ts#L574-L584)

[^packages-coding-agent-src-eval-js-tool-bridge-ts-l232-l260]: [`callSessionTool`](https://github.com/can1357/oh-my-pi/blob/4267074ac91456866e95ed8de0b6353388f08502/packages/coding-agent/src/eval/js/tool-bridge.ts#L232-L260)

[^packages-coding-agent-src-session-session-tools-ts-l437-l455]: [shared registry and eval bridge names](https://github.com/can1357/oh-my-pi/blob/4267074ac91456866e95ed8de0b6353388f08502/packages/coding-agent/src/session/session-tools.ts#L437-L455)

[^packages-coding-agent-src-eval-py-tool-bridge-ts-l90-l130]: [loopback HTTP bridge](https://github.com/can1357/oh-my-pi/blob/4267074ac91456866e95ed8de0b6353388f08502/packages/coding-agent/src/eval/py/tool-bridge.ts#L90-L130)

[^packages-coding-agent-src-tools-eval-format-code-mode-declarations-ts-l50-l60]: [TypeScript declaration generation](https://github.com/can1357/oh-my-pi/blob/4267074ac91456866e95ed8de0b6353388f08502/packages/coding-agent/src/tools/eval-format/code-mode-declarations.ts#L50-L60)
