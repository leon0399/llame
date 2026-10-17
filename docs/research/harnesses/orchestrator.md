---
type: Reference
title: "Orchestrator.inc"
description: "Local desktop and Go daemon that run parallel coding-agent workers in Git worktrees, derive board status from durable facts, and attach PR/CI lifecycle to each session."
tags: [harness, worktrees, daemon, acp, pr-lifecycle, peer-executor]
status: draft
resource: "https://github.com/Untrivial-ai/agent-orchestrator/tree/edf0bfaacbf63f3df693dcb88f72e9a1d7168480"
generated:
  by: "cursor/composer"
  at: "2026-10-17"
observed:
  date: "2026-10-17"
  revision: "edf0bfaacbf63f3df693dcb88f72e9a1d7168480"
sources:
  - id: ao-readme-l29-l35
    resource: "https://github.com/Untrivial-ai/agent-orchestrator/blob/edf0bfaacbf63f3df693dcb88f72e9a1d7168480/README.md#L29-L35"
    title: "Desktop workspace, per-worker worktree, local daemon"
  - id: ao-readme-l88-l96
    resource: "https://github.com/Untrivial-ai/agent-orchestrator/blob/edf0bfaacbf63f3df693dcb88f72e9a1d7168480/README.md#L88-L96"
    title: "Idea-to-merge workflow; agents keep native strengths"
  - id: ao-arch-l1-l19
    resource: "https://github.com/Untrivial-ai/agent-orchestrator/blob/edf0bfaacbf63f3df693dcb88f72e9a1d7168480/docs/architecture.md#L1-L19"
    title: "Go daemon; TUI vs Chat; ACP detached hosts"
  - id: ao-arch-l49-l80
    resource: "https://github.com/Untrivial-ai/agent-orchestrator/blob/edf0bfaacbf63f3df693dcb88f72e9a1d7168480/docs/architecture.md#L49-L80"
    title: "Display status derived; durable facts; Chat hibernation"
  - id: ao-arch-l84-l127
    resource: "https://github.com/Untrivial-ai/agent-orchestrator/blob/edf0bfaacbf63f3df693dcb88f72e9a1d7168480/docs/architecture.md#L84-L127"
    title: "Electron/mobile over loopback HTTP; SQLite; adapters"
  - id: ao-license-l1-l4
    resource: "https://github.com/Untrivial-ai/agent-orchestrator/blob/edf0bfaacbf63f3df693dcb88f72e9a1d7168480/LICENSE#L1-L4"
    title: "Apache License 2.0"
---

# Orchestrator.inc

