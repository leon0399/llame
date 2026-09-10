---
type: Reference
title: "Buzz"
description: "Formal isolation models to compare with runtime enforcement"
resource: "https://github.com/block/buzz/tree/051c3a270be9c73da9ab06700bcab7d5552fceaa"
observed:
  date: "2026-09-10"
  revision: "051c3a270be9c73da9ab06700bcab7d5552fceaa"
sources:
  - id: docs-multi-tenant-relay-md-l344-l374
    resource: "https://github.com/block/buzz/blob/051c3a270be9c73da9ab06700bcab7d5552fceaa/docs/multi-tenant-relay.md#L344-L374"
    title: "multi-tenant axioms"
  - id: docs-multi-tenant-conformance-md-l14-l36
    resource: "https://github.com/block/buzz/blob/051c3a270be9c73da9ab06700bcab7d5552fceaa/docs/multi-tenant-conformance.md#L14-L36"
    title: "conformance row"
  - id: crates-buzz-core-src-tenant-rs-l1-l15
    resource: "https://github.com/block/buzz/blob/051c3a270be9c73da9ab06700bcab7d5552fceaa/crates/buzz-core/src/tenant.rs#L1-L15"
    title: "TenantContext"
  - id: docs-multi-tenant-conformance-md-l25-l30
    resource: "https://github.com/block/buzz/blob/051c3a270be9c73da9ab06700bcab7d5552fceaa/docs/multi-tenant-conformance.md#L25-L30"
    title: "conformance contract"
  - id: docs-nips-nip-rs-md-l370-l377
    resource: "https://github.com/block/buzz/blob/051c3a270be9c73da9ab06700bcab7d5552fceaa/docs/nips/NIP-RS.md#L370-L377"
    title: "NIP-RS completeness"
  - id: crates-buzz-workflow-src-lib-rs-l229-l254
    resource: "https://github.com/block/buzz/blob/051c3a270be9c73da9ab06700bcab7d5552fceaa/crates/buzz-workflow/src/lib.rs#L229-L254"
    title: "workflow approval path"
---

# Buzz

- **Stack:** Rust monorepo with TypeScript/Tauri desktop and Dart/Flutter mobile; Apache 2.0

Buzz is a self-hosted Nostr workspace where humans and agents share a signed event log. Its useful material is the explicit security contract around tenant context and synchronization. The relay derives a community from the connection host before handlers run, and its formal model states the deployment assumptions needed for RLS. NIP-RS also treats completeness as a state that must be established before destructive synchronization. Borrow these boundaries while keeping llame's durable pg-boss Run model.

**Study**

1. **F22: Deployment obligations.** The multi-tenant axioms[^docs-multi-tenant-relay-md-l344-l374] turn RLS, `NOBYPASSRLS`/`FORCE`, transaction-local scope, trusted functions, and tenant-qualified constraints into reviewable obligations; the conformance row[^docs-multi-tenant-conformance-md-l14-l36] binds every request to host-derived context.
2. **F23: Trusted tenant context.** `TenantContext`[^crates-buzz-core-src-tenant-rs-l1-l15] carries server-resolved identity and has no client deserialization path. The conformance contract[^docs-multi-tenant-conformance-md-l25-l30] requires rejecting host/token disagreement.
3. **F24: Incomplete synchronization.** NIP-RS completeness[^docs-nips-nip-rs-md-l370-l377] forbids canonicalization, deletion, or success claims from an incomplete load.

**Applicability:** High for RLS and trusted scope binding; high for future Personal Realm synchronization; moderate for audit-log mechanics. **Confidence:** High for the documented contracts; moderate for implementation-wide compliance. **Caution:** the formal guarantees are conditional on deployment assumptions, the relay remains centralized, and Buzz's workflow approval path[^crates-buzz-workflow-src-lib-rs-l229-l254] still has runtime gaps. Treat the documents as conformance requirements and audit targets, not proof that every deployed path satisfies them.

[^docs-multi-tenant-relay-md-l344-l374]: [multi-tenant axioms](https://github.com/block/buzz/blob/051c3a270be9c73da9ab06700bcab7d5552fceaa/docs/multi-tenant-relay.md#L344-L374)

[^docs-multi-tenant-conformance-md-l14-l36]: [conformance row](https://github.com/block/buzz/blob/051c3a270be9c73da9ab06700bcab7d5552fceaa/docs/multi-tenant-conformance.md#L14-L36)

[^crates-buzz-core-src-tenant-rs-l1-l15]: [`TenantContext`](https://github.com/block/buzz/blob/051c3a270be9c73da9ab06700bcab7d5552fceaa/crates/buzz-core/src/tenant.rs#L1-L15)

[^docs-multi-tenant-conformance-md-l25-l30]: [conformance contract](https://github.com/block/buzz/blob/051c3a270be9c73da9ab06700bcab7d5552fceaa/docs/multi-tenant-conformance.md#L25-L30)

[^docs-nips-nip-rs-md-l370-l377]: [NIP-RS completeness](https://github.com/block/buzz/blob/051c3a270be9c73da9ab06700bcab7d5552fceaa/docs/nips/NIP-RS.md#L370-L377)

[^crates-buzz-workflow-src-lib-rs-l229-l254]: [workflow approval path](https://github.com/block/buzz/blob/051c3a270be9c73da9ab06700bcab7d5552fceaa/crates/buzz-workflow/src/lib.rs#L229-L254)
