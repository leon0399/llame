---
okf_version: "0.2"
---

# Tools and harness extensions

Noncanonical references for components used by agentic harnesses: plugins,
standalone tools, supporting services and prompt utilities. These components
supply capabilities or transform inputs/results; the hosting harness owns the
agent execution context and tool-use loop.

[Agentic runtimes and orchestration hosts](../harnesses/index.md) and
[format specifications](../formats/index.md) have separate indexes. Calling an
LLM, exposing MCP tools or keeping a local session file does not by itself make
a component an agentic harness.

SPEC, OpenSpec and shipped code remain authoritative for llame. Each entry's
`observed` date/revision describes its source inspection, not adoption or
independently reproduced performance.

## Harness extensions

- [SoL-Pi](./sol-pi.md) — Pi extensions for evidence-preserving tool-result
  projections and context reduction.
- [Spotify Shunt](./spotify-shunt.md) — Claude Code hooks, skills and delegated
  bulk-reading helpers.
- [parsec](./parsec.md) — Proxy/plugin gates and cache-aware history reduction
  around existing coding harnesses.

## Search and knowledge tools

- [jegrep](./jegrep.md) — Standalone staged semantic source search using typed
  judgments.
- [agent-memory](./agent-memory.md) — Derived memory indexes and federated
  retrieval.
- [gbrain](./gbrain.md) — File-backed knowledge and provenance-aware recall.
- [Graphify](./graphify.md) — Graph extraction, derived indexes and MCP queries.

## Work and prompt utilities

- [beads](./beads.md) — Dependency-aware work tracking, claims and trace retention.
- [Fabric](./fabric.md) — Named prompt patterns, reusable contexts and template
  extensions.

## Related studies

- [System One/Jev](../tool-harness/2026-09-23-system-one-jev/index.md) — Typed
  decisions, cookbook applicability and llame use cases.
- [Question-directed readers](../tool-harness/2026-09-23-question-directed-read/index.md) —
  Selected-source answers, scoped investigation and reader-model tradeoffs.
- [Semantic find/JUDGE](../tool-harness/2026-09-24-semantic-find-judge/index.md) —
  OMP's runtime integration, jegrep's algorithm and benchmark limitations.
