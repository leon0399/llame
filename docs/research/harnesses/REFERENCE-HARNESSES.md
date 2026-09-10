# Reference harnesses and prior art

Noncanonical research index for llame as a **meta-harness**: llame owns Chat/Run
identity, lifecycle, provenance, and isolation; peer coding agents and protocols
(ACP, A2A, and similar) are executor adapters. See [VISION.md](../../../VISION.md).

SPEC, OpenSpec, and shipped code win any disagreement with notes here. This file
records upstream repositories and in-repo deep dives only. Refresh a local clone
for line-level work via the `librarian` skill.

During alpha, **[OpenClaw](#openclaw) is the primary upstream implementation
reference for capabilities and behavior**. Consult its implementation first when
designing or implementing a capability, then use the other references for
targeted alternatives. Adapt its behavior to llame's ownership, lifecycle,
provenance, and isolation contracts; llame's specs remain authoritative.

The 2026-09-10 assessments inspected upstream source and test code without
executing it. Inclusion identifies a useful mechanism or comparison; adoption
still requires a llame decision and validation.

## Authority and related research

The [long-term-memory synthesis](../long-term-memory/2026-07-05-memory-landscape/CROSS-REPORT.md)
and [product-vision synthesis](../product-vision/2026-07-15-working-synthesis/report.md)
retain broader research. [SPEC.md §2.1](../../../SPEC.md) and its linked OpenSpec
capabilities own the current compaction contract. Dated deep dives below retain
their original observations; they are not refreshed by an index update.

## Index

Ordered by implementation relevance during llame's alpha: breadth of reusable
capability behavior and fit with the meta-harness architecture come first,
followed by focused mechanisms and cautionary comparisons. OpenClaw's priority
is a project decision; the remaining order is a moderate-confidence assessment.

1. [OpenClaw](#openclaw) — Primary alpha implementation reference for capabilities and behavior
2. [qwen-audio-agent](#qwen-audio-agent) — Host-owned sessions with ACP/A2A peer execution
3. [OpenCode](#opencode) — TypeScript coding harness; provider, session, and permission boundaries
4. [Codex CLI](#codex-cli) — Native peer lifecycle protocol and observable compaction
5. [goose](#goose) — ACP peer integration and tool approval boundaries
6. [Gemini CLI](#gemini-cli) — Argument-aware policy and behavioral evaluation
7. [T3 Code](#t3-code) — Environment identity, transactional receipts, and provider instances
8. [oh-my-pi](#oh-my-pi) — Session branching, compaction, and model-visible history
9. [DeepSeek Harness](#deepseek-harness) — Session projections and explicit approval outcomes
10. [Hermes Agent](#hermes-agent) — Recall framing and memory-provider lifecycle
11. [Seal](#seal) — Durable approval suspension and nested continuation streams
12. [Open WebUI](#open-webui) — Multi-user chat, tool access, and provider integration
13. [Vercel Chatbot (formerly ai-chatbot)](#vercel-chatbot-formerly-ai-chatbot) — Chat/message schema and request admission
14. [agent-memory](#agent-memory) — Derived memory indexes and federated retrieval
15. [gbrain](#gbrain) — File-backed knowledge and provenance-aware recall
16. [Continue](#continue) — Shared CLI execution, permission rules, and agent profiles
17. [beads](#beads) — Dependency-aware work tracking, claims, and trace retention
18. [Fabric](#fabric) — File-based prompt composition and drift checks
19. [Zeroshot](#zeroshot) — Bounded orchestration graphs and reconnect contracts
20. [OKF (Open Knowledge Format)](#okf-open-knowledge-format) — Optional authorship, verification, and freshness metadata
21. [OpenMausBot](#openmausbot) — Bounded MCP control and persona imports
22. [Buzz](#buzz) — Formal isolation models to compare with runtime enforcement
23. [nanoclaw](#nanoclaw) — Containerized agent execution and host-side authority
24. [neural-code](#neural-code) — Small context-pressure and child-loop comparison
25. [ELAI](#elai) — Archived architecture and measurement discipline

## References

### OpenClaw

- **Upstream:** [openclaw/openclaw](https://github.com/openclaw/openclaw)
- **Stack:** TypeScript; multi-channel gateway; Markdown memory; SQLite session/transcript state and search
- **Observed:** 2026-09-10 @ `f3c230c208d9f48a102ab457c0669e01341d91d1`

Primary alpha reference for capability behavior, with concrete routing, memory, and transcript-search implementations. High confidence in the cited mechanisms; llame retains canonical Chat/Run identity and its own storage contracts.

**Study**

1. **F28: Canonical files and explicit imports.** [Core/episodic files and bootstrap limits](https://github.com/openclaw/openclaw/blob/f3c230c208d9f48a102ab457c0669e01341d91d1/docs/concepts/memory.md#L9-L62) distinguish curated root memory from daily notes; [imports remain source-specific](https://github.com/openclaw/openclaw/blob/f3c230c208d9f48a102ab457c0669e01341d91d1/docs/concepts/memory.md#L64-L89). High confidence applicability to llame's source/projection boundary and Knowledge imports.
2. **F29: Deterministic inbound routing.** [`resolveAgentRoute`](https://github.com/openclaw/openclaw/blob/f3c230c208d9f48a102ab457c0669e01341d91d1/src/routing/resolve-route.ts#L592-L680) normalizes channel/account/peer inputs, derives a stable session key and last-route policy. [Ordered binding tiers](https://github.com/openclaw/openclaw/blob/f3c230c208d9f48a102ab457c0669e01341d91d1/src/routing/resolve-route.ts#L725-L799) resolve peer, parent-peer, wildcard, guild/role, team, account, and channel matches. Moderate-confidence comparison for future llame inbound routing; OpenClaw's channel peers are not executor-adapter identities.

3. **F30: Transcript authority and search.** [Transcript events are inserted into SQLite](https://github.com/openclaw/openclaw/blob/f3c230c208d9f48a102ab457c0669e01341d91d1/src/config/sessions/session-accessor.sqlite-transcript-store.ts#L76-L89). The [search contract](https://github.com/openclaw/openclaw/blob/f3c230c208d9f48a102ab457c0669e01341d91d1/docs/concepts/session-search.md#L43-L53) indexes new messages transactionally and reports incomplete reconciliation. Compare these source/projection boundaries with llame's canonical messages and search coverage.

**Caution:** [Default session visibility](https://github.com/openclaw/openclaw/blob/f3c230c208d9f48a102ab457c0669e01341d91d1/docs/concepts/session-search.md#L26-L38) permits broad cross-agent access. Preserve llame's owner-scoped datastore authorization rather than copying those defaults.

### qwen-audio-agent

- **Upstream:** [QwenAudio/qwen-audio-agent](https://github.com/QwenAudio/qwen-audio-agent/tree/94d6cd372379f9c889ea8d6f6190e4cd45122adb)
- **Stack:** Plain ESM `.mjs`, Zod, Node 22+, ACP, A2A, and custom backends; Apache-2.0.
- **Observed:** 2026-09-10 @ `94d6cd372379f9c889ea8d6f6190e4cd45122adb`

A meta-harness whose gateway owns task/session routing while backends retain
execution state. High confidence for executor boundaries and declared environment
flow; moderate for persistence because it remains a single-user application.

**Study**

1. **Session ownership seam.** [Stable backend session semantics](https://github.com/QwenAudio/qwen-audio-agent/blob/94d6cd372379f9c889ea8d6f6190e4cd45122adb/docs/architecture/deep-dive.md#L191-L214), [encoded session keys](https://github.com/QwenAudio/qwen-audio-agent/blob/94d6cd372379f9c889ea8d6f6190e4cd45122adb/server/src/agent/acp/backend-session-utils.mjs#L10-L15), and [registry state](https://github.com/QwenAudio/qwen-audio-agent/blob/94d6cd372379f9c889ea8d6f6190e4cd45122adb/server/src/agent/acp/session-registry.mjs#L64-L75) provide a comparison to llame owning Chat/Run identity around executor adapters.
2. **Secret and approval boundary.** [Catalog-driven environment allowlisting](https://github.com/QwenAudio/qwen-audio-agent/blob/94d6cd372379f9c889ea8d6f6190e4cd45122adb/shared/backend/environment.mjs#L3-L6) and [owner-bound permission brokering](https://github.com/QwenAudio/qwen-audio-agent/blob/94d6cd372379f9c889ea8d6f6190e4cd45122adb/server/src/agent/acp/permission-broker.mjs#L112-L214) inform llame's declared MCP environment and approval contracts.

**Caution:** The architecture document labels behavior roadmap-provisional. Verify
the cited implementation when defining an adapter contract, and retain llame's
tenant isolation independently of the host's owner/session routing keys.

### OpenCode

- **Upstream:** [anomalyco/opencode](https://github.com/anomalyco/opencode/tree/b3f1a96c6dd7adeb28b36dd11add1998fc84d67b)
- **Stack:** Bun/TypeScript, Effect, Drizzle/SQLite, AI SDK, Solid; MIT
- **Observed:** 2026-09-10 @ `b3f1a96c6dd7adeb28b36dd11add1998fc84d67b`

A TypeScript AI SDK harness with session projections and suspendable approvals.
High confidence for comparing replay and permission UX; moderate for direct reuse
because it is a local SQLite coding client.

**Study**

1. **Session history.** [Session, message, part, sequence, and context tables](https://github.com/anomalyco/opencode/blob/b3f1a96c6dd7adeb28b36dd11add1998fc84d67b/packages/core/src/session/sql.ts#L22-L176) plus [baseline-aware history loading](https://github.com/anomalyco/opencode/blob/b3f1a96c6dd7adeb28b36dd11add1998fc84d67b/packages/core/src/session/history.ts#L13-L99) are useful comparators for llame's replay and compaction projection.
2. **Approval policy.** [Wildcard evaluation and default ask behavior](https://github.com/anomalyco/opencode/blob/b3f1a96c6dd7adeb28b36dd11add1998fc84d67b/packages/core/src/permission.ts#L76-L85) and [pending approvals with saved rules](https://github.com/anomalyco/opencode/blob/b3f1a96c6dd7adeb28b36dd11add1998fc84d67b/packages/core/src/permission.ts#L190-L283) show a compact permission-to-suspension seam.

**Caution:** The cited local SQLite implementation does not demonstrate llame's datastore isolation requirements. Validate schema and migration assumptions separately before adapting its session model.

### Codex CLI

- **Upstream:** [openai/codex](https://github.com/openai/codex)
- **Stack:** Rust workspace with CLI and App Server surfaces
- **Observed:** 2026-09-10 @ `5d3fe48b08049165ef8143dca152869c1f18059c`

High-confidence reference for a native peer-executor protocol and alternative
compaction lifecycle. Its App Server can inform an adapter while llame retains
canonical Chat/Run identity.

**Study**

1. **Explicit execution lifecycle.** The protocol separates
   [thread start/resume](https://github.com/openai/codex/blob/5d3fe48b08049165ef8143dca152869c1f18059c/codex-rs/app-server-protocol/src/protocol/common.rs#L556-L576),
   [turn start/steer/interrupt](https://github.com/openai/codex/blob/5d3fe48b08049165ef8143dca152869c1f18059c/codex-rs/app-server-protocol/src/protocol/common.rs#L1023-L1046),
   and [turn/item notifications](https://github.com/openai/codex/blob/5d3fe48b08049165ef8143dca152869c1f18059c/codex-rs/app-server-protocol/src/protocol/common.rs#L1919-L1930).
   These are concrete adapter operations and events; remote thread identifiers
   should remain executor references under a llame Run.
2. **Compaction as an observable operation.** The
   [token-budget path](https://github.com/openai/codex/blob/5d3fe48b08049165ef8143dca152869c1f18059c/codex-rs/core/src/compact_token_budget.rs#L21-L25)
   starts a fresh context window without model/server summarization.
   [Pre/post hooks and item events](https://github.com/openai/codex/blob/5d3fe48b08049165ef8143dca152869c1f18059c/codex-rs/core/src/compact_token_budget.rs#L66-L92)
   still expose the transition. Compare that lifecycle with SPEC §2.1 while
   retaining llame's specified summary and provenance behavior.

**Caution:** This compaction path does not describe every Codex compaction mode.
Protocol declarations establish an interface, not successful reconnect,
cancellation, or recovery under failure; validate those in an adapter spike.

### goose

- **Upstream:** [aaif-goose/goose](https://github.com/aaif-goose/goose)
- **Stack:** Rust workspace with React/TypeScript desktop; Apache-2.0
- **Observed:** 2026-09-10 @ `bea9954b9378d5129c5b2ba8ae8d663d034b6c52`

Local agent with desktop, CLI, API, MCP, and ACP surfaces. High-confidence
reference for typed inspection outcomes and selective context reduction.
Its execution model remains distinct from llame's durable Runs.

**Study**

1. **Typed inspection outcomes.** [`ToolInspector` and result types](https://github.com/aaif-goose/goose/blob/bea9954b9378d5129c5b2ba8ae8d663d034b6c52/crates/goose/src/tool_inspection.rs#L10-L118) give each inspection a typed `Allow`, `Deny`, or
   `RequireApproval` result with reason, confidence, inspector name, and finding
   id. Inspectors run in order and restrictive composition preserves deny and
   approval decisions ([inspection composition](https://github.com/aaif-goose/goose/blob/bea9954b9378d5129c5b2ba8ae8d663d034b6c52/crates/goose/src/tool_inspection.rs#L168-L257)). This is a
   concrete shape for future llame approval policy, but the manager logs an inspector error and continues,
   so the pipeline is fail-open at that boundary.
2. **Selective context reduction.** Context management can summarize old tool-call/result pairs selectively before
   whole-conversation summarization. It computes a cutoff, preserves active calls,
   and processes bounded batches ([context reduction](https://github.com/aaif-goose/goose/blob/bea9954b9378d5129c5b2ba8ae8d663d034b6c52/crates/goose/src/context_mgmt/mod.rs#L367-L505)). llame would retain
   its canonical Chat/Run history alongside any executor-context reduction.

**Caution**

Goose is a single-user local application with SQLite and local configuration; no
tenant or RLS model was found in its own Rust/documentation tree. Copy the typed result shape
and restrictive merge rule only after putting them behind llame's fail-closed,
owner-scoped authorization boundary.

### Gemini CLI

- **Upstream:** [google-gemini/gemini-cli](https://github.com/google-gemini/gemini-cli)
- **Stack:** TypeScript npm-workspaces monorepo; Apache-2.0
- **Observed:** 2026-09-10 @ `ed2ac40df67a319bf348bd7e3d10494696b31b38`

Google's terminal agent is a high-confidence reference for argument-aware policy
and behavioral evaluation. Its policy engine can inform llame's future approval
capability; hooks have a separate failure contract.

**Study**

1. **Argument-aware policy.** [Typed rules](https://github.com/google-gemini/gemini-cli/blob/ed2ac40df67a319bf348bd7e3d10494696b31b38/packages/core/src/policy/types.ts#L125-L166)
   match MCP servers, subagents, argument patterns, annotations, and approval
   modes. The [engine](https://github.com/google-gemini/gemini-cli/blob/ed2ac40df67a319bf348bd7e3d10494696b31b38/packages/core/src/policy/policy-engine.ts#L247-L293)
   sorts rules by descending priority and defaults to deny in non-interactive
   mode. Compare this explicit evaluation order with llame's future policy needs.
2. **Behavioral evaluation.** The behavioral-eval workflow separates structural validation from nightly
   behavior: cases declare `ALWAYS_PASSES`, `USUALLY_PASSES`, or `USUALLY_FAILS`,
   while `eval:validate` checks rule shape and tool-call assertions
   ([evaluation guide](https://github.com/google-gemini/gemini-cli/blob/ed2ac40df67a319bf348bd7e3d10494696b31b38/docs/behavioral-evals.md#L55-L143)). This is a useful promotion model for
   llame's evals, provided reports retain the fixture and saved result.

**Caution**

[Hook execution errors](https://github.com/google-gemini/gemini-cli/blob/ed2ac40df67a319bf348bd7e3d10494696b31b38/packages/core/src/hooks/hookRunner.ts#L97-L111)
are logged as non-fatal and returned as failed hook results. A hook's failure
contract must be checked separately from a policy denial; do not use an advisory
hook as llame's authorization boundary.

### T3 Code

- **Upstream:** [pingdotgg/t3code](https://github.com/pingdotgg/t3code)
- **Stack:** TypeScript/Effect; SQLite server, web, Electron, mobile, relay; MIT
- **Observed:** 2026-09-10 @ `d29c56a5c404cb0f58d3b2ac41762fa0d0ac28d4`

High-confidence reference for future Surface/Node and peer-executor contracts.
Its execution environment owns local state and providers; clients reach that
environment through different transports.

**Study**

1. **F13: Identity independent of endpoint.** The [environment descriptor](https://github.com/pingdotgg/t3code/blob/d29c56a5c404cb0f58d3b2ac41762fa0d0ac28d4/apps/server/src/environment/ServerEnvironment.ts#L82-L245)
   exposes persisted identity and capabilities. [Remote semantics](https://github.com/pingdotgg/t3code/blob/d29c56a5c404cb0f58d3b2ac41762fa0d0ac28d4/docs/internals/remote.md#L3-L59)
   separate reachability from execution ownership. Useful for independently
   versioned llame surfaces without turning a transport URL into Node identity.
2. **F14: Commit before notification.** The [orchestration engine](https://github.com/pingdotgg/t3code/blob/d29c56a5c404cb0f58d3b2ac41762fa0d0ac28d4/apps/server/src/orchestration/Layers/OrchestrationEngine.ts#L273-L327)
   commits events, projections, and an accepted command receipt together before
   publishing events. [Receipt reuse](https://github.com/pingdotgg/t3code/blob/d29c56a5c404cb0f58d3b2ac41762fa0d0ac28d4/apps/server/src/orchestration/Layers/OrchestrationEngine.ts#L144-L171)
   rejects a command ID reused against a different aggregate. Compare the
   transaction boundary with llame's terminal Run/answer settlement; it does
   not justify replacing PostgreSQL with an event-sourcing rewrite.
3. **F15: Instance-scoped peer state.** The [driver contract](https://github.com/pingdotgg/t3code/blob/d29c56a5c404cb0f58d3b2ac41762fa0d0ac28d4/apps/server/src/provider/ProviderDriver.ts#L58-L172)
   requires separate provider instances to own their mutable state and lifetime.
   [Adapter capabilities](https://github.com/pingdotgg/t3code/blob/d29c56a5c404cb0f58d3b2ac41762fa0d0ac28d4/apps/server/src/provider/Services/ProviderAdapter.ts)
   disclose conversation rollback support. Its [checkpoint reactor](https://github.com/pingdotgg/t3code/blob/d29c56a5c404cb0f58d3b2ac41762fa0d0ac28d4/apps/server/src/orchestration/Layers/CheckpointReactor.ts#L686-L815)
   coordinates Git workspace restoration with provider rollback. Future llame
   Workspace recovery must likewise distinguish file state from peer history;
   neither rollback implies reversal of external side effects.

**Caution:** Remote control targets one environment; it is not Personal Realm
replication or cross-node execution routing. Its [authorization documentation](https://github.com/pingdotgg/t3code/blob/d29c56a5c404cb0f58d3b2ac41762fa0d0ac28d4/docs/internals/environment-auth.md#L40-L55)
states that Projects do not sandbox the filesystem and read scope can reach
host-readable absolute paths outside a Project. Provider-instance separation
does not supply llame's datastore tenant isolation.

### oh-my-pi

- **Upstream:** [can1357/oh-my-pi](https://github.com/can1357/oh-my-pi/tree/7728213eef8be770a67b2b20710d705ee63fefe7)
- **Stack:** Bun/TypeScript coding agent with Rust support crates; MIT
- **Observed:** 2026-09-10 @ `7728213eef8be770a67b2b20710d705ee63fefe7`

`oh-my-pi` is useful implementation prior art for a durable agent session, provider-boundary transformations, and stream-time policy. Its session tree keeps append-only entries behind a mutable leaf pointer. Compaction records an explicit `firstKeptEntryId`; rebuilding context replays entries from that boundary, so the source transcript and model view remain distinct. That is directly comparable to llame's stored `messages.parts` and explicit compaction boundary.

**Study**

1. **F19: Anchored compaction.** [Session compaction entries](https://github.com/can1357/oh-my-pi/blob/7728213eef8be770a67b2b20710d705ee63fefe7/docs/compaction.md#L27-L55) and [context replay](https://github.com/can1357/oh-my-pi/blob/7728213eef8be770a67b2b20710d705ee63fefe7/packages/coding-agent/src/session/session-context.ts#L261-L341) provide a concrete anchored-prefix model.
2. **F20: Provider-boundary secret handling.** [Reversible secret obfuscation](https://github.com/can1357/oh-my-pi/blob/7728213eef8be770a67b2b20710d705ee63fefe7/docs/secrets.md#L1-L32) replaces provider-visible values, deep-restores model-authored tool arguments before execution, and re-obfuscates replayed context.
3. **F21: Stream-time rules.** [TTSR stream rules](https://github.com/can1357/oh-my-pi/blob/7728213eef8be770a67b2b20710d705ee63fefe7/packages/coding-agent/src/export/ttsr.ts#L303-L365) and [their coordinator](https://github.com/can1357/oh-my-pi/blob/7728213eef8be770a67b2b20710d705ee63fefe7/packages/coding-agent/src/session/ttsr-coordinator.ts#L410-L455) can abort a streamed response, inject a rule message, and retry.

**Applicability:** High for compaction; moderate for MCP argument redaction; exploratory for stream enforcement. **Confidence:** High for the cited current source paths; moderate for behavior outside those paths. **Caution:** secrets are disabled by default, the stdio transport still passes the whole `Bun.env` into child processes ([code](https://github.com/can1357/oh-my-pi/blob/7728213eef8be770a67b2b20710d705ee63fefe7/packages/coding-agent/src/mcp/transports/stdio.ts#L574-L584)). Keep llame's declared environment and trusted runtime boundaries.

### DeepSeek Harness

- **Upstream:** [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)
- **Stack:** TypeScript monorepo on the Cordis plugin kernel; MIT; developer preview
- **Observed:** 2026-09-10 @ `aa8262ec091698bae9a6b04773a6b5b06ad4aef2`

`dsh` is a localhost harness built on Cordis plugins. Moderate-confidence
reference for documented session projections and explicit approval outcomes;
its developer-preview contracts require implementation validation before reuse.

**Study**

1. **Append-only context projection.** The append-only typed Session log is the single source of model context:
   `deriveMessages()` projects model history and replay reconstructs it without
   re-running tools ([session contract](https://github.com/deepseek-ai/deepseek-harness/blob/aa8262ec091698bae9a6b04773a6b5b06ad4aef2/docs/subsystems/session.md#L1-L25)).
   [Compaction](https://github.com/deepseek-ai/deepseek-harness/blob/aa8262ec091698bae9a6b04773a6b5b06ad4aef2/docs/subsystems/compaction.md#L9-L21)
   logs markers and a replacement message, retaining the original event history.
2. **Explicit approval outcomes.** Approval is a closed, fail-closed outcome set: `allowed-once`, `rejected`,
   `cancelled`, and `unavailable`; a missing or throwing answerer becomes
   `unavailable`. Per-session `ask`/`never` policy is itself reconstructed by
   replay ([approval contract](https://github.com/deepseek-ai/deepseek-harness/blob/aa8262ec091698bae9a6b04773a6b5b06ad4aef2/docs/subsystems/approval.md#L1-L58)). This is a useful authorization
   result contract for llame's future policy engine.

**Caution**

The [developer-preview notice](https://github.com/deepseek-ai/deepseek-harness/blob/aa8262ec091698bae9a6b04773a6b5b06ad4aef2/README.md#L11-L13) explicitly anticipates compatibility breaks. These documented contracts do not establish llame's owner isolation or durable recovery; validate those at the adapter boundary.

### Hermes Agent

- **Upstream:** [NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent)
- **Stack:** Python; multi-platform gateway; FTS5 session search
- **Observed:** 2026-09-10 @ `6271d772d2dab79ec613c08038ecf3039ad27a0c`

Self-improving agent with agent-curated memory, isolated subagents, and a pluggable memory-provider boundary. The useful comparison is lifecycle and context handling: llame owns Chat/Run identity and isolation, while any future memory implementation would be an adapter behind those boundaries.

**Study**

1. **Recall-time framing and scrubbing.** [`sanitize_context()` and `StreamingContextScrubber`](https://github.com/NousResearch/hermes-agent/blob/6271d772d2dab79ec613c08038ecf3039ad27a0c/agent/memory_manager.py#L167-L285) remove fake memory/system framing, handle split tags in streams, and wrap recalled data as reference material. High confidence applicability to llame's model-visible context items; this is a framing control, not a write-time content scan.
2. **Provider lifecycle and boundary ordering.** [`MemoryProvider`](https://github.com/NousResearch/hermes-agent/blob/6271d772d2dab79ec613c08038ecf3039ad27a0c/agent/memory_provider.py#L58-L145) defines initialization, prefetch, turn sync, and session callbacks. The manager serializes background writes and queues end-of-session extraction before switching sessions ([ordering](https://github.com/NousResearch/hermes-agent/blob/6271d772d2dab79ec613c08038ecf3039ad27a0c/agent/memory_manager.py#L480-L500)). Moderate confidence for future executor or memory adapters; Hermes' session lineage differs from llame's Chat/Run model.

**Caution:** recalled data is described as authoritative reference data inside a known wrapper. That framing does not provide tenant authorization, provenance enforcement, or isolation between users.

### Seal

- **Upstream:** [vercel-labs/seal](https://github.com/vercel-labs/seal)
- **Stack:** Python, FastAPI, Vercel Workflows/AI SDK, Vite
- **Observed:** 2026-09-10 @ `7724faa0c71c744a44751dcf15d666a296e8badb`

High-confidence mechanism reference; moderate confidence in longer-term reuse
from this example app. Relevant to future approvals and child Runs, with useful
reconnect test cases for the current stream contract.

**Study**

1. **F10: Durable parent/child completion.** A [session workflow](https://github.com/vercel-labs/seal/blob/7724faa0c71c744a44751dcf15d666a296e8badb/backend/agent/driver.py)
   starts turn workflows and waits on typed hooks. The [subagent tool](https://github.com/vercel-labs/seal/blob/7724faa0c71c744a44751dcf15d666a296e8badb/backend/agent/turn.py#L210-L257)
   starts a child turn, records its identity, and awaits durable completion.
   Study the lifecycle mapping while retaining llame-owned Chat/Run identities.
2. **F11: Cursor before resume.** [Approval submission](https://github.com/vercel-labs/seal/blob/7724faa0c71c744a44751dcf15d666a296e8badb/backend/app/chat.py#L101-L117)
   calculates the continuation cursor before resuming a batch of decisions,
   so resumed output cannot advance past the cursor before it is captured.
   A concrete ordering invariant for a future persisted approval pause.
3. **F12: Reconnect and nested output.** The [stream adapter](https://github.com/vercel-labs/seal/blob/7724faa0c71c744a44751dcf15d666a296e8badb/backend/app/chat.py)
   tails child progress into preliminary nested output; completed child messages
   support reconstruction on reload. Contract tests cover [parallel approvals](https://github.com/vercel-labs/seal/blob/7724faa0c71c744a44751dcf15d666a296e8badb/backend/tests/test_contract.py#L194-L230)
   and reload behavior. These are useful test scenarios, not evidence that
   llame needs Vercel's workflow storage.

**Caution:** This demo has no authenticated approval identity or owner-scoped
access model, and child turns explicitly set `gated=False` to run bash without
approval. A child lacking approval UI must not gain authority in llame. Keep
llame's RLS, immutable context receipts, native mutation fencing, and existing
PostgreSQL/pg-boss execution path.

### Open WebUI

- **Upstream:** [open-webui/open-webui](https://github.com/open-webui/open-webui/tree/0a7c15832fb30b1903753e83f81dc7d27e5b0944)
- **Stack:** Python/FastAPI, SQLAlchemy, SvelteKit, SQLite or PostgreSQL; Open WebUI License
- **Observed:** 2026-09-10 @ `0a7c15832fb30b1903753e83f81dc7d27e5b0944`

A reference for application-level multi-user sharing and permission-filtered tool
catalogs. Moderate confidence for reuse in future llame sharing capabilities;
its access predicates need to coexist with llame's datastore-enforced isolation.

**Study**

1. **Reusable resource grants.** [`AccessGrant` and permission filtering](https://github.com/open-webui/open-webui/blob/0a7c15832fb30b1903753e83f81dc7d27e5b0944/backend/open_webui/models/access_grants.py#L25-L45) and [owner, group, public access checks](https://github.com/open-webui/open-webui/blob/0a7c15832fb30b1903753e83f81dc7d27e5b0944/backend/open_webui/models/access_grants.py#L562-L620) provide a candidate shape for future Knowledge or project sharing.
2. **Tool visibility.** [MCP server access and per-user credential resolution](https://github.com/open-webui/open-webui/blob/0a7c15832fb30b1903753e83f81dc7d27e5b0944/backend/open_webui/routers/tools.py#L135-L190) demonstrates filtering the catalog before exposing server tools.

**Caution:** Authorization is enforced in application queries, with administrative bypasses; omitting one filter is a security defect. This provides no evidence for tenant isolation or RLS.

### Vercel Chatbot (formerly ai-chatbot)

- **Upstream:** [vercel/chatbot](https://github.com/vercel/chatbot/tree/c2f8235e1f3ea903ad8b7f61447c4f74164b5c58)
- **Stack:** Next.js, React, AI SDK, Drizzle, PostgreSQL, optional Redis; Apache-2.0
- **Observed:** 2026-09-10 @ `c2f8235e1f3ea903ad8b7f61447c4f74164b5c58`

A compact reference for role-plus-parts message persistence and request admission.
High confidence in those implementation comparisons; its route-owned execution
differs from llame's durable pg-boss Runs.

**Study**

1. **Message projection.** [`Chat` and `Message_v2` schema](https://github.com/vercel/chatbot/blob/c2f8235e1f3ea903ad8b7f61447c4f74164b5c58/lib/db/schema.ts#L28-L53) is useful comparative evidence for role-plus-parts persistence and display attachments.
2. **Request policy.** [Auth, model allowlist, and owner check](https://github.com/vercel/chatbot/blob/c2f8235e1f3ea903ad8b7f61447c4f74164b5c58/app/%28chat%29/api/chat/route.ts#L70-L133) plus the [bounded tool loop](https://github.com/vercel/chatbot/blob/c2f8235e1f3ea903ad8b7f61447c4f74164b5c58/app/%28chat%29/api/chat/route.ts#L269-L305) show a small admission-and-execution boundary.

**Caution:** `getChatById` queries by ID alone, so callers must enforce ownership; the application path has no datastore RLS.

### agent-memory

- **Upstream:** [xChuCx/agent-memory](https://github.com/xChuCx/agent-memory)
- **Stack:** Go; Markdown stores; SQLite FTS5; git; MCP stdio server
- **Observed:** 2026-09-10 @ `e42f455865538a59110c6510ae8e340969feb810`

Small, current reference for staged Markdown memory, imported-store pinning, inline provenance, and write-time secret/PII rejection. Its retrieval evaluation is a deterministic search regression fixture; its [behavioral evaluation is explicitly a scaffold with no published number](https://github.com/xChuCx/agent-memory/blob/e42f455865538a59110c6510ae8e340969feb810/eval/behavioural/README.md#L11-L37). Applicability is moderate for llame's owner-scoped Knowledge operations and any later imported-store capability.

**Study**

1. **Imported versus local pinning.** [`stores.lock`](https://github.com/xChuCx/agent-memory/blob/e42f455865538a59110c6510ae8e340969feb810/internal/config/stores_lock.go#L12-L75) records resolved commits for imported stores and marks non-git local paths `Unlocked`; [federation skips unrecorded material](https://github.com/xChuCx/agent-memory/blob/e42f455865538a59110c6510ae8e340969feb810/internal/memory/fetch_stores.go#L10-L25). High confidence applicability to llame's Knowledge imports and explicit uncertainty.
2. **Provenance and write gates.** [Rendered chunks carry origin and evidence framing](https://github.com/xChuCx/agent-memory/blob/e42f455865538a59110c6510ae8e340969feb810/internal/memory/fetch.go#L540-L559), while [secret/PII findings reject the final bytes](https://github.com/xChuCx/agent-memory/blob/e42f455865538a59110c6510ae8e340969feb810/internal/memory/update.go#L464-L492) before staging. Moderate confidence for comparison with llame's native file operations; llame's owner and approval model remains separate.

**Caution:** local memory is not content-addressed: [`Commit`](https://github.com/xChuCx/agent-memory/blob/e42f455865538a59110c6510ae8e340969feb810/internal/git/commit.go#L45-L86) returns an informational SHA and can swallow `rev-parse` failure. Do not treat it as a verified read snapshot.

### gbrain

- **Upstream:** [garrytan/gbrain](https://github.com/garrytan/gbrain)
- **Stack:** TypeScript; Markdown repository; Postgres/PGLite retrieval projection
- **Observed:** 2026-09-10 @ `43597b19e50a3abf56409337f248f7966860293c`

Personal knowledge brain whose Markdown files are the system of record and whose database supports retrieval and graph queries. It is a narrow, high-confidence reference for source-versus-projection boundaries and durable forget semantics. llame already treats Knowledge as owner-scoped Markdown; the useful comparison is write and rebuild discipline rather than gbrain's database or security posture.

**Study**

1. **Fence-first persistence.** [The system-of-record contract](https://github.com/garrytan/gbrain/blob/43597b19e50a3abf56409337f248f7966860293c/docs/architecture/system-of-record.md#L3-L18) makes Postgres disposable and rebuildable from Markdown; [forget rewrites the canonical fence](https://github.com/garrytan/gbrain/blob/43597b19e50a3abf56409337f248f7966860293c/docs/architecture/system-of-record.md#L125-L142), so deletion survives index reconstruction. High confidence applicability to llame's existing native Knowledge file operations, subject to its `kb://` locator and owner authorization.
2. **Layered untrusted-data framing.** [`sanitize.ts`](https://github.com/garrytan/gbrain/blob/43597b19e50a3abf56409337f248f7966860293c/src/core/think/sanitize.ts#L54-L105) applies structural tags, pattern stripping, length limits, and tells the model that retrieved material is data rather than instructions. Moderate confidence for llame context assembly; it still requires llame's authorization and provenance checks.

**Caution:** [RLS is enabled with no policies](https://github.com/garrytan/gbrain/blob/43597b19e50a3abf56409337f248f7966860293c/src/schema.sql#L1563-L1618), for deployments using a bypass role. This is not a per-tenant policy model to copy into llame. Deep dive: [2026-07-09-gbrain.md](../long-term-memory/2026-07-09-gbrain.md).

### Continue

- **Upstream:** [continuedev/continue](https://github.com/continuedev/continue)
- **Stack:** TypeScript monorepo; IDE extensions and CLI; Apache-2.0
- **Observed:** 2026-09-10 @ `5522c6f44ca0ac3528b37244818fbfa39b5af470`

High-confidence reference for llame's future CLI, profiles, and tool policy.
Scope this comparison to the inspected CLI implementation.

**Study**

1. **F4: Shared execution across surfaces.** [Interactive and headless entrypoints](https://github.com/continuedev/continue/blob/5522c6f44ca0ac3528b37244818fbfa39b5af470/extensions/cli/src/commands/chat.ts)
   initialize shared services and use the same streaming loop; local sessions
   support resume and history forks. Relevant to a first-party llame CLI over
   the existing Chat/Run core, without a parallel session authority.
2. **F5: Policy compilation.** [Precedence resolution](https://github.com/continuedev/continue/blob/5522c6f44ca0ac3528b37244818fbfa39b5af470/extensions/cli/src/permissions/precedenceResolver.ts)
   combines CLI flags, user YAML, and defaults into `allow`/`ask`/`exclude`.
   Argument-aware checks cover selected tool fields; [request filtering](https://github.com/continuedev/continue/blob/5522c6f44ca0ac3528b37244818fbfa39b5af470/extensions/cli/src/stream/handleToolCalls.ts#L172-L195)
   omits tools classified `ask` in headless mode. Useful for future approvals,
   provided llame resolves policy from trusted owner scope and records outcomes.
3. **F6: File-based agent composition.** [Markdown agent files](https://github.com/continuedev/continue/blob/5522c6f44ca0ac3528b37244818fbfa39b5af470/packages/config-yaml/src/markdown/agentFiles.ts)
   combine prompt text with model, rules, and built-in/MCP tool selection.
   Study the composition surface for Profiles/Skills; a file selecting a tool
   must never grant llame authority to execute it.

**Caution:** The [beta subagent executor](https://github.com/continuedev/continue/blob/5522c6f44ca0ac3528b37244818fbfa39b5af470/extensions/cli/src/subagent/executor.ts#L54-L122)
temporarily replaces shared permissions with `* allow` and disables shared
history while running an in-memory child. This conflicts with llame's intended
inspectable child Chats/Runs and bounded inherited authority. Local session
files and permission YAML are single-user state, not tenant isolation or
durable execution recovery.

### beads

- **Upstream:** [gastownhall/beads](https://github.com/gastownhall/beads)
- **Stack:** Go + Dolt, MIT
- **Observed:** 2026-09-10 @ `a690b0a8c4d1ddc4f0bd9bf767499625dd71bc96`

Distributed issue graph; high-confidence reference for deferred goals and work
coordination. Keep llame's [episodic memory](../../../SPEC.md#20-memory-and-search)
in Chats/Runs and its Knowledge in files.

**Study**

1. **F1: Readiness and claiming.** Typed dependencies distinguish blockers,
   hierarchy, and `discovered-from` provenance. [Ready-work computation](https://github.com/gastownhall/beads/blob/a690b0a8c4d1ddc4f0bd9bf767499625dd71bc96/internal/storage/issueops/ready_work.go#L44-L72)
   expands parent descendants before building SQL; [ready-and-claim](https://github.com/gastownhall/beads/blob/a690b0a8c4d1ddc4f0bd9bf767499625dd71bc96/internal/storage/issueops/claim.go#L245-L300)
   uses one transaction. Useful for future goal scheduling without making the
   model responsible for concurrency.
2. **F2: Liveness separate from history.** Clone-local leases avoid recording
   every heartbeat in Dolt history. The [co-mutation invariant](https://github.com/gastownhall/beads/blob/a690b0a8c4d1ddc4f0bd9bf767499625dd71bc96/internal/storage/issueops/lease.go#L45-L87)
   names which claim/status writers must serialize with reclaim. Study the
   invariant; llame already has PostgreSQL locking and pg-boss recovery.
3. **F3: Explicit trace retention.** [Wisps](https://github.com/gastownhall/beads/blob/a690b0a8c4d1ddc4f0bd9bf767499625dd71bc96/docs/workflows/wisps.md)
   can be discarded or [squashed into a durable digest](https://github.com/gastownhall/beads/blob/a690b0a8c4d1ddc4f0bd9bf767499625dd71bc96/cmd/bd/mol_squash.go#L268-L300). A future llame digest
   could summarize an outcome, but must not replace source messages or the
   event history required by its replay/provenance contract.

**Caution:** [Memory injection](https://github.com/gastownhall/beads/blob/a690b0a8c4d1ddc4f0bd9bf767499625dd71bc96/cmd/bd/prime.go#L519-L587)
is alphabetic flat KV without timestamps. Its elision count and browse command
are useful; its byte cap can be exceeded by the first entry. The
[HTTP authentication](https://github.com/gastownhall/beads/blob/a690b0a8c4d1ddc4f0bd9bf767499625dd71bc96/internal/httpapi/auth.go#L16-L27)
accepts shared bearer tokens for the whole surface, without user identity or
per-record authorization.

**Deep dives**

- [docs/research/long-term-memory/2026-07-09-beads.md](../long-term-memory/2026-07-09-beads.md)

### Fabric

- **Upstream:** [danielmiessler/fabric](https://github.com/danielmiessler/fabric)
- **Stack:** Go CLI/server, filesystem-backed patterns, contexts, and sessions; MIT
- **Observed:** 2026-09-10 @ `b682dad740f24e85ce9a48d23babc6780dd476ac`

High-confidence narrow reference for prompt assets; moderate applicability to
future Profiles/Skills. [Pattern loading](https://github.com/danielmiessler/fabric/blob/b682dad740f24e85ce9a48d23babc6780dd476ac/internal/plugins/db/fsdb/patterns.go)
supports named files, explicit variables, an input insertion point, and custom
overrides. [Request assembly](https://github.com/danielmiessler/fabric/blob/b682dad740f24e85ce9a48d23babc6780dd476ac/internal/core/chatter.go#L218-L346)
composes patterns with reusable context and strategies. This informs llame's
file-native profile direction: resolve composition through trusted code and bind
the effective result to the Run receipt.

Its [extension registry](https://github.com/danielmiessler/fabric/blob/b682dad740f24e85ce9a48d23babc6780dd476ac/internal/plugins/template/extension_registry.go#L238-L275)
checks both definition and executable hashes before returning an extension.
Useful drift-detection prior art for future installed executable capabilities;
the hashes do not establish trust or prevent a replacement after the check.

**Caution:** Template expansion can invoke file, network, and executable plugins
during prompt construction. [Extension execution](https://github.com/danielmiessler/fabric/blob/b682dad740f24e85ce9a48d23babc6780dd476ac/internal/plugins/template/extension_executor.go#L31-L152)
uses unsandboxed `sh -c` with inherited process environment; only the file-output
path applies its timeout. These mechanisms require llame's explicit tool and
executor authority, not permission inferred from a prompt asset. Local JSON
sessions and a global server API key do not supply llame's durable Runs or
owner isolation. Study assets and integrity checks without importing a second
session store or ambient execution into prompt rendering.

### Zeroshot

- **Upstream:** [the-open-engine/zeroshot](https://github.com/the-open-engine/zeroshot)
- **Stack:** Rust; SQLite local ledger; cluster protocol adapters; MIT
- **Observed:** 2026-09-10 @ `e1d66438ccfd91e3296deea5482204baeacc7cee`

High-confidence reference for deferred meta-harness orchestration. Codex and
Claude execute nodes in a caller-authored graph. This is later work under
[VISION.md](../../../VISION.md#runs-are-the-unit-of-execution), not a dependency
of llame's current single-agent knowledge loop.

**Study**

1. **F7: Validate control flow before execution.** The [graph verifier](https://github.com/the-open-engine/zeroshot/blob/e1d66438ccfd91e3296deea5482204baeacc7cee/crates/openengine-cluster-server/src/graph_verifier.rs#L20-L79)
   checks a typed graph before worker lookup. Its [bound analyzer](https://github.com/the-open-engine/zeroshot/blob/e1d66438ccfd91e3296deea5482204baeacc7cee/crates/openengine-cluster-server/src/graph_verifier/analyzer_bounds.rs)
   folds sequence, parallel, loop, and map structure into execution/concurrency
   ceilings. Borrow deterministic admission and bounded repair; adopting the
   entire graph language would be a separate architecture decision.
2. **F8: Explicit reconnect behavior.** The [local ledger](https://github.com/the-open-engine/zeroshot/blob/e1d66438ccfd91e3296deea5482204baeacc7cee/zeroshot/src/v2_run_ledger/sqlite.rs)
   appends events and updates the projection transactionally. The [watch contract](https://github.com/the-open-engine/zeroshot/blob/e1d66438ccfd91e3296deea5482204baeacc7cee/docs/reference/cluster/watch.md#L57-L83)
   specifies at-least-once delivery, cursor-based deduplication, and slow-consumer
   closure with a resumable cursor. Compare those guarantees with llame's Run
   reconnect behavior; keep PostgreSQL and pg-boss as its current authority.
3. **F9: Bind roles outside model output.** An immutable [node role plan](https://github.com/the-open-engine/zeroshot/blob/e1d66438ccfd91e3296deea5482204baeacc7cee/zeroshot/src/native_v2_runner/plan.rs#L3-L69)
   rejects changed worker/instruction/runtime bindings and assigns verifier
   read-only versus worker/delivery exclusive workspace access. This informs
   future peer adapters whose scope is resolved by llame, not by an agent's
   claimed role.

**Caution:** A read-only workspace role alone is not proof of OS confinement.
The [local target](https://github.com/the-open-engine/zeroshot/blob/e1d66438ccfd91e3296deea5482204baeacc7cee/docs/concepts/targets.md)
uses the caller's worktree and host-user authority; the direct target delegates
authentication to its deployment boundary. Its graph and local ledger do not
provide llame's RLS tenancy or authorize cross-node execution transfer.

### OKF (Open Knowledge Format)

- **Upstream:** [GoogleCloudPlatform/open-knowledge-format](https://github.com/GoogleCloudPlatform/open-knowledge-format)
- **Stack:** Markdown/YAML specification and Python reference agent; Apache-2.0
- **Observed:** 2026-09-10 @ `ad30107c31c06aec8a7d5636e0d1058118604e6f`

High-confidence reference for optional Knowledge provenance metadata. Its
[conformance rules](https://github.com/GoogleCloudPlatform/open-knowledge-format/blob/ad30107c31c06aec8a7d5636e0d1058118604e6f/SPEC.md#L736-L764)
require typed frontmatter in every non-reserved Markdown file. Making that a
Knowledge Space requirement would exclude existing owner notes; retain llame's
arbitrary-file read contract.

**Study**

1. **Authorship and verification.** [Separate fields](https://github.com/GoogleCloudPlatform/open-knowledge-format/blob/ad30107c31c06aec8a7d5636e0d1058118604e6f/SPEC.md#L366-L410)
   distinguish content generation from a list of independent verification events.
   Useful vocabulary for future recoverable agent writes, where an edit and a
   factual recheck have different provenance.
2. **Explicit freshness declaration.** [`stale_after`](https://github.com/GoogleCloudPlatform/open-knowledge-format/blob/ad30107c31c06aec8a7d5636e0d1058118604e6f/SPEC.md#L424-L432)
   is an absolute timestamp. A consumer can compare it with the current time;
   this is an authored expiry rule, not evidence that the content remains true
   before that instant.

**Caution:** Trust tiers are derived from declared actor names and are explicitly
advisory. A `human:` label supplies neither authenticated verification nor
access control. llame would still enforce ownership, safe filesystem access,
and model-input trust outside the Markdown metadata. Reserved `index.md` and
`log.md` conventions also prevent treating an arbitrary existing vault as an
already-conformant OKF bundle.

### OpenMausBot

- **Upstream:** [milind-soni/OpenMausBot](https://github.com/milind-soni/OpenMausBot)
- **Stack:** TypeScript local app/server; Apache-2.0 main tree, separately licensed enterprise directory
- **Observed:** 2026-09-10 @ `ca61118787f687749eb1251bc3007e4d7d7bdd93`

High-confidence reference for model-facing control and portable profile imports.
Study selected boundaries rather than importing its bots/rooms/runtime model.

**Study**

1. **F16: Preserve unavailable provider instances.** The [registry](https://github.com/milind-soni/OpenMausBot/blob/ca61118787f687749eb1251bc3007e4d7d7bdd93/server/harness/registry.ts#L76-L124)
   retains unknown or failed drivers as unavailable entries with reasons. The
   [event bus](https://github.com/milind-soni/OpenMausBot/blob/ca61118787f687749eb1251bc3007e4d7d7bdd93/server/harness/bus.ts#L27-L90)
   rejects cross-driver events and stamps provider-instance identity. Useful
   adapter correlation and degradation behavior for future llame peer executors.
2. **F17: Small external control surface.** The [MCP interface](https://github.com/milind-soni/OpenMausBot/blob/ca61118787f687749eb1251bc3007e4d7d7bdd93/docs/mcp-server.md)
   excludes approval grants, credentials, deletion, and VM lifecycle. Its
   [implementation](https://github.com/milind-soni/OpenMausBot/blob/ca61118787f687749eb1251bc3007e4d7d7bdd93/scripts/mcp-server.ts)
   validates bounded inputs, projects result fields, checks task-to-bot/channel
   association, and supports cancellable waits with distinct needs-user and
   timeout outcomes. Relevant to future external Run control; task association
   checks do not replace authenticated owner authorization.
3. **F18: Import descriptions without privileges.** [Persona import](https://github.com/milind-soni/OpenMausBot/blob/ca61118787f687749eb1251bc3007e4d7d7bdd93/server/team-manifest.ts#L210-L272)
   constructs an explicit field allowlist, excluding approval policy, connectors,
   computer access, and host paths. The [package schema](https://github.com/milind-soni/OpenMausBot/blob/ca61118787f687749eb1251bc3007e4d7d7bdd93/server/bot-package.ts)
   validates local references and requires imported routines to remain disabled.
   This directly informs future llame Profiles/Skills import: setup intent and
   human-readable instructions cannot carry an execution grant.

**Caution:** The event bus warns on NDJSON append failure and continues live
delivery, so its log is not sufficient for llame's authoritative durable Run
record. Its redaction applies to the persisted copy; the bus passes the original
event to live subscribers. Local JSON state and pairing/session checks do not
establish llame's PostgreSQL/RLS boundary. In persona import, the caller must
also force `composio: false`: omission alone enables that connector, as the
import function's contract explicitly warns.

### Buzz

- **Upstream:** [block/buzz](https://github.com/block/buzz/tree/051c3a270be9c73da9ab06700bcab7d5552fceaa)
- **Stack:** Rust monorepo with TypeScript/Tauri desktop and Dart/Flutter mobile; Apache 2.0
- **Observed:** 2026-09-10 @ `051c3a270be9c73da9ab06700bcab7d5552fceaa`

Buzz is a self-hosted Nostr workspace where humans and agents share a signed event log. Its useful material is the explicit security contract around tenant context and synchronization. The relay derives a community from the connection host before handlers run, and its formal model states the deployment assumptions needed for RLS. NIP-RS also treats completeness as a state that must be established before destructive synchronization. Borrow these boundaries while keeping llame's durable pg-boss Run model.

**Study**

1. **F22: Deployment obligations.** The [multi-tenant axioms](https://github.com/block/buzz/blob/051c3a270be9c73da9ab06700bcab7d5552fceaa/docs/multi-tenant-relay.md#L344-L374) turn RLS, `NOBYPASSRLS`/`FORCE`, transaction-local scope, trusted functions, and tenant-qualified constraints into reviewable obligations; the [conformance row](https://github.com/block/buzz/blob/051c3a270be9c73da9ab06700bcab7d5552fceaa/docs/multi-tenant-conformance.md#L14-L36) binds every request to host-derived context.
2. **F23: Trusted tenant context.** [`TenantContext`](https://github.com/block/buzz/blob/051c3a270be9c73da9ab06700bcab7d5552fceaa/crates/buzz-core/src/tenant.rs#L1-L15) carries server-resolved identity and has no client deserialization path. The [conformance contract](https://github.com/block/buzz/blob/051c3a270be9c73da9ab06700bcab7d5552fceaa/docs/multi-tenant-conformance.md#L25-L30) requires rejecting host/token disagreement.
3. **F24: Incomplete synchronization.** [NIP-RS completeness](https://github.com/block/buzz/blob/051c3a270be9c73da9ab06700bcab7d5552fceaa/docs/nips/NIP-RS.md#L370-L377) forbids canonicalization, deletion, or success claims from an incomplete load.

**Applicability:** High for RLS and trusted scope binding; high for future Personal Realm synchronization; moderate for audit-log mechanics. **Confidence:** High for the documented contracts; moderate for implementation-wide compliance. **Caution:** the formal guarantees are conditional on deployment assumptions, the relay remains centralized, and Buzz's [workflow approval path](https://github.com/block/buzz/blob/051c3a270be9c73da9ab06700bcab7d5552fceaa/crates/buzz-workflow/src/lib.rs#L229-L254) still has runtime gaps. Treat the documents as conformance requirements and audit targets, not proof that every deployed path satisfies them.

### nanoclaw

- **Upstream:** [nanocoai/nanoclaw](https://github.com/nanocoai/nanoclaw)
- **Stack:** TypeScript personal bot host with Linux containers; MIT
- **Observed:** 2026-09-10 @ `2c754a2234390fcc597273cef6344d99e8ac03d0`

NanoClaw routes messaging channels into agent-group sessions and runs agent work
inside per-session containers. Moderate-confidence reference for executor
isolation and host/container messaging in a single-user bot host.

**Study**

1. **Explicit executor mounts.** `container-runner.ts` composes a `SessionSpec` from explicit mounts: session
   workspace and agent-group data are writable, while config, plugins, composed
   instructions, and skills are mounted read-only; extra/provider mounts are
   allowlisted ([mount construction](https://github.com/nanocoai/nanoclaw/blob/2c754a2234390fcc597273cef6344d99e8ac03d0/src/container-runner.ts#L808-L1015)). This is a concrete
   executor isolation pattern if llame moves untrusted tools out of process.
2. **Host/container mailbox.** Host/container messaging uses a per-session mailbox backed by separate SQLite
   databases and sequence parity ([mailbox contract](https://github.com/nanocoai/nanoclaw/blob/2c754a2234390fcc597273cef6344d99e8ac03d0/docs/db-session.md#L72-L149)).
   Self-modification requests are separately approval-gated and validated
   ([self-modification requests](https://github.com/nanocoai/nanoclaw/blob/2c754a2234390fcc597273cef6344d99e8ac03d0/container/agent-runner/src/mcp-tools/self-mod.ts#L43-L210)).

**Caution**

The model/provider and channel integrations are partly external or branch-local;
the host has no user-account or database-RLS model. Its SQLite mailbox and
container mounts do not provide llame's authenticated ownership, pg-boss Run
identity, or provider/tool policy. Copy the boundary and approval seams only
after mapping them to llame's owner identity and fail-closed datastore rules.

### neural-code

- **Upstream:** [avbiswas/neural-code](https://github.com/avbiswas/neural-code)
- **Stack:** Python, OpenAI-compatible Chat Completions; educational implementation
- **Observed:** 2026-09-10 @ `e3d2b9b96ffe95cd9d2da53510401bbd124bbcf2`

Moderate-confidence inclusion as a small comparison implementation. Its
[child loop](https://github.com/avbiswas/neural-code/blob/e3d2b9b96ffe95cd9d2da53510401bbd124bbcf2/neuralcode/subagent.py)
starts fresh, caps execution at 12 turns, and returns a final report. That
parent-facing result shape is useful for future delegation; llame would retain
the child's underlying Chat/Run for inspection instead of discarding it.

[Context-pressure handling](https://github.com/avbiswas/neural-code/blob/e3d2b9b96ffe95cd9d2da53510401bbd124bbcf2/neuralcode/history.py)
caps fresh tool output, spills full text temporarily, then strips or drops
eligible older results while protecting a frozen prefix. Study the explicit
stages and disclosed truncation, not its destructive history mutations: llame's
source messages and declared compaction boundary remain authoritative. Spill
files expire at turn end, so their paths are not durable citations.

**Caution:** The child exclusion set names `write`, while the actual tool is
[`write_file`](https://github.com/avbiswas/neural-code/blob/e3d2b9b96ffe95cd9d2da53510401bbd124bbcf2/neuralcode/tools.py#L149-L160);
it does not enforce read-only exploration. [Sandbox selection](https://github.com/avbiswas/neural-code/blob/e3d2b9b96ffe95cd9d2da53510401bbd124bbcf2/neuralcode/sandbox.py#L30-L65)
falls back to an ordinary shell on Linux without bubblewrap and on Windows.
That fallback conflicts with VISION's rule against silently downgrading a
requested Sandbox to native execution. Local JSONL sessions provide neither
llame's tenant isolation nor durable Run recovery.

### ELAI

- **Upstream:** [DITlieD/ELAI-archive](https://github.com/DITlieD/ELAI-archive/tree/26bf2bc72d030a2d5ec022f04e1f9603bb285ae1)
- **Stack:** Rust workspace with Python and Svelte/Tauri components; MIT; abandoned
- **Observed:** 2026-09-10 @ `26bf2bc72d030a2d5ec022f04e1f9603bb285ae1`

ELAI is an archive of an abandoned harness experiment. Its value is accounting discipline: the author separates design goals, existing source, recorded fixtures, and claims that were never rebuilt or rerun. The README explicitly says its enforcement model is a goal, not proof that every path enforced it. This makes ELAI a negative reference for llame's evidence and completion contracts, not a runtime architecture to adopt.

**Study**

1. **F25: Reproducible evidence.** The [benchmark guide](https://github.com/DITlieD/ELAI-archive/blob/26bf2bc72d030a2d5ec022f04e1f9603bb285ae1/BENCHMARKS.md#L60-L70) requires the chain harness -> exact fixture -> saved result -> limitations and rejects registry or plan state as measurement. Use that evidence chain when evaluating llame changes.
2. **F26: Explicit unmeasured state.** [`ViewStatus::Unmeasured`](https://github.com/DITlieD/ELAI-archive/blob/26bf2bc72d030a2d5ec022f04e1f9603bb285ae1/.elai_cc/crates/orchestrator/src/governance_coverage.rs#L133-L145) makes missing producers and unreadable or empty evidence an explicit state instead of a synthetic score.
3. **F27: Default-off feature ownership.** The [wire-dark flag schema](https://github.com/DITlieD/ELAI-archive/blob/26bf2bc72d030a2d5ec022f04e1f9603bb285ae1/.elai_cc/wire-dark-allowlist.toml#L1-L28) requires an owner, expiry, promotion plan, and smoke test for default-off paths.

**Applicability:** High for evidence vocabulary and honest unmeasured states; low for adopting its orchestration. **Confidence:** High for the archive's stated limitations; low for any historical runtime claim. **Caution:** the [postmortem](https://github.com/DITlieD/ELAI-archive/blob/26bf2bc72d030a2d5ec022f04e1f9603bb285ae1/POSTMORTEM.md#L26-L42) says no application build or historical benchmark was rerun for the archive. Treat the patterns as source evidence and its historical runtime claims as unverified.
