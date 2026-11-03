---
type: Reference
title: "CraftBot"
description: "MIT self-hosted agent whose in-workspace surface is Agent App, with the theme wire still named livingui-theme."
resource: "https://github.com/CraftOS-dev/CraftBot/tree/94aa652fdc89c6bab653e157ce7eba3e8dad5d14"
tags: [harness, self-hosted, memory, apps]
status: stable
generated:
  by: "grok/grok-4.7"
  at: "2026-11-03"
observed:
  date: "2026-11-03"
  revision: "94aa652fdc89c6bab653e157ce7eba3e8dad5d14"
sources:
  - id: craftbot-license
    resource: "https://github.com/CraftOS-dev/CraftBot/blob/94aa652fdc89c6bab653e157ce7eba3e8dad5d14/LICENSE#L1-L3"
    title: "MIT License heading"
  - id: craftbot-readme
    resource: "https://github.com/CraftOS-dev/CraftBot/blob/94aa652fdc89c6bab653e157ce7eba3e8dad5d14/README.md#L41-L52"
    title: "Agent App, memory, and a browser or CLI surface"
  - id: craftbot-agent-app
    resource: "https://github.com/CraftOS-dev/CraftBot/blob/94aa652fdc89c6bab653e157ce7eba3e8dad5d14/README.md#L88-L118"
    title: "Agent App is a dashboard the agent can read and change"
  - id: craftbot-wire
    resource: "https://github.com/CraftOS-dev/CraftBot/blob/94aa652fdc89c6bab653e157ce7eba3e8dad5d14/agent-app/kit/src/theme/bridge.ts#L1-L11"
    title: "livingui-theme survived the rename to Agent App"
  - id: craftbot-start
    resource: "https://github.com/CraftOS-dev/CraftBot/blob/94aa652fdc89c6bab653e157ce7eba3e8dad5d14/README.md#L58"
    title: "Getting started asks for Python 3.10 and Node for the browser"
---

# CraftBot

- **Stack:** The README's getting-started block asks for Python 3.10+ and Node.js 18+ for browser mode.[^craftbot-start] MIT.[^craftbot-license] The [tierroom board](https://my-tierroom.party/agents/craftbot) and [craftbot.live](https://craftbot.live/) are live pages and are not pinned.

CraftBot is a self-hosted agent that also builds small apps inside the workspace. Source inspection of the README sections and the theme bridge; the scheduler, memory store, and MCP installer were not opened, and nothing was run. The board's "Living UI" name is the previous name of Agent App.

**Study**

1. **The distinctive surface is an app the agent operates.** The README calls it Agent App: a dashboard that can be created, imported from a marketplace, or wrapped around existing source. The agent is described as able to read and write that UI's data.[^craftbot-agent-app] The feature list puts Agent Profiles, playbooks, memory, and MCP beside it.[^craftbot-readme] For llame, an agent-edited UI is a context surface. [A context surface the owner cannot see is not shipped](../../../VISION.md#context-changes-are-narrated-not-silent). Whether the owner can inspect the app's state as data was not verified beyond the README's claim that the agent can.
2. **The wire name outlived the product name.** The theme bridge listens for `livingui-theme`. The comment says that type is a frozen contract and deliberately survived the Living UI to Agent App rename.[^craftbot-wire] The board still says Living UI. The code says the feature was renamed and the message type was not.
3. **Memory and schedules are README claims in this pass.** The README describes a hybrid memory (RAG, a knowledge graph, and an agent file system) and a midnight consolidation it calls dreaming.[^craftbot-readme] A frontend resource catalog contains a `scheduler` key. The job runner behind that key was not read. Hosted CraftBot Live, its prices, and the 90-day task-log line are on the board and were not re-read.

**llame fit**

- Low for the run and event model: this pass did not find a cursor-replayed run log to compare with [SPEC §9.4](../../../SPEC.md#94-run-events).
- Moderate as a naming caution: item 2. A board can keep a retired name after the repository moved on.
- Low: item 1, if a later llame surface lets an agent build a view. The owner-visible receipt rule comes first. A first-party CLI remains [backlog](../../../ROADMAP.md#backlog-standalone-personal-node-and-cli); CraftBot's CLI is described as a headless client of this runtime, not read here.

**Caution:** The README's memory and "with approval" proactive-task sentences were not matched to code. Browser mode is a UI, and the README also offers a CLI. That does not by itself make the CLI the owner of execution.

[^craftbot-license]: [MIT License heading](https://github.com/CraftOS-dev/CraftBot/blob/94aa652fdc89c6bab653e157ce7eba3e8dad5d14/LICENSE#L1-L3)

[^craftbot-readme]: [Agent App, memory, and a browser or CLI surface](https://github.com/CraftOS-dev/CraftBot/blob/94aa652fdc89c6bab653e157ce7eba3e8dad5d14/README.md#L41-L52)

[^craftbot-agent-app]: [Agent App is a dashboard the agent can read and change](https://github.com/CraftOS-dev/CraftBot/blob/94aa652fdc89c6bab653e157ce7eba3e8dad5d14/README.md#L88-L118)

[^craftbot-wire]: [livingui-theme survived the rename to Agent App](https://github.com/CraftOS-dev/CraftBot/blob/94aa652fdc89c6bab653e157ce7eba3e8dad5d14/agent-app/kit/src/theme/bridge.ts#L1-L11)

[^craftbot-start]: [Getting started asks for Python 3.10 and Node for the browser](https://github.com/CraftOS-dev/CraftBot/blob/94aa652fdc89c6bab653e157ce7eba3e8dad5d14/README.md#L58)
