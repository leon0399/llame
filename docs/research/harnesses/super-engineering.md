---
type: Reference
title: "super.engineering"
description: "Closed native macOS Rust control plane that runs many coding-agent CLIs in isolated worktrees with GPU-rendered terminals and optional SSH remote compute."
tags: [harness, desktop, worktrees, closed-source, rust, control-plane]
status: draft
resource: "https://super.engineering"
generated:
  by: "cursor/composer"
  at: "2026-10-17"
observed:
  date: "2026-10-17"
  revision: "site-docs-2026-10-17"
sources:
  - id: super-home
    resource: "https://super.engineering"
    title: "Native agent control plane claims"
  - id: super-docs-run
    resource: "https://super.engineering/docs/run-agents/"
    title: "Run-agents documentation"
  - id: super-org
    resource: "https://github.com/superdoteng"
    title: "GitHub org with no public app source"
---

# super.engineering

- **Stack:** Claims 100% Rust with Metal GPU-rendered terminal; no Electron and
  no embedded browser as the main shell. Formerly branded Superconductor;
  CLI surface still appears as `sc` in community tooling.[^super-home]
- **License / openness:** Closed. Nightly download claimed. GitHub org
  `superdoteng` has no public app repository.[^super-org]

**Status:** Site and docs inspection only. Closest closed peer to open control
planes such as [Zeron](./zeron.md) and worktree hosts such as
[Superset](./superset.md) / [Shipyard](./shipyard.md). High confidence on
positioning; internals unverifiable.

**Study**

1. **Agent-agnostic subprocess fleet.** Built-in providers include Claude Code,
   Codex, Cursor, OpenCode, Pi, Oh My Pi, Hermes, Qwen Code and others. Agents
   run as native subprocesses on the owner's credentials; the product claims no
   proxy of model traffic.[^super-home]
2. **One task, one worktree.** Each agent gets an isolated branch, terminal,
   session history and review diff. Same worktree-host pattern as Superset and
   Conductor.[^super-home]
3. **SSH remote compute.** Git, terminals and agents can run on an SSH-connected
   Linux or Mac host while the UI stays on the laptop.[^super-docs-run]
4. **Team orchestration CLI.** `sc team run`, `sc agent send` and
   `sc coordination-state` claim lead/specialist meshes with shared coordination
   state. Semantics and durability are unverifiable without source.[^super-home]

**llame fit**

- Moderate: comparative checklist for native fleet UX, SSH remote boxes and
  provider-agnostic subprocess adapters.
- Low: durability, tenancy and Chat/Run ownership. This is a local desktop
  control plane, not a server-owned conversation authority.
- Avoid: assuming unlimited-parallel marketing numbers or CRDT-like coordination
  without evidence.

**Caution:** Brand churn (Superconductor → super.engineering) pollutes search.
Empty public org proves nothing durable except "no source today".[^super-org]
[^super-home][^super-docs-run][^super-org]

[^super-home]: [Native agent control plane claims](https://super.engineering)

[^super-docs-run]: [Run-agents documentation](https://super.engineering/docs/run-agents/)

[^super-org]: [GitHub org with no public app source](https://github.com/superdoteng)
