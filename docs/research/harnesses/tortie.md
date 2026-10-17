---
type: Reference
title: "Tortie"
description: "macOS Electron agent multiplexer: private tmux sessions outlive the window, SQLite manifest-before-spawn durability, armed resume commands, and cross-project needs-input attention."
tags: [harness, peer-executor, desktop, tmux, durability, attention]
status: draft
resource: "https://github.com/gregce/tortie/tree/d2bb05ee495b5830a19925ba30c9b295dd347184"
observed:
  date: "2026-10-17"
  revision: "d2bb05ee495b5830a19925ba30c9b295dd347184"
sources:
  - id: tortie-product-l13-l46
    resource: "https://github.com/gregce/tortie/blob/d2bb05ee495b5830a19925ba30c9b295dd347184/PRODUCT.md#L13-L46"
    title: "stack, P1 durable sessions, status enum, disposable client"
  - id: tortie-product-l25-l33
    resource: "https://github.com/gregce/tortie/blob/d2bb05ee495b5830a19925ba30c9b295dd347184/PRODUCT.md#L25-L33"
    title: "armed claude --resume; tmux invisible in UI"
  - id: tortie-why-l9-l31
    resource: "https://github.com/gregce/tortie/blob/d2bb05ee495b5830a19925ba30c9b295dd347184/WHY-TORTIE-IS-DEPENDABLE.md#L9-L31"
    title: "private tmux; manifest before spawn; remote journal"
  - id: tortie-why-l48-l56
    resource: "https://github.com/gregce/tortie/blob/d2bb05ee495b5830a19925ba30c9b295dd347184/WHY-TORTIE-IS-DEPENDABLE.md#L48-L56"
    title: "monotonic quitting state closes IPC admission"
  - id: tortie-why-l76-l82
    resource: "https://github.com/gregce/tortie/blob/d2bb05ee495b5830a19925ba30c9b295dd347184/WHY-TORTIE-IS-DEPENDABLE.md#L76-L82"
    title: "context-isolated typed gmux bridge"
  - id: tortie-attention-l41-l55
    resource: "https://github.com/gregce/tortie/blob/d2bb05ee495b5830a19925ba30c9b295dd347184/src/main/tray/attention.ts#L41-L55"
    title: "needs_input attention rows across projects"
  - id: tortie-package-l1-l9
    resource: "https://github.com/gregce/tortie/blob/d2bb05ee495b5830a19925ba30c9b295dd347184/package.json#L1-L9"
    title: "Apache-2.0 package license"
  - id: tortie-license-l1-l4
    resource: "https://github.com/gregce/tortie/blob/d2bb05ee495b5830a19925ba30c9b295dd347184/LICENSE#L1-L4"
    title: "Apache License 2.0 header"
---

# Tortie

