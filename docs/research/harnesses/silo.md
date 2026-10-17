---
type: Reference
title: "Silo"
description: "MIT-licensed Tauri multi-workspace desktop shell with a types-first extension SDK, host-owned persistent PTY sessions, and ACP chat that resurrects session identity without keeping the agent process alive across quit."
tags: [harness, desktop, extensions, pty, acp, multi-workspace]
status: draft
resource: "https://github.com/silo-code/silo/tree/2c2378a869ac1c7927188c8722c0d3bc1035dac4"
generated:
  by: "cursor/composer"
  at: "2026-10-17"
observed:
  date: "2026-10-17"
  revision: "2c2378a869ac1c7927188c8722c0d3bc1035dac4"
sources:
  - id: silo-readme-l1-l20
    resource: "https://github.com/silo-code/silo/blob/2c2378a869ac1c7927188c8722c0d3bc1035dac4/README.md#L1-L20"
    title: "Multi-workspace local-first shell; MIT; no account"
  - id: silo-readme-l72-l83
    resource: "https://github.com/silo-code/silo/blob/2c2378a869ac1c7927188c8722c0d3bc1035dac4/README.md#L72-L83"
    title: "Persistent tabs, terminals, extension SDK"
  - id: silo-readme-l172-l174
    resource: "https://github.com/silo-code/silo/blob/2c2378a869ac1c7927188c8722c0d3bc1035dac4/README.md#L172-L174"
    title: "MIT license footer"
  - id: silo-license-l1-l10
    resource: "https://github.com/silo-code/silo/blob/2c2378a869ac1c7927188c8722c0d3bc1035dac4/LICENSE#L1-L10"
    title: "MIT license text"
  - id: silo-arch-l22-l31
    resource: "https://github.com/silo-code/silo/blob/2c2378a869ac1c7927188c8722c0d3bc1035dac4/docs/architecture.md#L22-L31"
    title: "Rust host plus webview workbench; extensions through ctx"
  - id: silo-arch-l55-l73
    resource: "https://github.com/silo-code/silo/blob/2c2378a869ac1c7927188c8722c0d3bc1035dac4/docs/architecture.md#L55-L73"
    title: "extensions-silo depends on sdk only; package-graph enforcement"
  - id: silo-arch-l97-l115
    resource: "https://github.com/silo-code/silo/blob/2c2378a869ac1c7927188c8722c0d3bc1035dac4/docs/architecture.md#L97-L115"
    title: "Session hosts outlive disposable webview"
  - id: silo-adr0010-l8-l43
    resource: "https://github.com/silo-code/silo/blob/2c2378a869ac1c7927188c8722c0d3bc1035dac4/docs/decisions/0010-persistent-process-sessions.md#L8-L43"
    title: "ctx.process persistent PTY sessions plus one-shot exec"
  - id: silo-adr0015-l17-l35
    resource: "https://github.com/silo-code/silo/blob/2c2378a869ac1c7927188c8722c0d3bc1035dac4/docs/decisions/0015-phased-security-model.md#L17-L35"
    title: "Phased security; sandbox not started; permission prompt is not containment"
  - id: silo-adr0013-l17-l30
    resource: "https://github.com/silo-code/silo/blob/2c2378a869ac1c7927188c8722c0d3bc1035dac4/docs/decisions/0013-trust-tiers-two-barrel-sdk.md#L17-L30"
    title: "core.* versus silo.* versus third-party trust tiers"
  - id: silo-adr0052-l8-l40
    resource: "https://github.com/silo-code/silo/blob/2c2378a869ac1c7927188c8722c0d3bc1035dac4/docs/decisions/0052-chat-session-resurrection.md#L8-L40"
    title: "ACP chat: session resurrects; in-flight process does not"
  - id: silo-adr0028-l14-l32
    resource: "https://github.com/silo-code/silo/blob/2c2378a869ac1c7927188c8722c0d3bc1035dac4/docs/decisions/0028-sealed-agent-detection.md#L14-L32"
    title: "Sealed agent detection; no silent session-id inference"
  - id: silo-site
    resource: "https://getsilo.dev"
    title: "Silo product site"
---

# Silo

- **Stack:** pnpm/Turbo monorepo; Tauri desktop (`apps/desktop`), React workbench,
  Rust session/PTY hosts (`crates/pty-host`), published `@silo-code/sdk`.[^silo-arch-l22-l31][^silo-readme-l72-l83]
  **License:** MIT.[^silo-license-l1-l10][^silo-readme-l172-l174]

**Status:** Source and documentation inspection only; nothing was run. Multi-workspace
desktop shell for developers juggling coding agents: persistent project tabs,
host-owned terminals, and an extension SDK — closer to an IDE host than to
llame's Chat/Run control plane.[^silo-readme-l1-l20] Neighbours: [Orca](./orca.md),
[AgentOne](./agent-one.md). High confidence on ADRs for process and ACP session
boundaries; moderate on marketplace security claims.

**Study**

1. **Disposable UI, durable processes.** Rust owns window, filesystem, and
   long-lived child processes; the webview is disposable. Session hosts (one per
   live terminal backend) outlive reloads so terminals reattach.[^silo-arch-l97-l115][^silo-adr0010-l8-l43]
   llame's analogue is API/worker ownership of Runs while the thin web client
   reconnects.
