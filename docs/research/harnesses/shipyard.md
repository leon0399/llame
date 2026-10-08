---
type: Reference
title: "Shipyard"
description: "Desktop app and per-box daemon that run Claude Code, Codex and other agent CLIs in tmux sessions on remote boxes, with a state-sorted agent board and a widget home."
resource: "https://github.com/cosscom/shipyard/tree/b140a0ffe8cd44ba4d410f3f100d1cc34acb6790"
tags:
  - agent-harness
  - host-daemon
  - dashboard
  - worktrees
  - tmux
status: draft
generated:
  by: "claude-code/claude-opus-5-5"
  at: "2026-10-08"
observed:
  date: "2026-10-08"
  revision: "b140a0ffe8cd44ba4d410f3f100d1cc34acb6790"
sources:
  - id: shipyard-readme-l1-l30
    resource: "https://github.com/cosscom/shipyard/blob/b140a0ffe8cd44ba4d410f3f100d1cc34acb6790/README.md#L1-L30"
    title: "product summary and feature list"
  - id: shipyard-readme-l32-l40
    resource: "https://github.com/cosscom/shipyard/blob/b140a0ffe8cd44ba4d410f3f100d1cc34acb6790/README.md#L32-L40"
    title: "pieces: berthd, berth, app, plugins, kits"
  - id: shipyard-architecture
    resource: "https://github.com/cosscom/shipyard/blob/b140a0ffe8cd44ba4d410f3f100d1cc34acb6790/docs/concepts/architecture.mdx"
    title: "principles, components, where state lives, events"
  - id: shipyard-security
    resource: "https://github.com/cosscom/shipyard/blob/b140a0ffe8cd44ba4d410f3f100d1cc34acb6790/docs/concepts/security.mdx"
    title: "trust table, pinned TLS, known limits"
  - id: shipyard-integrations
    resource: "https://github.com/cosscom/shipyard/blob/b140a0ffe8cd44ba4d410f3f100d1cc34acb6790/docs/guides/agent-integrations.mdx#L1-L45"
    title: "agent CLI hooks that report state"
  - id: shipyard-orchestration-l100-l125
    resource: "https://github.com/cosscom/shipyard/blob/b140a0ffe8cd44ba4d410f3f100d1cc34acb6790/docs/guides/orchestration.mdx#L100-L125"
    title: "agent-to-agent reports and the berthd MCP server"
  - id: shipyard-dashboard-columns-l32-l41
    resource: "https://github.com/cosscom/shipyard/blob/b140a0ffe8cd44ba4d410f3f100d1cc34acb6790/app/src/views/dashboard/dashboard-view.tsx#L32-L41"
    title: "four state columns and longest-waiting-first ordering"
  - id: shipyard-dashboard-view-l99-l196
    resource: "https://github.com/cosscom/shipyard/blob/b140a0ffe8cd44ba4d410f3f100d1cc34acb6790/app/src/views/dashboard/dashboard-view.tsx#L99-L196"
    title: "header, empty state, column grid and column headers"
  - id: shipyard-dashboard-view-l198-l262
    resource: "https://github.com/cosscom/shipyard/blob/b140a0ffe8cd44ba4d410f3f100d1cc34acb6790/app/src/views/dashboard/dashboard-view.tsx#L198-L262"
    title: "collapsed shells-and-ended row, selection bar, quiet cards"
  - id: shipyard-agent-card-l54-l160
    resource: "https://github.com/cosscom/shipyard/blob/b140a0ffe8cd44ba4d410f3f100d1cc34acb6790/app/src/views/dashboard/agent-card.tsx#L54-L160"
    title: "agent card anatomy and waiting outline"
  - id: shipyard-agent-card-l163-l200
    resource: "https://github.com/cosscom/shipyard/blob/b140a0ffe8cd44ba4d410f3f100d1cc34acb6790/app/src/views/dashboard/agent-card.tsx#L163-L200"
    title: "numbered options as answer buttons"
  - id: shipyard-screen-tail-l10-l45
    resource: "https://github.com/cosscom/shipyard/blob/b140a0ffe8cd44ba4d410f3f100d1cc34acb6790/app/src/views/dashboard/use-screen-tail.ts#L10-L45"
    title: "screen tail refetch policy"
  - id: shipyard-state-model-l1-l52
    resource: "https://github.com/cosscom/shipyard/blob/b140a0ffe8cd44ba4d410f3f100d1cc34acb6790/app/src/lib/state-model.ts#L1-L52"
    title: "one state vocabulary and colour rule"
  - id: shipyard-agent-glyph-l37-l83
    resource: "https://github.com/cosscom/shipyard/blob/b140a0ffe8cd44ba4d410f3f100d1cc34acb6790/app/src/components/agent-glyph.tsx#L37-L83"
    title: "state glyph shapes and reduced-motion behaviour"
  - id: shipyard-derive-l18-l30
    resource: "https://github.com/cosscom/shipyard/blob/b140a0ffe8cd44ba4d410f3f100d1cc34acb6790/app/src/lib/derive.ts#L18-L30"
    title: "session state derivation"
  - id: shipyard-home-view-l9-l41
    resource: "https://github.com/cosscom/shipyard/blob/b140a0ffe8cd44ba4d410f3f100d1cc34acb6790/app/src/views/home/home-view.tsx#L9-L41"
    title: "home: composer above a widget grid"
  - id: shipyard-home-grid-l19-l36
    resource: "https://github.com/cosscom/shipyard/blob/b140a0ffe8cd44ba4d410f3f100d1cc34acb6790/app/src/views/home/widgets/grid.tsx#L19-L36"
    title: "four-column widget grid with fixed cell sizes"
  - id: shipyard-widget-parts-l30-l60
    resource: "https://github.com/cosscom/shipyard/blob/b140a0ffe8cd44ba4d410f3f100d1cc34acb6790/app/src/views/home/widgets/parts.tsx#L30-L60"
    title: "widget empty and skeleton components"
  - id: shipyard-view-header-l13-l40
    resource: "https://github.com/cosscom/shipyard/blob/b140a0ffe8cd44ba4d410f3f100d1cc34acb6790/app/src/views/view-header.tsx#L13-L40"
    title: "shared view header strip"
  - id: shipyard-components-json
    resource: "https://github.com/cosscom/shipyard/blob/b140a0ffe8cd44ba4d410f3f100d1cc34acb6790/app/components.json"
    title: "shadcn configuration with the @coss registry"
  - id: shipyard-demo
    resource: "https://www.berthd.app/demo/"
    title: "browser demo of the app, noindex"
