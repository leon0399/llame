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
reference for broad capabilities and behavior**. **[OMP (oh-my-pi)](./oh-my-pi.md)
is the primary reference for coding capabilities and tool behavior**. Consult OMP
first for coding-specific decisions and OpenClaw first for other capability
areas, then use the remaining references for targeted alternatives. Adapt their
behavior to llame's ownership, lifecycle, provenance, and isolation contracts;
llame's specs remain authoritative.

The dated assessments inspect upstream source and, where noted, test code
without executing upstream programs. Harness extensions and adjacent knowledge
tooling are included when they offer a distinct mechanism; benchmark claims
remain upstream reports unless an entry records independent reproduction.
Adoption requires a separate llame decision and validation.

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
followed by focused mechanisms and cautionary comparisons. OpenClaw's and OMP's
priorities are project decisions; the remaining order is a moderate-confidence
assessment.

1. [OpenClaw](./openclaw.md) — Primary alpha implementation reference for capabilities and behavior
2. [oh-my-pi](./oh-my-pi.md) — Primary coding implementation reference for capabilities and tool behavior
3. [qwen-audio-agent](./qwen-audio-agent.md) — Host-owned sessions with ACP/A2A peer execution
4. [OpenCode](./opencode.md) — TypeScript coding harness; provider, session, and permission boundaries
5. [Codex CLI](./codex-cli.md) — Native peer lifecycle protocol and observable compaction
6. [SoL-Pi](./sol-pi.md) — Evidence-preserving tool-result projections and compaction economics
7. [Spotify Shunt](./spotify-shunt.md) — Question-focused bulk-read delegation and cost-routing boundaries
8. [goose](./goose.md) — ACP peer integration and tool approval boundaries
9. [Gemini CLI](./gemini-cli.md) — Argument-aware policy and behavioral evaluation
10. [T3 Code](./t3-code.md) — Environment identity, transactional receipts, and provider instances
11. [DeepSeek Harness](./deepseek-harness.md) — Session projections and explicit approval outcomes
12. [Hermes Agent](./hermes-agent.md) — Recall framing and memory-provider lifecycle
13. [Seal](./seal.md) — Durable approval suspension and nested continuation streams
14. [Baro](./baro.md) — Lease-correlated peer execution and evidence-gated result acceptance
15. [Open WebUI](./open-webui.md) — Multi-user chat, tool access, and provider integration
16. [Vercel Chatbot (formerly ai-chatbot)](./vercel-chatbot.md) — Chat/message schema and request admission
17. [agent-memory](./agent-memory.md) — Derived memory indexes and federated retrieval
18. [gbrain](./gbrain.md) — File-backed knowledge and provenance-aware recall
19. [Graphify](./graphify.md) — Derived graph provenance, extraction caches, and MCP query boundaries
20. [Continue](./continue.md) — Shared CLI execution, permission rules, and agent profiles
21. [beads](./beads.md) — Dependency-aware work tracking, claims, and trace retention
22. [Fabric](./fabric.md) — File-based prompt composition and drift checks
23. [Zeroshot](./zeroshot.md) — Bounded orchestration graphs and reconnect contracts
24. [OKF (Open Knowledge Format)](./open-knowledge-format.md) — Optional authorship, verification, and freshness metadata
25. [OpenMausBot](./openmausbot.md) — Bounded MCP control and persona imports
26. [Buzz](./buzz.md) — Formal isolation models to compare with runtime enforcement
27. [nanoclaw](./nanoclaw.md) — Containerized agent execution and host-side authority
28. [neural-code](./neural-code.md) — Small context-pressure and child-loop comparison
29. [ELAI](./elai.md) — Archived architecture and measurement discipline
