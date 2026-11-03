---
type: Reference
title: "OpenGrokBot"
description: "MIT gateway with its own bot runtime. Local computers leave shell off until an OS sandbox exists; Docker computers keep a shell."
resource: "https://github.com/wolfqing/OpenGrokBot/tree/b50e71cdc96118406cbe560e317845f7f823e7da"
tags: [harness, sandbox, routines, browser, self-hosted]
status: stable
generated:
  by: "grok/grok-4.7"
  at: "2026-11-03"
observed:
  date: "2026-11-03"
  revision: "b50e71cdc96118406cbe560e317845f7f823e7da"
sources:
  - id: ogb-license
    resource: "https://github.com/wolfqing/OpenGrokBot/blob/b50e71cdc96118406cbe560e317845f7f823e7da/LICENSE#L1-L3"
    title: "MIT License heading"
  - id: ogb-shell
    resource: "https://github.com/wolfqing/OpenGrokBot/blob/b50e71cdc96118406cbe560e317845f7f823e7da/gateway/src/server.ts#L193-L201"
    title: "Local computers enable shell only when the bot flag is set; Docker shells stay on"
  - id: ogb-local-doc
    resource: "https://github.com/wolfqing/OpenGrokBot/blob/b50e71cdc96118406cbe560e317845f7f823e7da/docs/local-computers.md#L11-L40"
    title: "Local mode is the default without Docker; commands are off until the sandbox self-check passes"
  - id: ogb-sandbox
    resource: "https://github.com/wolfqing/OpenGrokBot/blob/b50e71cdc96118406cbe560e317845f7f823e7da/gateway/src/sandbox.ts#L8-L55"
    title: "Seatbelt or bubblewrap, or a hint and no sandbox"
  - id: ogb-delivery
    resource: "https://github.com/wolfqing/OpenGrokBot/blob/b50e71cdc96118406cbe560e317845f7f823e7da/gateway/src/server.ts#L171-L181"
    title: "A routine delivery id is remembered and a repeat is dropped"
---

# OpenGrokBot

- **Stack:** Node gateway, web client, SQLite. MIT.[^ogb-license] The [tierroom board](https://my-tierroom.party/agents/opengrokbot) is a live page and is not pinned. The board's feature grid cites commit `15e42b1`; this note reads `b50e71cd`.

OpenGrokBot is a self-hosted team of bots with a browser each. The local-computers doc says the core is its own gateway, computers stay on the operator's machine, and Docker is one backend.[^ogb-local-doc] Source inspection of the gateway files below; nothing was run. The board says some older FAQ paragraphs still call Docker mandatory. The local-computers page says local mode has shipped and is the default when Docker is not running.[^ogb-local-doc]

**Study**

1. **Shell is off on a local computer until the operator turns it on.** `shellEnabledFor` returns true for every non-local computer, and for a local computer only when `bot.shell_enabled === 1`.[^ogb-shell] The doc says commands then run in Seatbelt on macOS or bubblewrap on Linux, confined to the teammate's folder, and the switch refuses to turn on until a sandbox self-check passes.[^ogb-local-doc] `detectSandbox` returns null when `sandbox-exec` or `bwrap` is missing, and `sandboxHint` tells the operator what to install. Windows local commands are refused in that hint, which points at a Docker computer instead.[^ogb-sandbox] A missing sandbox does not select an unsandboxed shell in this function. llame's [sandbox failure must not become native execution](../../../VISION.md#execution-follows-intent-and-capability) is the same rule. This pass did not read the call site that invokes `runSandboxed` after the flag is on.
2. **Docker computers are a different default.** For `computerKind !== 'local'`, the shell view is `{ enabled: true, available: true }`.[^ogb-shell] The doc's table gives Docker a container per teammate.[^ogb-local-doc] Local mode has no CPU or RAM cap in the board's summary; the doc distinguishes browser-profile isolation from a container. Those are different fences.
3. **Routine deliveries dedupe in memory.** `rememberDelivery` keeps a short list of delivery ids per routine and returns false when the id was already seen.[^ogb-delivery] The map lives on the gateway process. A restart can forget it. The board says cron, webhook, and read-only watch routines persist across restarts; the durable schedule was not opened. The in-memory set is only the replay guard.

**llame fit**

- High: item 1's default-off shell and a detector that fails when the OS sandbox binary is absent.
- Moderate: item 2, as a placed computer with a stronger fence than the local folder. A follow-up [managed Sandbox](../../../ROADMAP.md#then-local-sandbox-execution) is still a proposal.
- Low: item 3, until the durable routine row is read. Memory diffs shown in the UI are a board and README claim and were not opened.

**Caution:** The gateway comment says a container computer always has a shell.[^ogb-shell] That is a product default, not a per-command approval. Prompt injection is called out in the board's reading of the security guide; this pass did not read `docs/security.md`. Local-mode cookies are described there, on the board, as readable by other programs of the same user.

[^ogb-license]: [MIT License heading](https://github.com/wolfqing/OpenGrokBot/blob/b50e71cdc96118406cbe560e317845f7f823e7da/LICENSE#L1-L3)

[^ogb-shell]: [Local computers enable shell only when the bot flag is set; Docker shells stay on](https://github.com/wolfqing/OpenGrokBot/blob/b50e71cdc96118406cbe560e317845f7f823e7da/gateway/src/server.ts#L193-L201)

[^ogb-local-doc]: [Local mode is the default without Docker; commands are off until the sandbox self-check passes](https://github.com/wolfqing/OpenGrokBot/blob/b50e71cdc96118406cbe560e317845f7f823e7da/docs/local-computers.md#L11-L40)

[^ogb-sandbox]: [Seatbelt or bubblewrap, or a hint and no sandbox](https://github.com/wolfqing/OpenGrokBot/blob/b50e71cdc96118406cbe560e317845f7f823e7da/gateway/src/sandbox.ts#L8-L55)

[^ogb-delivery]: [A routine delivery id is remembered and a repeat is dropped](https://github.com/wolfqing/OpenGrokBot/blob/b50e71cdc96118406cbe560e317845f7f823e7da/gateway/src/server.ts#L171-L181)
