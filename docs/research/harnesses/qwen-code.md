---
type: Reference
title: "Qwen Code"
description: "Apache-2.0 peer coding agent (Gemini CLI / Codex CLI class): terminal loop with sandbox and approval modes, plus experimental qwen serve ACP daemon for multi-client sessions."
tags: [harness, peer-coding-agent, acp, daemon, sandbox, apache]
status: draft
resource: "https://github.com/QwenLM/qwen-code/tree/0ed9895ae9aaf7bcfdcaba734053bc32f370cf6c"
observed:
  date: "2026-10-17"
  revision: "0ed9895ae9aaf7bcfdcaba734053bc32f370cf6c"
sources:
  - id: qwen-readme-l10-l29
    resource: "https://github.com/QwenLM/qwen-code/blob/0ed9895ae9aaf7bcfdcaba734053bc32f370cf6c/README.md#L10-L29"
    title: "open-source coding agent; multi-protocol; multi-surface"
  - id: qwen-readme-l103-l107
    resource: "https://github.com/QwenLM/qwen-code/blob/0ed9895ae9aaf7bcfdcaba734053bc32f370cf6c/README.md#L103-L107"
    title: "headless, SDKs, qwen serve ACP daemon"
  - id: qwen-readme-l141-l156
    resource: "https://github.com/QwenLM/qwen-code/blob/0ed9895ae9aaf7bcfdcaba734053bc32f370cf6c/README.md#L141-L156"
    title: "capability table: sandbox, subagents, daemon mode"
  - id: qwen-license-l190-l197
    resource: "https://github.com/QwenLM/qwen-code/blob/0ed9895ae9aaf7bcfdcaba734053bc32f370cf6c/LICENSE#L190-L197"
    title: "Apache-2.0; Copyright 2025 Google LLC and Qwen"
  - id: qwen-bridge-l1-l20
    resource: "https://github.com/QwenLM/qwen-code/blob/0ed9895ae9aaf7bcfdcaba734053bc32f370cf6c/packages/acp-bridge/src/bridge.ts#L1-L20"
    title: "createAcpSessionBridge; Apache-2.0 SPDX"
  - id: qwen-approval-l7-l13
    resource: "https://github.com/QwenLM/qwen-code/blob/0ed9895ae9aaf7bcfdcaba734053bc32f370cf6c/packages/core/src/config/approval-mode.ts#L7-L13"
    title: "ApprovalMode including YOLO"
  - id: qwen-serve-l1-l17
    resource: "https://github.com/QwenLM/qwen-code/blob/0ed9895ae9aaf7bcfdcaba734053bc32f370cf6c/docs/users/qwen-serve.md#L1-L17"
    title: "daemon shares one ACP session; first-responder permissions"
  - id: qwen-serve-l37-l46
    resource: "https://github.com/QwenLM/qwen-code/blob/0ed9895ae9aaf7bcfdcaba734053bc32f370cf6c/docs/users/qwen-serve.md#L37-L46"
    title: "trusted loopback default; non-loopback requires bearer"
---

# Qwen Code

- **Stack:** TypeScript monorepo (`packages/core`, `packages/cli`,
  `packages/acp-bridge`, managed-agent-server, IDE/desktop/channel
  packages).[^qwen-readme-l10-l29] **License:** Apache License 2.0; appendix
  copyrights list Google LLC and Qwen (Gemini CLI lineage).[^qwen-license-l190-l197]
  Peer coding agent in the Gemini CLI / Codex CLI class — an executor llame can
  drive, not a meta-harness that owns Chat/Run.

**Status:** Source and documentation inspection only; nothing was run. Open-source
agentic coding CLI with subagents, MCP, sandbox, multi-provider APIs, headless
`-p`, SDKs, and experimental `qwen serve` HTTP+SSE (ACP) daemon.[^qwen-readme-l103-l107][^qwen-readme-l141-l156]
Neighbours: [Gemini CLI](./gemini-cli.md), [Codex CLI](./codex-cli.md),
[qwen-audio-agent](./qwen-audio-agent.md). High confidence llame should treat it
as a peer executor behind an ACP/CLI adapter.

**Study**

1. **Peer executor, not conversation authority.** The product is the agent loop
   and tools; Chat identity, lifecycle and RLS stay in llame. Drive it headless,
   via SDK, or as an ACP child — same role as Codex/Gemini
   CLIs.[^qwen-readme-l103-l107]
2. **ACP session bridge package.** `createAcpSessionBridge` builds an
   `AcpSessionBridge` from a session control plane and channel harness
   (`packages/acp-bridge`).[^qwen-bridge-l1-l20] Primary wire for a llame ACP
   adapter; keep Run correlation tokens on the llame side.
