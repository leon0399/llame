---
type: Reference
title: "goose"
description: "ACP peer integration and tool approval boundaries"
resource: "https://github.com/aaif-goose/goose"
sources:
  - id: crates-goose-src-tool-inspection-rs-l10-l118
    resource: "https://github.com/aaif-goose/goose/blob/bea9954b9378d5129c5b2ba8ae8d663d034b6c52/crates/goose/src/tool_inspection.rs#L10-L118"
    title: "ToolInspector and result types"
  - id: crates-goose-src-tool-inspection-rs-l168-l257
    resource: "https://github.com/aaif-goose/goose/blob/bea9954b9378d5129c5b2ba8ae8d663d034b6c52/crates/goose/src/tool_inspection.rs#L168-L257"
    title: "inspection composition"
  - id: crates-goose-src-context-mgmt-mod-rs-l367-l505
    resource: "https://github.com/aaif-goose/goose/blob/bea9954b9378d5129c5b2ba8ae8d663d034b6c52/crates/goose/src/context_mgmt/mod.rs#L367-L505"
    title: "context reduction"
---

# goose

- **Stack:** Rust workspace with React/TypeScript desktop; Apache-2.0
- **Observed:** 2026-09-10 @ `bea9954b9378d5129c5b2ba8ae8d663d034b6c52`

Local agent with desktop, CLI, API, MCP, and ACP surfaces. High-confidence
reference for typed inspection outcomes and selective context reduction.
Its execution model remains distinct from llame's durable Runs.

**Study**

1. **Typed inspection outcomes.** `ToolInspector` and result types[^crates-goose-src-tool-inspection-rs-l10-l118] give each inspection a typed `Allow`, `Deny`, or
   `RequireApproval` result with reason, confidence, inspector name, and finding
   id. Inspectors run in order and restrictive composition preserves deny and
   approval decisions (inspection composition[^crates-goose-src-tool-inspection-rs-l168-l257]). This is a
   concrete shape for future llame approval policy, but the manager logs an inspector error and continues,
   so the pipeline is fail-open at that boundary.
2. **Selective context reduction.** Context management can summarize old tool-call/result pairs selectively before
   whole-conversation summarization. It computes a cutoff, preserves active calls,
   and processes bounded batches (context reduction[^crates-goose-src-context-mgmt-mod-rs-l367-l505]). llame would retain
   its canonical Chat/Run history alongside any executor-context reduction.

**Caution**

Goose is a single-user local application with SQLite and local configuration; no
tenant or RLS model was found in its own Rust/documentation tree. Copy the typed result shape
and restrictive merge rule only after putting them behind llame's fail-closed,
owner-scoped authorization boundary.

[^crates-goose-src-tool-inspection-rs-l10-l118]: [`ToolInspector` and result types](https://github.com/aaif-goose/goose/blob/bea9954b9378d5129c5b2ba8ae8d663d034b6c52/crates/goose/src/tool_inspection.rs#L10-L118)

[^crates-goose-src-tool-inspection-rs-l168-l257]: [inspection composition](https://github.com/aaif-goose/goose/blob/bea9954b9378d5129c5b2ba8ae8d663d034b6c52/crates/goose/src/tool_inspection.rs#L168-L257)

[^crates-goose-src-context-mgmt-mod-rs-l367-l505]: [context reduction](https://github.com/aaif-goose/goose/blob/bea9954b9378d5129c5b2ba8ae8d663d034b6c52/crates/goose/src/context_mgmt/mod.rs#L367-L505)