- **Stack:** Electron 43 + React/TypeScript, xterm.js, private tmux (`-L gmux`),
  better-sqlite3, Monaco.[^tortie-product-l13-l46] **License:**
  Apache-2.0.[^tortie-package-l1-l9][^tortie-license-l1-l4] Site:
  [tortie.sh](https://tortie.sh). macOS-first (iPhone companion in product docs).

**Status:** Source and documentation inspection only; nothing was run. A calm
agent multiplexer: named terminal sessions host coding-agent CLIs, survive quit
via private tmux, and restore after reboot with scrollback plus an armed (not
auto-run) provider `--resume`.[^tortie-product-l13-l46][^tortie-product-l25-l33]
Neighbours: [Shipyard](./shipyard.md), [Ghostex](./ghostex.md). High confidence
it hosts peers rather than implementing an agent loop. llame keeps Chat/Run;
study Tortie for durability ordering and attention UX.

**Study**

1. **Disposable client over durable sessions.** The app is framed as a disposable
   client; tmux is invisible in UI copy; sessions have names only.[^tortie-product-l25-l33]
   Closing Tortie must not stop agents.[^tortie-why-l9-l31] Same mental model as
   llame's thin web over durable Runs.
2. **Manifest before spawn.** Important operations are recorded in SQLite before
   the child process starts. A failed remote journal write blocks spawn; each
   operation has an immutable identity distinct from the visible session
   name.[^tortie-why-l9-l31] Strong pattern for "admit work only when recovery
   facts exist" — map to Run enqueue + attempt token, not tmux.
3. **Armed resume, user decides.** Reboot restore recreates sessions with
   scrollback and a pre-typed resume command (`claude --resume <uuid>` style);
   the user chooses when to fire it.[^tortie-product-l13-l46][^tortie-product-l25-l33]
   Peer adapters should separate "conversation cursor restored" from "executor
   restarted".
4. **Uncertainty over false certainty.** Lost remote connections leave unfinished
   journal rows as cut-off operations rather than inventing success/failure;
   recovery shows a durability notice.[^tortie-why-l9-l31] Applicable to remote
   Workspace/peer outcomes.
5. **Monotonic shutdown closes admission.** Main process enters one quitting
   state that cannot return to running; the typed IPC handler refuses new
   renderer requests; then ordered disposal snapshots sessions and closes
   DBs.[^tortie-why-l48-l56] Checklist for graceful API/worker drain.
6. **Cross-project needs-input attention.** Frozen status enum WORKING /
   NEEDS_INPUT / IDLE (+ manifest `exited`); tray/attention code filters
   `needs_input` across all projects for ⌘J / Dock badge.[^tortie-product-l13-l46][^tortie-attention-l41-l55]
   Operator surface for "which Run needs me", not authorization.
7. **Renderer authority floor.** Context isolation, Node integration off, one
   typed `window.gmux` bridge; main checks sender and owns OS work.[^tortie-why-l76-l82]

**llame fit**

- High: items 2, 3 and 5 for admit-before-execute, resume vs restart, shutdown
  admission.
- Moderate: items 1, 4 and 6 for disposable UI, uncertain remote outcomes,
  attention UX.
- Low: item 7 as Electron-specific; principle transfers, code does not.
- Avoid: private tmux as Chat durability, or importing Tortie's single-user
  local trust as a tenant model.

**Caution:** No cloud/tenant isolation in the product contract; single
BrowserWindow, local machine.[^tortie-product-l13-l46] Internal socket name
remains `gmux` after the Tortie rename.

[^tortie-product-l13-l46]: [stack, P1 durable sessions, status enum, disposable client](https://github.com/gregce/tortie/blob/d2bb05ee495b5830a19925ba30c9b295dd347184/PRODUCT.md#L13-L46)

[^tortie-product-l25-l33]: [armed claude --resume; tmux invisible in UI](https://github.com/gregce/tortie/blob/d2bb05ee495b5830a19925ba30c9b295dd347184/PRODUCT.md#L25-L33)

[^tortie-why-l9-l31]: [private tmux; manifest before spawn; remote journal](https://github.com/gregce/tortie/blob/d2bb05ee495b5830a19925ba30c9b295dd347184/WHY-TORTIE-IS-DEPENDABLE.md#L9-L31)

[^tortie-why-l48-l56]: [monotonic quitting state closes IPC admission](https://github.com/gregce/tortie/blob/d2bb05ee495b5830a19925ba30c9b295dd347184/WHY-TORTIE-IS-DEPENDABLE.md#L48-L56)

[^tortie-why-l76-l82]: [context-isolated typed gmux bridge](https://github.com/gregce/tortie/blob/d2bb05ee495b5830a19925ba30c9b295dd347184/WHY-TORTIE-IS-DEPENDABLE.md#L76-L82)

[^tortie-attention-l41-l55]: [needs_input attention rows across projects](https://github.com/gregce/tortie/blob/d2bb05ee495b5830a19925ba30c9b295dd347184/src/main/tray/attention.ts#L41-L55)

[^tortie-package-l1-l9]: [Apache-2.0 package license](https://github.com/gregce/tortie/blob/d2bb05ee495b5830a19925ba30c9b295dd347184/package.json#L1-L9)

[^tortie-license-l1-l4]: [Apache License 2.0 header](https://github.com/gregce/tortie/blob/d2bb05ee495b5830a19925ba30c9b295dd347184/LICENSE#L1-L4)
