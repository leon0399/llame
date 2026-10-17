---
type: Reference
title: "CodexHost"
description: "LGPL host that embeds Pi, Claude Code, OpenCode and other harnesses inside Codex Desktop via plugin adapters, native-first wires and ACP fallback."
tags: [harness, embedding, codex-desktop, peer-executor, plugins, acp]
status: draft
resource: "https://github.com/BytePioneer-AI/codex-host/tree/a8adb78b519a81795fc05b787811f20a9738d7f0"
generated:
  by: "cursor/composer"
  at: "2026-10-17"
observed:
  date: "2026-10-17"
  revision: "a8adb78b519a81795fc05b787811f20a9738d7f0"
sources:
  - id: ch-readme-l3-l11
    resource: "https://github.com/BytePioneer-AI/codex-host/blob/a8adb78b519a81795fc05b787811f20a9738d7f0/README.md#L3-L11"
    title: "Run other harnesses inside Codex Desktop"
  - id: ch-readme-l191-l205
    resource: "https://github.com/BytePioneer-AI/codex-host/blob/a8adb78b519a81795fc05b787811f20a9738d7f0/README.md#L191-L205"
    title: "Cross-agent # delegation to native sessions"
  - id: ch-readme-l252-l259
    resource: "https://github.com/BytePioneer-AI/codex-host/blob/a8adb78b519a81795fc05b787811f20a9738d7f0/README.md#L252-L259"
    title: "CDP shell, app-server shim, native then ACP"
  - id: ch-agents-l40-l45
    resource: "https://github.com/BytePioneer-AI/codex-host/blob/a8adb78b519a81795fc05b787811f20a9738d7f0/AGENTS.md#L40-L45"
    title: "Rust vs Host protocol; plugins not static imports"
  - id: ch-runtime-l5-l61
    resource: "https://github.com/BytePioneer-AI/codex-host/blob/a8adb78b519a81795fc05b787811f20a9738d7f0/docs/architecture/harness-plugin-runtime.md#L5-L61"
    title: "Dynamic plugins, enabled.json trust, no sandbox"
  - id: ch-adapter-l555-l659
    resource: "https://github.com/BytePioneer-AI/codex-host/blob/a8adb78b519a81795fc05b787811f20a9738d7f0/packages/harness-adapter/src/text-session.ts#L555-L659"
    title: "HarnessSession and HarnessAdapter contracts"
  - id: ch-cap-l1-l13
    resource: "https://github.com/BytePioneer-AI/codex-host/blob/a8adb78b519a81795fc05b787811f20a9738d7f0/docs/harnesses/capability-boundaries.md#L1-L13"
    title: "Capability table is plugin-real, not UI-parity"
  - id: ch-license-l1-l6
    resource: "https://github.com/BytePioneer-AI/codex-host/blob/a8adb78b519a81795fc05b787811f20a9738d7f0/LICENSE#L1-L6"
    title: "GNU Lesser General Public License v3"
---

# CodexHost

- **Stack:** TypeScript host packages (`host-runtime`, `harness-adapter`,
  `protocol-core`, per-harness `adapters/*`) plus Rust crates for launch, shim
  and updates; embeds into Codex Desktop.[^ch-agents-l40-l45] **License:**
  LGPL-3.0.[^ch-license-l1-l6]

**Status:** Source and documentation inspection only; nothing was run. Unusual
embedding strategy: keep Codex Desktop as the shell and run other harnesses as
independent Threads inside it.[^ch-readme-l3-l11] High confidence on product intent
and plugin-loader contracts from in-repo docs; moderate on zero-regression claims
across Codex Desktop versions (runtime doc says full native acceptance is
incomplete).

**Study**

1. **Foreign desktop as viewport, not rebuilt chat UI.** CodexHost extends
   official Codex Desktop via CDP / Electron Inspector; a CLI shim sits in front
   of the official app-server and passes native Codex requests through
   untouched.[^ch-readme-l252-l259] Proof that a host can share one viewport
   without merging session authorities — if the host still owns identity.
