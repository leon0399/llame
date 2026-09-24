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

The dated assessments distinguish source inspection from explicitly recorded
execution. Most inspect upstream source and test code without running the
upstream program; individual studies may also record offline mechanics probes.
Harness extensions and adjacent knowledge tooling are included when they offer a
distinct mechanism. Benchmark claims remain upstream reports unless an entry
records independent reproduction.
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

The [System One/Jev study](../tool-harness/2026-09-23-system-one-jev/index.md)
connects [OMP's JUDGE role](./oh-my-pi.md#typed-judgments-and-jev) to bounded
decision APIs, extractive compaction, and concrete llame applications: recall
relevance, main-Run effort, premature-stop detection, result usability, citation
support and Knowledge write triage. It distinguishes source inspection and
offline mechanics probes from unmeasured live-model quality. Read it alongside
[SoL-Pi](./sol-pi.md) for evidence-preserving recovery and
[Spotify Shunt](./spotify-shunt.md) for question-focused context reduction.

The [question-directed read follow-on](../tool-harness/2026-09-23-question-directed-read/index.md)
compares Apple LensVLM with local Qwen/Gemma and cheap or promotional hosted
readers for [#849](https://github.com/leon0399/llame/issues/849). It connects
[OMP's image-question subcall](./oh-my-pi.md#question-directed-image-reads) and
[Shunt's bulk-read delegation](./spotify-shunt.md) to explicit source scope,
verifiable evidence and total parent-plus-worker economics. LensVLM's
research-only weights and token/latency tradeoff remain distinct from the
general reader design.

The [semantic find/JUDGE layer](../tool-harness/2026-09-24-semantic-find-judge/index.md)
traces [OMP's cascade](./oh-my-pi.md#semantic-find-and-jegrep) and its
[jegrep reference](./jegrep.md), including native versus parsed-label judging,
failure/coverage mechanics and benchmark limitations. It maps concrete uses
across chat evidence, code, tools, skills, documents and future Run/artifact
sources without making relevance an authorization decision.

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
6. [OpenCode V2](./opencode-v2.md) — Per-model protocol dispatch, hand-rolled wire protocols, and a construction/request header seam
7. [Codex CLI](./codex-cli.md) — Native peer lifecycle protocol and observable compaction
8. [SoL-Pi](./sol-pi.md) — Evidence-preserving tool-result projections and compaction economics
9. [Spotify Shunt](./spotify-shunt.md) — Question-focused bulk-read delegation and cost-routing boundaries
10. [jegrep](./jegrep.md) — Staged semantic source retrieval, typed judgments, and code-search benchmark limits
11. [parsec](./parsec.md) — In-loop re-read and command-loop gates, byte-stable cache-safe history splicing, and measured rather than modeled token savings
12. [goose](./goose.md) — ACP peer integration and tool approval boundaries
13. [Rowboat](./rowboat.md) — Per-person local agent behind a thin shared Space server, agent-authored Markdown memory, ACP peer executors, and classifier-based auto-approval
14. [Gemini CLI](./gemini-cli.md) — Argument-aware policy and behavioral evaluation
15. [T3 Code](./t3-code.md) — Environment identity, transactional receipts, and provider instances
16. [DeepSeek Harness](./deepseek-harness.md) — Session projections and explicit approval outcomes
17. [Hermes Agent](./hermes-agent.md) — Recall framing and memory-provider lifecycle
18. [Seal](./seal.md) — Durable approval suspension and nested continuation streams
19. [Baro](./baro.md) — Lease-correlated peer execution and evidence-gated result acceptance
20. [AX](./ax.md) — Desired-state task sandboxes, snapshot-backed workspaces, and fail-open control-plane gaps
21. [Open WebUI](./open-webui.md) — Multi-user chat, tool access, and provider integration
22. [Vercel Chatbot (formerly ai-chatbot)](./vercel-chatbot.md) — Chat/message schema and request admission
23. [agent-memory](./agent-memory.md) — Derived memory indexes and federated retrieval
24. [gbrain](./gbrain.md) — File-backed knowledge and provenance-aware recall
25. [Graphify](./graphify.md) — Derived graph provenance, extraction caches, and MCP query boundaries
26. [Continue](./continue.md) — Shared CLI execution, permission rules, and agent profiles
27. [beads](./beads.md) — Dependency-aware work tracking, claims, and trace retention
28. [Fabric](./fabric.md) — File-based prompt composition and drift checks
29. [Zeroshot](./zeroshot.md) — Bounded orchestration graphs and reconnect contracts
30. [OKF (Open Knowledge Format)](./open-knowledge-format.md) — Optional authorship, verification, and freshness metadata
31. [OpenMausBot](./openmausbot.md) — Bounded MCP control and persona imports
32. [Buzz](./buzz.md) — Formal isolation models to compare with runtime enforcement
33. [nanoclaw](./nanoclaw.md) — Containerized agent execution and host-side authority
34. [neural-code](./neural-code.md) — Small context-pressure and child-loop comparison
35. [ELAI](./elai.md) — Archived architecture and measurement discipline
36. [Loki Agent](./loki.md) — Rebranded Hermes fork; managed connector gateway degradation and retry contract, per-child input-token ceilings for delegation
37. [pi-mono](./pi-mono.md) — Lane-as-branch session tree, composable provider session headers, and a fail-open hook registry
38. [Kilo Code](./kilocode.md) — Provider-gated header tiers, hard permission rulesets, and a fail-closed headless subagent guard
39. [MiMo Code](./mimo-code.md) — Frozen prefix snapshots, parent-grant inheritance for subagents, and local dream/distill self-improvement
40. [Kimi Code](./kimi-code.md) — Subagent type allowlist with inherited permission mode; cautionary env inheritance and yolo bypass
41. [jcode](./jcode.md) — Host-detected gateway headers, per-instance session identity, and a bash-only risk gate
