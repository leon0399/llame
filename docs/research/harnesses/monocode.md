---
type: Reference
title: "MonoCode"
description: "Tauri desktop GUI that launches Claude Code, Codex, Cursor and other installed agent CLIs as local or remote host sessions, with SQLite session storage and an in-thread /operator app CLI."
tags: [harness, peer-executor, desktop, worktrees, remote-host, session-store]
status: draft
resource: "https://github.com/hardbeat920/monocode/tree/b653a397d180d98097a5f214e9bbdae68d837239"
generated:
  by: "cursor/composer"
  at: "2026-10-17"
observed:
  date: "2026-10-17"
  revision: "b653a397d180d98097a5f214e9bbdae68d837239"
sources:
  - id: readme-l15-l39
    resource: "https://github.com/hardbeat920/monocode/blob/b653a397d180d98097a5f214e9bbdae68d837239/README.md#L15-L39"
    title: "Subscription agents, tabs as sessions, worktrees and /operator"
  - id: readme-l69-l71
    resource: "https://github.com/hardbeat920/monocode/blob/b653a397d180d98097a5f214e9bbdae68d837239/README.md#L69-L71"
    title: "MIT license declaration"
  - id: license-l1-l10
    resource: "https://github.com/hardbeat920/monocode/blob/b653a397d180d98097a5f214e9bbdae68d837239/LICENSE#L1-L10"
    title: "MIT license text"
  - id: providers-l1-l21
    resource: "https://github.com/hardbeat920/monocode/blob/b653a397d180d98097a5f214e9bbdae68d837239/docs/providers.md#L1-L21"
    title: "Probe installed CLIs; reuse existing logins"
  - id: agent-access-l1-l18
    resource: "https://github.com/hardbeat920/monocode/blob/b653a397d180d98097a5f214e9bbdae68d837239/docs/agent-access.md#L1-L18"
    title: "/operator thread-scoped app CLI and session actions"
  - id: remote-l1-l24
    resource: "https://github.com/hardbeat920/monocode/blob/b653a397d180d98097a5f214e9bbdae68d837239/docs/remote-access.md#L1-L24"
    title: "Host-owned sessions over SSH; desktop exit does not stop them"
  - id: harness-events-l13-l32
    resource: "https://github.com/hardbeat920/monocode/blob/b653a397d180d98097a5f214e9bbdae68d837239/src/integrations/harness/core/types.ts#L13-L32"
    title: "HarnessEvent session and turn wire discriminators"
  - id: harness-session-l161-l189
    resource: "https://github.com/hardbeat920/monocode/blob/b653a397d180d98097a5f214e9bbdae68d837239/src/integrations/harness/core/types.ts#L161-L189"
    title: "HarnessSessionInput: MonoCode owns transcript; ephemeral provider context"
  - id: host-providers-l37-l74
    resource: "https://github.com/hardbeat920/monocode/blob/b653a397d180d98097a5f214e9bbdae68d837239/host/providers.ts#L37-L74"
    title: "HostProvider send/cancel/approve surface per RemoteProvider"
  - id: session-store-l12-l53
    resource: "https://github.com/hardbeat920/monocode/blob/b653a397d180d98097a5f214e9bbdae68d837239/src-tauri/src/session_store.rs#L12-L53"
    title: "SQLite sessions table with blocks_json and WAL"
  - id: harness-coalesce-l63-l70
    resource: "https://github.com/hardbeat920/monocode/blob/b653a397d180d98097a5f214e9bbdae68d837239/src-tauri/src/harness.rs#L63-L70"
    title: "Stdout coalesce window and post-exit drain wait"
---

# MonoCode