- **Stack:** Go daemon, Electron + React desktop, Expo mobile, SQLite, loopback
  HTTP/SSE and WebSocket terminals.[^ao-arch-l84-l127] Site:
  [orchestrator.inc](https://orchestrator.inc). Checkout remote
  `Untrivial-ai/agent-orchestrator` (README badges also name
  `OrchestratorInc/agent-orchestrator`). **License:** Apache-2.0.[^ao-license-l1-l4]

**Status:** Source and architecture-doc inspection only; nothing was run. Open
desktop ADE that supervises coding-agent workers with per-session worktrees and
a Kanban derived from session, PR, CI and review facts.[^ao-readme-l29-l35] Closest
open peer for **PR/CI-attached worker lifecycle** with derived board
status. High confidence on the observe/update/derive contract from
`docs/architecture.md`; moderate on runtime numbers (hibernation leases) without
executed tests.

**Study**

1. **Durable facts, derived display.** Display columns such as `working`,
   `needs_input`, `ci_failed` and `mergeable` are computed at read time from
   durable activity, hibernation, termination and PR facts. Display status is
   never stored.[^ao-arch-l49-l80] Useful pattern for llame Run projections that
   must not invent a second authority beside persisted events.
2. **ACP Chat hosts survive daemon replace.** Codex and ACP Chat processes run
   in detached per-session hosts so replacing the daemon or desktop does not
   stop an in-flight turn; connection setup, JSON-RPC correlation, pending
   interactions and acknowledged prompt replay are preserved while the
   replacement rebuilds its typed controller.[^ao-arch-l1-l19] Directly
   applicable to llame peer-adapter process ownership across worker restarts.
3. **One interface mode at a time.** A session is either TUI (PTY/ConPTY, tmux
   fallback) or Chat (native protocol, no agent terminal). A durable handoff can
   move a compatible conversation between modes, but both controllers are never
   live at once. Automation must never inject input into a blocked
   session.[^ao-arch-l1-l19][^ao-arch-l49-l80]
4. **Worktree and branchless workspaces.** Project sessions own isolated Git
   worktrees; projectless standalone workers own AO-managed plain
   directories.[^ao-arch-l1-l19][^ao-readme-l88-l96] Worktree isolation is
   collision avoidance, not OS sandboxing.
5. **Chat hibernation boundary.** Idle Chat provider hosts can hibernate and
   resume only after a settled primary turn with no pending approval or
   unconfirmed outcome; waiting/blocked turns never hibernate. The Chat view
   renews a short lease; hibernation is a process boundary, not a display
   status.[^ao-arch-l49-l80] Compare with llame Run attempt lifecycle rather than
   copying the lease numbers.
6. **Clients are viewports.** Electron, Expo and `ao` CLI speak REST/SSE to a
   loopback HTTP daemon; persistence is SQLite with CDC broadcast.[^ao-arch-l84-l127]
   Same daemon-owns-authority split as llame API/workers vs thin web.

**llame fit**

- High: items 1 to 3 for Run projection and ACP process ownership.
- Moderate: items 4 and 5 for Workspace isolation and idle peer process policy.
- Low: item 6 as storage topology; llame already persists in Postgres with RLS.
- Avoid: Electron/SQLite local daemon as Chat authority next to owner-scoped
  `messages.parts`.

**Caution:** Local-first single-machine trust model. Mobile pairs over
authenticated LAN REST/SSE; execution stays on the desktop host.[^ao-arch-l84-l127]
No llame-style multi-tenant RLS boundary. Product marketing treats agents as
executors under one supervisor — that vocabulary transfers; the local SQLite
session store does not.[^ao-readme-l88-l96]

[^ao-readme-l29-l35]: [Desktop workspace, per-worker worktree, local daemon](https://github.com/Untrivial-ai/agent-orchestrator/blob/edf0bfaacbf63f3df693dcb88f72e9a1d7168480/README.md#L29-L35)

[^ao-readme-l88-l96]: [Idea-to-merge workflow; agents keep native strengths](https://github.com/Untrivial-ai/agent-orchestrator/blob/edf0bfaacbf63f3df693dcb88f72e9a1d7168480/README.md#L88-L96)

[^ao-arch-l1-l19]: [Go daemon; TUI vs Chat; ACP detached hosts](https://github.com/Untrivial-ai/agent-orchestrator/blob/edf0bfaacbf63f3df693dcb88f72e9a1d7168480/docs/architecture.md#L1-L19)

[^ao-arch-l49-l80]: [Display status derived; durable facts; Chat hibernation](https://github.com/Untrivial-ai/agent-orchestrator/blob/edf0bfaacbf63f3df693dcb88f72e9a1d7168480/docs/architecture.md#L49-L80)

[^ao-arch-l84-l127]: [Electron/mobile over loopback HTTP; SQLite; adapters](https://github.com/Untrivial-ai/agent-orchestrator/blob/edf0bfaacbf63f3df693dcb88f72e9a1d7168480/docs/architecture.md#L84-L127)

[^ao-license-l1-l4]: [Apache License 2.0](https://github.com/Untrivial-ai/agent-orchestrator/blob/edf0bfaacbf63f3df693dcb88f72e9a1d7168480/LICENSE#L1-L4)
