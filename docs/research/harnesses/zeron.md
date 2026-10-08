---
type: Reference
title: "Zeron"
description: "Rust control plane that drives Claude Code, Codex, Cursor and other agents as subprocess executors, with a durable per-chat command ledger, event journal and optional CRDT multi-device sync."
tags: [harness, peer-executor, acp, durable-runs, command-queue, sync]
status: draft
resource: "https://github.com/zeronsh/zeron/tree/037f4c10d67a38175b2386e776aba54355b4e941"
generated:
  by: "claude-code/claude-opus-5-5"
  at: "2026-10-08"
observed:
  date: "2026-10-08"
  revision: "037f4c10d67a38175b2386e776aba54355b4e941"
sources:
  - id: readme-l1-l40
    resource: "https://github.com/zeronsh/zeron/blob/037f4c10d67a38175b2386e776aba54355b4e941/README.md#L1-L40"
    title: "Local-first control of coding agents, headless service and optional sync"
  - id: architecture-l16-l42
    resource: "https://github.com/zeronsh/zeron/blob/037f4c10d67a38175b2386e776aba54355b4e941/ARCHITECTURE.md#L16-L42"
    title: "Engine, viewport and edge topology; headed and headless modes"
  - id: architecture-l44-l78
    resource: "https://github.com/zeronsh/zeron/blob/037f4c10d67a38175b2386e776aba54355b4e941/ARCHITECTURE.md#L44-L78"
    title: "Auth state versus immutable WorkspaceScope and profile roots"
  - id: architecture-l80-l92
    resource: "https://github.com/zeronsh/zeron/blob/037f4c10d67a38175b2386e776aba54355b4e941/ARCHITECTURE.md#L80-L92"
    title: "Remote workspace file trust boundary and deferred self-hosting"
  - id: architecture-l96-l125
    resource: "https://github.com/zeronsh/zeron/blob/037f4c10d67a38175b2386e776aba54355b4e941/ARCHITECTURE.md#L96-L125"
    title: "Loro session document and durable command plane"
  - id: message-queue-l8-l55
    resource: "https://github.com/zeronsh/zeron/blob/037f4c10d67a38175b2386e776aba54355b4e941/docs/reference/message-queue.md#L8-L55"
    title: "Shared queue storage, delivery states and protected edit leases"
  - id: run-journal-l1-l11
    resource: "https://github.com/zeronsh/zeron/blob/037f4c10d67a38175b2386e776aba54355b4e941/crates/engine/src/run_journal.rs#L1-L11"
    title: "Per-chat JSONL event journal and crash recovery"
  - id: harness-trait-l83-l115
    resource: "https://github.com/zeronsh/zeron/blob/037f4c10d67a38175b2386e776aba54355b4e941/crates/harness/src/lib.rs#L83-L115"
    title: "Harness trait: steering, deterministic turn end"
  - id: acp-decision-l3-l21
    resource: "https://github.com/zeronsh/zeron/blob/037f4c10d67a38175b2386e776aba54355b4e941/docs/research/acp.md#L3-L21"
    title: "Decision to speak ACP and delete bespoke adapters"
  - id: acp-silence-l168-l180
    resource: "https://github.com/zeronsh/zeron/blob/037f4c10d67a38175b2386e776aba54355b4e941/docs/research/acp.md#L168-L180"
    title: "Pending prompts and the retired quiet timer"
---

# Zeron

- **Stack:** Rust workspace (tokio, gpui, Loro CRDT), TypeScript Cloudflare edge Worker and Durable Objects, WorkOS auth; MIT[^readme-l1-l40][^architecture-l16-l42]

**Status:** Source and documentation inspection only; nothing was run. A
meta-harness in llame's own sense: it owns the chat, its transcript and its run
history, and treats Claude Code, Codex, Cursor, Grok, Pi, Hermes, Devin and
Antigravity as executors it launches as subprocesses.[^readme-l1-l40] The closest
analogue to llame's peer-adapter direction in the bundle alongside
[Orca](./orca.md) and [bb](./bb.md). High confidence it is the most relevant of
the three to the ACP boundary; moderate confidence on durability claims, which
come from design documents and test names rather than executed tests.

**Study**

