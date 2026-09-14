---
type: Reference
title: "Codex CLI"
description: "Native peer lifecycle protocol and observable compaction"
resource: "https://github.com/openai/codex"
observed:
  date: "2026-09-15"
  revision: "94697375cb9d2aa8ae74d61957c6b396819bec94"
sources:
  - id: codex-rs-app-server-protocol-src-protocol-common-rs-l556-l576
    resource: "https://github.com/openai/codex/blob/5d3fe48b08049165ef8143dca152869c1f18059c/codex-rs/app-server-protocol/src/protocol/common.rs#L556-L576"
    title: "thread start/resume"
  - id: codex-rs-app-server-protocol-src-protocol-common-rs-l1023-l1046
    resource: "https://github.com/openai/codex/blob/5d3fe48b08049165ef8143dca152869c1f18059c/codex-rs/app-server-protocol/src/protocol/common.rs#L1023-L1046"
    title: "turn start/steer/interrupt"
  - id: codex-rs-app-server-protocol-src-protocol-common-rs-l1919-l1930
    resource: "https://github.com/openai/codex/blob/5d3fe48b08049165ef8143dca152869c1f18059c/codex-rs/app-server-protocol/src/protocol/common.rs#L1919-L1930"
    title: "turn/item notifications"
  - id: codex-rs-core-src-compact-token-budget-rs-l21-l25
    resource: "https://github.com/openai/codex/blob/5d3fe48b08049165ef8143dca152869c1f18059c/codex-rs/core/src/compact_token_budget.rs#L21-L25"
    title: "token-budget path"
  - id: codex-rs-core-src-compact-token-budget-rs-l66-l92
    resource: "https://github.com/openai/codex/blob/5d3fe48b08049165ef8143dca152869c1f18059c/codex-rs/core/src/compact_token_budget.rs#L66-L92"
    title: "Pre/post hooks and item events"
  - id: codex-rs-tools-src-code-mode-rs-l75-l99
    resource: "https://github.com/openai/codex/blob/94697375cb9d2aa8ae74d61957c6b396819bec94/codex-rs/tools/src/code_mode.rs#L75-L99"
    title: "collect_code_mode_tool_definitions"
  - id: codex-rs-tools-src-mcp-tool-rs-l9-l11
    resource: "https://github.com/openai/codex/blob/94697375cb9d2aa8ae74d61957c6b396819bec94/codex-rs/tools/src/mcp_tool.rs#L9-L11"
    title: "parse_mcp_tool"
  - id: codex-rs-core-src-tools-code-mode-execute-handler-rs-l48-l78
    resource: "https://github.com/openai/codex/blob/94697375cb9d2aa8ae74d61957c6b396819bec94/codex-rs/core/src/tools/code_mode/execute_handler.rs#L48-L78"
    title: "enabled tools for an exec cell"
  - id: codex-rs-core-src-tools-code-mode-execute-handler-rs-l208-l210
    resource: "https://github.com/openai/codex/blob/94697375cb9d2aa8ae74d61957c6b396819bec94/codex-rs/core/src/tools/code_mode/execute_handler.rs#L208-L210"
    title: "raw JavaScript source only"
---

# Codex CLI

- **Stack:** Rust workspace with CLI and App Server surfaces

High-confidence reference for a native peer-executor protocol and alternative
compaction lifecycle. Its App Server can inform an adapter while llame retains
canonical Chat/Run identity.

**Study**

1. **Explicit execution lifecycle.** The protocol separates
   thread start/resume[^codex-rs-app-server-protocol-src-protocol-common-rs-l556-l576],
   turn start/steer/interrupt[^codex-rs-app-server-protocol-src-protocol-common-rs-l1023-l1046],
   and turn/item notifications[^codex-rs-app-server-protocol-src-protocol-common-rs-l1919-l1930].
   These are concrete adapter operations and events; remote thread identifiers
   should remain executor references under a llame Run.
