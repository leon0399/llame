---
type: Reference
title: "super.engineering"
description: "Closed native macOS Rust control plane that runs many coding-agent CLIs in isolated worktrees with GPU-rendered terminals and optional experimental SSH remote compute."
tags: [harness, desktop, worktrees, closed-source, rust, control-plane]
status: draft
resource: "https://super.engineering"
generated:
  by: "cursor/composer"
  at: "2026-10-17"
observed:
  date: "2026-10-17"
  revision: "site-docs-2026-10-17"
sources: []
---

# super.engineering

- **Stack:** Claims 100% Rust with Metal GPU-rendered terminal; no Electron and
  no embedded browser as the main shell. Formerly branded Superconductor;
  CLI surface still appears as `sc` in community tooling. Product home:
  [super.engineering](https://super.engineering); run-agents docs:
  [super.engineering/docs/run-agents](https://super.engineering/docs/run-agents/).
- **License / openness:** Closed. Nightly download claimed. GitHub org
  [`superdoteng`](https://github.com/superdoteng) has no public app repository.

**Status:** Site and docs inspection only; no public app revision to pin.
Closest closed peer to open control planes such as [Zeron](./zeron.md) and
worktree hosts such as [Superset](./superset.md) / [Shipyard](./shipyard.md).
High confidence on positioning; internals unverifiable. Mutable vendor URLs are
navigation only, not `sources`.

**Study**

1. **Agent-agnostic subprocess fleet.** Built-in providers include Claude Code,
   Codex, Cursor, OpenCode, Pi, Oh My Pi, Hermes, Qwen Code and others. Agents
   run as native subprocesses on the owner's credentials; the product claims no
   proxy of model traffic.
2. **One task, one worktree.** Each agent gets an isolated branch, terminal,
   session history and review diff. Same worktree-host pattern as Superset and
   Conductor.
3. **Experimental SSH remote workspaces.** Vendor docs label Remote workspaces
   (SSH) as experimental and require enabling the feature in Experimental
   settings
   ([remote-workspaces](https://super.engineering/docs/remote-workspaces/)).
   Git, terminals and agents can run on an SSH-connected Linux or Mac host while
   the UI stays on the laptop.
4. **Team orchestration CLI.** `sc team run`, `sc agent send` and
   `sc coordination-state` claim lead/specialist meshes with shared coordination
   state. Semantics and durability are unverifiable without source.

**llame fit**

- Moderate: comparative checklist for native fleet UX, experimental SSH remote
  boxes and provider-agnostic subprocess adapters.
- Low: durability, tenancy and Chat/Run ownership. This is a local desktop
  control plane, not a server-owned conversation authority.
- Avoid: assuming unlimited-parallel marketing numbers or CRDT-like coordination
  without evidence.

**Caution:** Brand churn (Superconductor → super.engineering) pollutes search.
Empty public org proves nothing durable except "no source today".
