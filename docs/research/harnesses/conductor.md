---
type: Reference
title: "Conductor"
description: "Closed macOS desktop host that runs Claude Code, Codex, Cursor and OpenCode in Git worktree workspaces with local and optional Conductor Cloud sandboxes."
tags: [harness, desktop, worktrees, closed-source, parallel-agents]
status: draft
resource: "https://www.conductor.build"
generated:
  by: "cursor/composer"
  at: "2026-10-17"
observed:
  date: "2026-10-17"
  revision: "site-docs-2026-10-17"
sources:
  - id: conductor-home
    resource: "https://www.conductor.build"
    title: "Product home: parallel coding agents on Mac"
  - id: conductor-docs
    resource: "https://docs.conductor.build"
    title: "First-party docs and install notes"
  - id: conductor-releases
    resource: "https://github.com/meltylabs/conductor-releases"
    title: "Public releases org; app source not published"
---

# Conductor

- **Stack:** Closed commercial macOS desktop app (Melty Labs). UI framework is
  not stated first-party; third-party Electron claims are unverified. Optional
  Conductor Cloud uses Vercel sandboxes.[^conductor-home][^conductor-docs]
- **License / openness:** Closed. Free local tier; paid Pro/Teams/Enterprise.
  Public GitHub under `meltylabs` publishes releases and taps, not the app
  source.[^conductor-releases]

**Status:** Marketing and first-party docs inspection only; nothing was run and
no binary was inspected. A Superset-class desktop worktree host: BYO CLI agents
in isolated workspaces, review/merge from one window. High confidence on the
worktree product shape from docs; low confidence on internals.

**Study**

1. **Workspace equals worktree.** Each task gets a Git worktree and branch with
   setup/run hooks and a dedicated port. Docs frame this as development
   isolation, not a security boundary: agents run as the Mac user.[^conductor-docs]
   Same caveat llame already applies to peer worktree hosts.
2. **Parallel fleet, not a second chat authority.** Conductor orchestrates
   Claude Code, Codex, Cursor and OpenCode sessions; it does not claim to own
   provider transcripts as the source of truth for a multi-tenant product.
3. **Local versus cloud privacy split.** Local mode claims Conductor never sees
   coding I/O. Cloud workspaces store sessions on vendor servers. Any llame
   comparison must keep that split explicit.
4. **Mobile as a paid surface.** Pro claims a mobile app for checking agents
   away from the desk. Architecture is unverifiable without source.

**llame fit**

- Moderate: product expectations for Mac parallel-agent hosts (worktrees,
  review, merge).
- Low: architecture transfer. Closed, Mac-centric, optional vendor-hosted
  session storage.
- Avoid: treating Conductor Cloud privacy claims as equivalent to llame's
  owner-scoped RLS and Chat/Run provenance.

**Caution:** Name collisions with other "Conductor" products. Pin to
conductor.build / Melty Labs. Isolation is branch isolation, not tenancy.
[^conductor-home][^conductor-docs][^conductor-releases]

[^conductor-home]: [Product home: parallel coding agents on Mac](https://www.conductor.build)

[^conductor-docs]: [First-party docs and install notes](https://docs.conductor.build)

[^conductor-releases]: [Public releases org; app source not published](https://github.com/meltylabs/conductor-releases)
