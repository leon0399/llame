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

The assessments distinguish source inspection from explicitly recorded
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
capabilities own the current compaction contract.

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
sources without making relevance an authorization decision. Current catalog
notes: [jevgrep](../tools/jevgrep.md), [jegrep](../tools/jegrep.md),
[oh-my-pi find](../tools/oh-my-pi-find.md), [XERJ](../tools/xerj.md), and the
[comparison](../tools/code-search.md).

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

These references cover three integration boundaries:
[bb](./bb.md) and [Orca](./orca.md) compare peer-executor and
worktree control; [Earendil Pi 1.0 and Pi Durable](./earendil-pi.md) compare
tool/context composition and experimental semantic recovery; and
[OpenDots](./opendots.md) demonstrates an application built around
[AG-UI](../standards/ag-ui.md), the agent-to-Surface protocol. Moderate
confidence: study these mechanisms independently rather than importing a
second conversation authority into llame. Provider resume, event replay,
checkpoint recovery, and an approval UI provide different guarantees.

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
4. [Orca](./orca.md) — Agent Development Environment with negotiated native adapters, PTY fallbacks, durable provider resume, and host-scoped local/remote/cloud workspaces
5. [bb](./bb.md) — Local-first agent IDE with server-owned threads and host-daemon provider execution
6. [Zeron](./zeron.md) — Rust control plane for peer coding agents: ACP executor capability flags, durable command ledger and steer queue with edit leases, JSONL run journal, optional CRDT sync
7. [Omnigent](./omnigent.md) — Python meta-harness over peer CLIs: declared harness capabilities, ALLOW/DENY/ASK policies, entry-point harness plugins, client-side queue/steer
8. [OpenHands (Agent Canvas)](./openhands.md) — MIT self-hosted control center: Canvas UI over Agent Server, multi-backend placement, built-in OpenHands agent plus ACP peers, separate automation backend
9. [Paseo](./paseo.md) — Local-first Node daemon ADE: WebSocket clients, ACP and direct provider adapters, closed-residency lifecycle, file-backed `$PASEO_HOME`
10. [Orchestrator.inc](./orchestrator.md) — Go daemon and desktop board: durable session facts, derived PR/CI status, detached ACP Chat hosts
11. [Waku](./waku.md) — GPL-3.0-only Rust/GPUI coding-agent desktop; waku-daemon owns provider sessions over a versioned WebSocket protocol with steer-or-queue (not the React framework)
12. [Kandev](./kandev.md) — AGPL Go control plane for parallel agent tasks: agentctl + ACP peers, multi-executor runtimes, and application-level private executor ownership (not RLS)
13. [Shipyard](./shipyard.md) — Desktop app and per-box daemon running agent CLIs in tmux worktrees on remote boxes; hook-reported state, a state-sorted agent board, and a widget home
14. [Jean](./jean.md) — Tauri/Rust worktree ADE: peer backend capability checklist, fail-closed Plan/Build/Yolo permissions, jean-server multi-host identity, Apache-2.0
15. [Emdash](./emdash.md) — Electron meta-harness: ACP conversation runtime, host-authoritative workspaces, user-global lifecycle hooks, Apache-2.0
16. [MonoCode](./monocode.md) — Tauri GUI over installed agent CLIs: typed harness events, SQLite sessions, `/operator` thread CLI, experimental SSH host that outlives the desktop
17. [Superset](./superset.md) — Bun ADE with terminal-agent definitions, worktree workspaces, host-service tRPC skew rules; ELv2 (not a hosted-service dependency)
18. [Solo (soloterm)](./solo.md) — Closed Tauri meta-harness: shared `solo.yml` processes and MCP/HTTP/CLI agent control
19. [Earendil Pi 1.0 and Pi Durable](./earendil-pi.md) — Pi 1.0's codemode, virtual and deferred model surfaces, cache-aware transcript mutations, and the experimental Pi Durable runtime
20. [oh-my-openagent (OmO)](./oh-my-openagent.md) — One agent product adapted into OpenCode, Codex and a pi fork; Git-backed memory with a gated cheap-model advisor; durable child tasks with exactly-once completion; approval bypassed by default
21. [OpenCode](./opencode.md) — TypeScript coding harness; provider, session, and permission boundaries
22. [OpenCode V2](./opencode-v2.md) — Per-model protocol dispatch, hand-rolled wire protocols, and a construction/request header seam
23. [Paperclip](./paperclip.md) — Company-of-agents control plane: heartbeat wakeups, atomic issue checkout with a liveness contract, ACP-default adapters with no silent fallback, budget hard stops that block on unpriced usage, ask-first approvals, and coalescing routines; tenant isolation by application checks only
24. [Codex CLI](./codex-cli.md) — Native peer lifecycle protocol and observable compaction
25. [Qwen Code](./qwen-code.md) — Apache-2.0 peer coding agent (Gemini CLI / Codex CLI class); ACP bridge and experimental qwen serve multi-client daemon
26. [CodeBuddy Code](./codebuddy.md) — Tencent peer coding CLI and Agent SDK: stream-json child, cwd-keyed JSONL sessions, and a WorkBuddy sidecar host
27. [goose](./goose.md) — ACP peer integration and tool approval boundaries
28. [Rowboat](./rowboat.md) — Per-person local agent behind a thin shared Space server, agent-authored Markdown memory, ACP peer executors, and classifier-based auto-approval
29. [Gemini CLI](./gemini-cli.md) — Argument-aware policy and behavioral evaluation
30. [T3 Code](./t3-code.md) — Environment identity, transactional receipts, and provider instances
31. [DeepSeek Harness](./deepseek-harness.md) — Local Cordis harness with browser and stdio clients, append-only session projection, and fail-closed approvals
32. [Hermes Agent](./hermes-agent.md) — Recall framing, memory-provider lifecycle, and TUI gateway transport and workspace cwd
33. [Seal](./seal.md) — Durable approval suspension and nested continuation streams
34. [Baro](./baro.md) — Lease-correlated peer execution and evidence-gated result acceptance
35. [AX](./ax.md) — Desired-state task sandboxes, snapshot-backed workspaces, and fail-open control-plane gaps
36. [OpenShell](./openshell.md) — Policy-enforced sandbox runtime: a gateway and trusted supervisor host a guest agent, and credentials stay outside the workload
37. [CodexHost](./codex-host.md) — LGPL plugin host embedding peer harnesses inside Codex Desktop; native-first wires with ACP fallback
38. [Open WebUI](./open-webui.md) — Multi-user chat, tool access, and provider integration
39. [OpenDots](./opendots.md) — Self-hosted single-owner agent workspace with AG-UI, durable Threads, per-Dot computers, and scheduled work
40. [Vercel Chatbot (formerly ai-chatbot)](./vercel-chatbot.md) — Chat/message schema and request admission
41. [Continue](./continue.md) — Shared CLI execution, permission rules, and agent profiles
42. [Zeroshot](./zeroshot.md) — Bounded orchestration graphs and reconnect contracts
43. [Empryo (SoulForge)](./empryo.md) — Single-user BUSL-licensed coding agent; chat-surface daemon with pairing-code lockout, deny-first approval policy and capped pending approvals
44. [OpenMausBot](./openmausbot.md) — Bounded MCP control and persona imports
45. [Buzz](./buzz.md) — ACP agent workspace with isolation and synchronization contracts
46. [nanoclaw](./nanoclaw.md) — Containerized agent execution and host-side authority
47. [neural-code](./neural-code.md) — Small context-pressure and child-loop comparison
48. [ELAI](./elai.md) — Archived architecture and measurement discipline
49. [Loki Agent](./loki.md) — Rebranded Hermes fork; managed connector gateway degradation and retry contract, per-child input-token ceilings for delegation
50. [pi-mono](./pi-mono.md) — Lane-as-branch session tree, composable provider session headers, and a fail-open hook registry
51. [Kilo Code](./kilocode.md) — Provider-gated header tiers, hard permission rulesets, and a fail-closed headless subagent guard
52. [MiMo Code](./mimo-code.md) — Frozen prefix snapshots, parent-grant inheritance for subagents, and local dream/distill self-improvement
53. [Kimi Code](./kimi-code.md) — Subagent type allowlist with inherited permission mode; cautionary env inheritance and yolo bypass
54. [jcode](./jcode.md) — Host-detected gateway headers, per-instance session identity, and a bash-only risk gate
55. [AgentOne](./agent-one.md) — Desktop webview agent with no session workspace, transcript snapshots, and per-chat approval overlays
56. [super.engineering](./super-engineering.md) — Closed native Rust/Metal macOS control plane for parallel CLI agents and SSH remotes
57. [Conductor](./conductor.md) — Closed macOS worktree host with optional Conductor Cloud sandboxes
58. [WorkBuddy](./workbuddy.md) — Closed Tencent desktop that hosts CodeBuddy Code; user-picked task directory and a client-global full-access switch
59. [Agentastic](./agentastic.md) — Closed macOS multi-agent IDE with Manager Agents, ACP chat and iPhone steering
60. [Traycer](./traycer.md) — Open clients/protocol for a closed Host; capability-gated agent-to-agent messaging and worktrees
61. [Synara](./synara.md) — Task-owned provider sessions with per-task delivery journals, reconnect-from-sequence recovery, and worktree-gated peer start
62. [Silo](./silo.md) — Multi-workspace Tauri shell: package-graph extension SDK, host-owned PTY sessions, ACP chat resurrection without a daemon
63. [Ghostex](./ghostex.md) — GPUI workarea over gxserver and zmx/wmx session daemons; peer CLIs with chat/CLI views, Tab prompt queue, and orchestrator/thread vocabulary
64. [Tortie](./tortie.md) — macOS Electron agent multiplexer: private tmux sessions, SQLite manifest-before-spawn, armed resume commands, and cross-project needs-input attention
65. [OpenCodex](./opencodex.md) — Provider proxy / Responses wire translator (better as a tool); ChatGPT account-pool affinity
66. [OpenBot](./openbot.md) — Electron desktop meta-harness: per-agent workspaces, peer CLIs, a host-owned queue, and a macOS Seatbelt workspace mode that refuses to start on Linux and Windows