---

# Shipyard

Shipyard (binaries and paths still say `berth`) is a desktop app, a laptop CLI and agent, and a per-box
daemon that run coding-agent CLIs on remote development machines. The README states the premise: agents
run on the boxes, so closing the app or losing Wi-Fi never stops them[^shipyard-readme-l1-l30]. MIT
licensed, Go for the daemon and CLI, Tauri and React for the app[^shipyard-readme-l32-l40].

## Classification

It belongs under harnesses: it starts, tracks, steers and stops tool-enabled agent processes. It does not
implement an agent loop, model client or tool set. Moderate-high confidence that the closest llame analogue
is a peer-executor adapter plus its operator UI, not a second Run system. Neighbours are
[Orca](./orca.md) and [bb](./bb.md).

## Execution model

- `berthd` is one static binary per box, a systemd user service (launchd on macOS), holding locations,
  worktrees, sessions, services, hooks, flows and the box's trust store[^shipyard-architecture].
- Agents are the vendor CLIs (Claude Code, Codex, Cursor, Gemini CLI, OpenCode, pi) running inside tmux
  sessions in a git worktree. The box needs only `git` and `tmux`[^shipyard-architecture]. Sessions outlive
  the daemon and the app.
- The laptop agent (`berth agent`) holds one pinned-key TLS 1.3 connection per box, relays events and keeps an
  offline prompt queue. The desktop app is a view over a loopback API and holds no state worth
  losing[^shipyard-architecture].
