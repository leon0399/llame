---
type: Reference
title: "OpenTeam"
description: "GPL-3.0 self-hosted bot team. SSE replays an Event sequence. Bots share one Linux computer container, and passwordless sudo inside it is documented."
resource: "https://github.com/raghavpillai/openteam/tree/32f903eaa56a2489cbdf0b10753afa74bc9f06aa"
tags: [harness, sandbox, desktop, routines, mobile]
status: stable
generated:
  by: "grok/grok-4.7"
  at: "2026-11-03"
observed:
  date: "2026-11-03"
  revision: "32f903eaa56a2489cbdf0b10753afa74bc9f06aa"
sources:
  - id: openteam-license
    resource: "https://github.com/raghavpillai/openteam/blob/32f903eaa56a2489cbdf0b10753afa74bc9f06aa/LICENSE#L1-L4"
    title: "GNU GPL version 3 heading"
  - id: openteam-readme
    resource: "https://github.com/raghavpillai/openteam/blob/32f903eaa56a2489cbdf0b10753afa74bc9f06aa/README.md#L16-L30"
    title: "Each bot has a screen; the server needs Docker"
  - id: openteam-computer
    resource: "https://github.com/raghavpillai/openteam/blob/32f903eaa56a2489cbdf0b10753afa74bc9f06aa/docs/usage/computer.md#L1-L40"
    title: "One Linux computer, shared sign-ins, passwordless sudo, no VM boundary"
  - id: openteam-broker
    resource: "https://github.com/raghavpillai/openteam/blob/32f903eaa56a2489cbdf0b10753afa74bc9f06aa/apps/computer/src/screen-broker.ts#L342-L361"
    title: "Takeover is per bot; shutdown closes every bot browser before the computer exits"
  - id: openteam-stream
    resource: "https://github.com/raghavpillai/openteam/blob/32f903eaa56a2489cbdf0b10753afa74bc9f06aa/apps/computer/src/computer-event-stream.ts#L1-L36"
    title: "Computer events are NDJSON pulls with blank-line keepalives"
  - id: openteam-event-row
    resource: "https://github.com/raghavpillai/openteam/blob/32f903eaa56a2489cbdf0b10753afa74bc9f06aa/packages/db/prisma/schema.prisma#L908-L917"
    title: "Event.sequence is an autoincrement bigint"
  - id: openteam-event-route
    resource: "https://github.com/raghavpillai/openteam/blob/32f903eaa56a2489cbdf0b10753afa74bc9f06aa/apps/server/src/routes/event.ts#L14-L26"
    title: "GET /api/events reads after or Last-Event-ID and returns SSE"
  - id: openteam-event-stream
    resource: "https://github.com/raghavpillai/openteam/blob/32f903eaa56a2489cbdf0b10753afa74bc9f06aa/apps/server/src/event-stream.ts#L89-L151"
    title: "An expired or ahead cursor emits snapshot.required"
---

# OpenTeam

