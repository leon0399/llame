# Thin surfaces, operable Nodes, and later Personal Realm synchronization

## Repository evidence

This analysis uses VISION.md and SPEC.md **inside round-two bundle c800bd0**,
not the older, separately attached June 2026 copies. The bundle's research
`docs/research/product-vision/2026-08-21-local-nodes-workspaces-and-distributed-execution.md`
sections 5.10 and 5.14 distinguish a Node protocol from Personal Realm replication.
The current CLI has a complete local loop but embeds it in a terminal application.
The hosted node already owns its own authorized recall, Knowledge and MCP loop.

## Alternatives considered

A remote-only terminal is small but removes independent local operation. Running
NestJS/Postgres for every terminal would reuse hosted services at an unjustified
installation cost and still would not define replication. Leaving all execution
inside the CLI duplicates runtime ownership when desktop/daemon clients arrive.
A transport-neutral Node with an automatically launched local process provides
the useful client/server boundary without either requirement.

Therefore choose **thin Surface, capable local Node, optional remote authority**.
Personal Realm is an ownership/reconciliation boundary, not a service the terminal
must log in to. A private local Node already makes search and tools native. Sync
has distinct semantic work and cannot be obtained merely by adding a server.

## External evidence (consulted 2026-09-05)

- OpenCode server documentation: https://opencode.ai/docs/server/ — TUI and
  server are separate; a headless server exposes an OpenAPI surface. Adopt
  separation, not its optional network-auth defaults.
- Codex app-server: https://developers.openai.com/codex/app-server — clients
  use a bidirectional protocol for events and approvals.
- OpenAI engineering account: https://openai.com/index/unlocking-the-codex-harness/
  — separates protocol translation, thread management and core execution.
- Goose architecture: https://goose-docs.ai/docs/goose-architecture/ — separates
  interface, agent and extensions. Process placement and runtime ownership are
  different decisions.

These references motivate boundaries. They do not prove this implementation's
correctness or promise interoperability with their protocols. No upstream code
is copied. Repository agents-best-practices and Turborepo skills inform bounded
loops, instruction/authority separation, source-attributed retrieval and package
build ownership.

## Concrete next slice

Extract the current personal loop, store and tool host. Use bounded JSON-RPC over
private stdio or a 0600 Unix socket beneath the 0700 data directory. Require
core negotiation; advertise only implemented module versions. A foreground
`node serve` makes local execution independently persistent. With no server,
the CLI starts and owns its child process automatically. A dead existing socket
is an error, never an excuse to silently choose another executor.

Native placement is fixed by the Node's startup grant. A persistent Node starts
without it unless the owner explicitly provides --native and --cwd. A terminal
may decline that capability but cannot enlarge it. Read-only Knowledge access
is not native Workspace execution.

Use source-attributed bounded literal search over a rebuildable SQLite projection
of user/assistant text, not tools/reasoning or all serialized Run events. Keep
original transcripts intact. Provision private Markdown spaces with stable UUIDs
and reuse the hosted filesystem adapter for live reads. No embeddings provider,
background summarizer or replication account is required.

## What follows, not what this cut claims

First unify the hosted implementation against the concrete Node schemas where
semantics already match; do not hide missing capabilities. Then define the first
replicated episodic core per existing research: stable identities and parent
anchors, normalized semantic checkpoints and receipts, transactional ChangeBatch
journal, authenticated enrollment, idempotent reception and explicit coverage.
Knowledge remains Git-reconciled rather than copied as database rows. Offline
shared writes remain proposals to their own authority. Secrets, host paths,
provider/MCP configuration, raw token/progress events and derived indexes remain
excluded. Receipt replication never re-authorizes a tool or resumes an uncertain
side effect. Multiwriter settings, general permissions and deletion semantics
need separate contracts; do not improvise last-write-wins for them.
