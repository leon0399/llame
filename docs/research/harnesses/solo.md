---
type: Reference
title: "Solo (soloterm)"
description: "Closed Tauri desktop meta-harness that shares project processes via solo.yml and orchestrates Claude, Codex, OpenCode and Pi through MCP, HTTP and CLI."
tags: [harness, desktop, meta-harness, closed-source, mcp, processes]
status: draft
resource: "https://soloterm.com"
generated:
  by: "cursor/composer"
  at: "2026-10-17"
observed:
  date: "2026-10-17"
  revision: "site-docs-2026-10-17"
sources:
  - id: solo-home
    resource: "https://soloterm.com"
    title: "Meta-harness product home and solo.yml positioning"
  - id: solo-docs
    resource: "https://soloterm.com/docs"
    title: "First-party docs for MCP, CLI and process trust"
  - id: solo-org-collision
    resource: "https://github.com/soloterm/solo"
    title: "Older Laravel Artisan package; not the desktop app"
---

# Solo (soloterm)

- **Stack:** Tauri with OS webview (WebKit on macOS, WebView2 on Windows);
  explicitly not Electron. Free tier limits projects and processes; Pro is
  commercial.[^solo-home][^solo-docs]
- **License / openness:** Closed desktop binary. `soloterm/solo` on GitHub is an
  older Laravel Artisan multi-command package, not this app.[^solo-org-collision]

**Status:** Site and docs inspection only. Closest marketing alignment to
llame's "meta-harness" language among the closed desktop products in this wave:
owns the room (shared processes, todos, scratchpads, spawn/wait) and treats
coding CLIs as executors.[^solo-home]

**Study**

1. **`solo.yml` shared process manifest.** Dev servers, queues, log tails,
   tunnels and watchers are defined once so humans and agents share the running
   system instead of each spawning another `npm run dev`. Isolation is process
   trust, not containers by default.[^solo-home]
2. **Programmable control plane.** Agents spawn and control terminals and shared
   context through MCP, localhost HTTP or the Solo CLI. That is orchestration
   around harnesses, not a replacement for provider session identity.[^solo-docs]
3. **Worktrees are optional links.** Related checkouts can share todos and
   templates; Solo does not center the product on auto worktree-per-agent the
   way Conductor or Superset do.[^solo-docs]
4. **No remote-host session management.** WSL execution profiles exist on
   Windows; generic SSH/tmux remote hosting is left to the user.[^solo-docs]

**llame fit**

- High: positioning map. Meta-harness owns workspace processes and executor
  spawning; peer CLIs stay adapters.
- Moderate: mechanics. Shared-process manifests and MCP control surfaces are
  worth comparing to llame tool/process placement work.
- Low: identity and tenancy. Local Tauri workspace with no Chat/Run server
  authority and no RLS.

**Caution:** Do not cite `soloterm/solo` Laravel as the desktop source. Meta-harness
is product branding; map it explicitly to llame's Chat/Run definition before
adopting language.[^solo-org-collision]
[^solo-home][^solo-docs][^solo-org-collision]

[^solo-home]: [Meta-harness product home and solo.yml positioning](https://soloterm.com)

[^solo-docs]: [First-party docs for MCP, CLI and process trust](https://soloterm.com/docs)

[^solo-org-collision]: [Older Laravel Artisan package; not the desktop app](https://github.com/soloterm/solo)
