---
type: Reference
title: "Baro"
description: "Contract-first DAG orchestration, lease correlation, and fail-closed acceptance"
resource: "https://github.com/jigjoy-ai/baro"
observed:
  date: "2026-09-11"
  revision: "5e6a5abcc37c6c01effd049796ec88e63170a9a6"
sources:
  - id: baro-readme-l8-l11
    resource: "https://github.com/jigjoy-ai/baro/blob/5e6a5abcc37c6c01effd049796ec88e63170a9a6/README.md#L8-L11"
    title: "software-factory contract"
  - id: baro-readme-l80-l91
    resource: "https://github.com/jigjoy-ai/baro/blob/5e6a5abcc37c6c01effd049796ec88e63170a9a6/README.md#L80-L91"
    title: "runtime model"
  - id: baro-goal-contract-ts-l26-l40
    resource: "https://github.com/jigjoy-ai/baro/blob/5e6a5abcc37c6c01effd049796ec88e63170a9a6/packages/baro-orchestrator/src/goal/goal-contract.ts#L26-L40"
    title: "goal contract"
  - id: baro-collective-runtime-md-l80-l109
    resource: "https://github.com/jigjoy-ai/baro/blob/5e6a5abcc37c6c01effd049796ec88e63170a9a6/docs/collective-runtime.md#L80-L109"
    title: "authority and correlation"
  - id: baro-story-executor-ts-l31-l85
    resource: "https://github.com/jigjoy-ai/baro/blob/5e6a5abcc37c6c01effd049796ec88e63170a9a6/packages/baro-orchestrator/src/execution/story-executor.ts#L31-L85"
    title: "executor capability boundary"
  - id: baro-acceptance-gate-ts-l63-l67
    resource: "https://github.com/jigjoy-ai/baro/blob/5e6a5abcc37c6c01effd049796ec88e63170a9a6/packages/baro-orchestrator/src/acceptance/acceptance-gate.ts#L63-L67"
    title: "acceptance gate"
  - id: baro-semantic-events-ts-l1-l10
    resource: "https://github.com/jigjoy-ai/baro/blob/5e6a5abcc37c6c01effd049796ec88e63170a9a6/packages/baro-orchestrator/src/semantic-events.ts#L1-L10"
    title: "replayable semantic events"
  - id: baro-auditor-ts-l44-l149
    resource: "https://github.com/jigjoy-ai/baro/blob/5e6a5abcc37c6c01effd049796ec88e63170a9a6/packages/baro-orchestrator/src/execution/auditor.ts#L44-L149"
    title: "audit persistence"
  - id: baro-collective-experiment-md-l75-l87
    resource: "https://github.com/jigjoy-ai/baro/blob/5e6a5abcc37c6c01effd049796ec88e63170a9a6/docs/collective-experiment.md#L75-L87"
    title: "resume identity limit"
  - id: baro-collective-experiment-md-l191-l202
    resource: "https://github.com/jigjoy-ai/baro/blob/5e6a5abcc37c6c01effd049796ec88e63170a9a6/docs/collective-experiment.md#L191-L202"
    title: "local-only boundary"
  - id: baro-license-l1-l13
    resource: "https://github.com/jigjoy-ai/baro/blob/5e6a5abcc37c6c01effd049796ec88e63170a9a6/LICENSE#L1-L13"
    title: "MIT license"
---

# Baro

- **Stack:** Rust TUI host plus TypeScript orchestrator over the Mozaik event
  runtime; the repository has Cargo and npm workspaces.[^baro-readme-l80-l91]
  **License:** MIT.[^baro-license-l1-l13]

Moderate-confidence reference for future execution and coordination. It is
useful for future child-agent and Workspace adapters; its operator session and
run registry are not an alternative to llame's owner-scoped Chat/Run system.

**Study**

F68 — **Contract-first work decomposition.** Baro turns a goal into a
machine-checkable contract, maps work into a DAG, and blocks integration behind
declared tests, build checks, evidence review, and write-surface ownership.[^baro-readme-l8-l11]
Its `GoalContract` is provider-neutral, fingerprinted from exact intent, and
contains acceptance/constraint invariants, non-goals, and assumptions.[^baro-goal-contract-ts-l26-l40]
The llame mapping is a future child Run contract: preserve the parent Run's
goal/provenance and map each child result to explicit obligations before a
Workspace publication or parent completion. Do not import Baro's PRD as a
second Chat/Run authority; VISION already makes child Chats/Runs inspectable
and keeps identity and lifecycle in llame.

