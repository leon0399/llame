---
type: Reference
title: "OpenHands (Agent Canvas)"
description: "MIT Agent Canvas control center over OpenHands Agent Server: multi-backend placement, built-in OpenHands agent plus ACP peer CLIs, and a separate automation backend."
tags:
  [harness, meta-harness, peer-executor, acp, self-host, backends, automations]
status: draft
resource: "https://github.com/OpenHands/OpenHands/tree/61a3bd93e642a0ff4def73b29496a73245628209"
generated:
  by: "cursor/composer"
  at: "2026-10-17"
observed:
  date: "2026-10-17"
  revision: "61a3bd93e642a0ff4def73b29496a73245628209"
sources:
  - id: oh-readme-l7-l10
    resource: "https://github.com/OpenHands/OpenHands/blob/61a3bd93e642a0ff4def73b29496a73245628209/README.md#L7-L10"
    title: "Self-hosted control center; ACP-compatible agents across backends"
  - id: oh-readme-l14
    resource: "https://github.com/OpenHands/OpenHands/blob/61a3bd93e642a0ff4def73b29496a73245628209/README.md#L14"
    title: "Project status beta badge"
  - id: oh-readme-l33-l45
    resource: "https://github.com/OpenHands/OpenHands/blob/61a3bd93e642a0ff4def73b29496a73245628209/README.md#L33-L45"
    title: "Multi-backend, automations, BYO model, ACP peers"
  - id: oh-readme-l66
    resource: "https://github.com/OpenHands/OpenHands/blob/61a3bd93e642a0ff4def73b29496a73245628209/README.md#L66"
    title: "Host install gives agent full filesystem access"
  - id: oh-readme-l117-l120
    resource: "https://github.com/OpenHands/OpenHands/blob/61a3bd93e642a0ff4def73b29496a73245628209/README.md#L117-L120"
    title: "Per-conversation Docker runtime; shared host workspace caveat"
  - id: oh-agents-l26-l36
    resource: "https://github.com/OpenHands/OpenHands/blob/61a3bd93e642a0ff4def73b29496a73245628209/AGENTS.md#L26-L36"
    title: "Repo split: Canvas UI vs Agent Server vs automation"
  - id: oh-arch-l14-l31
    resource: "https://github.com/OpenHands/OpenHands/blob/61a3bd93e642a0ff4def73b29496a73245628209/docs/architecture.md#L14-L31"
    title: "Canvas not responsible for execution or sandbox; Agent Server primary"
  - id: oh-arch-l80-l82
    resource: "https://github.com/OpenHands/OpenHands/blob/61a3bd93e642a0ff4def73b29496a73245628209/docs/architecture.md#L80-L82"
    title: "Security posture: Docker sandbox and self-host hardening"
  - id: oh-acp-l8-l31
    resource: "https://github.com/OpenHands/OpenHands/blob/61a3bd93e642a0ff4def73b29496a73245628209/docs/ACP_AGENTS.md#L8-L31"
    title: "ACP subprocess relay; Agent Server owns credentials; agent per backend"
  - id: oh-selfhost-l7-l58
    resource: "https://github.com/OpenHands/OpenHands/blob/61a3bd93e642a0ff4def73b29496a73245628209/docs/SELF_HOSTING.md#L7-L58"
    title: "VM threat model; LOCAL_BACKEND_API_KEY and X-Session-API-Key"
  - id: oh-license-l1-l5
    resource: "https://github.com/OpenHands/OpenHands/blob/61a3bd93e642a0ff4def73b29496a73245628209/LICENSE#L1-L5"
    title: "MIT License"
---

# OpenHands (Agent Canvas)

