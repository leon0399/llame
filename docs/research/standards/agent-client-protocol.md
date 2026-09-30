---
type: Reference
title: "ACP (Agent Client Protocol)"
description: "Client-to-coding-agent session protocol; candidate peer executor adapter"
resource: "https://agentclientprotocol.com"
observed:
  date: "2026-09-27"
  revision: "15219ed70b6cfc19a0951b2a7e9272ed1d23640f"
sources:
  - id: acp-readme
    resource: "https://github.com/agentclientprotocol/agent-client-protocol/blob/15219ed70b6cfc19a0951b2a7e9272ed1d23640f/README.md"
    title: "Agent Client Protocol README"
  - id: acp-governance
    resource: "https://agentclientprotocol.com/community/governance"
    title: "ACP governance"
  - id: acp-v1-overview
    resource: "https://agentclientprotocol.com/protocol/v1/overview"
    title: "ACP v1 overview"
  - id: acp-v1-session
    resource: "https://agentclientprotocol.com/protocol/v1/session-setup"
    title: "ACP v1 session setup"
  - id: acp-v1-session-list
    resource: "https://agentclientprotocol.com/protocol/v1/session-list"
    title: "ACP v1 session list"
  - id: acp-v2-draft
    resource: "https://agentclientprotocol.com/announcements/acp-v2-draft"
    title: "ACP v2 draft announcement"
  - id: acp-remote-rfd
    resource: "https://agentclientprotocol.com/rfds/streamable-http-websocket-transport"
    title: "Streamable HTTP and WebSocket transport RFD"
  - id: acp-agents
    resource: "https://agentclientprotocol.com/get-started/agents"
    title: "ACP agents"
  - id: acp-v1-methods
    resource: "https://github.com/agentclientprotocol/agent-client-protocol/blob/15219ed70b6cfc19a0951b2a7e9272ed1d23640f/schema/v1/meta.json"
    title: "ACP v1 method table"
  - id: acp-v2-methods
    resource: "https://github.com/agentclientprotocol/agent-client-protocol/blob/15219ed70b6cfc19a0951b2a7e9272ed1d23640f/schema/v2/meta.json"
    title: "ACP v2 draft method table"
  - id: acp-v2-schema
    resource: "https://github.com/agentclientprotocol/agent-client-protocol/blob/15219ed70b6cfc19a0951b2a7e9272ed1d23640f/schema/v2/schema.json#L6274-L6320"
    title: "ACP v2 draft ResumeSessionRequest"
---

# ACP (Agent Client Protocol)

- **Status:** wire protocol version 1 stable; v2 draft published 2026-07-20
  and breaking; schema artifacts at 1.9.1. Originated at Zed, now under interim
  Zed and JetBrains governance; Apache-2.0[^acp-readme][^acp-governance][^acp-v2-draft]

JSON-RPC 2.0 between a client (editor or host) and a coding agent. Stable v1
defines one transport: the client launches the agent and exchanges
newline-delimited JSON over stdio[^acp-v1-overview].

**Mechanics**

1. **Lifecycle.** `initialize` negotiates version and capabilities;
   `session/new` takes an absolute `cwd` and the MCP servers the agent should
   connect to, and returns the agent's `sessionId`[^acp-v1-session].
2. **Turns.** `session/prompt` starts a turn; `session/update` notifications
   stream message chunks, tool calls and plans.
3. **Permission.** The agent asks through the client's
   `session/request_permission`, so the host owns approval.
4. **Client environment.** v1 clients may offer `fs/*` and `terminal/*` so
   the agent reads, writes and executes inside the client's environment. The v2
   draft drops that surface in favor of MCP.
5. **Session management.** v1 already declares `session/load` (replay),
   `session/resume`, `session/list` and `session/close`[^acp-v1-methods], each
   gated by its own advertised capability: `loadSession`,
   `sessionCapabilities.resume` and `sessionCapabilities.close`[^acp-v1-session],
   and `sessionCapabilities.list`[^acp-v1-session-list]. The v2 draft drops
   `session/load`[^acp-v2-methods] and replays through a `replayFrom` cursor on
   `session/resume`[^acp-v2-schema].
6. **Remote.** Streamable HTTP and WebSocket transports are an RFD, not
   stable[^acp-remote-rfd].
7. **Adopters.** goose, Gemini CLI, OpenCode, OpenHands, Cline, and adapters
   for Claude Agent and Codex CLI, among others[^acp-agents].

**Identity ownership.** The agent owns the session: it mints `sessionId` and
retains the history `session/load` replays. The client owns prompts, approvals
and the advertised environment.

**llame fit: study as the local peer executor adapter.** llame acts as the
client: a Run maps to an ACP prompt turn, with the `sessionId` stored as
adapter correlation and never promoted to a second session system.
`request_permission` routes into llame's permission path, and llame's
operator MCP servers can be passed through `session/new`. Prior art in
[goose](../harnesses/goose.md), [Orca](../harnesses/orca.md) and
[qwen-audio-agent](../harnesses/qwen-audio-agent.md).

**Caution:** do not mix v1 and v2 schemas; target v1 until v2 is final. Remote
workers need the unfinished HTTP transport or a llame-owned tunnel to a local
stdio process. Agent-side history retention limits what a resumed Run can
replay.

[^acp-readme]: [Agent Client Protocol README](https://github.com/agentclientprotocol/agent-client-protocol/blob/15219ed70b6cfc19a0951b2a7e9272ed1d23640f/README.md)

[^acp-governance]: [ACP governance](https://agentclientprotocol.com/community/governance)

[^acp-v1-overview]: [ACP v1 overview](https://agentclientprotocol.com/protocol/v1/overview)

[^acp-v1-session]: [ACP v1 session setup](https://agentclientprotocol.com/protocol/v1/session-setup)

[^acp-v2-draft]: [ACP v2 draft announcement](https://agentclientprotocol.com/announcements/acp-v2-draft)

[^acp-remote-rfd]: [Streamable HTTP and WebSocket transport RFD](https://agentclientprotocol.com/rfds/streamable-http-websocket-transport)

[^acp-agents]: [ACP agents](https://agentclientprotocol.com/get-started/agents)

[^acp-v1-methods]: [ACP v1 method table](https://github.com/agentclientprotocol/agent-client-protocol/blob/15219ed70b6cfc19a0951b2a7e9272ed1d23640f/schema/v1/meta.json)

[^acp-v2-methods]: [ACP v2 draft method table](https://github.com/agentclientprotocol/agent-client-protocol/blob/15219ed70b6cfc19a0951b2a7e9272ed1d23640f/schema/v2/meta.json)

[^acp-v1-session-list]: [ACP v1 session list](https://agentclientprotocol.com/protocol/v1/session-list)

[^acp-v2-schema]: [ACP v2 draft ResumeSessionRequest](https://github.com/agentclientprotocol/agent-client-protocol/blob/15219ed70b6cfc19a0951b2a7e9272ed1d23640f/schema/v2/schema.json#L6274-L6320)
