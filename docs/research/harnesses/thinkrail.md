---
type: Reference
title: "ThinkRail"
description: "JetBrains agentic IDE that runs pi in-process: git-worktree workspaces, a project trust grant, and MCP calls that ask unless marked read-only."
resource: "https://github.com/JetBrains/thinkrail"
tags: [harness, ide, pi, worktree, permissions, mcp]
status: stable
generated:
  by: "grok/grok-4.7"
  at: "2026-10-30"
observed:
  date: "2026-10-30"
  revision: "bc1d252695c2998a96ed203370fefcb3a78dbfa0"
sources:
  - id: thinkrail-license-l1-l4
    resource: "https://github.com/JetBrains/thinkrail/blob/bc1d252695c2998a96ed203370fefcb3a78dbfa0/LICENSE#L1-L4"
    title: "Apache License 2.0 heading"
  - id: thinkrail-catalog-l16-l19
    resource: "https://github.com/JetBrains/thinkrail/blob/bc1d252695c2998a96ed203370fefcb3a78dbfa0/package.json#L16-L19"
    title: "Pi packages pinned at 1.4.0"
  - id: thinkrail-readme-l4-l13
    resource: "https://github.com/JetBrains/thinkrail/blob/bc1d252695c2998a96ed203370fefcb3a78dbfa0/README.md#L4-L13"
    title: "An IDE around pi, with workspaces, specs, and skills"
  - id: thinkrail-readme-providers-l74-l79
    resource: "https://github.com/JetBrains/thinkrail/blob/bc1d252695c2998a96ed203370fefcb3a78dbfa0/README.md#L74-L79"
    title: "Provider auth stays in pi; ThinkRail reads ~/.pi/agent"
  - id: thinkrail-create-session-l1351-l1369
    resource: "https://github.com/JetBrains/thinkrail/blob/bc1d252695c2998a96ed203370fefcb3a78dbfa0/packages/server/src/agent/agentSessionManager.ts#L1351-L1369"
    title: "A session is an in-process pi agent bound to a cwd"
  - id: thinkrail-protocol-l131
    resource: "https://github.com/JetBrains/thinkrail/blob/bc1d252695c2998a96ed203370fefcb3a78dbfa0/packages/contracts/src/wsProtocol.ts#L131"
    title: "Wire protocol version 98"
  - id: thinkrail-ws-l299-l310
    resource: "https://github.com/JetBrains/thinkrail/blob/bc1d252695c2998a96ed203370fefcb3a78dbfa0/packages/server/src/host/server.ts#L299-L310"
    title: "WebSocket upgrade takes a client query parameter"
  - id: thinkrail-cli-host-l1-l2
    resource: "https://github.com/JetBrains/thinkrail/blob/bc1d252695c2998a96ed203370fefcb3a78dbfa0/apps/cli/src/args.ts#L1-L2"
    title: "CLI defaults to localhost port 24242"
  - id: thinkrail-data-dir-l47-l49
    resource: "https://github.com/JetBrains/thinkrail/blob/bc1d252695c2998a96ed203370fefcb3a78dbfa0/packages/server/src/persistence/persistence.ts#L47-L49"
    title: "Data directory defaults to ~/.thinkrail"
  - id: thinkrail-worktree-l272-l283
    resource: "https://github.com/JetBrains/thinkrail/blob/bc1d252695c2998a96ed203370fefcb3a78dbfa0/packages/server/src/workspaces/workspaces.ts#L272-L283"
    title: "A created workspace is a git worktree under the data directory"
  - id: thinkrail-default-workspace-l346-l352
    resource: "https://github.com/JetBrains/thinkrail/blob/bc1d252695c2998a96ed203370fefcb3a78dbfa0/packages/server/src/workspaces/workspaces.ts#L346-L352"
    title: "The default workspace cwd is the project folder"
  - id: thinkrail-skill-admission-l40-l44
    resource: "https://github.com/JetBrains/thinkrail/blob/bc1d252695c2998a96ed203370fefcb3a78dbfa0/packages/server/src/agent/skillAdmission.ts#L40-L44"
    title: "A project skill alias stays unloaded until the project is trusted and the skill is acknowledged"
  - id: thinkrail-session-settings-l996-l997
    resource: "https://github.com/JetBrains/thinkrail/blob/bc1d252695c2998a96ed203370fefcb3a78dbfa0/packages/server/src/agent/agentSessionManager.ts#L996-L997"
    title: "Pi project trust follows the workspace admission flag"
  - id: thinkrail-apply-trust-l325-l326
    resource: "https://github.com/JetBrains/thinkrail/blob/bc1d252695c2998a96ed203370fefcb3a78dbfa0/packages/server/src/agent/extensions.ts#L325-L326"
    title: "Reload writes the current pi-resource trust into settings"
  - id: thinkrail-clone-trust-l70-l78
    resource: "https://github.com/JetBrains/thinkrail/blob/bc1d252695c2998a96ed203370fefcb3a78dbfa0/packages/server/src/projects/clone.test.ts#L70-L78"
    title: "A clone opens with pi-resource trust untrusted"
  - id: thinkrail-mcp-repo-l70-l76
    resource: "https://github.com/JetBrains/thinkrail/blob/bc1d252695c2998a96ed203370fefcb3a78dbfa0/packages/server/src/host/mcp.ts#L70-L76"
    title: "Repository MCP entries cannot be edited until pi-resource trust is granted"
  - id: thinkrail-mcp-confirm-l76-l97
    resource: "https://github.com/JetBrains/thinkrail/blob/bc1d252695c2998a96ed203370fefcb3a78dbfa0/packages/server/src/agent/mcp/sessionHost.ts#L76-L97"
    title: "Read-only MCP tools proceed; other calls ask, and a headless call is blocked"
  - id: thinkrail-mcp-answers-l105-l114
    resource: "https://github.com/JetBrains/thinkrail/blob/bc1d252695c2998a96ed203370fefcb3a78dbfa0/packages/server/src/agent/mcp/sessionHost.ts#L105-L114"
    title: "Allow always, once, for this chat, or deny"
  - id: thinkrail-steer-l2256-l2277
    resource: "https://github.com/JetBrains/thinkrail/blob/bc1d252695c2998a96ed203370fefcb3a78dbfa0/packages/server/src/agent/agentSessionManager.ts#L2256-L2277"
    title: "Steer a streaming session; a prompt while streaming steers"
  - id: thinkrail-follow-up-l2315-l2334
    resource: "https://github.com/JetBrains/thinkrail/blob/bc1d252695c2998a96ed203370fefcb3a78dbfa0/packages/server/src/agent/agentSessionManager.ts#L2315-L2334"
    title: "A follow-up queues while the session is streaming"
  - id: thinkrail-spec-build-l46-l51
    resource: "https://github.com/JetBrains/thinkrail/blob/bc1d252695c2998a96ed203370fefcb3a78dbfa0/packages/server/src/buildSupport.ts#L46-L51"
    title: "Packaged builds stage the spec-graph, workflow, and todos extensions"
  - id: thinkrail-spec-child-l278-l283
    resource: "https://github.com/JetBrains/thinkrail/blob/bc1d252695c2998a96ed203370fefcb3a78dbfa0/packages/server/src/agent/extensions.ts#L278-L283"
    title: "Child sessions include the spec-graph extension inline"
