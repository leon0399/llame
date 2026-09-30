# Agentic harness references

Noncanonical research index for llame as a **meta-harness**: llame owns Chat/Run
identity, lifecycle, provenance, and isolation; peer coding agents and protocols
(ACP, A2A, and similar) are executor adapters. See [VISION.md](../../../VISION.md).

This directory is reserved for software that hosts tool-enabled agent execution,
directly or through peer executors. Agent runtimes and orchestration hosts belong
here. Standalone tools, plugins, memory services and prompt utilities belong in
[tools and extensions](../tools/index.md); protocols and data specifications belong in
[standards](../standards/index.md).

SPEC, OpenSpec, and shipped code win any disagreement with notes here. This bundle
records upstream repositories and in-repo deep dives only. Refresh a local clone
for line-level work via the `librarian` skill.

During alpha, **[OMP (oh-my-pi)](./oh-my-pi.md) is the primary reference for
agentic capabilities and tool shape**: the agent loop, tool contracts and
behavior, and coding capabilities. **[OpenClaw](./openclaw.md) is the primary
upstream implementation reference for broader product behavior** outside that
loop, such as channel routing, memory, and transcript search. Consult OMP first
for agentic and tool decisions and OpenClaw first for other capability areas,
then use the remaining references for targeted alternatives. Adapt their
behavior to llame's ownership, lifecycle, provenance, and isolation contracts;
llame's specs remain authoritative.

The dated assessments distinguish source inspection from explicitly recorded
execution. Most inspect upstream source and test code without running the
upstream program; individual studies may also record offline mechanics probes.
Benchmark claims remain upstream reports unless an entry records independent
reproduction.
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
[SoL-Pi](../tools/sol-pi.md) for evidence-preserving recovery and
[Spotify Shunt](../tools/spotify-shunt.md) for question-focused context reduction.

