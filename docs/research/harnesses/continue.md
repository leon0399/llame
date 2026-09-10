---
type: Reference
title: "Continue"
description: "Shared CLI execution, permission rules, and agent profiles"
resource: "https://github.com/continuedev/continue"
sources:
  - id: extensions-cli-src-commands-chat-ts
    resource: "https://github.com/continuedev/continue/blob/5522c6f44ca0ac3528b37244818fbfa39b5af470/extensions/cli/src/commands/chat.ts"
    title: "Interactive and headless entrypoints"
  - id: extensions-cli-src-permissions-precedenceresolver-ts
    resource: "https://github.com/continuedev/continue/blob/5522c6f44ca0ac3528b37244818fbfa39b5af470/extensions/cli/src/permissions/precedenceResolver.ts"
    title: "Precedence resolution"
  - id: extensions-cli-src-stream-handletoolcalls-ts-l172-l195
    resource: "https://github.com/continuedev/continue/blob/5522c6f44ca0ac3528b37244818fbfa39b5af470/extensions/cli/src/stream/handleToolCalls.ts#L172-L195"
    title: "request filtering"
  - id: packages-config-yaml-src-markdown-agentfiles-ts
    resource: "https://github.com/continuedev/continue/blob/5522c6f44ca0ac3528b37244818fbfa39b5af470/packages/config-yaml/src/markdown/agentFiles.ts"
    title: "Markdown agent files"
  - id: extensions-cli-src-subagent-executor-ts-l54-l122
    resource: "https://github.com/continuedev/continue/blob/5522c6f44ca0ac3528b37244818fbfa39b5af470/extensions/cli/src/subagent/executor.ts#L54-L122"
    title: "beta subagent executor"
---

# Continue

- **Stack:** TypeScript monorepo; IDE extensions and CLI; Apache-2.0
- **Observed:** 2026-09-10 @ `5522c6f44ca0ac3528b37244818fbfa39b5af470`

High-confidence reference for llame's future CLI, profiles, and tool policy.
Scope this comparison to the inspected CLI implementation.

**Study**

1. **F4: Shared execution across surfaces.** Interactive and headless entrypoints[^extensions-cli-src-commands-chat-ts]
   initialize shared services and use the same streaming loop; local sessions
   support resume and history forks. Relevant to a first-party llame CLI over
   the existing Chat/Run core, without a parallel session authority.
2. **F5: Policy compilation.** Precedence resolution[^extensions-cli-src-permissions-precedenceresolver-ts]
   combines CLI flags, user YAML, and defaults into `allow`/`ask`/`exclude`.
   Argument-aware checks cover selected tool fields; request filtering[^extensions-cli-src-stream-handletoolcalls-ts-l172-l195]
   omits tools classified `ask` in headless mode. Useful for future approvals,
   provided llame resolves policy from trusted owner scope and records outcomes.
3. **F6: File-based agent composition.** Markdown agent files[^packages-config-yaml-src-markdown-agentfiles-ts]
   combine prompt text with model, rules, and built-in/MCP tool selection.
   Study the composition surface for Profiles/Skills; a file selecting a tool
   must never grant llame authority to execute it.

**Caution:** The beta subagent executor[^extensions-cli-src-subagent-executor-ts-l54-l122]
temporarily replaces shared permissions with `* allow` and disables shared
history while running an in-memory child. This conflicts with llame's intended
inspectable child Chats/Runs and bounded inherited authority. Local session
files and permission YAML are single-user state, not tenant isolation or
durable execution recovery.

[^extensions-cli-src-commands-chat-ts]: [Interactive and headless entrypoints](https://github.com/continuedev/continue/blob/5522c6f44ca0ac3528b37244818fbfa39b5af470/extensions/cli/src/commands/chat.ts)

[^extensions-cli-src-permissions-precedenceresolver-ts]: [Precedence resolution](https://github.com/continuedev/continue/blob/5522c6f44ca0ac3528b37244818fbfa39b5af470/extensions/cli/src/permissions/precedenceResolver.ts)

[^extensions-cli-src-stream-handletoolcalls-ts-l172-l195]: [request filtering](https://github.com/continuedev/continue/blob/5522c6f44ca0ac3528b37244818fbfa39b5af470/extensions/cli/src/stream/handleToolCalls.ts#L172-L195)

[^packages-config-yaml-src-markdown-agentfiles-ts]: [Markdown agent files](https://github.com/continuedev/continue/blob/5522c6f44ca0ac3528b37244818fbfa39b5af470/packages/config-yaml/src/markdown/agentFiles.ts)

[^extensions-cli-src-subagent-executor-ts-l54-l122]: [beta subagent executor](https://github.com/continuedev/continue/blob/5522c6f44ca0ac3528b37244818fbfa39b5af470/extensions/cli/src/subagent/executor.ts#L54-L122)
