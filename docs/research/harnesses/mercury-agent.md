---
type: Reference
title: "Mercury Agent"
description: "MIT Node agent whose second terminal attaches over SSE to a running daemon, with one Ask Me or Allow All mode shared by every surface."
resource: "https://github.com/cosmicstack-labs/mercury-agent/tree/fd8cf4a655caa7b81ecb8b1b7604188e729c895e"
tags: [harness, tui, sse, permissions, daemon, memory]
status: stable
generated:
  by: "grok/grok-4.7"
  at: "2026-11-03"
observed:
  date: "2026-11-03"
  revision: "fd8cf4a655caa7b81ecb8b1b7604188e729c895e"
sources:
  - id: mercury-license
    resource: "https://github.com/cosmicstack-labs/mercury-agent/blob/fd8cf4a655caa7b81ecb8b1b7604188e729c895e/LICENSE#L1-L3"
    title: "MIT License heading"
  - id: mercury-attach
    resource: "https://github.com/cosmicstack-labs/mercury-agent/blob/fd8cf4a655caa7b81ecb8b1b7604188e729c895e/src/cli/attach.ts#L6-L15"
    title: "A second terminal uses REST and SSE against the running runtime"
  - id: mercury-events
    resource: "https://github.com/cosmicstack-labs/mercury-agent/blob/fd8cf4a655caa7b81ecb8b1b7604188e729c895e/src/web/api/chat.ts#L207-L228"
    title: "The SSE handler sends a connected frame and then live events"
  - id: mercury-mode
    resource: "https://github.com/cosmicstack-labs/mercury-agent/blob/fd8cf4a655caa7b81ecb8b1b7604188e729c895e/src/index.ts#L2204-L2217"
    title: "Ask Me or Allow All is saved once for every surface"
  - id: mercury-mcp
    resource: "https://github.com/cosmicstack-labs/mercury-agent/blob/fd8cf4a655caa7b81ecb8b1b7604188e729c895e/src/capabilities/permissions.ts#L1113-L1136"
    title: "MCP always stores server and tool, not the arguments"
  - id: mercury-readme
    resource: "https://github.com/cosmicstack-labs/mercury-agent/blob/fd8cf4a655caa7b81ecb8b1b7604188e729c895e/README.md#L9"
    title: "The agent lives on the machine and keeps working when you walk away"
---

# Mercury Agent

- **Stack:** Node.js, a terminal UI, and a local web dashboard. MIT.[^mercury-license] The [tierroom board](https://my-tierroom.party/agents/mercury-agent) and [mercuryagent.sh](https://mercuryagent.sh/) are live pages and are not pinned.

Mercury is a self-hosted personal agent. The README says it asks before it acts, remembers, and keeps working when the person leaves.[^mercury-readme] Source inspection of the attach path and the permission prompt; the memory schema and routine scheduler were not opened, and nothing was run.

**Study**

1. **The terminal can attach to a daemon.** `attach.ts` says a second terminal connects to an already-running runtime: REST for actions, SSE for live events, authenticated by a machine-local token file mode `0600`. The comment limits v1 to the attached client's own request activity plus shared session history, and says live mirroring of the owning terminal is out of scope.[^mercury-attach] `GET /api/chat/events` sends one `connected` SSE frame (client id, provider, model, optional status) and then keeps the stream open with 15-second keepalives.[^mercury-events] There is no cursor query on that handler. llame's [clients replay an append-only log](../../../SPEC.md#94-run-events). Mercury's SSE handler, as read here, starts at "connected" and continues with whatever the channel emits next. History is a separate read, per the attach comment.
2. **One permission mode covers every surface, and MCP is a separate ask.** Setup asks once: Ask Me confirms before file writes and commands, or Allow All, with the label "blocked commands stay blocked." The choice is saved and the comment says the terminal, an attached terminal, and the dashboard share it. `/permissions` changes it later.[^mercury-mode] `checkMcpTool` still asks, showing the server, tool, and arguments. `yes` allows that call. `always` stores `serverId/toolName` and not the arguments, so a later call with different arguments is allowed.[^mercury-mcp] Arbitrary external MCP is in this tree. The board said that was not verified, and that the landing page still says no MCP. Allow All is not an OS sandbox.
3. **Messaging clients are not executors.** The board lists Telegram, Discord, Slack, Signal, and an optional WhatsApp plugin. The daemon is the runtime.[^mercury-readme] A phone that only messages the daemon is a Surface. Android via Termux, which the board mentions, would be the runtime itself. That path was not read.

**llame fit**

- High: item 1's split between a durable-enough daemon and a terminal that attaches, with the limit that this SSE route does not replay a seq. A llame TUI would subscribe with a cursor. Mercury shows the attach-token and "history is separate from the live frame" shape.
- Moderate: item 2, as a single explicit mode rather than a silent default. llame's approval flow is [later work](../../../VISION.md#the-harness-owns-execution). Copying Allow All would weaken that future gate.
- Moderate: item 2's split between a session Allow All and an MCP `always` that is not bound to the arguments shown.
- Low: SQLite memory and specialist bots, which the board describes and this pass did not open.

**Caution:** The board records older shell-permission bypass reports and maintainer fixes in 1.2.2 and 1.3.0. This revision was not checked for those issues. `always` on an MCP tool survives an argument change.[^mercury-mcp]

[^mercury-license]: [MIT License heading](https://github.com/cosmicstack-labs/mercury-agent/blob/fd8cf4a655caa7b81ecb8b1b7604188e729c895e/LICENSE#L1-L3)

[^mercury-attach]: [A second terminal uses REST and SSE against the running runtime](https://github.com/cosmicstack-labs/mercury-agent/blob/fd8cf4a655caa7b81ecb8b1b7604188e729c895e/src/cli/attach.ts#L6-L15)

[^mercury-events]: [The SSE handler sends a connected frame and then live events](https://github.com/cosmicstack-labs/mercury-agent/blob/fd8cf4a655caa7b81ecb8b1b7604188e729c895e/src/web/api/chat.ts#L207-L228)

[^mercury-mode]: [Ask Me or Allow All is saved once for every surface](https://github.com/cosmicstack-labs/mercury-agent/blob/fd8cf4a655caa7b81ecb8b1b7604188e729c895e/src/index.ts#L2204-L2217)

[^mercury-mcp]: [MCP always stores server and tool, not the arguments](https://github.com/cosmicstack-labs/mercury-agent/blob/fd8cf4a655caa7b81ecb8b1b7604188e729c895e/src/capabilities/permissions.ts#L1113-L1136)

[^mercury-readme]: [The agent lives on the machine and keeps working when you walk away](https://github.com/cosmicstack-labs/mercury-agent/blob/fd8cf4a655caa7b81ecb8b1b7604188e729c895e/README.md#L9)