1. **Executor adapter surface.** A `Harness` trait exposes `supports_steering`,
   `steering_mode`, reasoning levels, install detection and two completion
   predicates: `deterministic_turn_end` (the agent's wire always ends a turn)
   and `authoritative_prompt_end`.[^harness-trait-l83-l115] The engine retires its
   quiet watchdog only for agents that declare a deterministic end. llame needs
   the same capability flags before any adapter can claim a Run is finished.
2. **ACP as the common wire.** Claude and Codex were moved onto ACP adapters and
   about 4,300 lines of bespoke stream-json and app-server code deleted;
   hand-rolled tolerant serde types were chosen over the official SDK to keep
   child-process hardening and raw updates visible.[^acp-decision-l3-l21] Accepted
   regressions are listed: steering semantics became adapter-defined and sandbox
   policy became adapter-owned. That list is the cost llame would pay.
3. **Silence is not completion.** A blanket 30 s quiet timer settled prompts that
   were still running, discarded the response future and let a second prompt
   hit a busy agent. The timer was retired; pending prompts keep their futures,
   and the engine exempts authoritative prompts from its stall watchdog.[^acp-silence-l168-l180]
   Directly applicable to any llame executor timeout.
4. **Durable command ledger.** Send, steer, interrupt and answer-input are
   append-only entries in the chat document; each device writes only its own
   entries, the chat host alone writes outcomes, and a pure evaluator returns
   skip, expired, superseded or execute. The host marks an entry
   processed before executing it.[^architecture-l96-l125] That is at-most-once
   delivery; llame's pg-boss Runs give at-least-once with an attempt token, so
   the ledger's dedupe and supersede rules transfer and its ordering does not.
5. **Message queue with leases.** Queued messages are a movable list with stable
   IDs; only the host delivers, a per-chat mutex serializes drains, steering
   is chosen only when the provider declares mid-turn support, and a failed
   dispatch restores the row. Edits take a 60 s host-issued lease that expires
   into `ReviewRequired` instead of silently releasing.[^message-queue-l8-l55]
   Moderate confidence this is the best published queue-edit contract in the
   bundle; llame has no queued-message surface yet.
6. **Event journal and recovery.** One append-only JSONL file per chat with a
   monotonic `seq`; `Subscribe` replays then tails the broadcast hub, and a journal
   whose last event is not `Done` is stamped `aborted` at boot.[^run-journal-l1-l11]
   Same replay-then-tail shape as llame's persisted run events, but on local
   files with no tenant boundary and no compaction yet.
7. **Local-first scope.** `WorkspaceScope` is fixed at startup and never
   re-resolved when credentials change, so a login or token refresh cannot swap
   the open store; profile roots separate local from org and user data.[^architecture-l44-l78]
   llame's equivalent is RLS identity bound at transaction start.
8. **Headless engine plus viewport.** One binary runs the engine in process or as
   a daemon; the UI speaks the same typed RPC over an in-memory duplex or a
   socket, and a VPS engine can be driven from a laptop.[^architecture-l16-l42] This
   matches llame's API-plus-thin-web split.

**llame fit**

- High: items 1 to 3 as the checklist for an ACP executor adapter.
- Moderate: items 4 and 5 for steer, interrupt and queued prompts.
- Low: item 6 on its own; llame already persists run events in Postgres.
- Avoid: the CRDT document as chat authority. Transcripts and commands live in
  Loro with host-only outcome writes, a second conversation authority next to
  llame's `messages.parts`.

**Caution:** Devices on one account are trusted peers for workspace files and
may read ignored files such as `.env`; the document declines a filename
denylist and states that hiding entries in the UI is no security control.[^architecture-l80-l92]
That is the opposite of llame's per-owner isolation, so no part of its remote
model transfers. Sync depends on a hosted Cloudflare edge and WorkOS, and a
supported self-hosted backend is explicitly deferred.[^architecture-l80-l92] The
document calls itself a fresh rewrite with no backwards compatibility, so
mechanism details may change.

[^readme-l1-l40]: [Local-first control of coding agents, headless service and optional sync](https://github.com/zeronsh/zeron/blob/037f4c10d67a38175b2386e776aba54355b4e941/README.md#L1-L40)

[^architecture-l16-l42]: [Engine, viewport and edge topology; headed and headless modes](https://github.com/zeronsh/zeron/blob/037f4c10d67a38175b2386e776aba54355b4e941/ARCHITECTURE.md#L16-L42)

[^architecture-l44-l78]: [Auth state versus immutable WorkspaceScope and profile roots](https://github.com/zeronsh/zeron/blob/037f4c10d67a38175b2386e776aba54355b4e941/ARCHITECTURE.md#L44-L78)

[^architecture-l80-l92]: [Remote workspace file trust boundary and deferred self-hosting](https://github.com/zeronsh/zeron/blob/037f4c10d67a38175b2386e776aba54355b4e941/ARCHITECTURE.md#L80-L92)

[^architecture-l96-l125]: [Loro session document and durable command plane](https://github.com/zeronsh/zeron/blob/037f4c10d67a38175b2386e776aba54355b4e941/ARCHITECTURE.md#L96-L125)

[^message-queue-l8-l55]: [Shared queue storage, delivery states and protected edit leases](https://github.com/zeronsh/zeron/blob/037f4c10d67a38175b2386e776aba54355b4e941/docs/reference/message-queue.md#L8-L55)

[^run-journal-l1-l11]: [Per-chat JSONL event journal and crash recovery](https://github.com/zeronsh/zeron/blob/037f4c10d67a38175b2386e776aba54355b4e941/crates/engine/src/run_journal.rs#L1-L11)

[^harness-trait-l83-l115]: [Harness trait: steering, deterministic turn end](https://github.com/zeronsh/zeron/blob/037f4c10d67a38175b2386e776aba54355b4e941/crates/harness/src/lib.rs#L83-L115)

[^acp-decision-l3-l21]: [Decision to speak ACP and delete bespoke adapters](https://github.com/zeronsh/zeron/blob/037f4c10d67a38175b2386e776aba54355b4e941/docs/research/acp.md#L3-L21)

[^acp-silence-l168-l180]: [Pending prompts and the retired quiet timer](https://github.com/zeronsh/zeron/blob/037f4c10d67a38175b2386e776aba54355b4e941/docs/research/acp.md#L168-L180)