2. **Native interface first, ACP fallback.** Each harness uses its strongest
   native wire where one exists (Pi RPC, Claude Agent SDK); otherwise
   ACP.[^ch-readme-l252-l259] Matches llame's peer-adapter preference and
   Zeron's ACP decision.
3. **Plugin Host, not static adapter imports.** Sixteen preinstalled harnesses
   load through `manifest.json` and `createHarnessAdapter`; Host source must not
   import concrete adapter packages. Discovery uses preinstalled and user plugin
   roots with per-root `enabled.json` as explicit trust — missing or invalid
   roots fail closed, no hard-coded fallback.[^ch-runtime-l5-l61][^ch-agents-l40-l45]
4. **Typed HarnessAdapter / HarnessSession.** Sessions expose capabilities,
   output streams, turn execute/cancel, interaction respond, model/thinking/
   permission selects; adapters own inspect/open/close and optional import,
   usage and subagent surfaces.[^ch-adapter-l555-l659] Useful checklist for
   llame ACP/A2A capability flags before claiming a Run is finished.
5. **Capability table is not UI-parity.** Docs state the feature matrix describes
   what plugins can actually call, not everything visible in an upstream
   interactive terminal; harness-specific protocol stays inside the
   plugin.[^ch-cap-l1-l13]
6. **Cross-agent `#` delegation.** Composer `#` starts a separate native session
   in the target harness; orchestration can wait or run in the
   background.[^ch-readme-l191-l205][^ch-readme-l252-l259] Child correlation
   belongs to the host Thread list, not a merged transcript.

**llame fit**

- High: items 2 to 5 as adapter contracts and fail-closed plugin trust.
- Moderate: item 6 for child-Run delegation UX vocabulary.
- Low: item 1 as product UI; llame already has a thin web client.
- Avoid: depending on Codex Desktop internals as llame's Surface; LGPL coupling
  for any code reuse.

**Caution:** Enabled plugins are trusted host-process code with full process
permissions; path checks are not a sandbox.[^ch-runtime-l5-l61] Local console on
`127.0.0.1:4399` is an operational surface. Version coupling to Codex Desktop
upgrades is an explicit product risk.

[^ch-readme-l3-l11]: [Run other harnesses inside Codex Desktop](https://github.com/BytePioneer-AI/codex-host/blob/a8adb78b519a81795fc05b787811f20a9738d7f0/README.md#L3-L11)

[^ch-readme-l191-l205]: [Cross-agent # delegation to native sessions](https://github.com/BytePioneer-AI/codex-host/blob/a8adb78b519a81795fc05b787811f20a9738d7f0/README.md#L191-L205)

[^ch-readme-l252-l259]: [CDP shell, app-server shim, native then ACP](https://github.com/BytePioneer-AI/codex-host/blob/a8adb78b519a81795fc05b787811f20a9738d7f0/README.md#L252-L259)

[^ch-agents-l40-l45]: [Rust vs Host protocol; plugins not static imports](https://github.com/BytePioneer-AI/codex-host/blob/a8adb78b519a81795fc05b787811f20a9738d7f0/AGENTS.md#L40-L45)

[^ch-runtime-l5-l61]: [Dynamic plugins, enabled.json trust, no sandbox](https://github.com/BytePioneer-AI/codex-host/blob/a8adb78b519a81795fc05b787811f20a9738d7f0/docs/architecture/harness-plugin-runtime.md#L5-L61)

[^ch-adapter-l555-l659]: [HarnessSession and HarnessAdapter contracts](https://github.com/BytePioneer-AI/codex-host/blob/a8adb78b519a81795fc05b787811f20a9738d7f0/packages/harness-adapter/src/text-session.ts#L555-L659)

[^ch-cap-l1-l13]: [Capability table is plugin-real, not UI-parity](https://github.com/BytePioneer-AI/codex-host/blob/a8adb78b519a81795fc05b787811f20a9738d7f0/docs/harnesses/capability-boundaries.md#L1-L13)

[^ch-license-l1-l6]: [GNU Lesser General Public License v3](https://github.com/BytePioneer-AI/codex-host/blob/a8adb78b519a81795fc05b787811f20a9738d7f0/LICENSE#L1-L6)