F69 — **Correlation is part of authority.** Baro's collective-runtime contract requires exact participant
authority plus `run/story/lease/generation` correlation for results, replans,
integration, and verification; the Board alone commits graph state, while
workers receive lease-scoped capabilities.[^baro-collective-runtime-md-l80-l109]
The executor interface carries an opaque token bound to that correlation and
explicitly forbids substituting manager-private session or filesystem state for
a worker capability. This interface contract alone is not proof of enforcement
by every custom executor.[^baro-story-executor-ts-l31-l85]
For ACP/A2A or other llame adapters, carry llame's Run and child execution
identity through the adapter, bind accepted results to the issuing authority,
and keep cancellation, publication, and tenant scope in llame. A peer must not
mint a Chat/Run identity or turn a bearer capability into owner authorization.

F70 — **Acceptance and replay need typed evidence.** Baro's acceptance gate
correlates a successful leased result with the exact Critic verdict for its
terminal turn and fails closed when the evidence is absent.[^baro-acceptance-gate-ts-l63-l67]
Its semantic events preserve stable wire discriminators across JSON replay,[^baro-semantic-events-ts-l1-l10]
and its optional auditor writes bus/model/tool items as JSONL with lease
bearers fingerprinted before writing. That logger is best effort: its first
write failure disables later writes, so it cannot establish durable acceptance
evidence.[^baro-auditor-ts-l44-l149] llame already persists owner-scoped Run
events and immutable context receipts. Carry correlated child acceptance
evidence through that required durable path; treat Baro's file logger as
supplementary diagnostics only.

F71 — **Scope and recovery limits.** Baro's same-run runtime ledger can restore
decisions only when resuming the exact `runId`; the public CLI currently creates
a new run identity after a normal restart and does not expose the old decision
ledger.[^baro-collective-experiment-md-l75-l87] Its `--local-only` mode still
allows arbitrary shell commands and is not an OS/network sandbox.[^baro-collective-experiment-md-l191-l202]
The inspected design therefore supplies no llame-style authenticated tenant or
PostgreSQL-RLS boundary. Use Baro for bounded orchestration, lease correlation,
and acceptance policy; retain llame's durable Run recovery and isolation
contracts as the authority.

[^baro-readme-l8-l11]: [software-factory contract](https://github.com/jigjoy-ai/baro/blob/5e6a5abcc37c6c01effd049796ec88e63170a9a6/README.md#L8-L11)

[^baro-goal-contract-ts-l26-l40]: [goal contract](https://github.com/jigjoy-ai/baro/blob/5e6a5abcc37c6c01effd049796ec88e63170a9a6/packages/baro-orchestrator/src/goal/goal-contract.ts#L26-L40)

[^baro-collective-runtime-md-l80-l109]: [authority and correlation](https://github.com/jigjoy-ai/baro/blob/5e6a5abcc37c6c01effd049796ec88e63170a9a6/docs/collective-runtime.md#L80-L109)

[^baro-story-executor-ts-l31-l85]: [executor capability boundary](https://github.com/jigjoy-ai/baro/blob/5e6a5abcc37c6c01effd049796ec88e63170a9a6/packages/baro-orchestrator/src/execution/story-executor.ts#L31-L85)

[^baro-acceptance-gate-ts-l63-l67]: [acceptance gate](https://github.com/jigjoy-ai/baro/blob/5e6a5abcc37c6c01effd049796ec88e63170a9a6/packages/baro-orchestrator/src/acceptance/acceptance-gate.ts#L63-L67)

[^baro-semantic-events-ts-l1-l10]: [replayable semantic events](https://github.com/jigjoy-ai/baro/blob/5e6a5abcc37c6c01effd049796ec88e63170a9a6/packages/baro-orchestrator/src/semantic-events.ts#L1-L10)

[^baro-auditor-ts-l44-l149]: [audit persistence](https://github.com/jigjoy-ai/baro/blob/5e6a5abcc37c6c01effd049796ec88e63170a9a6/packages/baro-orchestrator/src/execution/auditor.ts#L44-L149)

[^baro-collective-experiment-md-l75-l87]: [resume identity limit](https://github.com/jigjoy-ai/baro/blob/5e6a5abcc37c6c01effd049796ec88e63170a9a6/docs/collective-experiment.md#L75-L87)

[^baro-collective-experiment-md-l191-l202]: [local-only boundary](https://github.com/jigjoy-ai/baro/blob/5e6a5abcc37c6c01effd049796ec88e63170a9a6/docs/collective-experiment.md#L191-L202)

[^baro-license-l1-l13]: [MIT license](https://github.com/jigjoy-ai/baro/blob/5e6a5abcc37c6c01effd049796ec88e63170a9a6/LICENSE#L1-L13)

[^baro-readme-l80-l91]: [runtime model](https://github.com/jigjoy-ai/baro/blob/5e6a5abcc37c6c01effd049796ec88e63170a9a6/README.md#L80-L91)
