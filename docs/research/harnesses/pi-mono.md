---
type: Reference
title: "pi-mono"
description: "Lane-as-branch session tree, composable provider session headers, and a fail-open hook registry"
resource: "https://github.com/badlogic/pi-mono"
observed:
  date: "2026-09-15"
  revision: "f9bcd351dc3cedf989bc5fc0f8aa012db5737df2"
sources:
  - id: packages-ai-src-providers-opencode-headers-ts-l9-l24
    resource: "https://github.com/badlogic/pi-mono/blob/f9bcd351dc3cedf989bc5fc0f8aa012db5737df2/packages/ai/src/providers/opencode-headers.ts#L9-L24"
    title: "withOpenCodeSessionHeader"
  - id: packages-ai-src-providers-opencode-go-ts-l9-l19
    resource: "https://github.com/badlogic/pi-mono/blob/f9bcd351dc3cedf989bc5fc0f8aa012db5737df2/packages/ai/src/providers/opencode-go.ts#L9-L19"
    title: "OpenCode Go provider"
  - id: packages-agent-src-harness-runtime-drive-generation-ts-l217-l219
    resource: "https://github.com/badlogic/pi-mono/blob/f9bcd351dc3cedf989bc5fc0f8aa012db5737df2/packages/agent/src/harness/runtime/drive/generation.ts#L217-L219"
    title: "lane-namespaced session id"
  - id: packages-ai-src-utils-pi-user-agent-ts-l17-l19
    resource: "https://github.com/badlogic/pi-mono/blob/f9bcd351dc3cedf989bc5fc0f8aa012db5737df2/packages/ai/src/utils/pi-user-agent.ts#L17-L19"
    title: "getPiUserAgent"
  - id: packages-agent-src-harness-session-session-ts-l225-l264
    resource: "https://github.com/badlogic/pi-mono/blob/f9bcd351dc3cedf989bc5fc0f8aa012db5737df2/packages/agent/src/harness/session/session.ts#L225-L264"
    title: "single-writer mutation line"
  - id: packages-agent-src-harness-session-fork-ts-l29-l121
    resource: "https://github.com/badlogic/pi-mono/blob/f9bcd351dc3cedf989bc5fc0f8aa012db5737df2/packages/agent/src/harness/session/fork.ts#L29-L121"
    title: "createForkSnapshot"
  - id: packages-agent-src-harness-execution-tools-ts-l76-l176
    resource: "https://github.com/badlogic/pi-mono/blob/f9bcd351dc3cedf989bc5fc0f8aa012db5737df2/packages/agent/src/harness/execution/tools.ts#L76-L176"
    title: "four-phase tool execution"
  - id: packages-agent-src-harness-hooks-ts-l156-l184
    resource: "https://github.com/badlogic/pi-mono/blob/f9bcd351dc3cedf989bc5fc0f8aa012db5737df2/packages/agent/src/harness/hooks.ts#L156-L184"
    title: "before_tool fails closed"
  - id: packages-agent-src-harness-hooks-ts-l229-l330
    resource: "https://github.com/badlogic/pi-mono/blob/f9bcd351dc3cedf989bc5fc0f8aa012db5737df2/packages/agent/src/harness/hooks.ts#L229-L330"
    title: "other hooks fail open"
  - id: packages-coding-agent-docs-security-md-l9-l25
    resource: "https://github.com/badlogic/pi-mono/blob/f9bcd351dc3cedf989bc5fc0f8aa012db5737df2/packages/coding-agent/docs/security.md#L9-L25"
    title: "no sandbox, project trust"
---

# pi-mono

- **Stack:** TypeScript monorepo (unified LLM API, agent loop, TUI, coding CLI); MIT

Upstream of [oh-my-pi](./oh-my-pi.md), which forks it. Listed by OpenCode Go
as a validated client. Study it for the mechanisms OMP inherited unchanged;
OMP remains the primary coding reference.

**Study**

1. **Composable provider session header.** One wrapper sets
   `x-opencode-session` from the request's `sessionId` unless the caller
   already supplied the header, and never fabricates one
   (`withOpenCodeSessionHeader`[^packages-ai-src-providers-opencode-headers-ts-l9-l24]);
   the Go provider is an ordinary provider declaration wrapping the same
   adapters[^packages-ai-src-providers-opencode-go-ts-l9-l19]. Subagent lanes
   send `<sessionId>:<lane>` so each lane has its own routing and cache
   identity[^packages-agent-src-harness-runtime-drive-generation-ts-l217-l219].
   The User-Agent is a generic `pi (<platform>; <arch>)`
   string[^packages-ai-src-utils-pi-user-agent-ts-l17-l19]. High confidence as
   the shape for llame's Go provider (#809): header injection as a provider
   wrapper, session id derived from Chat identity, per-child identity for
   subagents.
