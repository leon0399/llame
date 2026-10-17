---
type: Reference
title: "Jean"
description: "Tauri/Rust AI agent workspace that runs peer CLIs in parallel git worktrees, with a headless jean-server, per-backend permission mapping, and experimental background agents."
tags: [harness, peer-executor, worktrees, desktop, headless-server, permissions]
status: draft
resource: "https://github.com/coollabsio/jean/tree/b766f894c9f66405681161cfda4c4f85473b4204"
generated:
  by: "cursor/composer"
  at: "2026-10-17"
observed:
  date: "2026-10-17"
  revision: "b766f894c9f66405681161cfda4c4f85473b4204"
sources:
  - id: jean-readme-l5-l17
    resource: "https://github.com/coollabsio/jean/blob/b766f894c9f66405681161cfda4c4f85473b4204/README.md#L5-L17"
    title: "Parallel peer CLIs in worktrees; desktop and jean-server"
  - id: jean-readme-l42-l50
    resource: "https://github.com/coollabsio/jean/blob/b766f894c9f66405681161cfda4c4f85473b4204/README.md#L42-L50"
    title: "Sessions, backends, local plus multi-server remote"
  - id: jean-package-license
    resource: "https://github.com/coollabsio/jean/blob/b766f894c9f66405681161cfda4c4f85473b4204/package.json#L1-L12"
    title: "package.json license Apache-2.0"
  - id: jean-license-l1-l4
    resource: "https://github.com/coollabsio/jean/blob/b766f894c9f66405681161cfda4c4f85473b4204/LICENSE.md#L1-L4"
    title: "Apache License 2.0 text"
  - id: jean-headless-l1-l7
    resource: "https://github.com/coollabsio/jean/blob/b766f894c9f66405681161cfda4c4f85473b4204/docs/headless-server.md#L1-L7"
    title: "jean-core owns state; src-server is the headless adapter"
  - id: jean-server-arch-l5-l18
    resource: "https://github.com/coollabsio/jean/blob/b766f894c9f66405681161cfda4c4f85473b4204/docs/developer/server-architecture.md#L5-L18"
    title: "jean-core, src-server, src-tauri split"
  - id: jean-server-arch-l134-l150
    resource: "https://github.com/coollabsio/jean/blob/b766f894c9f66405681161cfda4c4f85473b4204/docs/developer/server-architecture.md#L134-L150"
    title: "Multi-server client; resource identity is serverId plus resourceId"
  - id: jean-agents-backend-l420-l431
    resource: "https://github.com/coollabsio/jean/blob/b766f894c9f66405681161cfda4c4f85473b4204/AGENTS.md#L420-L431"
    title: "Backend capability classification checklist"
  - id: jean-permissions-l1-l37
    resource: "https://github.com/coollabsio/jean/blob/b766f894c9f66405681161cfda4c4f85473b4204/docs/developer/permissions.md#L1-L37"
    title: "Plan/Build wire modes; unsupported policies must not become Full access"
  - id: jean-permissions-l41-l49
    resource: "https://github.com/coollabsio/jean/blob/b766f894c9f66405681161cfda4c4f85473b4204/docs/developer/permissions.md#L41-L49"
    title: "ACP approval bridge fail-closed timeout and Allow-once"
  - id: jean-agents-feature-l1-l20
    resource: "https://github.com/coollabsio/jean/blob/b766f894c9f66405681161cfda4c4f85473b4204/docs/developer/agents.md#L1-L20"
    title: "Experimental agents; delegations table and status vocabulary"
  - id: jean-site
    resource: "https://jean.build"
    title: "Jean product site"
---

# Jean

- **Stack:** Tauri v2 desktop, React/TypeScript UI, Rust `jean-core` and
  `src-server` (Axum/Tokio headless); Bun tooling; SQLite for experimental
  agents.[^jean-readme-l5-l17][^jean-headless-l1-l7]
  **License:** Apache-2.0 (`package.json` and `LICENSE.md`).[^jean-package-license][^jean-license-l1-l4]

**Status:** Source and documentation inspection only; nothing was run. Opinionated
agent workspace: every task gets a git worktree, peer CLIs run in parallel, and
the same `jean-core` serves desktop or headless `jean-server`.[^jean-readme-l5-l17]
Neighbours: [Emdash](./emdash.md), [Orca](./orca.md), [bb](./bb.md). High
confidence on documented permission and server-boundary contracts; moderate on
background-agent durability (feature default off).

**Study**

1. **Worktree-scoped peer sessions.** Jean runs Claude, Codex, Cursor, OpenCode,
   Pi, Command Code, Grok, Kimi Code, and Antigravity each in its own worktree,
   with multiple sessions per worktree and Plan/Build/Yolo execution
   modes.[^jean-readme-l5-l17][^jean-readme-l42-l50] llame keeps Chat/Run; Jean
   is a checklist for executor cwd isolation and mode labels.
