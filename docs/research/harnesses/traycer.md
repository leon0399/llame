---
type: Reference
title: "Traycer"
description: "Open clients, CLI and protocol for a desktop orchestration product whose signed Host binary and cloud backends stay closed; BYOA agents, worktrees and capability-gated agent-to-agent messaging."
tags: [harness, desktop, multi-agent, worktrees, protocol, peer-executor]
status: draft
resource: "https://github.com/traycerai/traycer/tree/c851ce482058418a03a35d22260beb552fc4f325"
generated:
  by: "cursor/composer"
  at: "2026-10-17"
observed:
  date: "2026-10-17"
  revision: "c851ce482058418a03a35d22260beb552fc4f325"
sources:
  - id: tray-readme-l20-l32
    resource: "https://github.com/traycerai/traycer/blob/c851ce482058418a03a35d22260beb552fc4f325/README.md#L20-L32"
    title: "BYOA, unified context, agent-to-agent, sync"
  - id: tray-readme-l103-l106
    resource: "https://github.com/traycerai/traycer/blob/c851ce482058418a03a35d22260beb552fc4f325/README.md#L103-L106"
    title: "Privacy Mode and provider-direct agent traffic"
  - id: tray-agents-l5-l28
    resource: "https://github.com/traycerai/traycer/blob/c851ce482058418a03a35d22260beb552fc4f325/AGENTS.md#L5-L28"
    title: "Open clients/protocol; Host not in repo"
  - id: tray-protocol-l1-l57
    resource: "https://github.com/traycerai/traycer/blob/c851ce482058418a03a35d22260beb552fc4f325/protocol/README.md#L1-L57"
    title: "Client-host contract; RPC vs persistence versions"
  - id: tray-hosts-l6-l21
    resource: "https://github.com/traycerai/traycer/blob/c851ce482058418a03a35d22260beb552fc4f325/mintlify/concepts/hosts.mdx#L6-L21"
    title: "Host owns agents, files, terminals; sync is separate"
  - id: tray-a2a-l82-l118
    resource: "https://github.com/traycerai/traycer/blob/c851ce482058418a03a35d22260beb552fc4f325/mintlify/concepts/agent-to-agent.mdx#L82-L118"
    title: "Reference vs transcript vs deliver; inbox rules"
  - id: tray-worktrees-l6-l29
    resource: "https://github.com/traycerai/traycer/blob/c851ce482058418a03a35d22260beb552fc4f325/mintlify/guides/parallel-agents-on-worktrees.mdx#L6-L29"
    title: "Per-agent worktree branches and child agents"
  - id: tray-license-l1-l10
    resource: "https://github.com/traycerai/traycer/blob/c851ce482058418a03a35d22260beb552fc4f325/LICENSE#L1-L10"
    title: "MIT License"
---

# Traycer