- **Stack:** React/TypeScript Agent Canvas (`@openhands/agent-canvas`), optional
  Electron desktop, local ingress over Agent Server + automation backend.
  Execution, sandbox and wire contracts live in
  [`OpenHands/software-agent-sdk`](https://github.com/OpenHands/software-agent-sdk);
  scheduling/webhooks in [`OpenHands/automation`](https://github.com/OpenHands/automation).[^oh-agents-l26-l36][^oh-arch-l14-l31]
  Site: [openhands.dev](https://www.openhands.dev). **License:** MIT.[^oh-license-l1-l5]
  README status badge: beta.[^oh-readme-l14]

**Status:** Source and first-party docs inspection of the Canvas repository only;
nothing was run and the Agent Server / automation repos were not line-audited
here. Self-described developer control center: conversations and automations over
local, remote, Docker and optional OpenHands Cloud backends, with a built-in
OpenHands agent plus Claude Code, Codex, Gemini, Pi, OpenCode and other
ACP peers.[^oh-readme-l7-l10][^oh-readme-l33-l45] Neighbours:
[Omnigent](./omnigent.md), [Zeron](./zeron.md), [Paseo](./paseo.md),
[Emdash](./emdash.md). High confidence on the Canvas vs Agent Server ownership
split and ACP relay shape (docs and AGENTS.md agree); moderate on Cloud/Enterprise
internals; low on Agent Server durability without inspecting that repo.

**Study**

1. **UI meta-harness, separate executor plane.** Canvas renders conversation,
   terminal, files, settings and automations UI and translates actions into Agent
   Server API calls. It explicitly does not execute agent actions, provide
   sandbox isolation, hold provider credentials outside the backend, or run
   scheduled automations without the automation backend.[^oh-arch-l14-l31]
   Same ownership cut llame wants: Chat/Run authority vs peer executor.
2. **ACP peers as Agent Server subprocesses.** For external agents the Agent
   Server spawns the provider CLI over ACP JSON-RPC on stdio and relays turns;
   Canvas only records which agent to run and collects secrets forms. Agent
   choice is stored per backend.[^oh-acp-l8-l31] Direct pattern for llame ACP
   adapters: host owns subprocess + credentials, UI does not mint authority.
3. **Multi-backend placement is first-class.** One Canvas can switch among local,
   remote VM, Docker and Cloud Agent Server instances without changing the
   product surface.[^oh-readme-l33-l45] Useful vocabulary for future llame
   Workspace/node placement; identity must stay in llame, not in a backend
   switcher.
4. **Per-conversation Docker is not full isolation.**
   `OH_CONVERSATION_RUNTIME=docker` runs each new conversation in its own
   container with mounted workspace and state, but conversations that share a
   host workspace directory still share those files — docs tell operators to use
   separate directories or worktrees.[^oh-readme-l117-l120] Same worktree ≠
   sandbox honesty as the rest of this wave.
5. **Host install is full filesystem trust.** Non-sandbox quickstart warns that
   the agent-server has full access to the host filesystem.[^oh-readme-l66]
   Architecture recommends Docker sandbox for laptop use and ordinary server
   hardening for self-host.[^oh-arch-l80-l82]
6. **Self-host auth is a shared session API key.** Public mode requires
   `LOCAL_BACKEND_API_KEY` / `X-Session-API-Key`; anyone who can talk to the
   agent server has the machine's agent powers. Docs treat the VM like a
   production-credential host.[^oh-selfhost-l7-l58] Application secret, not
   Postgres RLS or owner-scoped Chat/Run.

**llame fit**

- High: items 1, 2 and 4 for ownership split, ACP subprocess relay and isolation
  honesty.
- Moderate: item 3 for multi-backend / remote placement UX.
- Low: item 6 as a tenancy model; useful negative example vs authenticated RLS.
- Avoid: treating Canvas conversation IDs or Agent Server sessions as llame
  Chat/Run identity, or importing shared-key self-host as multi-tenant auth.

**Caution:** This tree is the Canvas UI and local-stack launcher; durable agent
loop, events and sandbox code are upstream in software-agent-sdk.
Automations are another repository.[^oh-agents-l26-l36] Beta product surface;
vendor Cloud/Enterprise paths are optional and change the privacy story.

[^oh-readme-l7-l10]: [Self-hosted control center; ACP-compatible agents across backends](https://github.com/OpenHands/OpenHands/blob/61a3bd93e642a0ff4def73b29496a73245628209/README.md#L7-L10)

[^oh-readme-l14]: [Project status beta badge](https://github.com/OpenHands/OpenHands/blob/61a3bd93e642a0ff4def73b29496a73245628209/README.md#L14)

[^oh-readme-l33-l45]: [Multi-backend, automations, BYO model, ACP peers](https://github.com/OpenHands/OpenHands/blob/61a3bd93e642a0ff4def73b29496a73245628209/README.md#L33-L45)

[^oh-readme-l66]: [Host install gives agent full filesystem access](https://github.com/OpenHands/OpenHands/blob/61a3bd93e642a0ff4def73b29496a73245628209/README.md#L66)

[^oh-readme-l117-l120]: [Per-conversation Docker runtime; shared host workspace caveat](https://github.com/OpenHands/OpenHands/blob/61a3bd93e642a0ff4def73b29496a73245628209/README.md#L117-L120)

[^oh-agents-l26-l36]: [Repo split: Canvas UI vs Agent Server vs automation](https://github.com/OpenHands/OpenHands/blob/61a3bd93e642a0ff4def73b29496a73245628209/AGENTS.md#L26-L36)

[^oh-arch-l14-l31]: [Canvas not responsible for execution or sandbox; Agent Server primary](https://github.com/OpenHands/OpenHands/blob/61a3bd93e642a0ff4def73b29496a73245628209/docs/architecture.md#L14-L31)

[^oh-arch-l80-l82]: [Security posture: Docker sandbox and self-host hardening](https://github.com/OpenHands/OpenHands/blob/61a3bd93e642a0ff4def73b29496a73245628209/docs/architecture.md#L80-L82)

[^oh-acp-l8-l31]: [ACP subprocess relay; Agent Server owns credentials; agent per backend](https://github.com/OpenHands/OpenHands/blob/61a3bd93e642a0ff4def73b29496a73245628209/docs/ACP_AGENTS.md#L8-L31)

[^oh-selfhost-l7-l58]: [VM threat model; LOCAL_BACKEND_API_KEY and X-Session-API-Key](https://github.com/OpenHands/OpenHands/blob/61a3bd93e642a0ff4def73b29496a73245628209/docs/SELF_HOSTING.md#L7-L58)

[^oh-license-l1-l5]: [MIT License](https://github.com/OpenHands/OpenHands/blob/61a3bd93e642a0ff4def73b29496a73245628209/LICENSE#L1-L5)