## Multi-machine and container placement

Which References document **execution placement** beyond one local worktree host.
Worktrees-on-one-Mac, remote UI/relay only, OS tool sandboxes (bwrap/seatbelt),
and LLM provider backends are not placement. Confidence is moderate: closed
products and README claims were not re-executed here.

**Multi-host / multi-box** (control plane can use more than one machine or
backend for agent execution):

- [bb](./bb.md) — server plus enrolled host daemons; environment binds workspace→host
- [Shipyard](./shipyard.md) — per-box `berthd`; agents run on the boxes
- [Orca](./orca.md) — execution hosts `local` / `ssh:` / `runtime:` plus cloud VM recipes
- [Zeron](./zeron.md) — headless/VPS engine driven from a laptop; multi-device sync peers
- [OpenHands](./openhands.md) — switchable local / remote / Docker / Cloud Agent Server backends
- [Jean](./jean.md) — multiple `jean-server` connections; `(serverId, resourceId)` identity
- [Emdash](./emdash.md) — local and remote SSH project hosts
- [Kandev](./kandev.md) — executor profiles across local/worktree/Docker/K8s/SSH/Sprites
- [Paseo](./paseo.md) — CLI `--host` / `ssh://` selects among remote daemons
- [Superset](./superset.md) — connect another machine; Remote Access hosts; cloud workspaces
- [MonoCode](./monocode.md) — Settings→Connections machine registry (experimental SSH hosts)
- [Ghostex](./ghostex.md) — remote machines via Easy Connect or SSH in the sidebar
- [Agentastic](./agentastic.md) — SSH hosts plus Modal/Fly/Vercel (closed; site claims)
- [OpenClaw](./openclaw.md) — tool sandboxes, Crabbox cloud workers, paired-device hosting
  (detail in the [execution-placement study](../product-vision/2026-09-27-openclaw-sandboxes-and-cloud-workers.md))