3. **`qwen serve` multi-client daemon (experimental).** Local HTTP daemon so IDE,
   web, CI and custom clients share one agent session over HTTP + SSE; reconnect
   via `Last-Event-ID`; first client to answer a permission prompt
   wins.[^qwen-serve-l1-l17] Useful for multi-surface peers; Stage 1 docs scope it
   to local/single-user style collaboration, not production multi-tenant.
4. **Trusted loopback vs bearer on non-loopback.** Default loopback needs no
   token and grants full API access including code execution as the daemon user;
   non-loopback binds require a bearer (generated or supplied) and fail closed on
   empty token sources.[^qwen-serve-l37-l46] Opposite of llame RLS — never expose
   this daemon as a tenant boundary.
5. **Approval mode ladder includes YOLO.** `plan` / `default` / `auto-edit` /
   `auto` / `yolo`.[^qwen-approval-l7-l13] Adapter must surface and constrain
   approval mode; never inherit YOLO from ambient env without an owner decision.
6. **Sandbox and worktrees advertised as product capabilities.** Capability table
   lists Auto Mode, Sandbox, Git Worktrees alongside SubAgents and Agent
   Teams.[^qwen-readme-l141-l156] Treat as peer-owned confinement; llame still
   enforces owner isolation independently.
7. **Channel surfaces are out of band.** Telegram/DingTalk/WeChat/Feishu and
   desktop/web shells attach to the same agent.[^qwen-readme-l10-l29] Do not mirror
   into llame Chat; optional future channel adapters stay outside Run identity.

**llame fit**

- High: items 1 to 3 and 5 for peer role, ACP bridge, daemon wire, approval
  modes.
- Moderate: item 6 for sandbox/worktree expectations on the peer.
- Low: item 7 for product surface breadth.
- Avoid: item 4 as a tenancy model; avoid making `qwen serve` the Chat store.

**Caution:** Apache-2.0 is permissive relative to Waku/Kandev copyleft, but the
daemon's loopback full-trust default is a footgun on shared hosts.[^qwen-serve-l37-l46]
Upstream evaluation scores are vendor-reported; not independently reproduced
here. Related voice frontend [qwen-audio-agent](./qwen-audio-agent.md) already
sits in this bundle as an ACP client of Qwen Code.

[^qwen-readme-l10-l29]: [open-source coding agent; multi-protocol; multi-surface](https://github.com/QwenLM/qwen-code/blob/0ed9895ae9aaf7bcfdcaba734053bc32f370cf6c/README.md#L10-L29)

[^qwen-readme-l103-l107]: [headless, SDKs, qwen serve ACP daemon](https://github.com/QwenLM/qwen-code/blob/0ed9895ae9aaf7bcfdcaba734053bc32f370cf6c/README.md#L103-L107)

[^qwen-readme-l141-l156]: [capability table: sandbox, subagents, daemon mode](https://github.com/QwenLM/qwen-code/blob/0ed9895ae9aaf7bcfdcaba734053bc32f370cf6c/README.md#L141-L156)

[^qwen-license-l190-l197]: [Apache-2.0; Copyright 2025 Google LLC and Qwen](https://github.com/QwenLM/qwen-code/blob/0ed9895ae9aaf7bcfdcaba734053bc32f370cf6c/LICENSE#L190-L197)

[^qwen-bridge-l1-l20]: [createAcpSessionBridge; Apache-2.0 SPDX](https://github.com/QwenLM/qwen-code/blob/0ed9895ae9aaf7bcfdcaba734053bc32f370cf6c/packages/acp-bridge/src/bridge.ts#L1-L20)

[^qwen-approval-l7-l13]: [ApprovalMode including YOLO](https://github.com/QwenLM/qwen-code/blob/0ed9895ae9aaf7bcfdcaba734053bc32f370cf6c/packages/core/src/config/approval-mode.ts#L7-L13)

[^qwen-serve-l1-l17]: [daemon shares one ACP session; first-responder permissions](https://github.com/QwenLM/qwen-code/blob/0ed9895ae9aaf7bcfdcaba734053bc32f370cf6c/docs/users/qwen-serve.md#L1-L17)

[^qwen-serve-l37-l46]: [trusted loopback default; non-loopback requires bearer](https://github.com/QwenLM/qwen-code/blob/0ed9895ae9aaf7bcfdcaba734053bc32f370cf6c/docs/users/qwen-serve.md#L37-L46)