The [permission-classifier study](../tool-harness/2026-09-24-permission-classifier-cascade/index.md)
compares Claude Code auto mode, Codex Guardian and eve's Jev approvals, then
records live synthetic Jev experiments with reusable fixtures and raw responses.
It separates delegated automatic review from mandatory human approval and
examines bounded script inspection, intent spoofing and execution binding for
[#778](https://github.com/leon0399/llame/issues/778). It approves no product change.

The [question-directed read follow-on](../tool-harness/2026-09-23-question-directed-read/index.md)
compares Apple LensVLM with local Qwen/Gemma and cheap or promotional hosted
readers for [#849](https://github.com/leon0399/llame/issues/849). It connects
[OMP's image-question subcall](./oh-my-pi.md#question-directed-image-reads) and
[Shunt's bulk-read delegation](../tools/spotify-shunt.md) to explicit source scope,
verifiable evidence and total parent-plus-worker economics. LensVLM's
research-only weights and token/latency tradeoff remain distinct from the
general reader design.

The [semantic find/JUDGE layer](../tool-harness/2026-09-24-semantic-find-judge/index.md)
traces [OMP's cascade](./oh-my-pi.md#semantic-find-and-jegrep) and its
[jegrep reference](../tools/jegrep.md), including native versus parsed-label judging,
failure/coverage mechanics and benchmark limitations. It maps concrete uses
across chat evidence, code, tools, skills, documents and future Run/artifact
sources without making relevance an authorization decision.

The [prompt-cache boundaries study](../tool-harness/2026-09-26-prompt-cache-boundaries.md)
compares how Anthropic, OpenAI, DeepSeek, Gemini and vLLM write and reuse
prompt-cache entries, then traces which system-prompt items differ between
llame chats. It sets [OMP's head breakpoints](https://github.com/can1357/oh-my-pi/blob/6ee309d18ba627291b8a099b6b276de071abb7ca/packages/ai/src/providers/anthropic.ts#L4054-L4126)
and OpenClaw's stable/dynamic system-prompt split against llame's single
automatic breakpoint for [#972](https://github.com/leon0399/llame/issues/972).
It measures no cache-hit rates.

The [OpenClaw execution-placement study](../product-vision/2026-09-27-openclaw-sandboxes-and-cloud-workers.md)
traces [OpenClaw's](./openclaw.md) tool sandboxes, Crabbox cloud workers and
paired-device session hosting, then compares them with the
[local-node research](../product-vision/2026-08-21-local-nodes-workspaces-and-distributed-execution.md)
for [#756](https://github.com/leon0399/llame/issues/756) and
[#758](https://github.com/leon0399/llame/issues/758). It records source and
documentation reading only; nothing was run.

The [OMP memory study](../long-term-memory/2026-09-28-omp-memory.md)
traces [OMP's](./oh-my-pi.md) `local` summary pipeline, `learn` capture and
Mnemopi retrieval backend at `v18.2.10`, plus the Hindsight client and its server, and measures
the `local` pipeline on one live installation: extraction coverage, provider
refusals, per-worktree scopes and lessons lost to the injection cap. Mnemopi and
Hindsight are source-only. It maps the queue, frozen-snapshot, recall-scoring and
observation ideas to llame's Knowledge and recall work.

Read the ranked index first, then open individual references as needed.

## Index

Ordered by implementation relevance during llame's alpha: breadth of reusable
capability behavior and fit with the meta-harness architecture come first,
followed by focused mechanisms and cautionary comparisons. OMP's and OpenClaw's
priorities are project decisions; the remaining order is a moderate-confidence
assessment.

1. [oh-my-pi](./oh-my-pi.md) — Primary reference for agentic capabilities and tool shape
2. [OpenClaw](./openclaw.md) — Primary alpha implementation reference for broader product behavior
3. [qwen-audio-agent](./qwen-audio-agent.md) — Host-owned sessions with ACP/A2A peer execution
4. [Orca](./orca.md) — Two-tier peer-agent adapters (SDK/app-server versus PTY), durable session records with provider-native resume, and a bypass-by-default permission posture
5. [oh-my-openagent (OmO)](./oh-my-openagent.md) — One agent product adapted into OpenCode, Codex and a pi fork; Git-backed memory with a gated cheap-model advisor; durable child tasks with exactly-once completion; approval bypassed by default
6. [OpenCode](./opencode.md) — TypeScript coding harness; provider, session, and permission boundaries
7. [OpenCode V2](./opencode-v2.md) — Per-model protocol dispatch, hand-rolled wire protocols, and a construction/request header seam
8. [Codex CLI](./codex-cli.md) — Native peer lifecycle protocol and observable compaction
9. [goose](./goose.md) — ACP peer integration and tool approval boundaries
10. [Rowboat](./rowboat.md) — Per-person local agent behind a thin shared Space server, agent-authored Markdown memory, ACP peer executors, and classifier-based auto-approval
11. [Gemini CLI](./gemini-cli.md) — Argument-aware policy and behavioral evaluation
12. [T3 Code](./t3-code.md) — Environment identity, transactional receipts, and provider instances
13. [DeepSeek Harness](./deepseek-harness.md) — Session projections and explicit approval outcomes
14. [Hermes Agent](./hermes-agent.md) — Recall framing and memory-provider lifecycle
15. [Seal](./seal.md) — Durable approval suspension and nested continuation streams
16. [Baro](./baro.md) — Lease-correlated peer execution and evidence-gated result acceptance
17. [AX](./ax.md) — Desired-state task sandboxes, snapshot-backed workspaces, and fail-open control-plane gaps
18. [Open WebUI](./open-webui.md) — Multi-user chat, tool access, and provider integration
19. [Vercel Chatbot (formerly ai-chatbot)](./vercel-chatbot.md) — Chat/message schema and request admission
20. [Continue](./continue.md) — Shared CLI execution, permission rules, and agent profiles
21. [Zeroshot](./zeroshot.md) — Bounded orchestration graphs and reconnect contracts
22. [OpenMausBot](./openmausbot.md) — Bounded MCP control and persona imports
23. [Buzz](./buzz.md) — ACP agent workspace with isolation and synchronization contracts
24. [nanoclaw](./nanoclaw.md) — Containerized agent execution and host-side authority
25. [neural-code](./neural-code.md) — Small context-pressure and child-loop comparison
26. [ELAI](./elai.md) — Archived architecture and measurement discipline
27. [Loki Agent](./loki.md) — Rebranded Hermes fork; managed connector gateway degradation and retry contract, per-child input-token ceilings for delegation
28. [pi-mono](./pi-mono.md) — Lane-as-branch session tree, composable provider session headers, and a fail-open hook registry
29. [Kilo Code](./kilocode.md) — Provider-gated header tiers, hard permission rulesets, and a fail-closed headless subagent guard
30. [MiMo Code](./mimo-code.md) — Frozen prefix snapshots, parent-grant inheritance for subagents, and local dream/distill self-improvement
31. [Kimi Code](./kimi-code.md) — Subagent type allowlist with inherited permission mode; cautionary env inheritance and yolo bypass
32. [jcode](./jcode.md) — Host-detected gateway headers, per-instance session identity, and a bash-only risk gate