- **Stack:** Tauri (Rust) desktop shell, Vite/React UI, Node host package for
  remote sessions; [usemono.dev](https://www.usemono.dev). **License:**
  MIT.[^readme-l69-l71][^license-l1-l10]

**Status:** Source and documentation inspection only; nothing was run. A
desktop multi-agent GUI: tabs are sessions over installed subscription CLIs
(Claude Code, Codex, Cursor, Grok, OpenCode, Antigravity, Pi, omp, fx, Hermes,
Devin), not a token marketplace.[^readme-l15-l39] Closest to [Shipyard](./shipyard.md)
and [Orca](./orca.md) as a host that treats peer agents as executors. High
confidence on the adapter and session-store shapes; moderate confidence on
remote lifetime claims, which come from docs rather than executed hosts.

**Study**

1. **Installed-CLI adapters, not a new agent.** Startup probes PATH for each
   provider and disables missing ones; auth stays with the vendor
   login.[^providers-l1-l21] The TypeScript `HostProvider` surface is
   `send` / optional `compact` / `cancel` / `stop` / `bind` / `approve` /
   `answer`, keyed by `RemoteProvider`.[^host-providers-l37-l74] llame's peer
   adapters need the same capability split before claiming a Run is finished
   or interruptible.
2. **Typed harness events.** `HarnessEvent` discriminates session start/end/error,
   provider binding, turn start/ready, usage limits, background tasks,
   message and tool deltas.[^harness-events-l13-l32] That is a useful checklist
   for mapping peer streams into llame run events without inventing a second
   transcript authority.
3. **Host owns the saved transcript.** `HarnessSessionInput` states MonoCode owns
   the saved transcript while provider context may be ephemeral; optional
   `appAccess` and `controlsAgents` gate the local control CLI because sandboxes
   deny network by default.[^harness-session-l161-l189] Same ownership rule as
   llame: Chat/Run persistence stays in the meta-harness, not in the peer.
4. **SQLite session ledger.** Local sessions live in SQLite with `harness`,
   `model`, `runtime_mode`, optional `provider_session_id`, and
   `blocks_json`, opened with WAL and a query-only read
   connection.[^session-store-l12-l53] Durable relative to a pure TUI, but still
   single-machine and without tenant RLS.
5. **Thread-scoped operator CLI.** `/operator` on one turn injects an `app` CLI
   for that thread only: start/list/send/stop/archive sessions, worktrees, and
   notes; orchestration workers keep a separate scoped
   `control` path.[^agent-access-l1-l18] Relevant to child-Run tools that must
   not mint parent Chat identity.
6. **Remote host survives the UI.** Experimental SSH remote access installs a
   host package; the host owns provider processes and the session database, so
   closing the desktop or losing the tunnel does not stop host
   sessions.[^remote-l1-l24] Matches llame's transport-neutral Run worker
   direction more than an in-process PTY UI.
7. **Stream coalesce.** Rust harness stdout is batched on a ~16 ms window with a
   500 ms post-exit drain so grandchild pipes cannot strand the last
   lines.[^harness-coalesce-l63-l70] Applicable to any llame executor that
   multiplexes child stdout into persisted events.

**llame fit**

- High: items 1 to 3 as peer-adapter capability and transcript ownership.
- Moderate: items 5 and 6 for child-session tools and headless host Runs.
- Low: item 4 as storage; llame already uses Postgres with RLS.
- Avoid: treating MonoCode's session DB or Mono chats as a second conversation
  authority beside `messages.parts`.

**Caution:** Device tokens for a paired host grant control as that OS user,
including provider execution and workspace reads.[^remote-l1-l24] There is no
llame-style authenticated tenant boundary. Product is early; mechanism details
may change.

[^readme-l15-l39]: [Subscription agents, tabs as sessions, worktrees and /operator](https://github.com/hardbeat920/monocode/blob/b653a397d180d98097a5f214e9bbdae68d837239/README.md#L15-L39)

[^readme-l69-l71]: [MIT license declaration](https://github.com/hardbeat920/monocode/blob/b653a397d180d98097a5f214e9bbdae68d837239/README.md#L69-L71)

[^license-l1-l10]: [MIT license text](https://github.com/hardbeat920/monocode/blob/b653a397d180d98097a5f214e9bbdae68d837239/LICENSE#L1-L10)

[^providers-l1-l21]: [Probe installed CLIs; reuse existing logins](https://github.com/hardbeat920/monocode/blob/b653a397d180d98097a5f214e9bbdae68d837239/docs/providers.md#L1-L21)

[^agent-access-l1-l18]: [/operator thread-scoped app CLI and session actions](https://github.com/hardbeat920/monocode/blob/b653a397d180d98097a5f214e9bbdae68d837239/docs/agent-access.md#L1-L18)

[^remote-l1-l24]: [Host-owned sessions over SSH; desktop exit does not stop them](https://github.com/hardbeat920/monocode/blob/b653a397d180d98097a5f214e9bbdae68d837239/docs/remote-access.md#L1-L24)

[^harness-events-l13-l32]: [HarnessEvent session and turn wire discriminators](https://github.com/hardbeat920/monocode/blob/b653a397d180d98097a5f214e9bbdae68d837239/src/integrations/harness/core/types.ts#L13-L32)

[^harness-session-l161-l189]: [HarnessSessionInput: MonoCode owns transcript; ephemeral provider context](https://github.com/hardbeat920/monocode/blob/b653a397d180d98097a5f214e9bbdae68d837239/src/integrations/harness/core/types.ts#L161-L189)

[^host-providers-l37-l74]: [HostProvider send/cancel/approve surface per RemoteProvider](https://github.com/hardbeat920/monocode/blob/b653a397d180d98097a5f214e9bbdae68d837239/host/providers.ts#L37-L74)

[^session-store-l12-l53]: [SQLite sessions table with blocks_json and WAL](https://github.com/hardbeat920/monocode/blob/b653a397d180d98097a5f214e9bbdae68d837239/src-tauri/src/session_store.rs#L12-L53)

[^harness-coalesce-l63-l70]: [Stdout coalesce window and post-exit drain wait](https://github.com/hardbeat920/monocode/blob/b653a397d180d98097a5f214e9bbdae68d837239/src-tauri/src/harness.rs#L63-L70)