2. **Lane-as-branch session tree.** Sessions are append-only entry trees; a
   single-writer mutation line serializes
   commits[^packages-agent-src-harness-session-session-ts-l225-l264], and
   subagents are named lanes (branches) inside the same tree rather than new
   top-level identities. Forking clones the whole tree or one branch and
   validates lane config and tip
   integrity[^packages-agent-src-harness-session-fork-ts-l29-l121]. Moderate
   confidence as a comparison for how llame represents child agents (#765)
   under one Chat without a second session system.
3. **Four-phase tool execution.** Prepare, hook decision, gated execution,
   finalize are separate
   steps[^packages-agent-src-harness-execution-tools-ts-l76-l176]; a
   synchronous gate admits each effect and supports cooperative abort.
   Moderate confidence for llame's `runTool()` structure, which already has
   the same gates in one function.

**Caution**

- Hooks fail open by default. Only `before_tool` and `before_drive` fail
  closed[^packages-agent-src-harness-hooks-ts-l156-l184]; every other hook
  reports and swallows
  errors[^packages-agent-src-harness-hooks-ts-l229-l330]. A misbehaving
  extension degrades silently.
- No sandbox and no MCP. Extensions are in-process TypeScript with the OS
  user's full permissions; "project trust" gates whether project settings
  load, not what a tool may do[^packages-coding-agent-docs-security-md-l9-l25].
  llame's allowlist and tenancy model has no counterpart here.

[^packages-ai-src-providers-opencode-headers-ts-l9-l24]: [`withOpenCodeSessionHeader`](https://github.com/badlogic/pi-mono/blob/f9bcd351dc3cedf989bc5fc0f8aa012db5737df2/packages/ai/src/providers/opencode-headers.ts#L9-L24)

[^packages-ai-src-providers-opencode-go-ts-l9-l19]: [OpenCode Go provider](https://github.com/badlogic/pi-mono/blob/f9bcd351dc3cedf989bc5fc0f8aa012db5737df2/packages/ai/src/providers/opencode-go.ts#L9-L19)

[^packages-agent-src-harness-runtime-drive-generation-ts-l217-l219]: [lane-namespaced session id](https://github.com/badlogic/pi-mono/blob/f9bcd351dc3cedf989bc5fc0f8aa012db5737df2/packages/agent/src/harness/runtime/drive/generation.ts#L217-L219)

[^packages-ai-src-utils-pi-user-agent-ts-l17-l19]: [`getPiUserAgent`](https://github.com/badlogic/pi-mono/blob/f9bcd351dc3cedf989bc5fc0f8aa012db5737df2/packages/ai/src/utils/pi-user-agent.ts#L17-L19)

[^packages-agent-src-harness-session-session-ts-l225-l264]: [single-writer mutation line](https://github.com/badlogic/pi-mono/blob/f9bcd351dc3cedf989bc5fc0f8aa012db5737df2/packages/agent/src/harness/session/session.ts#L225-L264)

[^packages-agent-src-harness-session-fork-ts-l29-l121]: [`createForkSnapshot`](https://github.com/badlogic/pi-mono/blob/f9bcd351dc3cedf989bc5fc0f8aa012db5737df2/packages/agent/src/harness/session/fork.ts#L29-L121)

[^packages-agent-src-harness-execution-tools-ts-l76-l176]: [four-phase tool execution](https://github.com/badlogic/pi-mono/blob/f9bcd351dc3cedf989bc5fc0f8aa012db5737df2/packages/agent/src/harness/execution/tools.ts#L76-L176)

[^packages-agent-src-harness-hooks-ts-l156-l184]: [`before_tool` fails closed](https://github.com/badlogic/pi-mono/blob/f9bcd351dc3cedf989bc5fc0f8aa012db5737df2/packages/agent/src/harness/hooks.ts#L156-L184)

[^packages-agent-src-harness-hooks-ts-l229-l330]: [other hooks fail open](https://github.com/badlogic/pi-mono/blob/f9bcd351dc3cedf989bc5fc0f8aa012db5737df2/packages/agent/src/harness/hooks.ts#L229-L330)

[^packages-coding-agent-docs-security-md-l9-l25]: [no sandbox, project trust](https://github.com/badlogic/pi-mono/blob/f9bcd351dc3cedf989bc5fc0f8aa012db5737df2/packages/coding-agent/docs/security.md#L9-L25)