2. **Package-graph extension boundary.** `silo.*` extensions depend on
   `@silo-code/sdk` (and `git-api`) only and physically cannot import the host;
   `core.*` may use `@silo-code/extension-host/internal`.[^silo-arch-l55-l73][^silo-adr0013-l17-l30]
   Strong prior art for proving a public adapter surface is real, not aspirational.
3. **Phased security, honest limits.** Files and process stay host-mediated and
   workspace-relative. Workspace path-scoping and install-time consent shipped;
   sandboxed execution has not. Docs warn: the permission prompt is not
   containment.[^silo-adr0015-l17-l35]
4. **ACP chat resurrection without a daemon.** Chat agents are ACP children
   piped to Silo. A detached daemon was rejected because ACP agents block on
   client RPCs (`session/request_permission`, `fs/*`, `terminal/*`) with no
   responder while the app is closed. Decision: the session resurrects; the
   process and in-flight turn do not. A host-owned transcript journal paints
   restore; `resume` wins over `load` when advertised.[^silo-adr0052-l8-l40]
   Critical caution for any llame plan that "backgrounds" an ACP peer.
5. **Sealed agent detection.** No public detector/register API; exact resume
   requires an explicit identity source (hook or agent registry), not cwd
   heuristics.[^silo-adr0028-l14-l32] Same honesty rule as llame peer resume IDs.

**llame fit**

- High: item 4 for ACP ownership and quit/resume semantics.
- Moderate: items 1 to 3 for host/webview split and capability surfaces.
- Low: multi-workspace tab UX as product chrome only.
- Avoid: Silo dock panels, extension `ctx`, or local journals as Chat/Run
  identity. Peers remain executors; RLS stays in llame.

**Caution:** In-process extensions are trusted code today; third-party install
consent is not a sandbox.[^silo-adr0015-l17-l35] Local-first, no account, no
tenant boundary. Product site: [getsilo.dev](https://getsilo.dev).[^silo-site]

[^silo-readme-l1-l20]: [Multi-workspace local-first shell; MIT; no account](https://github.com/silo-code/silo/blob/2c2378a869ac1c7927188c8722c0d3bc1035dac4/README.md#L1-L20)

[^silo-readme-l72-l83]: [Persistent tabs, terminals, extension SDK](https://github.com/silo-code/silo/blob/2c2378a869ac1c7927188c8722c0d3bc1035dac4/README.md#L72-L83)

[^silo-readme-l172-l174]: [MIT license footer](https://github.com/silo-code/silo/blob/2c2378a869ac1c7927188c8722c0d3bc1035dac4/README.md#L172-L174)

[^silo-license-l1-l10]: [MIT license text](https://github.com/silo-code/silo/blob/2c2378a869ac1c7927188c8722c0d3bc1035dac4/LICENSE#L1-L10)

[^silo-arch-l22-l31]: [Rust host plus webview workbench; extensions through ctx](https://github.com/silo-code/silo/blob/2c2378a869ac1c7927188c8722c0d3bc1035dac4/docs/architecture.md#L22-L31)

[^silo-arch-l55-l73]: [extensions-silo depends on sdk only; package-graph enforcement](https://github.com/silo-code/silo/blob/2c2378a869ac1c7927188c8722c0d3bc1035dac4/docs/architecture.md#L55-L73)

[^silo-arch-l97-l115]: [Session hosts outlive disposable webview](https://github.com/silo-code/silo/blob/2c2378a869ac1c7927188c8722c0d3bc1035dac4/docs/architecture.md#L97-L115)

[^silo-adr0010-l8-l43]: [ctx.process persistent PTY sessions plus one-shot exec](https://github.com/silo-code/silo/blob/2c2378a869ac1c7927188c8722c0d3bc1035dac4/docs/decisions/0010-persistent-process-sessions.md#L8-L43)

[^silo-adr0015-l17-l35]: [Phased security; sandbox not started; permission prompt is not containment](https://github.com/silo-code/silo/blob/2c2378a869ac1c7927188c8722c0d3bc1035dac4/docs/decisions/0015-phased-security-model.md#L17-L35)

[^silo-adr0013-l17-l30]: [core._ versus silo._ versus third-party trust tiers](https://github.com/silo-code/silo/blob/2c2378a869ac1c7927188c8722c0d3bc1035dac4/docs/decisions/0013-trust-tiers-two-barrel-sdk.md#L17-L30)

[^silo-adr0052-l8-l40]: [ACP chat: session resurrects; in-flight process does not](https://github.com/silo-code/silo/blob/2c2378a869ac1c7927188c8722c0d3bc1035dac4/docs/decisions/0052-chat-session-resurrection.md#L8-L40)

[^silo-adr0028-l14-l32]: [Sealed agent detection; no silent session-id inference](https://github.com/silo-code/silo/blob/2c2378a869ac1c7927188c8722c0d3bc1035dac4/docs/decisions/0028-sealed-agent-detection.md#L14-L32)

[^silo-site]: [Silo product site](https://getsilo.dev)
