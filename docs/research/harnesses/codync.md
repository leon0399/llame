---
type: Reference
title: "Codync"
description: "Rust host for installed agent CLIs: a ratatui client, SQLite routines that coalesce, and phones that attach to the computer that runs the bot."
resource: "https://github.com/leepokai/Codync/tree/ed8daf11f89398e598ef1f791abc3014ded68496"
tags: [harness, peer-executor, tui, routines, mobile, multi-host]
status: stable
generated:
  by: "grok/grok-4.7"
  at: "2026-11-03"
observed:
  date: "2026-11-03"
  revision: "ed8daf11f89398e598ef1f791abc3014ded68496"
sources:
  - id: codync-license
    resource: "https://github.com/leepokai/Codync/blob/ed8daf11f89398e598ef1f791abc3014ded68496/LICENSE#L1-L4"
    title: "Apache License 2.0 heading"
  - id: codync-readme
    resource: "https://github.com/leepokai/Codync/blob/ed8daf11f89398e598ef1f791abc3014ded68496/README.md#L8-L10"
    title: "Message installed agents from a phone"
  - id: codync-tui
    resource: "https://github.com/leepokai/Codync/blob/ed8daf11f89398e598ef1f791abc3014ded68496/host/src/tui/app/mod.rs#L1"
    title: "TUI state is driven by host events"
  - id: codync-seq
    resource: "https://github.com/leepokai/Codync/blob/ed8daf11f89398e598ef1f791abc3014ded68496/host/src/tui/app/mod.rs#L148"
    title: "Catch-up records the lowest loaded seq per bot"
  - id: codync-routines
    resource: "https://github.com/leepokai/Codync/blob/ed8daf11f89398e598ef1f791abc3014ded68496/docs/features/routines.md#L79-L107"
    title: "Due triggers coalesce; an acted run is not replayed into a new session"
  - id: codync-hooks
    resource: "https://github.com/leepokai/Codync/blob/ed8daf11f89398e598ef1f791abc3014ded68496/docs/features/routines.md#L176-L186"
    title: "Cloud webhooks are readable by the relay and kept up to 72 hours"
  - id: codync-network
    resource: "https://github.com/leepokai/Codync/blob/ed8daf11f89398e598ef1f791abc3014ded68496/docs/plans/codync-network-next.md#L100"
    title: "A phone chats with that computer's own bots"
---

# Codync

- **Stack:** Rust host, Electron desktop, SwiftUI iPhone app, ratatui on the host. Apache-2.0.[^codync-license] The [tierroom board](https://my-tierroom.party/agents/codync) and [codync.dev](https://www.codync.dev) are live pages and are not pinned.

Codync messages agent CLIs that are already installed on a computer. The README names Claude Code, Codex, Gemini CLI, and Cursor, and says the phone is how you reach them.[^codync-readme] Source inspection of the host tree and its docs; nothing was run. The board's "40+ agents" count is a README claim, not a catalog this pass enumerated.

**Study**

1. **The host owns the transcript seq.** The TUI module is "state and everything that changes it: host events, keys, mouse, replies."[^codync-tui] Catch-up stores, per bot, the lowest seq of the loaded main chat when the connection's catch-up began.[^codync-seq] The phone and the TUI are clients of that host. A first-party llame CLI is still [backlog](../../../ROADMAP.md#backlog-standalone-personal-node-and-cli); Codync is a case where the terminal UI is a client of the same log the phone reads, and the agent process stays on the computer.
2. **Routines coalesce, and an acted run is not replayed.** The host checks deadlines every second with no client connected. Definitions and run records are SQLite (`routines.v1`). Due triggers become one run per routine, and only one routine per bot is dispatched at a time. Missed intervals coalesce. A run interrupted in execution becomes `recovering` and reloads its agent session. If the provider cannot load that session, the run becomes `interrupted` instead of starting the task again. The doc says session recovery cannot promise exactly-once side effects.[^codync-routines] A retry runs only when the turn has no tool call outside `read`, `search`, `fetch`, and `think`; an unknown kind counts as having acted.
3. **The webhook cloud can read the delivery.** Public hooks go through Codync's cloud. The doc says deliveries are not end-to-end encrypted: the cloud terminates HTTPS, sees the body, and stores the signing key. Offline public deliveries are kept up to 72 hours. The host checks the key again before a run starts.[^codync-hooks]
4. **Another computer is another host.** The network plan's recommended default keeps other computers' bots out of this computer's bot list. "A phone chats with a computer's own bots."[^codync-network] Opening a bot on a second machine does not move its execution. That matches [execution affinity](../../../VISION.md#execution-follows-intent-and-capability): observation is not a grant to run the work elsewhere.

**llame fit**

- High: item 2's coalesce-and-do-not-replay-after-a-tool-call rule for any future scheduled Run. llame does not ship routines; this is a proposal input, not a shipped contract.
- High: item 4. A paired phone is a Surface. The computer that holds the CLI is the executor.
- Moderate: item 1's seq catch-up inside the TUI. llame's shipped replay is the API event log, not a terminal widget.
- Avoid: item 3 as a pattern for owner data. A relay that stores webhook bodies is a second reader of the task.

**Caution:** Background permission behavior is the bot's own approval setting. This pass did not read each CLI adapter's sandbox flags. The cloud assistant connector, which the board says can read requests, was not re-read beyond the routine webhook path above.

[^codync-license]: [Apache License 2.0 heading](https://github.com/leepokai/Codync/blob/ed8daf11f89398e598ef1f791abc3014ded68496/LICENSE#L1-L4)

[^codync-readme]: [Message installed agents from a phone](https://github.com/leepokai/Codync/blob/ed8daf11f89398e598ef1f791abc3014ded68496/README.md#L8-L10)

[^codync-tui]: [TUI state is driven by host events](https://github.com/leepokai/Codync/blob/ed8daf11f89398e598ef1f791abc3014ded68496/host/src/tui/app/mod.rs#L1)

[^codync-seq]: [Catch-up records the lowest loaded seq per bot](https://github.com/leepokai/Codync/blob/ed8daf11f89398e598ef1f791abc3014ded68496/host/src/tui/app/mod.rs#L148)

[^codync-routines]: [Due triggers coalesce; an acted run is not replayed into a new session](https://github.com/leepokai/Codync/blob/ed8daf11f89398e598ef1f791abc3014ded68496/docs/features/routines.md#L79-L107)

[^codync-hooks]: [Cloud webhooks are readable by the relay and kept up to 72 hours](https://github.com/leepokai/Codync/blob/ed8daf11f89398e598ef1f791abc3014ded68496/docs/features/routines.md#L176-L186)

[^codync-network]: [A phone chats with that computer's own bots](https://github.com/leepokai/Codync/blob/ed8daf11f89398e598ef1f791abc3014ded68496/docs/plans/codync-network-next.md#L100)
