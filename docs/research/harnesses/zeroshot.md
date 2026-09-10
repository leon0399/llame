---
type: Reference
title: "Zeroshot"
description: "Bounded orchestration graphs and reconnect contracts"
resource: "https://github.com/the-open-engine/zeroshot"
sources:
  - id: crates-openengine-cluster-server-src-graph-verifier-rs-l20-l79
    resource: "https://github.com/the-open-engine/zeroshot/blob/e1d66438ccfd91e3296deea5482204baeacc7cee/crates/openengine-cluster-server/src/graph_verifier.rs#L20-L79"
    title: "graph verifier"
  - id: crates-openengine-cluster-server-src-graph-verifier-analyzer-bounds-rs
    resource: "https://github.com/the-open-engine/zeroshot/blob/e1d66438ccfd91e3296deea5482204baeacc7cee/crates/openengine-cluster-server/src/graph_verifier/analyzer_bounds.rs"
    title: "bound analyzer"
  - id: zeroshot-src-v2-run-ledger-sqlite-rs
    resource: "https://github.com/the-open-engine/zeroshot/blob/e1d66438ccfd91e3296deea5482204baeacc7cee/zeroshot/src/v2_run_ledger/sqlite.rs"
    title: "local ledger"
  - id: docs-reference-cluster-watch-md-l57-l83
    resource: "https://github.com/the-open-engine/zeroshot/blob/e1d66438ccfd91e3296deea5482204baeacc7cee/docs/reference/cluster/watch.md#L57-L83"
    title: "watch contract"
  - id: zeroshot-src-native-v2-runner-plan-rs-l3-l69
    resource: "https://github.com/the-open-engine/zeroshot/blob/e1d66438ccfd91e3296deea5482204baeacc7cee/zeroshot/src/native_v2_runner/plan.rs#L3-L69"
    title: "node role plan"
  - id: docs-concepts-targets-md
    resource: "https://github.com/the-open-engine/zeroshot/blob/e1d66438ccfd91e3296deea5482204baeacc7cee/docs/concepts/targets.md"
    title: "local target"
---

# Zeroshot

- **Stack:** Rust; SQLite local ledger; cluster protocol adapters; MIT
- **Observed:** 2026-09-10 @ `e1d66438ccfd91e3296deea5482204baeacc7cee`

High-confidence reference for deferred meta-harness orchestration. Codex and
Claude execute nodes in a caller-authored graph. This is later work under
[VISION.md](../../../VISION.md#runs-are-the-unit-of-execution), not a dependency
of llame's current single-agent knowledge loop.

**Study**

1. **F7: Validate control flow before execution.** The graph verifier[^crates-openengine-cluster-server-src-graph-verifier-rs-l20-l79]
   checks a typed graph before worker lookup. Its bound analyzer[^crates-openengine-cluster-server-src-graph-verifier-analyzer-bounds-rs]
   folds sequence, parallel, loop, and map structure into execution/concurrency
   ceilings. Borrow deterministic admission and bounded repair; adopting the
   entire graph language would be a separate architecture decision.
2. **F8: Explicit reconnect behavior.** The local ledger[^zeroshot-src-v2-run-ledger-sqlite-rs]
   appends events and updates the projection transactionally. The watch contract[^docs-reference-cluster-watch-md-l57-l83]
   specifies at-least-once delivery, cursor-based deduplication, and slow-consumer
   closure with a resumable cursor. Compare those guarantees with llame's Run
   reconnect behavior; keep PostgreSQL and pg-boss as its current authority.
3. **F9: Bind roles outside model output.** An immutable node role plan[^zeroshot-src-native-v2-runner-plan-rs-l3-l69]
   rejects changed worker/instruction/runtime bindings and assigns verifier
   read-only versus worker/delivery exclusive workspace access. This informs
   future peer adapters whose scope is resolved by llame, not by an agent's
   claimed role.

**Caution:** A read-only workspace role alone is not proof of OS confinement.
The local target[^docs-concepts-targets-md]
uses the caller's worktree and host-user authority; the direct target delegates
authentication to its deployment boundary. Its graph and local ledger do not
provide llame's RLS tenancy or authorize cross-node execution transfer.

[^crates-openengine-cluster-server-src-graph-verifier-rs-l20-l79]: [graph verifier](https://github.com/the-open-engine/zeroshot/blob/e1d66438ccfd91e3296deea5482204baeacc7cee/crates/openengine-cluster-server/src/graph_verifier.rs#L20-L79)

[^crates-openengine-cluster-server-src-graph-verifier-analyzer-bounds-rs]: [bound analyzer](https://github.com/the-open-engine/zeroshot/blob/e1d66438ccfd91e3296deea5482204baeacc7cee/crates/openengine-cluster-server/src/graph_verifier/analyzer_bounds.rs)

[^zeroshot-src-v2-run-ledger-sqlite-rs]: [local ledger](https://github.com/the-open-engine/zeroshot/blob/e1d66438ccfd91e3296deea5482204baeacc7cee/zeroshot/src/v2_run_ledger/sqlite.rs)

[^docs-reference-cluster-watch-md-l57-l83]: [watch contract](https://github.com/the-open-engine/zeroshot/blob/e1d66438ccfd91e3296deea5482204baeacc7cee/docs/reference/cluster/watch.md#L57-L83)

[^zeroshot-src-native-v2-runner-plan-rs-l3-l69]: [node role plan](https://github.com/the-open-engine/zeroshot/blob/e1d66438ccfd91e3296deea5482204baeacc7cee/zeroshot/src/native_v2_runner/plan.rs#L3-L69)

[^docs-concepts-targets-md]: [local target](https://github.com/the-open-engine/zeroshot/blob/e1d66438ccfd91e3296deea5482204baeacc7cee/docs/concepts/targets.md)