- **Stack:** Bun/Nx monorepo of open `protocol/`, Electron desktop, CLI and
  gui-app clients; Host is a signed binary provisioned from GitHub
  Releases.[^tray-agents-l5-l28] Site: [traycer.ai](https://traycer.ai).
  **License:** MIT for this repository.[^tray-license-l1-l10]

**Status:** Source, protocol README and in-repo Mintlify docs inspection only;
nothing was run. Product is an orchestration desktop with BYOA coding agents,
worktrees and agent-to-agent loops.[^tray-readme-l20-l32] The open tree is
**clients + wire contract**; the Host and cloud backends that own execution are
not here.[^tray-agents-l5-l28] High confidence on that split and on the published
capability matrix; low confidence on Host internals.

**Study**

1. **Open protocol, closed Host.** `@traycer/protocol` is the single client⇄host
   contract; npm semver, per-method RPC `{major,minor}` and persistence schema
   versions are three independent systems — handshake uses RPC versions, not
   package semver.[^tray-protocol-l1-l57] Useful discipline for llame peer
   adapter versioning.
2. **Host owns machine-local work.** A host owns workspace folders, files, git
   diffs, terminals, agents and in-app browsers on one machine; cloud sync
   carries Tasks and history, but live work stays on the host that started
   it.[^tray-hosts-l6-l21] Same placement rule as llame local-node research:
   identity may sync, execution does not teleport.
3. **Three separate A2A capabilities.** Referencing an agent, reading its
   transcript and delivering a message have different requirements. Reference is
   always available in a Task; transcript and inbox delivery are narrower and
   depend on ownership, interface (Chat vs Terminal) and host. Cross-host
   messages queue through the cloud with a 24 h expiry and do not confirm
   delivery on send.[^tray-a2a-l82-l118] Direct cautionary design for llame child
   Runs: do not collapse "can see" with "can steer".
4. **Terminal inbox is not universal.** On Terminal interface, only Claude Code
   can receive; Codex and OpenCode Terminal agents can send but not receive, so
   they cannot ask for a reply or be created as Terminal children that need a
   brief.[^tray-a2a-l82-l118] Capability flags before claiming peer completion.
5. **Worktree parallelism.** Guides prescribe one worktree/branch per agent so
   edits do not collide; parents can spawn children on new worktrees.[^tray-worktrees-l6-l29]
   Collision avoidance, not sandboxing.
6. **BYOA traffic path.** Agent requests for configured CLI providers go directly
   to that provider; Traycer inference is separate. Privacy Mode gates prompt
   logging.[^tray-readme-l103-l106]

**llame fit**

- High: items 2 to 4 for execution placement and child-Run capability gates.
- Moderate: item 1 for adapter wire versioning; item 5 for Workspace isolation
  vocabulary.
- Low: collaborative boards / cross-device sync as Chat authority.
- Avoid: treating the closed Host or cloud Task store as a model for RLS
  tenancy.

**Caution:** "Unified context" and "shared memory across providers" are product
claims whose Host-side normalization is not inspectable in this
checkout.[^tray-readme-l20-l32][^tray-agents-l5-l28] Dev desktop talks to
production cloud.[^tray-agents-l5-l28] No llame-style authenticated multi-owner
isolation in the open sources.

[^tray-readme-l20-l32]: [BYOA, unified context, agent-to-agent, sync](https://github.com/traycerai/traycer/blob/c851ce482058418a03a35d22260beb552fc4f325/README.md#L20-L32)

[^tray-readme-l103-l106]: [Privacy Mode and provider-direct agent traffic](https://github.com/traycerai/traycer/blob/c851ce482058418a03a35d22260beb552fc4f325/README.md#L103-L106)

[^tray-agents-l5-l28]: [Open clients/protocol; Host not in repo](https://github.com/traycerai/traycer/blob/c851ce482058418a03a35d22260beb552fc4f325/AGENTS.md#L5-L28)

[^tray-protocol-l1-l57]: [Client-host contract; RPC vs persistence versions](https://github.com/traycerai/traycer/blob/c851ce482058418a03a35d22260beb552fc4f325/protocol/README.md#L1-L57)

[^tray-hosts-l6-l21]: [Host owns agents, files, terminals; sync is separate](https://github.com/traycerai/traycer/blob/c851ce482058418a03a35d22260beb552fc4f325/mintlify/concepts/hosts.mdx#L6-L21)

[^tray-a2a-l82-l118]: [Reference vs transcript vs deliver; inbox rules](https://github.com/traycerai/traycer/blob/c851ce482058418a03a35d22260beb552fc4f325/mintlify/concepts/agent-to-agent.mdx#L82-L118)

[^tray-worktrees-l6-l29]: [Per-agent worktree branches and child agents](https://github.com/traycerai/traycer/blob/c851ce482058418a03a35d22260beb552fc4f325/mintlify/guides/parallel-agents-on-worktrees.mdx#L6-L29)

[^tray-license-l1-l10]: [MIT License](https://github.com/traycerai/traycer/blob/c851ce482058418a03a35d22260beb552fc4f325/LICENSE#L1-L10)
