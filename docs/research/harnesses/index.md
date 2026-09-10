---
okf_version: "0.2"
---

# Reference harnesses and prior art

Noncanonical research index for llame as a **meta-harness**: llame owns Chat/Run
identity, lifecycle, provenance, and isolation; peer coding agents and protocols
(ACP, A2A, and similar) are executor adapters. See [VISION.md](../../../VISION.md).

SPEC, OpenSpec, and shipped code win any disagreement with notes here. This bundle
records upstream repositories and in-repo deep dives only. Refresh a local clone
for line-level work via the `librarian` skill.

During alpha, **[OpenClaw](./openclaw.md) is the primary upstream implementation
reference for capabilities and behavior**. Consult its implementation first when
designing or implementing a capability, then use the other references for
targeted alternatives. Adapt its behavior to llame's ownership, lifecycle,
provenance, and isolation contracts; llame's specs remain authoritative.

The 2026-09-10 assessments inspected upstream source and test code without
executing it. Inclusion identifies a useful mechanism or comparison; adoption
still requires a llame decision and validation.

The `observed` frontmatter extension records the source inspection `date` and
upstream Git `revision`. It does not record document generation or verification.

## Authority and related research

The [long-term-memory synthesis](../long-term-memory/2026-07-05-memory-landscape/CROSS-REPORT.md)
and [product-vision synthesis](../product-vision/2026-07-15-working-synthesis/report.md)
retain broader research. [SPEC.md §2.1](../../../SPEC.md) and its linked OpenSpec
capabilities own the current compaction contract. Dated deep dives linked from
individual references retain their original observations; they are not refreshed
by a bundle update.

Read the ranked index first, then open individual references as needed.

## Index

Ordered by implementation relevance during llame's alpha: breadth of reusable
capability behavior and fit with the meta-harness architecture come first,
followed by focused mechanisms and cautionary comparisons. OpenClaw's priority
is a project decision; the remaining order is a moderate-confidence assessment.

1. [OpenClaw](./openclaw.md) — Primary alpha implementation reference for capabilities and behavior
2. [qwen-audio-agent](./qwen-audio-agent.md) — Host-owned sessions with ACP/A2A peer execution
3. [OpenCode](./opencode.md) — TypeScript coding harness; provider, session, and permission boundaries
4. [Codex CLI](./codex-cli.md) — Native peer lifecycle protocol and observable compaction
5. [goose](./goose.md) — ACP peer integration and tool approval boundaries
6. [Gemini CLI](./gemini-cli.md) — Argument-aware policy and behavioral evaluation
7. [T3 Code](./t3-code.md) — Environment identity, transactional receipts, and provider instances
8. [oh-my-pi](./oh-my-pi.md) — Session branching, compaction, and model-visible history
9. [DeepSeek Harness](./deepseek-harness.md) — Session projections and explicit approval outcomes
10. [Hermes Agent](./hermes-agent.md) — Recall framing and memory-provider lifecycle
11. [Seal](./seal.md) — Durable approval suspension and nested continuation streams
12. [Open WebUI](./open-webui.md) — Multi-user chat, tool access, and provider integration
13. [Vercel Chatbot (formerly ai-chatbot)](./vercel-chatbot.md) — Chat/message schema and request admission
14. [agent-memory](./agent-memory.md) — Derived memory indexes and federated retrieval
15. [gbrain](./gbrain.md) — File-backed knowledge and provenance-aware recall
16. [Continue](./continue.md) — Shared CLI execution, permission rules, and agent profiles
17. [beads](./beads.md) — Dependency-aware work tracking, claims, and trace retention
18. [Fabric](./fabric.md) — File-based prompt composition and drift checks
19. [Zeroshot](./zeroshot.md) — Bounded orchestration graphs and reconnect contracts
20. [OKF (Open Knowledge Format)](./open-knowledge-format.md) — Optional authorship, verification, and freshness metadata
21. [OpenMausBot](./openmausbot.md) — Bounded MCP control and persona imports
22. [Buzz](./buzz.md) — Formal isolation models to compare with runtime enforcement
23. [nanoclaw](./nanoclaw.md) — Containerized agent execution and host-side authority
24. [neural-code](./neural-code.md) — Small context-pressure and child-loop comparison
25. [ELAI](./elai.md) — Archived architecture and measurement discipline
