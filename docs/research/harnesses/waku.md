---
type: Reference
title: "Waku"
description: "GPL-3.0-only Rust/GPUI coding-agent desktop: waku-daemon owns provider sessions over a versioned WebSocket protocol, with steer-or-queue and Git checkpoints."
tags: [harness, peer-executor, desktop, daemon, acp, gpl, steer]
status: draft
resource: "https://github.com/egoist/waku/tree/10bcd728c9b2f07d664cfece3c8c870d3418ddd2"
observed:
  date: "2026-10-17"
  revision: "10bcd728c9b2f07d664cfece3c8c870d3418ddd2"
sources:
  - id: waku-readme-l1-l5
    resource: "https://github.com/egoist/waku/blob/10bcd728c9b2f07d664cfece3c8c870d3418ddd2/README.md#L1-L5"
    title: "native desktop for local coding agents; local transcripts"
  - id: waku-readme-l29-l51
    resource: "https://github.com/egoist/waku/blob/10bcd728c9b2f07d664cfece3c8c870d3418ddd2/README.md#L29-L51"
    title: "supported agents; queue/steer; checkpoints; no Waku account"
  - id: waku-readme-l53-l82
    resource: "https://github.com/egoist/waku/blob/10bcd728c9b2f07d664cfece3c8c870d3418ddd2/README.md#L53-L82"
    title: "desktop as RPC client of waku-daemon; loopback auth token"
  - id: waku-readme-l118-l120
    resource: "https://github.com/egoist/waku/blob/10bcd728c9b2f07d664cfece3c8c870d3418ddd2/README.md#L118-L120"
    title: "GPL-3.0-only license statement"
  - id: waku-cargo-l1-l6
    resource: "https://github.com/egoist/waku/blob/10bcd728c9b2f07d664cfece3c8c870d3418ddd2/Cargo.toml#L1-L6"
    title: "Cargo.toml license = GPL-3.0-only"
  - id: waku-providers-l11-l56
    resource: "https://github.com/egoist/waku/blob/10bcd728c9b2f07d664cfece3c8c870d3418ddd2/docs/providers.md#L11-L56"
    title: "driver transports including ACP; supports_steer and queue fallback"
  - id: waku-driver-l91-l98
    resource: "https://github.com/egoist/waku/blob/10bcd728c9b2f07d664cfece3c8c870d3418ddd2/crates/waku-core/src/driver/mod.rs#L91-L98"
    title: "DriverHandle supports_steer and steer"
---

# Waku

