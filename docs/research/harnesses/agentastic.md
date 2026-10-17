---
type: Reference
title: "Agentastic"
description: "Closed native macOS multi-agent IDE with worktree/container isolation, Manager Agents, ACP chat for many providers, and an iPhone steering client."
tags: [harness, desktop, worktrees, closed-source, ide, acp, mobile]
status: draft
resource: "https://www.agentastic.dev"
generated:
  by: "cursor/composer"
  at: "2026-10-17"
observed:
  date: "2026-10-17"
  revision: "site-docs-2026-10-17"
sources: []
---

# Agentastic

- **Stack:** Native macOS (Swift/SwiftUI per FAQ); terminal backends claim Ghostty
  (Metal) or SwiftTerm. Ships a built-in editor, browser and iPhone client.
  Optional Agentastic CLI on macOS/Linux/WSL. Product home:
  [agentastic.dev](https://www.agentastic.dev).
- **License / openness:** Free desktop without sign-up; closed development.
  Public [`agentasticai`](https://github.com/agentasticai) repos are peripheral,
  not the IDE. Docs: [agentastic.dev/docs](https://www.agentastic.dev/docs).

**Status:** Site and docs inspection only; no public app revision to pin.
Heavier than Superset/Conductor: editor, browser-use, Manager Agents and mobile.
High confidence on the claimed surface; low confidence on Manager Agent
durability. Mutable vendor URLs are navigation only, not `sources`.

**Study**

1. **Worktree or container isolation.** Each agent workspace is a new Git
   worktree by default; Apple containers and Docker are also supported. Setup
   hooks such as `.agentastic/setup.sh` run on worktree creation.
2. **ACP and native chat.** FAQ claims 55 built-in agent definitions, with many
   speaking structured chat natively or over ACP. Useful as a market signal that
   ACP is becoming table stakes for multi-agent hosts.
3. **Manager Agents.** Long-horizon managers turn a metric or spec into
   verifiable objectives and steer worker agents for days or weeks, including
   unattended tool auto-approve for the manager brain. That auto-approve posture
   conflicts with llame's approval and provenance instincts.
4. **Remote and mobile.** SSH hosts plus Modal/Fly/Vercel; iPhone pairs over LAN
   or Tailscale with optional vendor relay. Optional hosted services break the
   "nothing leaves your Mac" story when enabled.

**llame fit**

- Moderate: feature vocabulary (manager vs worker, ACP chat, worktree hooks,
  mobile steer).
- Low: runtime design. Closed Swift monolith; manager auto-approve; optional
  relay.
- Avoid: importing Manager Agent unattended approval as a default for llame Runs.

**Caution:** Public GitHub can look open at a glance; it is not the product.
Treat auth and cloud-routing details as moving vendor docs.