2. **Shared core, thin runtimes.** `jean-core` owns runtime context, typed
   state, events, domains, dispatcher, and Axum; `src-server` bootstraps the
   headless process; `src-tauri` is the desktop adapter.[^jean-server-arch-l5-l18][^jean-headless-l1-l7]
   Matches llame's transport-neutral execution behind HTTP/workers.
3. **Multi-server resource identity.** The native client keeps independent
   connections to several Jean servers; client-wide identity is
   `(serverId, resourceId)` with reserved `local`. Browser Web Access stays
   single-origin.[^jean-server-arch-l134-l150] Useful when llame later addresses
   remote executor hosts without collapsing tenant scope into path strings.
4. **Backend capability checklist.** New backends must classify transport
   (persistent server, streaming CLI, final-output CLI, helper), document
   streaming/resume/cancel/approvals/MCP flags, and refuse fake resume when the
   peer has no session id.[^jean-agents-backend-l420-l431] Directly reusable for
   llame ACP/A2A adapter admission.
5. **Permission policies fail closed.** Wire values `plan` / `supervised` /
   `build` / `auto` / `yolo` map to workflow plus permission policy. Unsupported
   restricted policies must not become Full access; IPC/MCP sends
   reject them.[^jean-permissions-l1-l37] Grok/Kimi ACP approvals fail closed on
   cancel, missing context, missing options, or a ten-minute
   timeout; Jean offers Allow once and Reject, not broad remembered
   grants.[^jean-permissions-l41-l49]
6. **Experimental background agents.** Opt-in agents use SQLite `delegations`
   (`active` / `waiting` / `done` / `failed` / `cancelled`) and keep working with
   no client open.[^jean-agents-feature-l1-l20] Study the correlation shape;
   do not import a second agent identity next to llame Chat/Run.

**llame fit**

- High: items 4 and 5 as adapter admission and approval-mapping checklists.
- Moderate: items 2 and 3 for headless core versus thin desktop/server shells.
- Low: item 1 alone; worktree UX is product, not Chat authority.
- Avoid: Jean session/worktree IDs or experimental `agents.db` as tenant or Run
  identity. Peers stay executors; RLS stays in llame.

**Caution:** Full access is the default for new sessions; old sessions without
`selected_execution_mode` load as Plan so defaults do not silently
escalate.[^jean-permissions-l1-l37] Headless/Web Access token auth is operator
procedure, not datastore isolation. Product site: [jean.build](https://jean.build).[^jean-site]

[^jean-readme-l5-l17]: [Parallel peer CLIs in worktrees; desktop and jean-server](https://github.com/coollabsio/jean/blob/b766f894c9f66405681161cfda4c4f85473b4204/README.md#L5-L17)

[^jean-readme-l42-l50]: [Sessions, backends, local plus multi-server remote](https://github.com/coollabsio/jean/blob/b766f894c9f66405681161cfda4c4f85473b4204/README.md#L42-L50)

[^jean-package-license]: [package.json license Apache-2.0](https://github.com/coollabsio/jean/blob/b766f894c9f66405681161cfda4c4f85473b4204/package.json#L1-L12)

[^jean-license-l1-l4]: [Apache License 2.0 text](https://github.com/coollabsio/jean/blob/b766f894c9f66405681161cfda4c4f85473b4204/LICENSE.md#L1-L4)

[^jean-headless-l1-l7]: [jean-core owns state; src-server is the headless adapter](https://github.com/coollabsio/jean/blob/b766f894c9f66405681161cfda4c4f85473b4204/docs/headless-server.md#L1-L7)

[^jean-server-arch-l5-l18]: [jean-core, src-server, src-tauri split](https://github.com/coollabsio/jean/blob/b766f894c9f66405681161cfda4c4f85473b4204/docs/developer/server-architecture.md#L5-L18)

[^jean-server-arch-l134-l150]: [Multi-server client; resource identity is serverId plus resourceId](https://github.com/coollabsio/jean/blob/b766f894c9f66405681161cfda4c4f85473b4204/docs/developer/server-architecture.md#L134-L150)

[^jean-agents-backend-l420-l431]: [Backend capability classification checklist](https://github.com/coollabsio/jean/blob/b766f894c9f66405681161cfda4c4f85473b4204/AGENTS.md#L420-L431)

[^jean-permissions-l1-l37]: [Plan/Build wire modes; unsupported policies must not become Full access](https://github.com/coollabsio/jean/blob/b766f894c9f66405681161cfda4c4f85473b4204/docs/developer/permissions.md#L1-L37)

[^jean-permissions-l41-l49]: [ACP approval bridge fail-closed timeout and Allow-once](https://github.com/coollabsio/jean/blob/b766f894c9f66405681161cfda4c4f85473b4204/docs/developer/permissions.md#L41-L49)

[^jean-agents-feature-l1-l20]: [Experimental agents; delegations table and status vocabulary](https://github.com/coollabsio/jean/blob/b766f894c9f66405681161cfda4c4f85473b4204/docs/developer/agents.md#L1-L20)

[^jean-site]: [Jean product site](https://jean.build)