- **Stack:** Rust/GPUI desktop, `waku-daemon` + `waku-core` providers, generated
  TypeScript browser client; Bun for protocol checks.[^waku-readme-l53-l82]
  **License:** GNU GPL v3.0 **only** (`GPL-3.0-only` in Cargo.toml; README and
  `LICENSE` agree). Copyleft: incorporating Waku code into a proprietary product
  is not available under this license without full GPL compliance.[^waku-readme-l118-l120][^waku-cargo-l1-l6]
  Site: [waku.sh](https://waku.sh). **Not** the React framework of the same name.

**Status:** Source and documentation inspection only; nothing was run. Local-first
control plane for peer coding-agent CLIs (Claude Code, Codex, Cursor CLI, OpenCode,
Pi, Amp, and others), with native structured protocols and session
continuity.[^waku-readme-l1-l5][^waku-readme-l29-l51] Neighbours: [Zeron](./zeron.md),
[Ghostex](./ghostex.md), [T3 Code](./t3-code.md). High confidence it is an
executor host. Study mechanisms; do not vendor under llame's license without a
separate legal decision.

**Study**

1. **Daemon owns durable state; desktop is disposable.** The native UI is an RPC
   client of `waku-daemon`. The daemon owns task SQLite, attachments,
   provider-native session forks, workspace filesystem and Git; paths always
   refer to the daemon host. Desktop keeps presentation and a disposable preview
   cache.[^waku-readme-l53-l82] Matches llame's API-plus-thin-web split.
2. **Versioned authenticated WebSocket contract.** Browser and Rust clients share
   handshake, request IDs, subscriptions, sequence dedupe and replay cursors;
   types are generated from Rust (`protocol:generate` /
   `protocol:check`).[^waku-readme-l53-l82] Template for a typed peer-control wire
   that is not Chat identity.
3. **Driver abstraction with per-transport sessions.** Seven transports behind
   eleven providers (Codex app-server, ACP for Cursor/Fx/Grok/Kimi, OpenCode HTTP+SSE,
   Pi NDJSON, Claude/Amp streaming, DeepSeek harness). Every transport holds a
   conversation-spanning session.[^waku-providers-l11-l56] llame adapters need the
   same transport matrix honesty.
4. **Steer capability flag + queue fallback.** `supports_steer` / `steer` inject
   into the running turn when the transport allows; otherwise the app queues a
   follow-up above the composer for the next turn.[^waku-providers-l11-l56][^waku-driver-l91-l98]
   Same checklist item as Zeron's harness trait; required before claiming mid-Run
   interrupt semantics.
5. **Loopback-default daemon exposure.** Settings can expose the child daemon on
   a fixed port with exact browser origins and a stable auth token; default remains
   loopback-only.[^waku-readme-l53-l82] Personal-machine trust, not RLS.
6. **Checkpoints and local-only product.** Queue/steer, Git-backed conversation-aware
   rewind, no Waku account or remote service.[^waku-readme-l29-l51] Useful recovery
   UX; Chat authority stays in llame Postgres.

**llame fit**

- High: items 1, 3 and 4 for daemon/UI split and ACP/steer adapter flags.
- Moderate: item 2 for generated wire types; item 6 for rewind UX ideas.
- Low: item 5 as a security model; llame needs authenticated tenant identity.
- Avoid: copying Waku source or linking its crates into a non-GPL product; treat
  as prior art only unless license posture changes.

**Caution:** GPL-3.0-only is a hard adoption boundary for proprietary or
permissively licensed products.[^waku-cargo-l1-l6] Remote daemon mode refuses to
interpret daemon paths on the client machine until host picker/PTY endpoints
exist.[^waku-readme-l53-l82] Computer-use and embedded browser remain
macOS-oriented in the inspected README.

[^waku-readme-l1-l5]: [native desktop for local coding agents; local transcripts](https://github.com/egoist/waku/blob/10bcd728c9b2f07d664cfece3c8c870d3418ddd2/README.md#L1-L5)

[^waku-readme-l29-l51]: [supported agents; queue/steer; checkpoints; no Waku account](https://github.com/egoist/waku/blob/10bcd728c9b2f07d664cfece3c8c870d3418ddd2/README.md#L29-L51)

[^waku-readme-l53-l82]: [desktop as RPC client of waku-daemon; loopback auth token](https://github.com/egoist/waku/blob/10bcd728c9b2f07d664cfece3c8c870d3418ddd2/README.md#L53-L82)

[^waku-readme-l118-l120]: [GPL-3.0-only license statement](https://github.com/egoist/waku/blob/10bcd728c9b2f07d664cfece3c8c870d3418ddd2/README.md#L118-L120)

[^waku-cargo-l1-l6]: [Cargo.toml license = GPL-3.0-only](https://github.com/egoist/waku/blob/10bcd728c9b2f07d664cfece3c8c870d3418ddd2/Cargo.toml#L1-L6)

[^waku-providers-l11-l56]: [driver transports including ACP; supports_steer and queue fallback](https://github.com/egoist/waku/blob/10bcd728c9b2f07d664cfece3c8c870d3418ddd2/docs/providers.md#L11-L56)

[^waku-driver-l91-l98]: [DriverHandle supports_steer and steer](https://github.com/egoist/waku/blob/10bcd728c9b2f07d664cfece3c8c870d3418ddd2/crates/waku-core/src/driver/mod.rs#L91-L98)