- **Stack:** TypeScript server, desktop apps, an iOS client, and a computer runtime. GPL-3.0.[^openteam-license] The [tierroom board](https://my-tierroom.party/agents/openteam) and [openteam.so](https://openteam.so/) are live pages and are not pinned.

OpenTeam runs a team of bots on a machine with Docker. The README says each bot has its own screen and browser, and that bots share a workspace and website sign-ins.[^openteam-readme] Source inspection of the computer docs and the screen broker; nothing was run.

**Study**

1. **One computer, many screens.** The usage doc's title is "Computer and browser," singular. Each bot has a screen, a browser, and a terminal on the server's Linux computer. Browsers share sign-ins. Updates recreate that computer from a fresh image and keep the bots' home folder, `/workspace`, `/usr/local`, and recorded apt packages. The reset instruction removes the volume `openteam_openteam_computer_local`.[^openteam-computer] `takeover(botId)` and `pauseAgent(botId)` address one bot. `shutdown` closes every bot browser before the computer exits, because Docker signals the gateway and a Chromium killed with the container would not publish its profile.[^openteam-broker] The board says each bot gets its own Linux desktop. The doc and this shutdown path describe one container and a screen per bot.
2. **The container is not a VM boundary.** Bots can use passwordless `sudo`. The doc says that reaches all container files, including provider credentials, and that the container has all Linux capabilities, unrestricted seccomp and LSM profiles, a writable `/tmp`, and `/dev/net/tun`. It shares the Docker host kernel.[^openteam-computer] That is the opposite of [a Sandbox that receives only a working copy](../../../VISION.md#portable-data-isolated-execution). llame's managed Sandbox is [still a proposal](../../../ROADMAP.md#then-local-sandbox-execution), and this container is a caution about what "a Linux computer per bot" can mean in prose.
3. **Computer events are a pull stream.** `computerEventStream` converts runtime events to NDJSON one pull at a time and emits a blank line as a keepalive so a slow consumer does not buffer the producer.[^openteam-stream] It is a live stream of that computer, not a Chat run-event log with a replay cursor.
4. **Product events have a sequence and an SSE cursor.** `Event.sequence` is a bigint identity.[^openteam-event-row] `GET /api/events` reads `after` or `Last-Event-ID` and responds with `text/event-stream`.[^openteam-event-route] The stream pulls windows of 64. An expired or ahead cursor emits `snapshot.required` and moves the cursor to the latest sequence instead of replaying a gap.[^openteam-event-stream] A slow reader does not make the server build an unbounded backlog: the pull waits until the client consumes the chunk. That is the closest published cousin in this batch to llame's [append-only run events](../../../SPEC.md#94-run-events). llame replays the log. OpenTeam tells the client to take a snapshot when the cursor is no longer valid.
5. **Clients attach.** The README lists desktop downloads and says an iPhone app exists in the tree (`apps/ios` is present). The desktop can also connect the person's own computer with an outgoing connection.[^openteam-readme][^openteam-computer] Execution of the Linux desktop stays on the server container. The phone path was not traced past the file tree.

**llame fit**

- High as a caution: item 2. Shared sudo inside one container is host-kernel authority with a desktop picture.
- High: item 4's `after` / `Last-Event-ID` cursor, and the explicit `snapshot.required` when that cursor cannot be replayed.
- Moderate: item 1's correction of "a computer per bot" into "a screen per bot on one computer." Placement docs should use the smaller claim.
- Low: item 3, as a backpressured event stream for a computer the owner watches. It is separate from item 4.
- Routines and MCP are README features and were not opened.

**Caution:** GPL-3.0. A marketing post in `apps/landing` still says each bot gets its own Linux desktop. The usage doc is the more specific page.[^openteam-computer] iPhone TestFlight is a board claim; this pass saw an `apps/ios` tree and did not install it.

[^openteam-license]: [GNU GPL version 3 heading](https://github.com/raghavpillai/openteam/blob/32f903eaa56a2489cbdf0b10753afa74bc9f06aa/LICENSE#L1-L4)

[^openteam-readme]: [Each bot has a screen; the server needs Docker](https://github.com/raghavpillai/openteam/blob/32f903eaa56a2489cbdf0b10753afa74bc9f06aa/README.md#L16-L30)

[^openteam-computer]: [One Linux computer, shared sign-ins, passwordless sudo, no VM boundary](https://github.com/raghavpillai/openteam/blob/32f903eaa56a2489cbdf0b10753afa74bc9f06aa/docs/usage/computer.md#L1-L40)

[^openteam-broker]: [Takeover is per bot; shutdown closes every bot browser before the computer exits](https://github.com/raghavpillai/openteam/blob/32f903eaa56a2489cbdf0b10753afa74bc9f06aa/apps/computer/src/screen-broker.ts#L342-L361)

[^openteam-stream]: [Computer events are NDJSON pulls with blank-line keepalives](https://github.com/raghavpillai/openteam/blob/32f903eaa56a2489cbdf0b10753afa74bc9f06aa/apps/computer/src/computer-event-stream.ts#L1-L36)

[^openteam-event-row]: [Event.sequence is an autoincrement bigint](https://github.com/raghavpillai/openteam/blob/32f903eaa56a2489cbdf0b10753afa74bc9f06aa/packages/db/prisma/schema.prisma#L908-L917)

[^openteam-event-route]: [GET /api/events reads after or Last-Event-ID and returns SSE](https://github.com/raghavpillai/openteam/blob/32f903eaa56a2489cbdf0b10753afa74bc9f06aa/apps/server/src/routes/event.ts#L14-L26)

[^openteam-event-stream]: [An expired or ahead cursor emits snapshot.required](https://github.com/raghavpillai/openteam/blob/32f903eaa56a2489cbdf0b10753afa74bc9f06aa/apps/server/src/event-stream.ts#L89-L151)