2. **Compaction as an observable operation.** The
   token-budget path[^codex-rs-core-src-compact-token-budget-rs-l21-l25]
   starts a fresh context window without model/server summarization.
   Pre/post hooks and item events[^codex-rs-core-src-compact-token-budget-rs-l66-l92]
   still expose the transition. Compare that lifecycle with SPEC §2.1 while
   retaining llame's specified summary and provenance behavior.
3. **Code-mode tool augmentation.** `collect_code_mode_tool_definitions`[^codex-rs-tools-src-code-mode-rs-l75-l99]
   flattens any `ToolSpec` (function, freeform, or namespace) into nested
   definitions filtered by `is_code_mode_nested_tool`; MCP tools enter as the
   same `ToolDefinition` shape through `parse_mcp_tool`[^codex-rs-tools-src-mcp-tool-rs-l9-l11].
   The exec handler rebuilds that list per cell with input and output schemas
   stripped[^codex-rs-core-src-tools-code-mode-execute-handler-rs-l48-l78] and
   accepts raw JavaScript only[^codex-rs-core-src-tools-code-mode-execute-handler-rs-l208-l210].
   Moderate confidence: the runtime is an in-process V8 sandbox migrating to an
   out-of-process host, not inspected here. See the
   [code-mode deep dive](../tool-harness/2026-09-14-code-mode-eval-tool.md).

**Caution:** This compaction path does not describe every Codex compaction mode.
Protocol declarations establish an interface, not successful reconnect,
cancellation, or recovery under failure; validate those in an adapter spike.

[^codex-rs-app-server-protocol-src-protocol-common-rs-l556-l576]: [thread start/resume](https://github.com/openai/codex/blob/5d3fe48b08049165ef8143dca152869c1f18059c/codex-rs/app-server-protocol/src/protocol/common.rs#L556-L576)

[^codex-rs-app-server-protocol-src-protocol-common-rs-l1023-l1046]: [turn start/steer/interrupt](https://github.com/openai/codex/blob/5d3fe48b08049165ef8143dca152869c1f18059c/codex-rs/app-server-protocol/src/protocol/common.rs#L1023-L1046)

[^codex-rs-app-server-protocol-src-protocol-common-rs-l1919-l1930]: [turn/item notifications](https://github.com/openai/codex/blob/5d3fe48b08049165ef8143dca152869c1f18059c/codex-rs/app-server-protocol/src/protocol/common.rs#L1919-L1930)

[^codex-rs-core-src-compact-token-budget-rs-l21-l25]: [token-budget path](https://github.com/openai/codex/blob/5d3fe48b08049165ef8143dca152869c1f18059c/codex-rs/core/src/compact_token_budget.rs#L21-L25)

[^codex-rs-core-src-compact-token-budget-rs-l66-l92]: [Pre/post hooks and item events](https://github.com/openai/codex/blob/5d3fe48b08049165ef8143dca152869c1f18059c/codex-rs/core/src/compact_token_budget.rs#L66-L92)

[^codex-rs-tools-src-code-mode-rs-l75-l99]: [`collect_code_mode_tool_definitions`](https://github.com/openai/codex/blob/94697375cb9d2aa8ae74d61957c6b396819bec94/codex-rs/tools/src/code_mode.rs#L75-L99)

[^codex-rs-tools-src-mcp-tool-rs-l9-l11]: [`parse_mcp_tool`](https://github.com/openai/codex/blob/94697375cb9d2aa8ae74d61957c6b396819bec94/codex-rs/tools/src/mcp_tool.rs#L9-L11)

[^codex-rs-core-src-tools-code-mode-execute-handler-rs-l48-l78]: [enabled tools for an exec cell](https://github.com/openai/codex/blob/94697375cb9d2aa8ae74d61957c6b396819bec94/codex-rs/core/src/tools/code_mode/execute_handler.rs#L48-L78)

[^codex-rs-core-src-tools-code-mode-execute-handler-rs-l208-l210]: [raw JavaScript source only](https://github.com/openai/codex/blob/94697375cb9d2aa8ae74d61957c6b396819bec94/codex-rs/core/src/tools/code_mode/execute_handler.rs#L208-L210)
