---
type: Reference
title: "Ghostex"
description: "Cross-platform GPUI workarea that hosts peer coding-agent CLIs in durable session daemons, with a shared gxserver chat brain, prompt queue, and orchestrator/thread model."
tags: [harness, peer-executor, desktop, session-daemon, prompt-queue, mobile]
status: draft
resource: "https://github.com/maddada/Ghostex/tree/4c6d52d506966b74c91dfed8fafd05fb80cc0014"
observed:
  date: "2026-10-17"
  revision: "4c6d52d506966b74c91dfed8fafd05fb80cc0014"
sources:
  - id: ghostex-readme-l51-l51
    resource: "https://github.com/maddada/Ghostex/blob/4c6d52d506966b74c91dfed8fafd05fb80cc0014/README.md#L51"
    title: "multi-agent workspace; sessions survive restarts"
  - id: ghostex-readme-l63-l73
    resource: "https://github.com/maddada/Ghostex/blob/4c6d52d506966b74c91dfed8fafd05fb80cc0014/README.md#L63-L73"
    title: "chat/CLI views and mid-task agent swap"
  - id: ghostex-readme-l95-l113
    resource: "https://github.com/maddada/Ghostex/blob/4c6d52d506966b74c91dfed8fafd05fb80cc0014/README.md#L95-L113"
    title: "agents that run agents; Tab prompt queue"
  - id: ghostex-readme-l130
    resource: "https://github.com/maddada/Ghostex/blob/4c6d52d506966b74c91dfed8fafd05fb80cc0014/README.md#L130"
    title: "Remote machines via Easy Connect or SSH in the sidebar"
  - id: ghostex-agents-l5-l15
    resource: "https://github.com/maddada/Ghostex/blob/4c6d52d506966b74c91dfed8fafd05fb80cc0014/AGENTS.md#L5-L15"
    title: "gxserver owns sessions; chat-core is the only chat brain"
  - id: ghostex-agents-l123-l129
    resource: "https://github.com/maddada/Ghostex/blob/4c6d52d506966b74c91dfed8fafd05fb80cc0014/AGENTS.md#L123-L129"
    title: "zmx/wmx session daemons and wire-generation kill cost"
  - id: ghostex-terms-l5-l6
    resource: "https://github.com/maddada/Ghostex/blob/4c6d52d506966b74c91dfed8fafd05fb80cc0014/TERMS.md#L5-L6"
    title: "orchestrator versus thread vocabulary"
  - id: ghostex-license-l1-l7
    resource: "https://github.com/maddada/Ghostex/blob/4c6d52d506966b74c91dfed8fafd05fb80cc0014/LICENSE#L1-L7"
    title: "MIT-shaped grant without SPDX MIT header"
---

# Ghostex