- Agent state is not parsed from a protocol. Hooks installed into each CLI (`SessionStart`,
  `PermissionRequest`, `Stop` and similar) emit events to `berthd`; only permission and question notifications
  map to "needs you"[^shipyard-integrations]. The app falls back to the box's per-folder report, then to "running" for an agent with no report[^shipyard-derive-l18-l30]. The app additionally reads the tail of the tmux screen for the
  last lines and numbered options[^shipyard-screen-tail-l10-l45].
- Orchestration is agent-to-agent through a typed `berthd mcp` server and `berth` CLI. Reports to the asking
  agent are delivered at its next idle, once, and never in a circle[^shipyard-orchestration-l100-l125].

No ACP or A2A in the tree: a path search for `acp` and `a2a` returned only `internal/mcpserver`. MCP is
exposed to agents, not used to drive them. High confidence for the tree listing, moderate for docs I did not
read in full.

## Isolation

None beyond the OS user. The trust table states that anything running as the box user has the same powers as
a paired laptop, and that plugins are not sandboxed[^shipyard-security]. Isolation is per git worktree with
its own ports and environment, and trust gates on repository config, kits and plugins by content hash. One
person per box. Contrast with llame's RLS-enforced tenancy: Shipyard is a single-owner remote-control plane.

## Dashboard and home pages

The app has two pages the owner could mean by an index. `views/dashboard` is a board of every agent on every
box. `views/home` is the workspace landing view. Both are specified below; the board is the stronger fit.
A browser demo of the app is served at `https://www.berthd.app/demo/`[^shipyard-demo] (HTTP 200 and a
"Shipyard demo" title seen; navigation inside it not exercised).

### Agent Dashboard (`dashboard-view.tsx`)

Source: `app/src/views/dashboard/dashboard-view.tsx`, `agent-card.tsx`, `use-screen-tail.ts`, with state words
in `lib/state-model.ts` and glyphs in `components/agent-glyph.tsx`.

- **Entities.** Only agent sessions, from all online boxes (`useAllSessions`). Shells and ended sessions are
  excluded from the board. No projects or chats are listed; location and worktree appear as card text.
- **Hierarchy.** A header strip titled "Agent Dashboard" with the line "Every agent on every box, by what it
  needs"[^shipyard-dashboard-view-l99-l196][^shipyard-view-header-l13-l40]. Below it four columns, in order:
  Needs you, Working, Done, Idle[^shipyard-dashboard-columns-l32-l41]. Grouping is by what the owner must do,
  not by project or box.
- **Ordering.** Inside a column the longest-in-state card is on top, using `state_since`. What has waited
  longest is first.
- **One screen.** Columns use `grid-cols-[repeat(auto-fit,minmax(250px,1fr))]`, so four columns on a wide
  window and wrapping on a narrow one. Each column header has glyph, label, count (amber only for a non-zero
  Needs you) and a column menu. Shells and ended sessions sit below in one collapsed row,
  "Shells & ended · 2 shells, 1 ended"[^shipyard-dashboard-view-l198-l262].
- **Card anatomy (about 100 px).** Agent icon; title (the work, else the worktree); a monospace elapsed
  duration since the state began, ticking from one shared one-second clock; a secondary line of agent, place,
  box, branch; the starting prompt in italics; a three-line monospace tail of the live screen; a footer with
  Stop (visible on hover or focus), Open, Reply or Prompt, and a menu[^shipyard-agent-card-l54-l160].
- **Answering in place.** When an agent waits and its screen shows numbered options, they render as buttons
  that type the number into the session[^shipyard-agent-card-l163-l200]. This is the one
  decision-without-navigating affordance.
- **Status encoding.** One vocabulary (Working, Needs you, Done, Idle, Ended), reused in the sidebar, tabs,
  palette and notifications. Colour is reserved: blue working, amber "needs you" and nothing else, green done
  or online, red broken, grey rest[^shipyard-state-model-l1-l52]. Shape carries the state too: spinning ring,
  pinging dot, check, hollow ring, filled grey dot, each with an `aria-label`; the spinner stops and the ping
  hides under reduced motion[^shipyard-agent-glyph-l37-l83]. A waiting card also takes an amber outline on the
  whole border, "never a stripe down one side".
