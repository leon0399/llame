---
type: Reference
title: "Emdash"
description: "Electron desktop meta-harness that runs coding-agent CLIs in parallel Git worktrees, with an ACP conversation runtime, host-authoritative workspace registry, and optional SSH remote hosts."
tags: [harness, peer-executor, acp, worktrees, desktop, local-first]
status: draft
resource: "https://github.com/generalaction/emdash/tree/761520624f1cafa740f5c88ddaf083b4fde2cc59"
generated:
  by: "cursor/composer"
  at: "2026-10-17"
observed:
  date: "2026-10-17"
  revision: "761520624f1cafa740f5c88ddaf083b4fde2cc59"
sources:
  - id: emdash-readme-l21-l40
    resource: "https://github.com/generalaction/emdash/blob/761520624f1cafa740f5c88ddaf083b4fde2cc59/README.md#L21-L40"
    title: "Parallel agents in Git worktrees; local and SSH projects"
  - id: emdash-readme-l51-l61
    resource: "https://github.com/generalaction/emdash/blob/761520624f1cafa740f5c88ddaf083b4fde2cc59/README.md#L51-L61"
    title: "Provider detection and user-level lifecycle hooks"
  - id: emdash-readme-l72-l80
    resource: "https://github.com/generalaction/emdash/blob/761520624f1cafa740f5c88ddaf083b4fde2cc59/README.md#L72-L80"
    title: "Local-first SQLite; no Emdash-hosted code or chats"
  - id: emdash-readme-l93-l95
    resource: "https://github.com/generalaction/emdash/blob/761520624f1cafa740f5c88ddaf083b4fde2cc59/README.md#L93-L95"
    title: "Apache-2.0 license pointer"
  - id: emdash-license-l1-l7
    resource: "https://github.com/generalaction/emdash/blob/761520624f1cafa740f5c88ddaf083b4fde2cc59/LICENSE.md#L1-L7"
    title: "Apache License 2.0 header; General Action copyright"
  - id: emdash-agents-l1-l6
    resource: "https://github.com/generalaction/emdash/blob/761520624f1cafa740f5c88ddaf083b4fde2cc59/AGENTS.md#L1-L6"
    title: "Desktop coordinates ACP chat, PTY, and worktree isolation"
  - id: emdash-agents-l185-l192
    resource: "https://github.com/generalaction/emdash/blob/761520624f1cafa740f5c88ddaf083b4fde2cc59/AGENTS.md#L185-L192"
    title: "PTY/TUI path versus structured ACP chat path"
  - id: emdash-acp-runtime-l7-l44
    resource: "https://github.com/generalaction/emdash/blob/761520624f1cafa740f5c88ddaf083b4fde2cc59/agents/architecture/acp-runtime.md#L7-L44"
    title: "AcpRuntime, SessionManager, ConversationHandle, process cache"
  - id: emdash-providers-l10-l32
    resource: "https://github.com/generalaction/emdash/blob/761520624f1cafa740f5c88ddaf083b4fde2cc59/agents/integrations/providers.md#L10-L32"
    title: "37 providers; 23 ACP-capable; no status inference from PTY"
  - id: emdash-providers-l44-l56
    resource: "https://github.com/generalaction/emdash/blob/761520624f1cafa740f5c88ddaf083b4fde2cc59/agents/integrations/providers.md#L44-L56"
    title: "Hooks install into user-global config, not task worktrees"
  - id: emdash-adr0001-l1-l25
    resource: "https://github.com/generalaction/emdash/blob/761520624f1cafa740f5c88ddaf083b4fde2cc59/docs/adr/0001-host-authoritative-workspaces.md#L1-L25"
    title: "Host-authoritative workspaces; guest not owner; positive-assertion scans"
  - id: emdash-adr0004-l1-l16
    resource: "https://github.com/generalaction/emdash/blob/761520624f1cafa740f5c88ddaf083b4fde2cc59/docs/adr/0004-cancellation-is-best-effort-across-planes.md#L1-L16"
    title: "Desktop cancel is best-effort; orphaned host effects may complete"
  - id: emdash-site
    resource: "https://emdash.com"
    title: "Emdash product site"
---

# Emdash

- **Stack:** pnpm/Nx monorepo; Electron desktop (`apps/emdash-desktop`),
  `workspace-server`, TypeScript packages (`@emdash/core`, plugins, chat-ui);
  SQLite via Drizzle; node-pty; ACP session runtime.[^emdash-agents-l1-l6][^emdash-readme-l72-l80]
  **License:** Apache-2.0. `LICENSE.md` is the standard Apache License text under
  Copyright 2026 General Action, Inc.; README badge and footer agree. No Commons
  Clause, BSL, or dual-license rider on the inspected file.[^emdash-license-l1-l7][^emdash-readme-l93-l95]

**Status:** Source and documentation inspection only; nothing was run. Desktop
meta-harness in llame's sense: it owns tasks, worktrees, and conversation
lifecycle while Claude Code, Codex, Cursor, OpenCode and peers stay provider
CLIs (ACP or PTY). Neighbours: [Orca](./orca.md), [Zeron](./zeron.md),
[Shipyard](./shipyard.md). High confidence on ACP/plugin and host-registry
contracts from in-repo ADRs; moderate on runtime durability without execution.

**Study**

1. **Peer CLIs in isolated worktrees.** Each task runs in its own Git worktree
   and branch; the desktop coordinates providers, ACP chat, terminals, issue/PR
   flows, and remote SSH hosts.[^emdash-readme-l21-l40][^emdash-agents-l1-l6]
   llame maps this to Workspace/checkout isolation around a peer executor, not
   a second Chat authority.
