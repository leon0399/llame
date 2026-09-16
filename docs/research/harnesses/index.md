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
retain broader research; the
[code-mode deep dive](../tool-harness/2026-09-14-code-mode-eval-tool.md)
compares eval and code-mode tools across OMP, OpenClaw, and Codex CLI.
[SPEC.md §2.1](../../../SPEC.md) and its linked OpenSpec
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
4. [Orca](./orca.md) — Two-tier peer-agent adapters (SDK/app-server versus PTY), durable session records with provider-native resume, and a bypass-by-default permission posture
5. [OpenCode](./opencode.md) — TypeScript coding harness; provider, session, and permission boundaries
6. [Codex CLI](./codex-cli.md) — Native peer lifecycle protocol and observable compaction
7. [SoL-Pi](./sol-pi.md) — Evidence-preserving tool-result projections and compaction economics
8. [Spotify Shunt](./spotify-shunt.md) — Question-focused bulk-read delegation and cost-routing boundaries
9. [parsec](./parsec.md) — In-loop re-read and command-loop gates, byte-stable cache-safe history splicing, and measured rather than modeled token savings
10. [goose](./goose.md) — ACP peer integration and tool approval boundaries
11. [Rowboat](./rowboat.md) — Per-person local agent behind a thin shared Space server, agent-authored Markdown memory, ACP peer executors, and classifier-based auto-approval
12. [Gemini CLI](./gemini-cli.md) — Argument-aware policy and behavioral evaluation
13. [T3 Code](./t3-code.md) — Environment identity, transactional receipts, and provider instances
14. [DeepSeek Harness](./deepseek-harness.md) — Session projections and explicit approval outcomes
15. [Hermes Agent](./hermes-agent.md) — Recall framing and memory-provider lifecycle
16. [Seal](./seal.md) — Durable approval suspension and nested continuation streams
17. [Baro](./baro.md) — Lease-correlated peer execution and evidence-gated result acceptance
18. [Open WebUI](./open-webui.md) — Multi-user chat, tool access, and provider integration
19. [Vercel Chatbot (formerly ai-chatbot)](./vercel-chatbot.md) — Chat/message schema and request admission
20. [agent-memory](./agent-memory.md) — Derived memory indexes and federated retrieval
21. [gbrain](./gbrain.md) — File-backed knowledge and provenance-aware recall
22. [Graphify](./graphify.md) — Derived graph provenance, extraction caches, and MCP query boundaries
23. [Continue](./continue.md) — Shared CLI execution, permission rules, and agent profiles
24. [beads](./beads.md) — Dependency-aware work tracking, claims, and trace retention
25. [Fabric](./fabric.md) — File-based prompt composition and drift checks
26. [Zeroshot](./zeroshot.md) — Bounded orchestration graphs and reconnect contracts
27. [OKF (Open Knowledge Format)](./open-knowledge-format.md) — Optional authorship, verification, and freshness metadata
28. [OpenMausBot](./openmausbot.md) — Bounded MCP control and persona imports
29. [Buzz](./buzz.md) — Formal isolation models to compare with runtime enforcement
30. [nanoclaw](./nanoclaw.md) — Containerized agent execution and host-side authority
31. [neural-code](./neural-code.md) — Small context-pressure and child-loop comparison
32. [ELAI](./elai.md) — Archived architecture and measurement discipline
33. [Loki Agent](./loki.md) — Rebranded Hermes fork; managed connector gateway degradation and retry contract, per-child input-token ceilings for delegation
34. [pi-mono](./pi-mono.md) — Lane-as-branch session tree, composable provider session headers, and a fail-open hook registry
35. [Kilo Code](./kilocode.md) — Provider-gated header tiers, hard permission rulesets, and a fail-closed headless subagent guard
36. [MiMo Code](./mimo-code.md) — Frozen prefix snapshots, parent-grant inheritance for subagents, and local dream/distill self-improvement
37. [Kimi Code](./kimi-code.md) — Subagent type allowlist with inherited permission mode; cautionary env inheritance and yolo bypass
38. [jcode](./jcode.md) — Host-detected gateway headers, per-instance session identity, and a bash-only risk gate