- **Navigation.** A card click opens the session in its worktree workspace. Select mode (button, or Cmd/Shift
  click) shows checkboxes and a floating bar to send one prompt to, or stop, several agents; Backspace stops the
  selection. A box filter persists in local storage. "Clean up..." stops Done and Idle agents older than 1 h,
  4 h or 1 d.
- **Empty states.** Whole board: a small illustration, "No agents yet", and one action that depends on state,
  Add a box or New worktree. Per column: a dashed box with one sentence ("Nothing needs you.").
- **Loading.** No skeleton in this view. While `status` is unloaded, `noBoxes` is false and the list is empty,
  so the generic empty state would render. Inference from code; not observed running. Low-moderate confidence
  that it flashes.
- **Refresh cost.** The screen tail refetches on state change or a matching event (debounced) and every 20 s
  only while working[^shipyard-screen-tail-l10-l45]; cards fade in with a 200 ms translate.
- **Library.** shadcn `new-york` config with the `@coss` registry, Base UI (`@base-ui/react`), Tailwind 4,
  lucide icons[^shipyard-components-json]. Components used on this page: Button, Empty, Checkbox, Kbd, Tooltip.

### Home (`home-view.tsx`)

Before any worktree is open, home shows a single prompt, "What should your agents work on?", over a
four-column customizable widget grid: Needs you, Working now, Recently finished, Boxes, Services, Git and
plugin widgets[^shipyard-home-view-l9-l41][^shipyard-home-grid-l19-l36]. Each widget has a fixed cell size, so
nothing shifts as data loads, and its own skeleton and empty component[^shipyard-widget-parts-l30-l60]. Widgets
declare a data source and refresh interval in a registry. The Boxes widget shows CPU, memory and disk as three
thin bars with an amber and red threshold at 80 and 90 percent.

## Mapping to llame

DESIGN.md makes red the only standing chromatic colour and sets a 256 px rail with a content stage, so
Shipyard's blue, amber and green state colours do not transfer. The shape-first state glyph does.

