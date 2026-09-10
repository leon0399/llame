---
type: Reference
title: "beads"
description: "Dependency-aware work tracking, claims, and trace retention"
resource: "https://github.com/gastownhall/beads"
observed:
  date: "2026-09-10"
  revision: "a690b0a8c4d1ddc4f0bd9bf767499625dd71bc96"
sources:
  - id: internal-storage-issueops-ready-work-go-l44-l72
    resource: "https://github.com/gastownhall/beads/blob/a690b0a8c4d1ddc4f0bd9bf767499625dd71bc96/internal/storage/issueops/ready_work.go#L44-L72"
    title: "Ready-work computation"
  - id: internal-storage-issueops-claim-go-l245-l300
    resource: "https://github.com/gastownhall/beads/blob/a690b0a8c4d1ddc4f0bd9bf767499625dd71bc96/internal/storage/issueops/claim.go#L245-L300"
    title: "ready-and-claim"
  - id: internal-storage-issueops-lease-go-l45-l87
    resource: "https://github.com/gastownhall/beads/blob/a690b0a8c4d1ddc4f0bd9bf767499625dd71bc96/internal/storage/issueops/lease.go#L45-L87"
    title: "co-mutation invariant"
  - id: docs-workflows-wisps-md
    resource: "https://github.com/gastownhall/beads/blob/a690b0a8c4d1ddc4f0bd9bf767499625dd71bc96/docs/workflows/wisps.md"
    title: "Wisps"
  - id: cmd-bd-mol-squash-go-l268-l300
    resource: "https://github.com/gastownhall/beads/blob/a690b0a8c4d1ddc4f0bd9bf767499625dd71bc96/cmd/bd/mol_squash.go#L268-L300"
    title: "squashed into a durable digest"
  - id: cmd-bd-prime-go-l519-l587
    resource: "https://github.com/gastownhall/beads/blob/a690b0a8c4d1ddc4f0bd9bf767499625dd71bc96/cmd/bd/prime.go#L519-L587"
    title: "Memory injection"
  - id: internal-httpapi-auth-go-l16-l27
    resource: "https://github.com/gastownhall/beads/blob/a690b0a8c4d1ddc4f0bd9bf767499625dd71bc96/internal/httpapi/auth.go#L16-L27"
    title: "HTTP authentication"
---

# beads

- **Stack:** Go + Dolt, MIT

Distributed issue graph; high-confidence reference for deferred goals and work
coordination. Keep llame's [episodic memory](../../../SPEC.md#20-memory-and-search)
in Chats/Runs and its Knowledge in files.

**Study**

1. **F1: Readiness and claiming.** Typed dependencies distinguish blockers,
   hierarchy, and `discovered-from` provenance. Ready-work computation[^internal-storage-issueops-ready-work-go-l44-l72]
   expands parent descendants before building SQL; ready-and-claim[^internal-storage-issueops-claim-go-l245-l300]
   uses one transaction. Useful for future goal scheduling without making the
   model responsible for concurrency.
2. **F2: Liveness separate from history.** Clone-local leases avoid recording
   every heartbeat in Dolt history. The co-mutation invariant[^internal-storage-issueops-lease-go-l45-l87]
   names which claim/status writers must serialize with reclaim. Study the
   invariant; llame already has PostgreSQL locking and pg-boss recovery.
3. **F3: Explicit trace retention.** Wisps[^docs-workflows-wisps-md]
   can be discarded or squashed into a durable digest[^cmd-bd-mol-squash-go-l268-l300]. A future llame digest
   could summarize an outcome, but must not replace source messages or the
   event history required by its replay/provenance contract.

**Caution:** Memory injection[^cmd-bd-prime-go-l519-l587]
is alphabetic flat KV without timestamps. Its elision count and browse command
are useful; its byte cap can be exceeded by the first entry. The
HTTP authentication[^internal-httpapi-auth-go-l16-l27]
accepts shared bearer tokens for the whole surface, without user identity or
per-record authorization.

**Deep dives**

- [docs/research/long-term-memory/2026-07-09-beads.md](../long-term-memory/2026-07-09-beads.md)

[^internal-storage-issueops-ready-work-go-l44-l72]: [Ready-work computation](https://github.com/gastownhall/beads/blob/a690b0a8c4d1ddc4f0bd9bf767499625dd71bc96/internal/storage/issueops/ready_work.go#L44-L72)

[^internal-storage-issueops-claim-go-l245-l300]: [ready-and-claim](https://github.com/gastownhall/beads/blob/a690b0a8c4d1ddc4f0bd9bf767499625dd71bc96/internal/storage/issueops/claim.go#L245-L300)

[^internal-storage-issueops-lease-go-l45-l87]: [co-mutation invariant](https://github.com/gastownhall/beads/blob/a690b0a8c4d1ddc4f0bd9bf767499625dd71bc96/internal/storage/issueops/lease.go#L45-L87)

[^docs-workflows-wisps-md]: [Wisps](https://github.com/gastownhall/beads/blob/a690b0a8c4d1ddc4f0bd9bf767499625dd71bc96/docs/workflows/wisps.md)

[^cmd-bd-mol-squash-go-l268-l300]: [squashed into a durable digest](https://github.com/gastownhall/beads/blob/a690b0a8c4d1ddc4f0bd9bf767499625dd71bc96/cmd/bd/mol_squash.go#L268-L300)

[^cmd-bd-prime-go-l519-l587]: [Memory injection](https://github.com/gastownhall/beads/blob/a690b0a8c4d1ddc4f0bd9bf767499625dd71bc96/cmd/bd/prime.go#L519-L587)

[^internal-httpapi-auth-go-l16-l27]: [HTTP authentication](https://github.com/gastownhall/beads/blob/a690b0a8c4d1ddc4f0bd9bf767499625dd71bc96/internal/httpapi/auth.go#L16-L27)