---

# ThinkRail

- **Stack:** Bun host (`packages/server`) with an in-process [`pi`](https://www.npmjs.com/package/@earendil-works/pi-coding-agent) coding agent at catalog version 1.4.0, a React client, and Electrobun desktop and CLI launchers.[^thinkrail-catalog-l16-l19] **License:** Apache-2.0.[^thinkrail-license-l1-l4] The site [thinkrail.ai](https://thinkrail.ai/) is a live page and is not pinned.

ThinkRail is JetBrains' agentic IDE around pi: isolated git workspaces, living specs, and skills.[^thinkrail-readme-l4-l13] It is a product host, not a second agent loop. Pi's own codemode and durable runtime stay in [Earendil Pi](./earendil-pi.md); [PiNomad](./pinomad.md) is a different host on Pi Durable. Source inspection only; nothing was run.

**Study**

1. **The host owns the engine; the UI is a client.** `createSession` passes that workspace cwd and a `SessionManager` for the same cwd into the parent session.[^thinkrail-create-session-l1351-l1369] The wire constant is protocol version 98.[^thinkrail-protocol-l131] `/ws` upgrades any request that reaches the server. The client id is the `client` query parameter, or a generated anonymous id.[^thinkrail-ws-l299-l310] The CLI defaults to `localhost:24242`.[^thinkrail-cli-host-l1-l2] Desktop launch is a local host. This matches [Runs are the unit of execution](../../../VISION.md#runs-are-the-unit-of-execution) only at the product layer: ThinkRail sessions are pi sessions, and the host is their store.
2. **A created workspace is a git worktree.** `git worktree add` places it at `<dataDir>/worktrees/<project slug>/<branch>`. The data directory is `THINKRAIL_DATA_DIR` or `~/.thinkrail`.[^thinkrail-worktree-l272-l283][^thinkrail-data-dir-l47-l49] Every project also has one default workspace whose path is the project folder itself.[^thinkrail-default-workspace-l346-l352] Shell and file tools therefore run as pi, in that cwd, on the host machine.
3. **Trust is a grant, and it is split.** A project skill alias stays `untrusted` until the project is trusted, and `pending-ack` until that skill name is acknowledged.[^thinkrail-skill-admission-l40-l44] Pi's own project resources follow a separate `piResourceTrust` flag passed into `SettingsManager.create`, and a reload writes the current flag back.[^thinkrail-session-settings-l996-l997][^thinkrail-apply-trust-l325-l326] Editing MCP servers that the repository defines throws until that flag is `granted`.[^thinkrail-mcp-repo-l70-l76] A clone opens with `piResourceTrust` still `untrusted`.[^thinkrail-clone-trust-l70-l78] This is the shape [the harness owns execution](../../../VISION.md#the-harness-owns-execution) wants for repo-supplied instructions: they do not become tools because they sit in the tree.
4. **MCP asks, with a read-only exception.** A tool whose name is an MCP tool proceeds when its annotation says `readOnlyHint`, when it was allowed for this chat, or when a stored grant matches. Otherwise the host asks. With no UI attached, the call is blocked.[^thinkrail-mcp-confirm-l76-l97] The answers are allow always (a stored grant), allow once, allow for this chat, or deny.[^thinkrail-mcp-answers-l105-l114] A dismissed question blocks the call. Ordinary pi bash and edit tools are pi's, and this gate does not wrap them.
5. **Steer and queue are different calls.** `steerSession` queues a steering message into `session.steer`. `promptSession` steers when the session is already streaming. `followUpSession` queues on pi's follow-up queue while streaming, and starts the turn when it is idle.[^thinkrail-steer-l2256-l2277][^thinkrail-follow-up-l2315-l2334]
6. **Specs are a pi extension, not a second memory store.** Packaged builds stage `pi-spec-graph`, `pi-thinkrail-workflow`, and `pi-todos`.[^thinkrail-spec-build-l46-l51] Child sessions also receive the spec-graph extension inline.[^thinkrail-spec-child-l278-l283] The package describes spec search and frontmatter-tagged specs beside the code. Provider sign-in stays in pi, including JetBrains AI; the README says ThinkRail has no accounts of its own and reads `~/.pi/agent` unless `PI_CODING_AGENT_DIR` is set.[^thinkrail-readme-providers-l74-l79]

**llame fit**

- High: items 3 and 4. A repo-supplied skill or MCP server is pending until the owner grants it, and a headless MCP call fails closed.
- Moderate: items 1, 2, and 5 for a host-owned engine, worktree cwd, and steer versus queue.
- Low: item 6's spec graph as project knowledge. It is files the agent edits, which fits human-readable knowledge, and it is still pi context.
- Avoid: treating a reached `/ws` as an authenticated owner. Binding is the boundary in the server code reviewed here.[^thinkrail-ws-l299-l310]

**Caution:** The architecture document describes Tailscale ACLs as the auth. The fetch handler that upgrades `/ws` does not check a credential.[^thinkrail-ws-l299-l310] The CLI accepts an explicit `--host`, including `0.0.0.0`, in its argument tests. MCP confirmation does not cover pi's shell. PiNomad's coding tools have no approval gate; ThinkRail's MCP gate is narrower and does not change that comparison for shell.

[^thinkrail-license-l1-l4]: [Apache License 2.0 heading](https://github.com/JetBrains/thinkrail/blob/bc1d252695c2998a96ed203370fefcb3a78dbfa0/LICENSE#L1-L4)

[^thinkrail-catalog-l16-l19]: [Pi packages pinned at 1.4.0](https://github.com/JetBrains/thinkrail/blob/bc1d252695c2998a96ed203370fefcb3a78dbfa0/package.json#L16-L19)

[^thinkrail-readme-l4-l13]: [An IDE around pi, with workspaces, specs, and skills](https://github.com/JetBrains/thinkrail/blob/bc1d252695c2998a96ed203370fefcb3a78dbfa0/README.md#L4-L13)

[^thinkrail-readme-providers-l74-l79]: [Provider auth stays in pi; ThinkRail reads ~/.pi/agent](https://github.com/JetBrains/thinkrail/blob/bc1d252695c2998a96ed203370fefcb3a78dbfa0/README.md#L74-L79)

[^thinkrail-create-session-l1351-l1369]: [A session is an in-process pi agent bound to a cwd](https://github.com/JetBrains/thinkrail/blob/bc1d252695c2998a96ed203370fefcb3a78dbfa0/packages/server/src/agent/agentSessionManager.ts#L1351-L1369)

[^thinkrail-protocol-l131]: [Wire protocol version 98](https://github.com/JetBrains/thinkrail/blob/bc1d252695c2998a96ed203370fefcb3a78dbfa0/packages/contracts/src/wsProtocol.ts#L131)

[^thinkrail-ws-l299-l310]: [WebSocket upgrade takes a client query parameter](https://github.com/JetBrains/thinkrail/blob/bc1d252695c2998a96ed203370fefcb3a78dbfa0/packages/server/src/host/server.ts#L299-L310)

[^thinkrail-cli-host-l1-l2]: [CLI defaults to localhost port 24242](https://github.com/JetBrains/thinkrail/blob/bc1d252695c2998a96ed203370fefcb3a78dbfa0/apps/cli/src/args.ts#L1-L2)

[^thinkrail-data-dir-l47-l49]: [Data directory defaults to ~/.thinkrail](https://github.com/JetBrains/thinkrail/blob/bc1d252695c2998a96ed203370fefcb3a78dbfa0/packages/server/src/persistence/persistence.ts#L47-L49)

[^thinkrail-worktree-l272-l283]: [A created workspace is a git worktree under the data directory](https://github.com/JetBrains/thinkrail/blob/bc1d252695c2998a96ed203370fefcb3a78dbfa0/packages/server/src/workspaces/workspaces.ts#L272-L283)

[^thinkrail-default-workspace-l346-l352]: [The default workspace cwd is the project folder](https://github.com/JetBrains/thinkrail/blob/bc1d252695c2998a96ed203370fefcb3a78dbfa0/packages/server/src/workspaces/workspaces.ts#L346-L352)

[^thinkrail-skill-admission-l40-l44]: [A project skill alias stays unloaded until the project is trusted and the skill is acknowledged](https://github.com/JetBrains/thinkrail/blob/bc1d252695c2998a96ed203370fefcb3a78dbfa0/packages/server/src/agent/skillAdmission.ts#L40-L44)

[^thinkrail-session-settings-l996-l997]: [Pi project trust follows the workspace admission flag](https://github.com/JetBrains/thinkrail/blob/bc1d252695c2998a96ed203370fefcb3a78dbfa0/packages/server/src/agent/agentSessionManager.ts#L996-L997)

[^thinkrail-apply-trust-l325-l326]: [Reload writes the current pi-resource trust into settings](https://github.com/JetBrains/thinkrail/blob/bc1d252695c2998a96ed203370fefcb3a78dbfa0/packages/server/src/agent/extensions.ts#L325-L326)

[^thinkrail-clone-trust-l70-l78]: [A clone opens with pi-resource trust untrusted](https://github.com/JetBrains/thinkrail/blob/bc1d252695c2998a96ed203370fefcb3a78dbfa0/packages/server/src/projects/clone.test.ts#L70-L78)

[^thinkrail-mcp-repo-l70-l76]: [Repository MCP entries cannot be edited until pi-resource trust is granted](https://github.com/JetBrains/thinkrail/blob/bc1d252695c2998a96ed203370fefcb3a78dbfa0/packages/server/src/host/mcp.ts#L70-L76)

[^thinkrail-mcp-confirm-l76-l97]: [Read-only MCP tools proceed; other calls ask, and a headless call is blocked](https://github.com/JetBrains/thinkrail/blob/bc1d252695c2998a96ed203370fefcb3a78dbfa0/packages/server/src/agent/mcp/sessionHost.ts#L76-L97)

[^thinkrail-mcp-answers-l105-l114]: [Allow always, once, for this chat, or deny](https://github.com/JetBrains/thinkrail/blob/bc1d252695c2998a96ed203370fefcb3a78dbfa0/packages/server/src/agent/mcp/sessionHost.ts#L105-L114)

[^thinkrail-steer-l2256-l2277]: [Steer a streaming session; a prompt while streaming steers](https://github.com/JetBrains/thinkrail/blob/bc1d252695c2998a96ed203370fefcb3a78dbfa0/packages/server/src/agent/agentSessionManager.ts#L2256-L2277)

[^thinkrail-follow-up-l2315-l2334]: [A follow-up queues while the session is streaming](https://github.com/JetBrains/thinkrail/blob/bc1d252695c2998a96ed203370fefcb3a78dbfa0/packages/server/src/agent/agentSessionManager.ts#L2315-L2334)

[^thinkrail-spec-build-l46-l51]: [Packaged builds stage the spec-graph, workflow, and todos extensions](https://github.com/JetBrains/thinkrail/blob/bc1d252695c2998a96ed203370fefcb3a78dbfa0/packages/server/src/buildSupport.ts#L46-L51)

[^thinkrail-spec-child-l278-l283]: [Child sessions include the spec-graph extension inline](https://github.com/JetBrains/thinkrail/blob/bc1d252695c2998a96ed203370fefcb3a78dbfa0/packages/server/src/agent/extensions.ts#L278-L283)