**Multi-container / cloud sandbox placement** (per-task or disposable runtime,
even with a single laptop UI):

- [OpenHands](./openhands.md) — `OH_CONVERSATION_RUNTIME=docker` per conversation
- [Omnigent](./omnigent.md) — cloud sandbox provider matrix (Modal, E2B, K8s, …)
- [Hermes Agent](./hermes-agent.md) — seven terminal backends (local/Docker/SSH/Modal/…)
- [Loki Agent](./loki.md) — same Hermes-derived terminal backend matrix (+ AgentVM)
- [Conductor](./conductor.md) — optional Conductor Cloud (Vercel) sandboxes
- [nanoclaw](./nanoclaw.md) — per-session containers with host mailbox
- [OpenDots](./opendots.md) — per-Dot authorized computer executors
- [AX](./ax.md) — desired-state task sandboxes over Agent Substrate
- [OpenShell](./openshell.md) — per-sandbox supervisor and workload; Docker, Podman, Kubernetes, and MicroVM fences

**Single remote only** (optional one SSH/daemon host, not a multi-box registry):
[super.engineering](./super-engineering.md) (experimental SSH), [Waku](./waku.md),
[T3 Code](./t3-code.md), [CodeBuddy Code](./codebuddy.md) (daemon `--host`,
docs only), [DeepSeek Harness](./deepseek-harness.md) (optional POSIX SSH
providers; shipped profiles leave them unmounted).

The [multi-device placement study](../product-vision/2026-10-18-multi-device-execution-placement.md)
compares these mechanisms with OpenClaw nodes, Home Assistant voice satellites,
Coder, and hosted cloud environments, and maps them to llame's Node direction.