2. **ACP versus PTY execution paths.** Structured chat uses ACP: plugins expose
   provider ACP behavior, `packages/core` owns protocol/session state, and the
   desktop bridges status into `@emdash/chat-ui`. Legacy/TUI conversations stay
   on PTY services.[^emdash-agents-l185-l192] Capability flags must say which
   path a peer uses before a Run can claim deterministic completion.
3. **Conversation aggregate and process cache.** `AcpRuntime` wires the ACP
   API; `SessionManager` is the conversation directory; `ConversationHandle` is
   the aggregate root; connection identity includes provider, cwd, and an env
   fingerprint via `createResourceCache`.[^emdash-acp-runtime-l7-l44] Same
   split llame needs between Chat identity and executor process identity.
4. **Honest agent status.** Docs list 37 providers and 23 ACP-capable ones.
   Status comes from hooks/plugins or ACP session summaries; Emdash does not
   infer status from terminal output.[^emdash-providers-l10-l32] Hooks install
   into user-global provider config with an Emdash marker and no-op outside an
   Emdash session — never into the task worktree.[^emdash-readme-l51-l61][^emdash-providers-l44-l56]
5. **Host-authoritative workspaces.** The host filesystem is truth; the desktop
   keeps a registry that converges the record toward the world. Spec/status
   controllers were rejected because Emdash is a guest on the host. Failed or
   partial scans write nothing (positive-assertion invariant).[^emdash-adr0001-l1-l25]
6. **Best-effort cancellation across planes.** Desktop cancel means "stopped
   asking," not "no host effects." Orphaned host work may finish and re-enter
   through observation/adoption.[^emdash-adr0004-l1-l16] Applicable to any
   llame adapter that forwards cancel over an unreliable wire.

**llame fit**

- High: items 2 to 4 for ACP peer adapters and completion/status honesty.
- Moderate: items 1 and 5 for worktree/Workspace isolation and host truth.
- Low: item 6 alone; llame already owns Run cancel semantics in Postgres.
- Avoid: treating Emdash SQLite tasks or ACP conversation handles as Chat/Run
  identity. Peers remain executors; RLS stays in llame.

**Caution:** Local-first SQLite has no llame-style tenant RLS boundary; agent
CLIs still send code to their providers.[^emdash-readme-l72-l80] Global hook
installs mutate the owner's user-level agent config on every machine that runs
Emdash.[^emdash-providers-l44-l56] Product marketing also lives at
[emdash.com](https://emdash.com); the inspected README links `emdash.sh`.[^emdash-site]

[^emdash-readme-l21-l40]: [Parallel agents in Git worktrees; local and SSH projects](https://github.com/generalaction/emdash/blob/761520624f1cafa740f5c88ddaf083b4fde2cc59/README.md#L21-L40)

[^emdash-readme-l51-l61]: [Provider detection and user-level lifecycle hooks](https://github.com/generalaction/emdash/blob/761520624f1cafa740f5c88ddaf083b4fde2cc59/README.md#L51-L61)

[^emdash-readme-l72-l80]: [Local-first SQLite; no Emdash-hosted code or chats](https://github.com/generalaction/emdash/blob/761520624f1cafa740f5c88ddaf083b4fde2cc59/README.md#L72-L80)

[^emdash-readme-l93-l95]: [Apache-2.0 license pointer](https://github.com/generalaction/emdash/blob/761520624f1cafa740f5c88ddaf083b4fde2cc59/README.md#L93-L95)

[^emdash-license-l1-l7]: [Apache License 2.0 header; General Action copyright](https://github.com/generalaction/emdash/blob/761520624f1cafa740f5c88ddaf083b4fde2cc59/LICENSE.md#L1-L7)

[^emdash-agents-l1-l6]: [Desktop coordinates ACP chat, PTY, and worktree isolation](https://github.com/generalaction/emdash/blob/761520624f1cafa740f5c88ddaf083b4fde2cc59/AGENTS.md#L1-L6)

[^emdash-agents-l185-l192]: [PTY/TUI path versus structured ACP chat path](https://github.com/generalaction/emdash/blob/761520624f1cafa740f5c88ddaf083b4fde2cc59/AGENTS.md#L185-L192)

[^emdash-acp-runtime-l7-l44]: [AcpRuntime, SessionManager, ConversationHandle, process cache](https://github.com/generalaction/emdash/blob/761520624f1cafa740f5c88ddaf083b4fde2cc59/agents/architecture/acp-runtime.md#L7-L44)

[^emdash-providers-l10-l32]: [37 providers; 23 ACP-capable; no status inference from PTY](https://github.com/generalaction/emdash/blob/761520624f1cafa740f5c88ddaf083b4fde2cc59/agents/integrations/providers.md#L10-L32)

[^emdash-providers-l44-l56]: [Hooks install into user-global config, not task worktrees](https://github.com/generalaction/emdash/blob/761520624f1cafa740f5c88ddaf083b4fde2cc59/agents/integrations/providers.md#L44-L56)

[^emdash-adr0001-l1-l25]: [Host-authoritative workspaces; guest not owner; positive-assertion scans](https://github.com/generalaction/emdash/blob/761520624f1cafa740f5c88ddaf083b4fde2cc59/docs/adr/0001-host-authoritative-workspaces.md#L1-L25)

[^emdash-adr0004-l1-l16]: [Desktop cancel is best-effort; orphaned host effects may complete](https://github.com/generalaction/emdash/blob/761520624f1cafa740f5c88ddaf083b4fde2cc59/docs/adr/0004-cancellation-is-best-effort-across-planes.md#L1-L16)

[^emdash-site]: [Emdash product site](https://emdash.com)