- **Sidebar rows.** llame's `ChatActivityIndicator` already has `processing` and `unread` and reserves
  `needs-input` until approvals exist (#45). Shipyard confirms the target taxonomy: one word and one glyph per
  state, reused everywhere. Transfer: a shared state vocabulary module. Colour: not transferable, use
  shape, weight and tooltip.
- **Runs.** A state-sorted view of active Runs (needs input, running, finished) ordered by time-in-state fits
  llame's pg-boss Runs and replay model once an approval state exists. Transfer: moderate confidence.
- **Projects.** Shipyard has no Project-level page to copy. Its box filter is the nearest analogue, persisted
  per browser.
- **Does not transfer.** Screen-scraping tmux for options (llame has structured events), stop and
  cleanup of processes, and the single-user trust model.

## Fit and open questions

- Adapter candidate: low-moderate confidence. It controls CLIs through tmux and hooks, not a protocol, so
  llame would drive vendor hooks rather than ACP. Reading it is more useful for UX than for transport.
- Unverified: docs not read (`runs.mdx`, `automations.mdx`, `boxes.mdx`); the shipped binary behaviour; the
  demo's rendering; whether the dashboard flashes its empty state; the clone of the repo timed out, so all
  files were read through the pinned GitHub contents API.

[^shipyard-readme-l1-l30]: [README](https://github.com/cosscom/shipyard/blob/b140a0ffe8cd44ba4d410f3f100d1cc34acb6790/README.md#L1-L30)

[^shipyard-readme-l32-l40]: [README pieces](https://github.com/cosscom/shipyard/blob/b140a0ffe8cd44ba4d410f3f100d1cc34acb6790/README.md#L32-L40)

[^shipyard-architecture]: [architecture](https://github.com/cosscom/shipyard/blob/b140a0ffe8cd44ba4d410f3f100d1cc34acb6790/docs/concepts/architecture.mdx)

[^shipyard-security]: [security model](https://github.com/cosscom/shipyard/blob/b140a0ffe8cd44ba4d410f3f100d1cc34acb6790/docs/concepts/security.mdx)

[^shipyard-integrations]: [agent integrations](https://github.com/cosscom/shipyard/blob/b140a0ffe8cd44ba4d410f3f100d1cc34acb6790/docs/guides/agent-integrations.mdx#L1-L45)

[^shipyard-orchestration-l100-l125]: [orchestration](https://github.com/cosscom/shipyard/blob/b140a0ffe8cd44ba4d410f3f100d1cc34acb6790/docs/guides/orchestration.mdx#L100-L125)

[^shipyard-dashboard-columns-l32-l41]: [dashboard columns](https://github.com/cosscom/shipyard/blob/b140a0ffe8cd44ba4d410f3f100d1cc34acb6790/app/src/views/dashboard/dashboard-view.tsx#L32-L41)

[^shipyard-dashboard-view-l99-l196]: [dashboard view](https://github.com/cosscom/shipyard/blob/b140a0ffe8cd44ba4d410f3f100d1cc34acb6790/app/src/views/dashboard/dashboard-view.tsx#L99-L196)

[^shipyard-dashboard-view-l198-l262]: [dashboard footer and selection](https://github.com/cosscom/shipyard/blob/b140a0ffe8cd44ba4d410f3f100d1cc34acb6790/app/src/views/dashboard/dashboard-view.tsx#L198-L262)

[^shipyard-agent-card-l54-l160]: [agent card](https://github.com/cosscom/shipyard/blob/b140a0ffe8cd44ba4d410f3f100d1cc34acb6790/app/src/views/dashboard/agent-card.tsx#L54-L160)

[^shipyard-agent-card-l163-l200]: [answer buttons](https://github.com/cosscom/shipyard/blob/b140a0ffe8cd44ba4d410f3f100d1cc34acb6790/app/src/views/dashboard/agent-card.tsx#L163-L200)

[^shipyard-screen-tail-l10-l45]: [screen tail](https://github.com/cosscom/shipyard/blob/b140a0ffe8cd44ba4d410f3f100d1cc34acb6790/app/src/views/dashboard/use-screen-tail.ts#L10-L45)

[^shipyard-state-model-l1-l52]: [state model](https://github.com/cosscom/shipyard/blob/b140a0ffe8cd44ba4d410f3f100d1cc34acb6790/app/src/lib/state-model.ts#L1-L52)

[^shipyard-agent-glyph-l37-l83]: [state glyph](https://github.com/cosscom/shipyard/blob/b140a0ffe8cd44ba4d410f3f100d1cc34acb6790/app/src/components/agent-glyph.tsx#L37-L83)

[^shipyard-derive-l18-l30]: [session state derivation](https://github.com/cosscom/shipyard/blob/b140a0ffe8cd44ba4d410f3f100d1cc34acb6790/app/src/lib/derive.ts#L18-L30)

[^shipyard-home-view-l9-l41]: [home view](https://github.com/cosscom/shipyard/blob/b140a0ffe8cd44ba4d410f3f100d1cc34acb6790/app/src/views/home/home-view.tsx#L9-L41)

[^shipyard-home-grid-l19-l36]: [home grid](https://github.com/cosscom/shipyard/blob/b140a0ffe8cd44ba4d410f3f100d1cc34acb6790/app/src/views/home/widgets/grid.tsx#L19-L36)

[^shipyard-widget-parts-l30-l60]: [widget parts](https://github.com/cosscom/shipyard/blob/b140a0ffe8cd44ba4d410f3f100d1cc34acb6790/app/src/views/home/widgets/parts.tsx#L30-L60)

[^shipyard-view-header-l13-l40]: [view header](https://github.com/cosscom/shipyard/blob/b140a0ffe8cd44ba4d410f3f100d1cc34acb6790/app/src/views/view-header.tsx#L13-L40)

[^shipyard-components-json]: [components.json](https://github.com/cosscom/shipyard/blob/b140a0ffe8cd44ba4d410f3f100d1cc34acb6790/app/components.json)

[^shipyard-demo]: [browser demo](https://www.berthd.app/demo/)