- **Stack:** Rust gxserver + GPUI desktop, zmx/wmx session daemons, UniFFI mobile
  chat; Bun tooling for release.[^ghostex-agents-l5-l15] **License:** MIT-shaped
  permission grant (copyright + standard MIT body; no SPDX `MIT` header in
  `LICENSE`).[^ghostex-license-l1-l7] Site: [ghostex.dev](https://ghostex.dev).

**Status:** Source and documentation inspection only; nothing was run. A
desktop meta-harness for peer coding agents: Claude Code, Codex, OpenCode, Pi,
Gemini, Grok, Cursor and others run as sessions under one workspace, with chat
and raw CLI views.[^ghostex-readme-l51-l51][^ghostex-readme-l63-l73] Closest
neighbours in this bundle are [Zeron](./zeron.md), [Shipyard](./shipyard.md) and
[Orca](./orca.md). High confidence it is an executor host, not an agent loop.
llame should keep Chat/Run and RLS; study Ghostex for session durability and
operator UX around peers.

**Study**

1. **Server owns the session; UIs are clients.** Agent session lifecycle,
   terminal I/O, hooks, transcripts, git/worktrees and CLI verbs live in
   `gxserver`; `gx-chat-core` is the only chat brain for desktop, web and
   phone.[^ghostex-agents-l5-l15] Same split llame wants: transport-neutral Run
   execution behind thin surfaces.
2. **Session daemons outlive the window.** POSIX zmx and Windows wmx keep agents
   running across gxserver restarts (~2 s reconnect gap when only gxserver is
   replaced). Wire-generation bumps kill every live daemon of a mismatched
   generation and therefore kill in-flight agents — intentional and
   costly.[^ghostex-agents-l123-l129] llame's peer adapter needs an explicit
   "protocol bump destroys Run" cost model.
3. **Orchestrator / thread vocabulary.** An orchestrator plans a stream of work;
   a thread is a child agent session whose final message is the report back.
   Stored API still says `coordinator`.[^ghostex-terms-l5-l6] Useful naming for
   future child Runs; do not import Ghostex's session IDs as Chat identity.
4. **Prompt queue while busy.** Tab queues a follow-up above the input until the
   agent is free; play interrupts and delivers immediately.[^ghostex-readme-l95-l113]
   Same operator need as Waku/Zeron steer-or-queue; map to llame queued prompts
   on an active Run, not a second transcript authority.
5. **Agents that run agents via host CLI.** Peers open sessions and send prompts
   through the `ghostex` command rather than inventing a second protocol inside
   the model.[^ghostex-readme-l95-l113] Pattern for host-owned child execution
   surfaces; keep authorization in llame.
6. **Mid-task agent swap.** Model/effort and even agent handoff from the chat
   box.[^ghostex-readme-l63-l73] llame may want Run-level executor rebinding; the
   Chat stays the same.
7. **Remote machines in the sidebar.** Another computer joins via Easy Connect
   code or SSH and appears as a placement target.[^ghostex-readme-l130]
   Multi-host execution surface; still owner-device trust, not tenant RLS.

**llame fit**

- High: items 1 and 2 for peer-host vs UI ownership and daemon lifecycle costs.
- Moderate: items 3 to 5 and 7 for child Runs, prompt queue, host CLI, and
  multi-machine placement.
- Low: item 6 alone; product polish, not isolation.
- Avoid: treating Ghostex session/transcript storage as Chat authority, or
  copying its personal-device trust model into multi-tenant RLS.

**Caution:** No inspected tenant/RLS boundary; Easy Connect / Tailscale mobile
pairing and remote-machine enrollment assume personal devices. Wire-generation
cycling destroys running agents by design.[^ghostex-agents-l123-l129]

[^ghostex-readme-l51-l51]: [multi-agent workspace; sessions survive restarts](https://github.com/maddada/Ghostex/blob/4c6d52d506966b74c91dfed8fafd05fb80cc0014/README.md#L51)

[^ghostex-readme-l63-l73]: [chat/CLI views and mid-task agent swap](https://github.com/maddada/Ghostex/blob/4c6d52d506966b74c91dfed8fafd05fb80cc0014/README.md#L63-L73)

[^ghostex-readme-l95-l113]: [agents that run agents; Tab prompt queue](https://github.com/maddada/Ghostex/blob/4c6d52d506966b74c91dfed8fafd05fb80cc0014/README.md#L95-L113)

[^ghostex-readme-l130]: [Remote machines via Easy Connect or SSH in the sidebar](https://github.com/maddada/Ghostex/blob/4c6d52d506966b74c91dfed8fafd05fb80cc0014/README.md#L130)

[^ghostex-agents-l5-l15]: [gxserver owns sessions; chat-core is the only chat brain](https://github.com/maddada/Ghostex/blob/4c6d52d506966b74c91dfed8fafd05fb80cc0014/AGENTS.md#L5-L15)

[^ghostex-agents-l123-l129]: [zmx/wmx session daemons and wire-generation kill cost](https://github.com/maddada/Ghostex/blob/4c6d52d506966b74c91dfed8fafd05fb80cc0014/AGENTS.md#L123-L129)

[^ghostex-terms-l5-l6]: [orchestrator versus thread vocabulary](https://github.com/maddada/Ghostex/blob/4c6d52d506966b74c91dfed8fafd05fb80cc0014/TERMS.md#L5-L6)

[^ghostex-license-l1-l7]: [MIT-shaped grant without SPDX MIT header](https://github.com/maddada/Ghostex/blob/4c6d52d506966b74c91dfed8fafd05fb80cc0014/LICENSE#L1-L7)
